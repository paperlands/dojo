// Lexical identity and world geometry stay separate from installation authority.
// The installation remains the reader, authority and continuation. (id:being-facets-situated)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, at } from './harness.mjs'
import { frameWorldTransform, resolveBinding } from '../../../assets/js/turtling/scheduler.js'
import { SE3, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const round = (values) => values.map(value => +value.toFixed(8))
const position = (frame) => round(frameWorldTransform(frame).position)
const pass = ({ requested }) => ({ accepted: true, transform: requested })

function scene({ angle = 90, law = 'z', admit = pass, admitAsync } = {}) {
    const scheduler = buildWorld({ admit, admitAsync })
    const base = SE3.rotateLocal(at(10, 20), AXIS_Z, angle)
    const preyWorld = SE3.apply(base, [3, 4, 0])
    const room = scheduler.hotSwapChild('room', fork('room', `jmpto ${preyWorld.join(' ')}
let prey
jmpto ${base.position.join(' ')}
let receiver
let receiver.${law} = ${base.position[law === 'y' ? 1 : 2]}`, base))
    for (let i = 0; i < 4; i++) scheduler.tick(i * 1000)
    const prey = room.children.get('prey'), receiver = room.children.get('receiver')
    assert.deepEqual(position(room), [10, 20, 0])
    assert.deepEqual(position(prey), round(SE3.apply(base, [3, 4, 0])))
    assert.deepEqual(position(receiver), [10, 20, 0])
    assert.deepEqual(round([resolveBinding(receiver, 'prey.x'), resolveBinding(receiver, 'prey.y')]), round(preyWorld.slice(0, 2)))

    function attach(body, bindings = {}, prefix = '') {
        const spec = fork('owner', `${prefix}def follow a b do
  as b do
    ${body}
  end
end
follow prey receiver`, at(500))
        spec.env.scope = { prey, receiver, ...bindings }
        const owner = scheduler.hotSwapChild('owner', spec)
        return { owner, installation: scheduler.installationsOf(owner)[0].frame }
    }
    function pump() {
        for (let i = 4; i < 24; i++) scheduler.tick(i * 1000)
        assert.deepEqual(scheduler.errors, [])
    }
    return { scheduler, room, prey, receiver, base, attach, pump }
}

for (const angle of [0, 90, 180]) {
    test(`a retained neighbourhood point guides the receiver in world coordinates; angle=${angle}`, () => {
        const s = scene({ angle })
        const { owner } = s.attach('faceto a.x a.y\n    fw 5')
        s.pump()
        assert.deepEqual(position(s.receiver), position(s.prey))
        assert.deepEqual(position(owner), [500, 0, 0])
        assert.ok(s.scheduler.laws.active().some(law => law.endpoints.includes(s.receiver.id)))
    })
}

test("the receiver's original law refuses a situated venture", () => {
    const s = scene({ law: 'y' })
    const { owner } = s.attach('faceto a.x a.y\n    fw 5')
    s.pump()
    assert.deepEqual(position(s.receiver), [10, 20, 0])
    assert.deepEqual(position(owner), [500, 0, 0])
    assert.ok(s.scheduler.laws.active().some(law => law.endpoints.includes(s.receiver.id)))
})

test('the command basis is birth, not the receiver\'s current cursor or orientation', () => {
    const s = scene()
    const cursor = SE3.rotateLocal(at(1, 1), AXIS_Z, 37)
    assert.equal(s.scheduler.requestMotion(s.receiver, cursor, s.scheduler.motionRevision).kind, 'accept')
    s.attach(`faceto a.x a.y\n    fw ${Math.sqrt(13)}`)
    s.pump()
    assert.deepEqual(position(s.receiver), position(s.prey))
})

test('receiver reference does not change lexical scalar or participant binding', () => {
    const s = scene()
    const { owner, installation } = s.attach('wait 100\n    faceto a.x a.y\n    fw len', {}, 'let len = 5\n')
    s.receiver.params = new Map([['len', 99]])
    assert.equal(installation.parent, owner)
    s.scheduler.tick(101000)
    for (let i = 102; i < 126; i++) s.scheduler.tick(i * 1000)
    assert.deepEqual(position(s.receiver), position(s.prey))
    assert.deepEqual(position(owner), [500, 0, 0])
    assert.deepEqual(s.scheduler.errors, [])
})

test('reserved spatial views are world-valued, not reader-relative', () => {
    const s = scene()
    const { installation } = s.attach('wait 100')
    assert.deepEqual([resolveBinding(installation, 'world.x'), resolveBinding(installation, 'world.y')], [500, 0])
    assert.deepEqual(round([resolveBinding(installation, 'origin.x'), resolveBinding(installation, 'origin.y')]), [0, 0])
})

test('an observation retains the target world pose across real target movement', () => {
    const s = scene()
    const { installation } = s.attach('wait 100')
    const evaluator = installation.deps.mathEvaluator
    const before = position(s.prey)
    evaluator.beginObservation()
    try {
        const moved = { ...s.prey.transform.deref(), position: [2, 1, 0] }
        assert.equal(s.scheduler.requestMotion(s.prey, moved, s.scheduler.motionRevision).kind, 'accept')
        assert.notDeepEqual(position(s.prey), before, 'the target really moved')
        const scope = { a: s.prey }
        assert.deepEqual(round(['x', 'y'].map(axis => evaluator.run(installation.deps.mathParser.parse(`a.${axis}`), scope))), before.slice(0, 2))
    } finally { evaluator.endObservation() }
    assert.deepEqual(round(['x', 'y'].map(axis => evaluator.resolveSubjectFacet(s.prey, axis))), position(s.prey).slice(0, 2))
})

test('faceto reads one snapshot and retries the whole command after a changed input', () => {
    const attempts = []
    const s = scene({ admit: request => {
        if (request.command === 'faceto') attempts.push(request)
        return pass(request)
    } })
    const { owner, installation } = s.attach('wait 1\n    faceto a.x a.y\n    fw 5')
    const evaluator = installation.deps.mathEvaluator
    const read = evaluator.resolveSubjectFacet
    let moved = false
    evaluator.resolveSubjectFacet = (being, property, args) => {
        const value = read(being, property, args)
        if (!moved && being === s.prey && property === 'x') {
            moved = true
            assert.equal(s.scheduler.requestMotion(s.prey, at(1, -1), s.scheduler.motionRevision).kind, 'accept')
        }
        return value
    }
    s.pump()
    assert.equal(attempts.length, 2, 'a stale command is reread once, not partially retained')
    assert.ok(attempts.every(request => Number.isInteger(request.baseRevision)))
    assert.deepEqual(round(SE3.apply(attempts[0].requested, [1, 0, 0])), [0.6, 0.8, 0])
    assert.deepEqual(round(SE3.apply(attempts[1].requested, [1, 0, 0])), [0.8, 0.6, 0])
    assert.deepEqual(position(s.receiver), position(s.prey))
    assert.deepEqual(position(owner), [500, 0, 0])
})

test('a pending participant blocks the entire point read until its instant settles', async () => {
    let settle
    const s = scene({ admitAsync: request => request.frame.name === 'movingPrey'
        ? new Promise(resolve => { settle = resolve }) : pass(request) })
    const moving = s.scheduler.hotSwapChild('movingPrey', fork('movingPrey', `goto ${SE3.apply(s.base, [3, 4, 0]).join(' ')}`, s.base))
    const { installation } = s.attach('faceto a.x a.y\n    fw 5', { prey: moving })
    s.scheduler.tick(4000)
    assert.equal(installation.suspension?.kind, 'dataflow')
    assert.equal(installation.suspension.on, moving)
    assert.deepEqual(position(s.receiver), [10, 20, 0])
    settle({ accepted: true, transform: at(3, 4) })
    await Promise.resolve()
    await Promise.resolve()
    s.pump()
    assert.deepEqual(position(s.receiver), position(moving))
})

test('retiring a bound input across a wait cannot revive it through a namesake', () => {
    const s = scene()
    const moving = s.scheduler.hotSwapChild('movingPrey', fork('movingPrey', '', s.base))
    const { installation } = s.attach('wait 1\n    faceto a.x a.y\n    fw 5', { prey: moving })
    const replacement = s.scheduler.hotSwapChild('movingPrey', fork('movingPrey', '', at(2000)))
    assert.notEqual(replacement, moving)
    for (let i = 4; i < 24; i++) s.scheduler.tick(i * 1000)
    assert.match(installation.error?.message ?? '', /retired subject/)
    assert.deepEqual(position(s.receiver), [10, 20, 0])
})
