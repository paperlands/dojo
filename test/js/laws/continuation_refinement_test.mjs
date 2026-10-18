// Refinement may stop at its own budget; input intent, original truth and publication rights do not.
// (id:laws-continuation-refinement-budget)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, worldOf } from './harness.mjs'
import { frameWorldTransform, lawWorld } from '../../../assets/js/turtling/scheduler.js'
import { continueLaws, lawViolation } from '../../../assets/js/turtling/laws/verdict.js'
import { toLocalPose } from '../../../assets/js/turtling/localize.js'
import { SE3, AXIS_X, AXIS_Y, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const chain = (n) => [
    Array.from({ length: n }, (_, i) => `${i === 0 ? '' : 'jmp 5\n'}let P${i}`).join('\n'),
    Array.from({ length: n - 1 }, (_, i) => `let distance(P${i},P${i + 1})=5`).join('\n'),
].join('\n')
const gap = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))

function build(n, { origin = SE3.identity(), tail = '', validate } = {}) {
    const scheduler = buildWorld({ breathEvery: 512, capacity: 4096, validate })
    const host = scheduler.hotSwapChild('host', fork('host', chain(n) + '\n' + tail, origin))
    drive(scheduler, { maxTicks: 200 })
    assert.deepEqual(scheduler.errors, [])
    const frames = Array.from({ length: n }, (_, i) => host.children.get(`P${i}`))
    assert.ok(frames.every((f) => f?.done), 'every participant is settled')
    const writer = frames[0]
    const ask = (position) => scheduler.requestMotion(writer,
        { ...frameWorldTransform(writer), position }, scheduler.motionRevision, 'world')
    return { scheduler, frames, writer, ask }
}

function lawful({ scheduler, frames }) {
    assert.equal(lawViolation(scheduler.laws.active(), null, scheduler.registry, lawWorld).status, 'valid')
    for (let i = 1; i < frames.length; i++) {
        assert.ok(Math.abs(gap(worldOf(frames[i - 1]), worldOf(frames[i])) - 5) <= 1e-6,
            `original length P${i - 1}/P${i} survives`)
    }
}

const snapshot = (frames) => frames.map((frame) => ({
    frame, origin: frame.origin, pose: frame.transform.deref(), position: worldOf(frame),
}))
function unchanged(before) {
    for (const { frame, origin, pose, position } of before) {
        assert.strictEqual(frame.origin, origin)
        assert.strictEqual(frame.transform.deref(), pose)
        assert.deepEqual(worldOf(frame), position)
    }
}

function warm(world) {
    for (let i = 0; i < 10; i++) {
        assert.equal(world.ask([i % 2 === 0 ? 2 : -2, 0, 0]).kind, 'accept')
    }
}

test('a lawful near-tangent continuation stays within its refinement work budget', () => {
    const world = build(16)
    warm(world)
    for (let i = 0; i < 200; i++) {
        const requested = { ...frameWorldTransform(world.writer), position: [i % 2 === 0 ? 2 : -2, 0, 0] }
        const verdict = { kind: 'accept', pose: toLocalPose(lawWorld.transform(world.writer), requested), component: [] }
        const before = snapshot(world.frames)
        let reads = 0
        const counted = {
            read: (frame, overrides) => { reads++; return lawWorld.read(frame, overrides) },
            transform: (frame) => lawWorld.transform(frame),
        }
        continueLaws(verdict, world.writer, world.scheduler.registry, world.scheduler.laws, counted)
        unchanged(before)
        const overrides = new Map([[world.writer, verdict.pose], ...verdict.component.map((m) => [m.frame, m.pose])])
        assert.equal(lawViolation(world.scheduler.laws.active(), overrides, world.scheduler.registry, lawWorld).status, 'valid')
        // The pinned cap trace needs 3157 reads; stable 2–3 passes need 253–341.
        // This budget separates the workloads without pinning one exact implementation count.
        assert.ok(reads < 1000, `bounded refinement, not 3157 reads at the sweep cap: ${reads}`)
        assert.equal(world.ask(requested.position).kind, 'accept')
        lawful(world)
    }
})

test('restating the accepted near-tangent world invents neither follower motion nor a revision', () => {
    const world = build(16)
    warm(world)
    const before = snapshot(world.frames), revision = world.scheduler.motionRevision
    for (let i = 0; i < 10; i++) {
        assert.equal(world.ask(worldOf(world.writer)).kind, 'accept')
        unchanged(before)
        assert.equal(world.scheduler.motionRevision, revision)
        lawful(world)
    }
})

test('new component inclusion uses the retained displacement and a strict edit-budget boundary', () => {
    for (const [x, included] of [[5e-10, false], [1e-9, false], [2e-9, true]]) {
        const scheduler = buildWorld({ breathEvery: 512, capacity: 4096 })
        const host = scheduler.hotSwapChild('host', fork('host', 'let P0\nlet P1\nlet distance(P0,P1)=0'))
        drive(scheduler)
        const writer = host.children.get('P0'), follower = host.children.get('P1')
        assert.deepEqual(scheduler.errors, [])
        const requested = { ...frameWorldTransform(writer), position: [x, 0, 0] }
        const verdict = { kind: 'accept', pose: toLocalPose(lawWorld.transform(writer), requested), component: [] }
        continueLaws(verdict, writer, scheduler.registry, scheduler.laws, lawWorld)
        assert.deepEqual(verdict.component.map((m) => m.frame), included ? [follower] : [])
        if (included) assert.deepEqual(verdict.component[0].pose.position, [x, 0, 0])
        const out = scheduler.requestMotion(writer, requested, scheduler.motionRevision, 'world')
        assert.equal(out.kind, 'accept')
        assert.deepEqual(worldOf(writer), [x, 0, 0], 'the edit budget never quantizes writer intent')
        assert.deepEqual(worldOf(follower), included ? [x, 0, 0] : [0, 0, 0])
        assert.equal(lawViolation(scheduler.laws.active(), null, scheduler.registry, lawWorld).status, 'valid')
    }
})

test('sub-budget writer requests remain requests, not rounded coordinates or an intent floor', () => {
    const world = build(2)
    for (const x of [1e-10, 2e-10, -1e-10, 1e-8, 1e-7]) {
        assert.equal(world.ask([x, 0, 0]).kind, 'accept')
        assert.ok(Math.abs(worldOf(world.writer)[0] - x) < 1e-15, `the requested x=${x} is retained`)
        lawful(world)
    }
})

// This fences lawfulness and writer intent, not identical follower selections in different rooms.
test('refinement remains lawful through translated and tilted placement histories', () => {
    const identity = SE3.identity()
    const rooms = [
        identity,
        { rotation: identity.rotation, position: [7, -3, 2] },
        SE3.compose({ rotation: identity.rotation, position: [7, -3, 2] },
            SE3.rotateLocal(SE3.rotateLocal(identity, AXIS_Z, 37), AXIS_X, 23)),
    ]
    for (const origin of rooms) {
        const world = build(12, { origin })
        for (let i = 0; i < 40; i++) {
            const target = SE3.apply(origin, [i % 2 === 0 ? 2 : -2, 0, 0])
            assert.equal(world.ask(target).kind, 'accept')
            assert.ok(gap(worldOf(world.writer), target) < 1e-12, 'the writer reaches its world wish')
            lawful(world)
        }
    }
})

test('a pinned end remains fixed through both feasible and clamped requests', () => {
    const world = build(3, { tail: 'let P2.position=(10,0,0)' })
    const pin = world.frames[2], pinnedAt = worldOf(pin), pinnedOrigin = pin.origin
    for (const [x, expected, clamped] of [[18, 'accept', false], [22, 'accept', true],
        [200, 'refuse', false], [-2, 'accept', true]]) {
        const before = snapshot(world.frames), revision = world.scheduler.motionRevision
        const out = world.ask([x, 0, 0])
        assert.equal(out.kind, expected)
        if (clamped) assert.ok(gap(worldOf(world.writer), [x, 0, 0]) > 1e-3, 'accepted at a lawful clamp, not the impossible wish')
        if (out.kind === 'refuse') {
            unchanged(before)
            assert.equal(world.scheduler.motionRevision, revision)
        }
        assert.deepEqual(worldOf(pin), pinnedAt)
        assert.strictEqual(pin.origin, pinnedOrigin)
        lawful(world)
    }
})

test('the host sees the final near-tangent candidate once, and rejection publishes nothing', () => {
    let capture = false
    const seen = []
    const world = build(16, { validate: ({ entries, entriesRef }) => {
        if (!capture) return true
        seen.push({ entries, entriesRef })
        return entries.length === 1
    } })
    warm(world)
    const before = snapshot(world.frames), revision = world.scheduler.motionRevision
    capture = true
    assert.equal(world.ask([2, 0, 0]).kind, 'fault')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].entriesRef, 'world')
    assert.ok(seen[0].entries.length > 1, 'the actual follower edits reached the host ceiling')
    unchanged(before)
    assert.equal(world.scheduler.motionRevision, revision)
    lawful(world)
})

test('every permitted publication matches the complete candidate certified by the host', () => {
    let capture = false
    const seen = []
    const world = build(16, { validate: ({ entries, entriesRef }) => {
        if (capture) seen.push({ entries, entriesRef })
        return true
    } })
    warm(world)
    const before = snapshot(world.frames), revision = world.scheduler.motionRevision
    capture = true
    const requested = { rotation: SE3.rotateLocal(SE3.identity(), AXIS_Z, 23).rotation, position: [2, 0, 0] }
    assert.equal(world.scheduler.requestMotion(world.writer, requested, revision, 'world').kind, 'accept')
    assert.equal(world.scheduler.motionRevision, revision + 1)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].entriesRef, 'world')
    const certified = new Map(seen[0].entries.map(({ frame, pose }) => [frame, pose]))
    assert.ok(before.some(({ frame, position }) => frame !== world.writer && certified.has(frame) &&
        gap(worldOf(frame), position) > 0), 'a translated follower exercises the full-pose certification path')
    for (const state of before) {
        const { frame } = state, after = frameWorldTransform(frame), pose = certified.get(frame)
        if (pose) {
            assert.ok(gap(after.position, pose.position) < 1e-12, 'the certified world point is what landed')
            for (const axis of [AXIS_X, AXIS_Y, AXIS_Z]) {
                assert.ok(gap(after.rotation.rotateVec(axis.x, axis.y, axis.z),
                    pose.rotation.rotateVec(axis.x, axis.y, axis.z)) < 1e-12, 'the certified heading is what landed')
            }
        } else unchanged([state])
    }
    lawful(world)
})
