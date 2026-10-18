// One dragged node answers the whole component: the writer conserves against the truths it
// cannot answer, and every member reached from it is placed on its own sets. (id:laws-free-relations-f2)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, worldOf } from './harness.mjs'
import { frameWorldTransform, lawWorld } from '../../../assets/js/turtling/scheduler.js'
import { continueLaws } from '../../../assets/js/turtling/laws/verdict.js'
import { SE3, AXIS_X, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const q = (frame) => worldOf(frame).map((n) => Math.round(n * 1e6) / 1e6)
const close = (a, b) => assert.ok(Math.hypot(...q(a).map((v, i) => v - b[i])) < 1e-6, `${q(a)} != ${b}`)

function build(source, options = {}, origin = SE3.identity()) {
    const scheduler = buildWorld(options)
    const host = scheduler.hotSwapChild('host', fork('host', source, origin))
    drive(scheduler)
    const at = (name) => host.children.get(name)
    const ask = (frame, position) => scheduler.requestMotion(frame,
        { ...frameWorldTransform(frame), position }, scheduler.motionRevision, 'world')
    const truths = () => scheduler.laws.active().filter((law) => law.feature === 'distance').map((law) => {
        const [a, b] = law.endpoints.map((id) => worldOf(scheduler.registry.get(id)))
        return Math.abs(Math.hypot(...a.map((v, i) => v - b[i])) - law.predicate)
    })
    return { scheduler, host, at, ask, truths }
}

// A pinned anchor, then free points seated along the walk so each is its own identity.
const CHAIN = (n) => {
    const names = ['A', 'B', 'C', 'D'].slice(0, n)
    const lets = names.map((name, i) => i === 0 ? 'let A=(0,0,0)' : `jmp 5\nlet ${name}`).join('\n')
    const laws = names.slice(1).map((name, i) => `let distance(${names[i]},${name})=5`).join('\n')
    return { names, source: `${lets}\n${laws}` }
}

test('the pair contract is unchanged: the writer conserves, its partner holds', () => {
    const { scheduler, at, ask } = build('let A=(0,0,0)\nlet B\nlet distance(A,B)=5')
    const before = scheduler.motionRevision
    assert.equal(ask(at('B'), [5, 8, 0]).kind, 'accept')
    close(at('B'), [5 * (5 / Math.hypot(5, 8)), 5 * (8 / Math.hypot(5, 8)), 0])
    close(at('A'), [0, 0, 0])
    assert.equal(scheduler.motionRevision, before + 1)
})

test('a three-node chain answers one drag: the writer conserves, the free member is carried', () => {
    const { source } = CHAIN(3)
    const { scheduler, at, ask, truths } = build(source)
    close(at('B'), [5, 0, 0])
    close(at('C'), [10, 0, 0])
    const before = scheduler.motionRevision
    assert.equal(ask(at('B'), [0, 8, 0]).kind, 'accept')
    // The writer answers the truth it cannot hand to a partner: the pinned anchor A.
    close(at('A'), [0, 0, 0])
    close(at('B'), [0, 5, 0])
    // C is not the writer and not pinned, so it is placed on its own law's set.
    assert.notDeepEqual(q(at('C')), [10, 0, 0])
    assert.equal(Math.round(Math.hypot(...q(at('C')).map((v, i) => v - q(at('B'))[i])) * 1e6) / 1e6, 5)
    assert.equal(scheduler.motionRevision, before + 1)
    assert.ok(Math.max(...truths()) < 1e-9, `residuals ${truths()}`)
    assert.equal(scheduler.root._lastAttempt.gate.status, 'valid')
    assert.deepEqual(scheduler.errors, [])
})

test('a four-node chain is answered the same way, with the far member carried', () => {
    const { source } = CHAIN(4)
    const { scheduler, at, ask, truths } = build(source)
    close(at('B'), [5, 0, 0])
    close(at('D'), [15, 0, 0])
    // The writer's own neighbour is a leaf and answers, B holds its pinned truth, and D,
    // two edges away, is carried by C. One drag, four members. (id:laws-free-relations-f2)
    assert.equal(ask(at('C'), [8, 3, 0]).kind, 'accept')
    assert.notDeepEqual(q(at('D')), [15, 0, 0])
    assert.ok(Math.max(...truths()) < 1e-9, `residuals ${truths()}`)
    assert.equal(scheduler.root._lastAttempt.gate.status, 'valid')
    assert.deepEqual(scheduler.errors, [])
})

test('a rigid chain is answered without motion, never as a violation', () => {
    const source = 'let A=(0,0,0)\nlet B=(5,0,0)\nlet C=(10,0,0)\nlet distance(A,B)=5\nlet distance(B,C)=5'
    const { scheduler, at, ask, truths } = build(source)
    assert.equal(ask(at('B'), [5, 8, 0]).kind, 'accept')
    close(at('B'), [5, 0, 0])
    close(at('C'), [10, 0, 0])
    assert.ok(Math.max(...truths()) < 1e-9, `residuals ${truths()}`)
    assert.equal(scheduler.root._lastAttempt.gate.status, 'valid')
})

test('a free three-let chain closes through the leaf: two laws, no declaration gap', () => {
    // The isolated-leaf method: B is touched by the accepted AB, C by nothing, so only C is
    // placed — nearest its accepted position on the new law's OWN set. The old free-pair
    // refusal is CLOSED for this shape and still stands where BOTH ends are constrained.
    const { at, host, scheduler } = build('let A\nlet B\nlet C\nlet distance(A,B)=5\nlet distance(B,C)=5')
    assert.equal(host.unresolved ?? null, null)
    const distances = scheduler.laws.active().filter((law) => law.feature === 'distance')
    assert.equal(distances.length, 2)
    for (const law of distances) {
        const [a, b] = law.endpoints.map((id) => worldOf(scheduler.registry.get(id)))
        assert.ok(Math.abs(Math.hypot(...a.map((v, i) => v - b[i])) - law.predicate) < 1e-9)
    }
    close(at('C'), [-2.5, 0, 0])
})

// A chain of n, pinned at one end, free beyond it, radius 5 apart along the walk.
const walk = (n) => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n)
    const lets = names.map((name, i) => i === 0 ? 'let A=(0,0,0)' : `jmp 5\nlet ${name}`).join('\n')
    return `${lets}\n${names.slice(1).map((name, i) => `let distance(${names[i]},${name})=5`).join('\n')}`
}

test('one drag reaches the whole reachable component, for every n', () => {
    // Least change over the component: the wish is the objective, the members answer, and
    // nothing is ordered by topology or by how a law spelled its ends. (id:laws-free-relations-f2)
    const moved = (n, actor) => {
        const { at, ask } = build(walk(n))
        const names = [...Array.from({ length: n }, (_, i) => ['A', 'B', 'C', 'D', 'E', 'F'][i])]
        const before = new Map(names.map((name) => [name, q(at(name)).join()]))
        const here = worldOf(at(actor))
        assert.equal(ask(at(actor), [here[0] - 2, 3, 0]).kind, 'accept')
        return names.filter((name) => q(at(name)).join() !== before.get(name)).join('')
    }
    assert.equal(moved(2, 'B'), 'B')
    assert.equal(moved(3, 'B'), 'BC')
    assert.equal(moved(3, 'C'), 'BC')
    assert.equal(moved(4, 'B'), 'BCD')
    assert.equal(moved(4, 'C'), 'BCD')
    assert.equal(moved(4, 'D'), 'CD')
    assert.equal(moved(5, 'C'), 'BCDE')
    assert.equal(moved(5, 'D'), 'CDE')
    assert.equal(moved(6, 'B'), 'BCDEF')
    assert.equal(moved(6, 'D'), 'CDEF')
    assert.equal(moved(6, 'F'), 'EF')
})

// --- measured interdependency: branching, depth, cycles, facet mix ------------------
// Wishes stay inside the reachable ball; a purely lateral wish on an over-extended chain
// is genuinely infeasible and must refuse rather than violate.
const dragOn = (source, actor) => {
    const { scheduler, host, at, ask } = build(source)
    const names = [...host.children.keys()]
    const before = new Map(names.map((n) => [n, q(at(n)).join()]))
    const here = worldOf(at(actor))
    const out = ask(at(actor), [here[0] - 2, 3, 0])
    const moved = names.filter((n) => q(at(n)).join() !== before.get(n))
    const residual = Math.max(0, ...scheduler.laws.active().filter((l) => l.feature === 'distance')
        .map((l) => {
            const [a, b] = l.endpoints.map((id) => worldOf(scheduler.registry.get(id)))
            return Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - l.predicate)
        }))
    return { kind: out.kind, message: out.message ?? '', moved, residual, gate: scheduler.root._lastAttempt?.gate?.status }
}

const JUNCTION = 'let A=(0,0,0)\njmp 5\nlet B\nrt 90\njmp 5\nlet C\nrt -90\njmp 5\nlet D\n' +
    'let distance(A,B)=5\nlet distance(B,C)=5\nlet distance(B,D)=5'
const DEPTH = 'let A=(0,0,0)\njmp 5\nlet B\nrt 90\njmp 5\nlet C\nrt -90\njmp 5\nlet D\nrt 90\njmp 5\nlet E\n' +
    'let distance(A,B)=5\nlet distance(B,C)=5\nlet distance(B,D)=5\nlet distance(D,E)=5'
const TRIANGLE = 'let A=(0,0,0)\njmp 5\nlet B\nrt 120\njmp 5\nlet C\n' +
    'let distance(A,B)=5\nlet distance(B,C)=5\nlet distance(A,C)=5'

test('a junction answers with every branch it reaches, not one path', () => {
    const r = dragOn(JUNCTION, 'B')
    assert.equal(r.kind, 'accept')
    assert.deepEqual([...r.moved].sort(), ['B', 'C', 'D'])
    assert.ok(r.residual < 1e-9, `residual ${r.residual}`)
    assert.equal(r.gate, 'valid')
})

test('the composition holds to depth: a branch off a branch is still carried', () => {
    for (const [actor, expected] of [['B', ['B', 'C', 'D', 'E']], ['D', ['B', 'D', 'E']], ['E', ['D', 'E']]]) {
        const r = dragOn(DEPTH, actor)
        assert.equal(r.kind, 'accept', `${actor} refused`)
        assert.deepEqual([...r.moved].sort(), expected.slice().sort(), `${actor} moved ${r.moved}`)
        assert.ok(r.residual < 1e-9 && r.gate === 'valid')
    }
})

test('a cycle is answered, not merely refused', () => {
    const r = dragOn(TRIANGLE, 'B')
    assert.equal(r.kind, 'accept')
    assert.deepEqual([...r.moved].sort(), ['B', 'C'])
    assert.ok(r.residual < 1e-9)
})

test('a mixed facet composes with the edges: sphere meet plane', () => {
    const r = dragOn('let A=(0,0,0)\njmp 5\nlet B\njmp 5\nlet C\n' +
        'let distance(A,B)=5\nlet distance(B,C)=5\nlet C.y=2', 'C')
    assert.equal(r.kind, 'accept')
    assert.ok(r.moved.includes('C'))
    assert.ok(r.residual < 1e-9)
})

test('KNOWN GAP: a facet referenced to another member does not compose yet', () => {
    // `let C.tilt = 30` inside `as B do` is measured against B's PLACEMENT. Moving B's live
    // position leaves that placement where it was, so the two truths cannot both hold: the
    // door refuses by NAME and moves not one coordinate. Honest and total, but the
    // composition is unearned — recorded here so it cannot be mistaken for working.
    const source = 'let A=(0,0,0)\njmp 5\nlet B\nrt 30\njmp 5\nlet C\n' +
        'let distance(A,B)=5\nlet distance(B,C)=5\nas B do\n  let C.tilt = 30\nend'
    const r = dragOn(source, 'B')
    assert.equal(r.kind, 'refuse')
    assert.match(r.message, /placement conflicts with the tilt law/)
    assert.equal(r.moved.length, 0, 'a refusal never leaves a partial move')
    assert.ok(r.residual < 1e-9, 'the standing truths survive the refusal')
})

// --- graduated from probe/free-point-relations/n_node_review.mjs (both High findings) ----
// The probe recorded these as counterexamples; each is now a standing regression, so the
// suite retains the protection without needing the instrument to be run.
// The ONE CONVENTION contract is pinned by angle_lab_test'''s geometric validator: it reads
// `request.requested` beside `entries`, and it failed when certification was moved after
// normalization. That is the regression; it needs no second copy here.
// (id:laws-free-relations-n-node-review, id:laws-figures-phase34-hand-frame)

test('the operation ceiling closes over the EXPANDED candidate', () => {
    const seen = []
    const options = { validate: ({ entries }) => {
        seen.push(entries.map((e) => e.frame.name))
        return entries.every((e) => e.frame === entries[0].frame)   // writer alone, no followers
    } }
    const { scheduler, host } = build('let A\njmp 5\nlet B\nlet distance(A,B)=5', options)
    const A = host.children.get('A'), B = host.children.get('B')
    const before = [worldOf(A), worldOf(B)]
    const out = scheduler.requestMotion(host.children.get('B'),
        { ...frameWorldTransform(B), position: [8, 0, 0] }, scheduler.motionRevision, 'world')
    // The continuation is the last producer, so the ceiling's ONE view is the candidate that
    // will publish. A ceiling over the writer alone is not a ceiling over the edit, and the
    // expansion is never certified before it exists.
    assert.equal(out.kind, 'fault')
    assert.deepEqual(seen, [['B', 'A']], 'the final candidate, once')
    assert.deepEqual([worldOf(A), worldOf(B)], before, 'a refused ceiling publishes nothing')
})

test('a ceiling that refuses a writer-only candidate never sees one: the expansion is the offer', () => {
    // The discriminating case: this host refuses any edit that carries nobody. Under a door
    // that certified the pre-expansion proposal it would refuse every lawful drag.
    const seen = []
    const options = { validate: ({ entries }) => {
        seen.push(entries.map((e) => e.frame.name))
        return entries.length === 2
    } }
    const { scheduler, host } = build('let A\njmp 5\nlet B\nlet distance(A,B)=5', options)
    const A = host.children.get('A'), B = host.children.get('B')
    const out = scheduler.requestMotion(B,
        { ...frameWorldTransform(B), position: [8, 0, 0] }, scheduler.motionRevision, 'world')
    assert.equal(out.kind, 'accept', 'one certified candidate, and it is the pair')
    assert.deepEqual(seen, [['B', 'A']], 'one invocation')
    assert.ok(Math.abs(Math.hypot(...worldOf(A).map((n, i) => n - worldOf(B)[i])) - 5) < 1e-9,
        'the published pair holds the bond the ceiling certified')
})

test('a validator rejection is a rejection, not another invocation', () => {
    let calls = 0
    const options = { validate: () => { calls += 1; return calls > 1 } }   // false, then true
    const { scheduler, host } = build('let A\njmp 5\nlet B\nlet distance(A,B)=5', options)
    const A = host.children.get('A'), B = host.children.get('B')
    const before = [worldOf(A), worldOf(B)]
    const out = scheduler.requestMotion(B,
        { ...frameWorldTransform(B), position: [8, 0, 0] }, scheduler.motionRevision, 'world')
    assert.equal(out.kind, 'fault')
    assert.equal(calls, 1, 'one candidate, one certificate — a refusal may not retry into accept')
    assert.deepEqual([worldOf(A), worldOf(B)], before)
})

test('a position-only answer changes no heading, in a rotated room', () => {
    const origin = SE3.rotateLocal(SE3.identity(), AXIS_Z, 37)
    const chain = 'let A=(0,0,0)\njmp 5\nlet B\njmp 5\nlet C\njmp 5\nlet D\n' +
        'let distance(A,B)=5\nlet distance(B,C)=5\nlet distance(C,D)=5'
    const { scheduler, host } = build(chain, {}, origin)
    const C = host.children.get('C'), D = host.children.get('D')
    const heading = (f) => frameWorldTransform(f).rotation.rotateVec(1, 0, 0)
    const [beforeC, beforeD] = [heading(C), heading(D)]
    const [beforeCq, beforeDq] = [C.transform.deref().rotation, D.transform.deref().rotation]
    const B = host.children.get('B')
    assert.equal(scheduler.requestMotion(B,
        { ...frameWorldTransform(B), position: SE3.apply(origin, [0, 4, 0]) },
        scheduler.motionRevision, 'world').kind, 'accept')
    // The enclosing 37-degree placement is composed ONCE: reading the world rotation and
    // storing it as a local one applied it twice and produced 74.
    const moved = (a, b) => !a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
    assert.ok(!moved(beforeC, heading(C)), `C heading rotated: ${beforeC} -> ${heading(C)}`)
    assert.ok(!moved(beforeD, heading(D)), `D heading rotated: ${beforeD} -> ${heading(D)}`)
    // Graduated from probe/free-point-relations/n_node_review.mjs (its 37-degree, four-node
    // control): the defect was a doubled parent placement, 37 -> 74. A world heading alone can
    // hide a conversion error that keeps the axis, so the LOCAL heading must be unchanged
    // EXACTLY, not merely close.
    const localQ = (f) => f.transform.deref().rotation
    assert.deepEqual([localQ(C).w, localQ(C).x, localQ(C).y, localQ(C).z], [beforeCq.w, beforeCq.x, beforeCq.y, beforeCq.z],
        'C by a position-only answer keeps its accepted LOCAL heading')
    assert.deepEqual([localQ(D).w, localQ(D).x, localQ(D).y, localQ(D).z], [beforeDq.w, beforeDq.x, beforeDq.y, beforeDq.z],
        'D by a position-only answer keeps its accepted LOCAL heading')
})

test('a position-only proposal retains the exact local rotation, before publication', () => {
    const origin = SE3.rotateLocal(SE3.rotateLocal(SE3.identity(), AXIS_X, 23), AXIS_Z, 37)
    const { scheduler, at } = build('let A\njmp 5\nlet B\nlet distance(A,B)=5', {}, origin)
    assert.deepEqual(scheduler.errors, [])
    assert.equal(scheduler.laws.active().length, 1)
    const A = at('A'), B = at('B')
    const turn = SE3.rotateLocal(SE3.identity(), AXIS_Z, 19).rotation
    assert.equal(scheduler.requestMotion(A, { ...A.transform.deref(), rotation: turn },
        scheduler.motionRevision).kind, 'accept')
    const beforeA = A.transform.deref(), beforeB = B.transform.deref()
    const requested = { rotation: beforeB.rotation, position: [3, 2, 0] }
    const answer = continueLaws({ kind: 'accept', pose: requested, component: [] },
        B, scheduler.registry, scheduler.laws, lawWorld)
    const follower = answer.component.find(({ frame }) => frame === A)
    assert.ok(follower, 'the proposal carries the free partner')
    assert.deepEqual(follower.pose.rotation, beforeA.rotation, 'no rotation round-trip error')
    assert.strictEqual(follower.pose.rotation, beforeA.rotation,
        'an untouched coordinate is retained, not reconstructed through world space')
    assert.strictEqual(answer.pose.rotation, requested.rotation, 'the writer retains its requested turn')
    assert.strictEqual(A.transform.deref(), beforeA, 'proposal does not publish the follower')
    assert.strictEqual(B.transform.deref(), beforeB, 'proposal does not publish the writer')
})
