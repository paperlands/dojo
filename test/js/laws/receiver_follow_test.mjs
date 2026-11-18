// An installation proposes from its retained receiver; the installation stays the writer.
// A proposal beyond the writer's scope declines WHOLE, never by subset.
// (id:laws-free-relations-f4-actor, id:being-facets-p4-sequence, D063)
// Run: node --test test/js/laws/receiver_follow_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from './harness.mjs'
import { frameWorldTransform, lawWorld } from '../../../assets/js/turtling/scheduler.js'
import { lawViolation } from '../../../assets/js/turtling/laws/verdict.js'
import { heldFrame } from '../../../assets/js/turtling/laws/constraints.js'
import { SE3, AXIS_X, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const q20 = SE3.rotateLocal(SE3.identity(), AXIS_Z, 20).rotation
const hd = q20.rotateVec(1, 0, 0)
const stepLocal = [2 * hd[0], 2 * hd[1], 0]
const followerLocal = (() => {
    const u = [5 - stepLocal[0], 0 - stepLocal[1], 0]
    const L = Math.hypot(...u)
    return [stepLocal[0] + 5 * u[0] / L, stepLocal[1] + 5 * u[1] / L, 0]
})()
const r6 = (v) => v.map((n) => +n.toFixed(6))
const close = (a, b, tol = 1e-6) => Math.hypot(...a.map((v, i) => v - b[i])) <= tol
const quat = (frame) => {
    const r = frameWorldTransform(frame).rotation
    return [r.w, r.x, r.y, r.z]
}
const localQuat = (frame) => {
    const r = frame.transform.deref().rotation
    return [r.w, r.x, r.y, r.z]
}
const at = (frame) => frameWorldTransform(frame).position
const gate = (scheduler) => lawViolation(scheduler.laws.active(), new Map(), scheduler.registry, lawWorld)
const addresses = (scheduler) => scheduler.laws.active().map((law) => law.address).sort()

// Observable phase, bounded guard: no fixed tick decides a test.
function until(ctx, predicate, { maxTicks = 400 } = {}) {
    for (let i = 0; i < maxTicks; i++) {
        ctx.scheduler._now = (ctx.scheduler._now ?? 0) + 1000
        ctx.scheduler.tick(ctx.scheduler._now)
        ctx.scheduler.readouts?.drain?.()
        if (predicate(ctx)) return true
    }
    return predicate(ctx)
}

// Raw numeric pose, copied at the callback basis. Frame identities stay for equality.
const copyPose = (p) => p ? { position: [...p.position], quat: [p.rotation.w, p.rotation.x, p.rotation.y, p.rotation.z] } : null
function seat(source, origin = SE3.identity()) {
    const seen = []
    const scheduler = buildWorld({ validate: (v) => {
        seen.push({
            command: v.request?.command ?? null,
            writer: v.writer, destination: v.request?.frame,
            from: copyPose(v.request?.from), requested: copyPose(v.request?.requested),
            entries: v.entries.map((e) => ({ frame: e.frame, pose: copyPose(e.pose) })),
        })
        return true
    } })
    const host = scheduler.hotSwapChild('host', fork('host', source, origin))
    const commits = []
    scheduler.onAcceptedChange(() => {
        const A = host.children.get('A'), B = host.children.get('B')
        if (A && B) commits.push({ revision: scheduler.motionRevision, A: [...at(A)], B: [...at(B)] })
    })
    return { scheduler, host, seen, commits }
}
const calls = (ctx, command) => ctx.seen.filter((v) => v.command === command)
const names = (v) => v.entries.map((e) => e.frame.name)
const jointRevisions = (ctx) => new Set(ctx.commits
    .filter((c) => Math.hypot(...c.A) > 1e-6)
    .map((c) => c.revision)).size

const RECIPE = (sig, args, body) => `def move ${sig} do
  as a do
${body}
  end
end
let A
jmp 5
let B
let distance(A,B)=5
wait 1
let venture = move ${args}
`
const TURN_STEP = `    wait 1
    rt -20
    wait 1
    jmp 2`
const BOTH = RECIPE('a b', 'A B', TURN_STEP)
const ONE = RECIPE('a', 'A', TURN_STEP)
const TWO_STEPS = RECIPE('a b', 'A B', `    wait 1
    loop 40 do
      jmp 2
      wait 1
    end`)
const DISPLACED = `def move a b do
  jmp 7
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
`
const CHAIN = `def move a b do
  as a do
    wait 1
    jmp 2
  end
end
let A
jmp 5
let B
jmp 5
let C
let distance(A,B)=5
let distance(B,C)=5
wait 1
let venture = move A B
`
const PINNED = `def move a b do
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
`

test('an installation proposes from its retained receiver while staying the writer', () => {
    const ctx = seat(BOTH)
    assert.equal(until(ctx, (c) => calls(c, 'jmp').length > 0 && c.scheduler.motionRevision >= 3), true)
    const A = ctx.host.children.get('A'), B = ctx.host.children.get('B')
    const step = calls(ctx, 'jmp').at(-1)
    assert.equal(calls(ctx, 'jmp').length, 1)
    assert.equal(step.writer, ctx.scheduler.installationsOf(ctx.host.children.get('venture'))[0].frame)
    assert.equal(step.destination, A)
    assert.notEqual(step.writer.id, A.id)
    assert.deepEqual(names(step).sort(), ['A', 'B'])
    assert.deepEqual(r6(at(A)), r6(stepLocal))
    assert.deepEqual(r6(at(B)), r6(followerLocal))
    assert.ok(close(quat(A), [q20.w, q20.x, q20.y, q20.z]))
    assert.ok(close(quat(B), [1, 0, 0, 0]))
    assert.equal(gate(ctx.scheduler).status, 'valid')
    assert.equal(heldFrame(A), false)
})

test('a one-input closed recipe never certifies the unsupplied follower', () => {
    const ctx = seat(ONE)
    assert.equal(until(ctx, (c) => calls(c, 'jmp').length > 0 && c.scheduler.motionRevision >= 2), true)
    const A = ctx.host.children.get('A'), B = ctx.host.children.get('B')
    const step = calls(ctx, 'jmp').at(-1)
    assert.equal(calls(ctx, 'jmp').length, 1)
    assert.deepEqual(names(step), ['A'])
    assert.deepEqual(r6(at(B)), [5, 0, 0])
    assert.deepEqual(r6(at(A)), [0, 0, 0])
    assert.equal(ctx.scheduler.root._lastAttempt.verdict, 'refuse')
    assert.equal(ctx.scheduler.root._lastAttempt.gate?.status, 'violation')
    assert.deepEqual(ctx.scheduler.errors, [])
})

test('a two-supplied recipe never salvages the unsupplied third member', () => {
    const ctx = seat(CHAIN)
    assert.equal(until(ctx, (c) => c.host.children.get('C') != null), true)
    const baseline = addresses(ctx.scheduler)
    assert.equal(until(ctx, (c) => calls(c, 'jmp').length > 0), true)
    const [A, B, C] = ['A', 'B', 'C'].map((n) => ctx.host.children.get(n))
    const step = calls(ctx, 'jmp').at(-1)
    assert.deepEqual(names(step), ['A'], 'the ORIGINAL offer, not a filtered [A,B]')
    assert.deepEqual(r6(at(A)), [0, 0, 0])
    assert.deepEqual(r6(at(B)), [5, 0, 0])
    assert.deepEqual(r6(at(C)), [10, 0, 0])
    assert.equal(ctx.scheduler.root._lastAttempt.verdict, 'refuse')
    assert.equal(ctx.scheduler.root._lastAttempt.gate?.status, 'violation')
    assert.deepEqual(addresses(ctx.scheduler), baseline)
    assert.deepEqual(ctx.scheduler.errors, [])
})

test('the request is stated in the receiver chain, not the declaration-site origin', () => {
    const ctx = seat(DISPLACED)
    assert.equal(until(ctx, (c) => calls(c, 'jmp').some((v) => v.writer.installation === true)), true)
    const A = ctx.host.children.get('A'), B = ctx.host.children.get('B')
    const step = calls(ctx, 'jmp').filter((v) => v.writer.installation === true).at(-1)
    assert.deepEqual(r6(step.from.position), [0, 0, 0])
    assert.deepEqual(r6(step.requested.position), [2, 0, 0])
    assert.deepEqual(names(step), ['A', 'B'])
    assert.deepEqual(r6(at(A)), [2, 0, 0])
    assert.deepEqual(r6(at(B)), [7, 0, 0])
    assert.equal(gate(ctx.scheduler).status, 'valid')
})

test('a translated tilted placement crosses through the receiver chain', () => {
    const TILT = SE3.compose(SE3.translateLocal(SE3.identity(), 10, 20, 30),
        SE3.rotateLocal(SE3.rotateLocal(SE3.identity(), AXIS_X, 37), AXIS_Z, 20))
    const ctx = seat(DISPLACED, TILT)
    assert.equal(until(ctx, (c) => calls(c, 'jmp').some((v) => v.writer.installation === true)), true)
    const A = ctx.host.children.get('A'), B = ctx.host.children.get('B')
    const expectedA = SE3.compose(TILT, SE3.translateLocal(SE3.identity(), 2, 0, 0))
    const expectedB = SE3.compose(TILT, SE3.translateLocal(SE3.identity(), 7, 0, 0))
    assert.ok(close(at(A), expectedA.position), `A ${r6(at(A))} != ${r6(expectedA.position)}`)
    assert.ok(close(at(B), expectedB.position), `B ${r6(at(B))} != ${r6(expectedB.position)}`)
    assert.ok(close(quat(A), [expectedA.rotation.w, expectedA.rotation.x, expectedA.rotation.y, expectedA.rotation.z]),
        'A keeps the placement heading; no local turn was requested')
    assert.ok(close(localQuat(A), [1, 0, 0, 0]))
    assert.ok(close(quat(B), [expectedB.rotation.w, expectedB.rotation.x, expectedB.rotation.y, expectedB.rotation.z]))
    assert.equal(gate(ctx.scheduler).status, 'valid')
})

test('a pinned follower declines the whole expansion and retains the original offer', () => {
    const ctx = seat(PINNED)
    assert.equal(until(ctx, (c) => calls(c, 'jmp').length > 0 && c.scheduler.motionRevision >= 2), true)
    const A = ctx.host.children.get('A'), B = ctx.host.children.get('B')
    const step = calls(ctx, 'jmp').at(-1)
    assert.equal(calls(ctx, 'jmp').length, 1)
    assert.deepEqual(names(step), ['A'])
    assert.deepEqual(r6(at(A)), [0, 0, 0])
    assert.deepEqual(r6(at(B)), [5, 0, 0])
    assert.equal(ctx.scheduler.root._lastAttempt.verdict, 'refuse')
    assert.equal(ctx.scheduler.root._lastAttempt.gate?.status, 'violation')
    assert.deepEqual(ctx.scheduler.errors, [])
})

test('withdrawal freezes both retained participants while the continuation is unfinished', () => {
    const ctx = seat(TWO_STEPS)
    assert.equal(until(ctx, (c) => jointRevisions(c) >= 2), true)
    const A = ctx.host.children.get('A'), B = ctx.host.children.get('B')
    const venture = ctx.host.children.get('venture')
    assert.ok(close(at(A), [4, 0, 0]), `A ${r6(at(A))}`)
    assert.ok(close(at(B), [9, 0, 0]), `B ${r6(at(B))}`)
    const [record] = ctx.scheduler.installationsOf(venture)
    assert.ok(record && record.frame.done === false, 'loop 40: 38 further steps would still run')
    const frozen = { A: [...at(A)], B: [...at(B)], rev: ctx.scheduler.motionRevision,
        calls: ctx.seen.length, addresses: addresses(ctx.scheduler) }
    assert.equal(ctx.scheduler.retireInstallation(venture, record.site), true)
    until(ctx, () => false, { maxTicks: 50 })
    assert.deepEqual(r6(at(A)), r6(frozen.A))
    assert.deepEqual(r6(at(B)), r6(frozen.B))
    assert.equal(ctx.scheduler.motionRevision, frozen.rev)
    assert.equal(ctx.seen.length, frozen.calls)
    assert.equal(ctx.scheduler.installationsOf(venture).length, 0)
    assert.deepEqual(addresses(ctx.scheduler), frozen.addresses, 'the SAME active laws survive')
    assert.equal(ctx.scheduler.registry.get(A.id), A)
    assert.equal(ctx.scheduler.registry.get(B.id), B)
    assert.deepEqual(ctx.scheduler.errors, [])
})
