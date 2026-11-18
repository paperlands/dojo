// Numeric obligations use world geometry; references, observation and ownership stay separate.
// (id:world-coordinate-phase-3)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { frameWorldTransform, worldTransform } from '../../../assets/js/turtling/scheduler.js'
import { AUTHORED, bindWorld, boundReferences } from '../../../assets/js/turtling/laws/authored.js'
import { bindLaw } from '../../../assets/js/turtling/laws/replacement.js'
import { validityDependents } from '../../../assets/js/turtling/laws/component.js'
import { SE3, AXIS_Y, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const near3 = (a, b) => a.length === 3 && b.length === 3 && Array.from(a).every((x, i) => Math.abs(x - b[i]) < 1e-8)
const IDENT = SE3.identity()
const BASE = SE3.rotateLocal(
    SE3.rotateLocal({ rotation: IDENT.rotation, position: [100, 20, 30] }, AXIS_Z, 90), AXIS_Y, 30)
const pos = f => frameWorldTransform(f).position
const toward = (frame, world) => SE3.unapply(worldTransform(frame), world)
const motion = (scheduler, frame, pose) => {
    const result = scheduler.requestMotion(frame, pose, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 4 })
    return result
}
const move = (scheduler, frame, world) => motion(scheduler, frame,
    { rotation: frame.transform.deref().rotation, position: toward(frame, world) })
const coordLaw = (host, A, axis, value) => bindLaw({
    feature: 'coordinate', axis, endpoints: [A.id], scope: host.id, frame: host.id, predicate: value,
})

test('a literal position is a world point, with no opt-in or chart metadata', () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', 'let A = (10, 20, 30)', BASE))
    drive(scheduler)
    const A = host.children.get('A')
    assert.ok(near3(pos(A), [10, 20, 30]))
    assert.ok(!near3(pos(A), SE3.apply(BASE, [10, 20, 30])), 'placement interpretation would fail')
    assert.equal(Object.hasOwn(scheduler.laws.active()[0], 'world'), false)
    const before = [...pos(host)]
    assert.equal(move(scheduler, host, [120, 25, 40]).kind, 'accept')
    assert.ok(!near3(pos(host), before), 'the owner really moved')
    assert.ok(near3(pos(A), [10, 20, 30]), 'owner motion supplies no geometric relationship')
})

test('a coordinate plane stays world-axis aligned through real owner rotation', () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', 'let A', BASE))
    drive(scheduler)
    const A = host.children.get('A')
    scheduler.laws.apply(coordLaw(host, A, 'y', 0))
    assert.equal(move(scheduler, A, [0, 0, 0]).kind, 'accept')
    const before = [...pos(A)]
    assert.equal(move(scheduler, A, [0, 1, 0]).kind, 'refuse')
    assert.deepEqual(pos(A), before, 'refusal preserves accepted geometry exactly')
    const oldRotation = frameWorldTransform(host).rotation
    assert.equal(motion(scheduler, host, SE3.rotateLocal(host.transform.deref(), AXIS_Z, 47)).kind, 'accept')
    assert.notDeepEqual(frameWorldTransform(host).rotation, oldRotation, 'the owner really rotated')
    assert.equal(move(scheduler, A, [3, 0, 5]).kind, 'accept')
    assert.ok(near3(pos(A), [3, 0, 5]))
    assert.equal(move(scheduler, A, [3, 1, 5]).kind, 'refuse')
})

test('a derived definition follows new observations through the existing acceptance pipeline', () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', 'let B\nlet A = (B.x, B.y, B.z)', BASE))
    drive(scheduler)
    const A = host.children.get('A'), B = host.children.get('B')
    assert.ok(near3(pos(A), pos(B)))
    assert.equal(move(scheduler, B, [12, -4, 6]).kind, 'accept')
    assert.ok(near3(pos(B), [12, -4, 6]))
    assert.ok(near3(pos(A), pos(B)), 'ordinary observed numbers still produce ordinary world geometry')
})

test('explicit distance retains being identities and geometric dependencies', () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', 'let A\nlet B\nas A do\n  let B.distance = 5\nend', BASE))
    drive(scheduler)
    const A = host.children.get('A'), B = host.children.get('B')
    const law = scheduler.laws.active().find(l => l.feature === 'distance')
    assert.deepEqual(new Set(law.endpoints), new Set([A.id, B.id]))
    assert.deepEqual(validityDependents([law], [{ id: B.id, aspect: 'position' }]), [law])
})

for (const feature of ['position', 'coordinate']) {
    test(`${feature}: no owner placement dependency or geometric reader`, () => {
        const value = feature === 'position' ? [10, 20, 30] : 20
        const law = bindLaw({ feature, endpoints: ['A'], scope: 'owner', frame: 'owner', axis: 'y', predicate: value })
        assert.deepEqual(boundReferences(law), [{ id: 'A', aspect: 'position' }])
        assert.deepEqual(validityDependents([law], [{ id: 'owner', aspect: 'placement' }]), [])
        const poison = () => { throw new Error('ownership must not supply geometry') }
        const ctx = { worldOf: () => [10, 20, 30], placementOf: poison, livePoseOf: poison }
        assert.equal(AUTHORED[feature].measure(law, ctx).status, 'valid')
        assert.ok(AUTHORED[feature].set(law, ctx))
        assert.ok(AUTHORED[feature].constraint(law, ctx).set)
        assert.equal(AUTHORED[feature].validate({ law, world: [10, 20, 30], ...ctx }).ok, true)
    })
}

test('retiring an owner retracts its numeric law while its independent target survives', () => {
    const scheduler = buildWorld({ admit: pass })
    const target = scheduler.hotSwapChild('target', fork('target', ''))
    drive(scheduler)
    const source = fork('owner', 'let target.position = (10, 20, 30)', BASE)
    source.env.scope = { target }
    const owner = scheduler.hotSwapChild('owner', source)
    drive(scheduler)
    assert.ok(near3(pos(target), [10, 20, 30]))
    const law = scheduler.laws.active().find(l => l.feature === 'position')
    assert.ok(law)
    assert.equal(law.scope, owner.id)
    assert.equal(move(scheduler, target, [11, 20, 30]).kind, 'refuse')
    scheduler.removeChild('owner')
    assert.equal(scheduler.registry.get(target.id), target, 'target is not retired with the owner')
    assert.equal(scheduler.laws.active().includes(law), false, 'ownership ends independently of geometry')
    assert.ok(near3(pos(target), [10, 20, 30]))
    assert.equal(move(scheduler, target, [11, 20, 30]).kind, 'accept')
})

test('a numeric literal centre is a world point, not an implicit reference construction', () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', 'let A\nlet distance(A,(10,20,30)) = 5', BASE))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    const A = host.children.get('A')
    const law = scheduler.laws.active().find(l => l.feature === 'distance')
    assert.deepEqual(law.expression.references, [A.id, { value: [10, 20, 30] }])
    assert.deepEqual(boundReferences(law), [{ id: A.id, aspect: 'position' }])
    assert.ok(Math.abs(Math.hypot(...pos(A).map((x, i) => x - [10, 20, 30][i])) - 5) < 1e-8)
})

test('explicit reference constructions keep their birth or live pose dependencies', () => {
    const frame = { id: 'B' }
    const ctx = bindWorld(() => frame, { live: () => ({ ...BASE, position: [200, 40, 60] }), placement: () => BASE })
    const birth = bindLaw({ feature: 'distance', endpoints: ['A', { frame: 'B', value: [1, 0, 0] }], scope: 'owner', frame: 'owner', predicate: 5 })
    const live = bindLaw({ feature: 'distance', endpoints: ['A', { frame: 'B', value: [1, 0, 0], relative: true }], scope: 'owner', frame: 'owner', predicate: 5 })
    assert.deepEqual(validityDependents([birth, live], [{ id: 'B', aspect: 'placement' }]), [birth])
    assert.deepEqual(validityDependents([birth, live], [{ id: 'B', aspect: 'position' }]), [live])
    assert.notDeepEqual(AUTHORED.distance.constraint(birth, { ...ctx, writerId: 'A' }).set,
        AUTHORED.distance.constraint(live, { ...ctx, writerId: 'A' }).set)
})


test('closed point consumers and pins use world geometry under a non-identity placement', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host',
        'def shape p do\n let mark = (p,20,30)\n goto p 20 30\nend\nlet fig = shape 10', BASE))
    drive(scheduler, { maxTicks: 80 })
    const fig = host.children.get('fig'), mark = fig.children.get('mark')
    assert.equal(fig.closed, true)
    assert.ok(near3(pos(fig), [10, 20, 30]))
    assert.ok(near3(pos(mark), [10, 20, 30]))
    assert.deepEqual(scheduler.errors, [])
    const ctx = bindWorld(id => scheduler.registry.get(id), { live: frameWorldTransform, placement: worldTransform })
    for (const law of scheduler.laws.active()) assert.equal(AUTHORED[law.feature].measure(law, ctx).status, 'valid')
})

test('cached construction placement cannot silently move a retained world pin', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host',
        'def shape p do\n let mark = (p,20,30)\n goto p 20 30\nend\nloop 2 do\n let fig = shape 10\n jmpto 200 50 40\nend', BASE))
    drive(scheduler, { maxTicks: 80 })
    const fig = host.children.get('fig'), mark = fig.children.get('mark')
    assert.equal(fig.runIncarnation, 1, 'an equal captured answer is not rebuilt')
    assert.ok(near3(pos(fig), [10, 20, 30]), 'the accepted answer survives refusal')
    assert.ok(near3(pos(mark), [10, 20, 30]))
    assert.ok(scheduler.errors.some(e => /conflicts.*position|position.*conflicts/.test(e.message)))
    const ctx = bindWorld(id => scheduler.registry.get(id), { live: frameWorldTransform, placement: worldTransform })
    for (const law of scheduler.laws.active()) assert.equal(AUTHORED[law.feature].measure(law, ctx).status, 'valid')
})

test('a stated hand placement checks descendant world pins before any publication', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host',
        'def shape p do\n let mark = (p,0,0)\nend\nlet fig = shape 10'))
    drive(scheduler)
    const fig = host.children.get('fig'), mark = fig.children.get('mark')
    const before = { origin: SE3.clone(fig.origin), fig: [...pos(fig)], mark: [...pos(mark)] }
    const revision = scheduler.motionRevision
    const answer = scheduler.requestMotion(fig, { ...frameWorldTransform(fig), position: [20, 0, 0] }, revision, 'world')
    assert.equal(answer.kind, 'refuse')
    assert.match(answer.message, /placement conflicts with the position law/)
    assert.deepEqual(fig.origin, before.origin)
    assert.deepEqual(pos(fig), before.fig)
    assert.deepEqual(pos(mark), before.mark)
    assert.equal(scheduler.motionRevision, revision)
})

test('a position obligation moves the head, not the retained placement or its independently pinned child', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host',
        'def shape p do\n let mark = (p,0,0)\n fw 1\nend\nlet fig = shape 10\nwait 1\nlet fig.position = (20,0,0)'))
    drive(scheduler)
    const fig = host.children.get('fig'), mark = fig.children.get('mark')
    assert.ok(near3(pos(fig), [20, 0, 0]))
    assert.ok(near3(fig.origin.position, [0, 0, 0]), 'a head edit is not a rigid placement')
    assert.ok(near3(pos(mark), [10, 0, 0]))
    assert.deepEqual(scheduler.errors, [])
    assert.equal(scheduler.laws.active().length, 2)
    const ctx = bindWorld(id => scheduler.registry.get(id), { live: frameWorldTransform, placement: worldTransform })
    for (const law of scheduler.laws.active()) assert.equal(AUTHORED[law.feature].measure(law, ctx).status, 'valid')
})


for (const [feature, value] of [['tilt', 90], ['bearing', 90]]) {
    test(`${feature}: an installation retains the receiver placement reference, not source placement`, () => {
        const scheduler = buildWorld({ admit: pass })
        const receiver = scheduler.hotSwapChild('receiver', fork('receiver', 'yaw 37', BASE))
        const target = scheduler.hotSwapChild('target', fork('target', '', { ...IDENT, position: [110, 20, 30] }))
        drive(scheduler)
        const source = fork('owner', `def impose a b do\n as b do\n let a.${feature} = ${value}\n end\nend\nimpose target receiver`, { ...IDENT, position: [500, -300, 100] })
        source.env.scope = { target, receiver }
        const owner = scheduler.hotSwapChild('owner', source)
        drive(scheduler)
        assert.deepEqual(scheduler.errors, [])
        const law = scheduler.laws.active().find(l => l.feature === feature)
        assert.ok(law)
        assert.equal(law.expression.frame, receiver.id, 'geometry names the retained receiver')
        assert.equal(law.scope, scheduler.installationsOf(owner)[0].frame.id, 'the installation owns authority')
        assert.deepEqual(validityDependents([law], [{ id: receiver.id, aspect: 'placement' }]), [law])
        const ctx = bindWorld(id => scheduler.registry.get(id), { live: frameWorldTransform, placement: worldTransform })
        assert.equal(AUTHORED[feature].measure(law, ctx).status, 'valid')
        assert.ok(near3(pos(target), [110, 20, 30]), 'a satisfied obligation need not displace its being')
        scheduler.removeChild('owner')
        assert.equal(scheduler.registry.get(target.id), target)
        assert.equal(scheduler.laws.active().includes(law), false)
    })
}
