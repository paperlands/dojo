// Decision observations own immutable plain data; no reachable live geometry.
// (id:laws-activation-verdicts, id:codex-play-eyes, id:laws-free-relations-installed-receiver)
//
// Run: node --test test/js/laws/decision_snapshot_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { frameWorldTransform, lawWorld } from '../../../assets/js/turtling/scheduler.js'
import { attachProbe } from '../../../assets/js/turtling/probe.js'
import { bindLaw } from '../../../assets/js/turtling/laws/replacement.js'
import { makeDistanceTerm } from '../../../assets/js/turtling/laws/authored.js'
import { SE3, AXIS_Z } from '../../../assets/js/turtling/se3.js'
import { lawViolation } from '../../../assets/js/turtling/laws/verdict.js'

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const world = (f) => frameWorldTransform(f).position.map((n) => +n.toFixed(9))
const quat = (f) => {
    const r = frameWorldTransform(f).rotation
    return [r.w, r.x, r.y, r.z].map((n) => +n.toFixed(9))
}
const frozen = (x) => Object.isFrozen(x)
const attempt = (scheduler) => scheduler.root._lastAttempt

test('a hand decision cannot mutate live geometry and survives a later edit', () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host', 'let A\njmp 5\nlet B\nlet distance(A,B)=5'))
    drive(scheduler, { maxTicks: 4 })
    const A = host.children.get('A'), B = host.children.get('B')
    const v = scheduler.requestMotion(B, { rotation: B.transform.deref().rotation, position: [3, 0, 0] },
        scheduler.motionRevision)
    assert.equal(v.kind, 'accept')
    const rec = attempt(scheduler)
    const before = { A: world(A), B: world(B), rev: scheduler.motionRevision }
    assert.deepEqual(rec.candidate, [3, 0, 0])
    assert.notEqual(rec.candidate, B.transform.deref().position, 'candidate is not the live array')
    assert.notEqual(rec.requested, B.transform.deref().position, 'requested is not the live array')
    assert.notEqual(rec.from, B.transform.deref().position, 'from is not the live array')
    assert.ok(frozen(rec) && frozen(rec.candidate) && frozen(rec.requested) && frozen(rec.from))
    assert.throws(() => { rec.candidate[0] = 10 })
    assert.throws(() => { rec.requested[0] = 10 })
    assert.deepEqual(world(B), before.B)
    assert.deepEqual(world(A), before.A)
    assert.equal(scheduler.motionRevision, before.rev)

    const saved = JSON.stringify(rec)
    const v2 = scheduler.requestMotion(B, { rotation: B.transform.deref().rotation, position: [4, 0, 0] },
        scheduler.motionRevision)
    assert.equal(v2.kind, 'accept')
    assert.equal(JSON.stringify(rec), saved, 'the saved record did not drift')
    assert.notEqual(attempt(scheduler), rec, 'a later edit replaces the slot')
    assert.deepEqual(world(B), [9, 0, 0])
})

test('an accepted reach decision holds numeric pose data, id stays id, live objects stay live', () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host',
        'let A\nlet B\nas B do\n  let A.distance = 5\nend'))
    drive(scheduler, { maxTicks: 10 })
    const A = host.children.get('A')
    const rec = attempt(scheduler)
    const entry = rec.candidate[0]
    const live = A.transform.deref()
    const liveQuat = quat(A)
    assert.equal(entry.frame, A.id, 'frame identity is projected to an id')
    assert.notEqual(entry.frame, A)
    assert.equal(Object.getPrototypeOf(entry.pose.rotation), Object.prototype,
        'rotation is plain data, not a runtime Versor')
    assert.equal(entry.pose.rotation.normalize, undefined, 'runtime methods do not cross')
    assert.ok(frozen(entry.pose.position) && frozen(entry.pose.rotation) && frozen(entry.pose))
    assert.ok(!frozen(live) && !frozen(live.position) && !frozen(live.rotation),
        'live geometry is not frozen')
    assert.throws(() => { entry.pose.position[0] = 9 })
    assert.throws(() => { entry.pose.rotation.w = 0.5 })
    assert.deepEqual(world(A), [5, 0, 0])
    assert.deepEqual(quat(A), liveQuat)
    assert.equal(scheduler.motionRevision, 1)

    const savedQuat = JSON.stringify(entry.pose.rotation)
    const turn = SE3.rotateLocal(SE3.identity(), AXIS_Z, 20).rotation
    const v = scheduler.requestMotion(A, { rotation: turn, position: [5, 0, 0] },
        scheduler.motionRevision, 'world')
    assert.equal(v.kind, 'accept', `later motion refused: ${v.message ?? ''}`)
    assert.deepEqual(quat(A), [0.984807753, 0, 0, 0.173648178])
    assert.equal(JSON.stringify(entry.pose.rotation), savedQuat, 'saved quat did not drift')
})

test('refused reach and motion gate facts are detached, frozen and inert', () => {
    const refused = buildWorld({ admit: pass })
    const host = refused.hotSwapChild('host', fork('host',
        'let A\nlet B\nas B do\n  let A.distance = 5\n  wait 1\n  let A.position = origin\nend'))
    drive(refused, { maxTicks: 20 })
    const A = host.children.get('A')
    const rec = attempt(refused)
    assert.equal(rec.outcome, 'obstructed')
    assert.equal(rec.candidate.frame, A.id)
    assert.ok(frozen(rec.candidate) && frozen(rec.candidate.world) && frozen(rec.span))
    assert.throws(() => { rec.candidate.world[0] = 9 })
    assert.throws(() => { rec.span.line = 99 })
    assert.deepEqual(world(A), [5, 0, 0])

    const pinned = buildWorld({})
    const host2 = pinned.hotSwapChild('host', fork('host', `def move a b do
  as a do
    wait 1
    jmp 2
  end
end
let A
jmp 5
let B=(5,0,0)
let distance(A,B)=5
wait 1
let venture = move A B
`))
    drive(pinned, { maxTicks: 20 })
    const m = attempt(pinned)
    const laws = pinned.laws.active().map((law) => law.address)
    const gate = m.gate
    assert.equal(m.verdict, 'refuse')
    assert.equal(gate.status, 'violation')
    assert.ok(frozen(gate))
    assert.throws(() => { gate.status = 'valid' })
    assert.deepEqual(pinned.laws.active().map((law) => law.address), laws)
    assert.deepEqual(world(host2.children.get('A')), [0, 0, 0])
    assert.equal(lawViolation(pinned.laws.active(), new Map(), pinned.registry, lawWorld).status, 'valid')
})

test('the public probe reads the same safe fact and round-trips as plain JSON', () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host', 'let A\njmp 5\nlet B\nlet distance(A,B)=5'))
    drive(scheduler, { maxTicks: 4 })
    const B = host.children.get('B')
    scheduler.requestMotion(B, { rotation: B.transform.deref().rotation, position: [3, 0, 0] },
        scheduler.motionRevision)
    const rec = attempt(scheduler)
    const previous = globalThis.window
    try {
        globalThis.window = {}
        attachProbe({ scheduler, _stateOf: () => null }, { orderOf: () => null })
        const seen = globalThis.window.__probe.read().attempt
        const before = { B: world(B), rev: scheduler.motionRevision }
        assert.equal(seen, rec, 'the probe reads the decision record')
        assert.ok(frozen(seen))
        assert.throws(() => { seen.candidate[0] = 10 })
        assert.deepEqual(world(B), before.B, 'the mutation did not move live geometry')
        assert.equal(scheduler.motionRevision, before.rev, 'the mutation did not advance revision')
        assert.deepEqual(JSON.parse(JSON.stringify(seen)), seen,
            'JSON shape and values are unchanged')
        assert.equal(JSON.parse(JSON.stringify(seen)).candidate[0], 3)
    } finally {
        if (previous === undefined) delete globalThis.window
        else globalThis.window = previous
    }
})

test('decision timing and the unconstrained fast path are unchanged', () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host', `def move a b do
  as a do
    wait 1
    jmp 2
  end
end
let A
jmp 5
let B
let distance(A,B)=5
wait 1
let venture = move A B
`))
    drive(scheduler, { maxTicks: 10 })
    const rec = attempt(scheduler)
    assert.equal(rec.path, 'program-motion')
    assert.equal(rec.revision, 1, 'stamp is the decision-time revision')
    assert.equal(scheduler.motionRevision, 2, 'publication advanced the revision')
    assert.equal(rec.candidate[0], 2)

    const free = buildWorld({})
    free.hotSwapChild('host', fork('host', 'let A\nas A do\n  wait 2\n  jmp 1\nend\n'))
    drive(free, { maxTicks: 10 })
    assert.equal(attempt(free), undefined, 'the unconstrained fast path records nothing')
    assert.equal(free.motionRevision, 0)
})

test('distance facts expose observed world inputs: live, absolute and relative', () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host',
        'let A\nlet B\nlet distance(A,B)=2\nlet C\nlet distance(C, (0,0,3)) = 5'))
    drive(scheduler, { maxTicks: 6 })
    const A = host.children.get('A'), B = host.children.get('B'), C = host.children.get('C')
    // A RELATIVE framed literal: B to A's live rotated pose, value (2,0,0).
    scheduler.laws.apply(bindLaw({ feature: 'distance', endpoints: [B.id], scope: host.id, frame: host.id, predicate: 3,
        expression: makeDistanceTerm([B.id, { frame: A.id, value: [2, 0, 0], relative: true }], 3),
        owner: { line: 99 } }))
    const previous = globalThis.window
    try {
        globalThis.window = {}
        attachProbe({ scheduler, _stateOf: () => null }, { orderOf: () => null })
        const facts = globalThis.window.__probe.read().laws
        const live = facts.find((f) => f.radius === 2)
        const absolute = facts.find((f) => f.radius === 5)
        const relative = facts.find((f) => f.radius === 3)
        assert.ok(live && absolute && relative, 'every distance row is captured')

        // Frozen observation; live geometry stays live.
        for (const fact of facts) {
            assert.ok(frozen(fact) && frozen(fact.observedInputs), 'the fact and its input list are frozen')
            assert.throws(() => { fact.observedInputs[0] = [9, 9, 9] })
        }
        assert.ok(!frozen(A) && !frozen(A.transform.deref().position), 'live frames are not frozen')

        const w = (f) => frameWorldTransform(f).position.map((n) => +n.toFixed(9))
        const at = (p) => p.map((n) => +n.toFixed(9))
        assert.deepEqual(at(live.observedInputs[0]), w(A), 'a live input is read at its world position')
        assert.deepEqual(at(live.observedInputs[1]), w(B))
        assert.deepEqual(at(absolute.observedInputs[0]), w(C), 'the literal law target is live')
        assert.deepEqual(at(absolute.observedInputs[1]), [0, 0, 3], 'an absolute literal is itself')
        const relativeAt = SE3.apply(frameWorldTransform(A), [2, 0, 0])
        assert.deepEqual(at(relative.observedInputs[1]), at(relativeAt),
            'a relative literal reads the live pose, not the placement alone')
        assert.equal(relative.observedInputs[0] && relative.observedInputs[0].length, 3)
        assert.equal(relative.radius, 3, 'the bound radius is kept beside the observation')
        assert.equal(relative.expression.radius, 3, 'the bound term is untouched')
    } finally {
        if (previous === undefined) delete globalThis.window
        else globalThis.window = previous
    }
})
