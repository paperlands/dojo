// Phase 0 acceptance: an analytic relationship, not merely a transported reply.
// Run: node --test test/js/laws/phase0i_authority_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, drive, world } from "./harness.mjs"
import { createFrame, frameWorldTransform, worldTransform, takeSync } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { createAtom } from "../../../assets/js/kernel/observable.js"

// Fixture policy: on the x-axis, move the other end by the requested displacement.
// This is a deliberately narrow, hand-before-rest analytic continuation, not a solver.
function pair({ broken = false } = {}) {
    return ({ frame, requested }) => {
        const other = frame.parent.children.get(frame.name === "a" ? "b" : "a")
        if (!other) return { accepted: false } // no unconstrained motion while the pair is incomplete
        const current = frame.transform.deref()
        const delta = requested.position[0] - current.position[0]
        const pose = { ...other.transform.deref(), position: [
            other.transform.deref().position[0] + (broken ? 0 : delta), 0, 0,
        ] }
        return { accepted: true, transform: requested, component: [{ frame: other, transform: pose }] }
    }
}

// Independent admission check: use Euclidean world distance, not the responder's
// displacement rule. It also rejects a partial reply that omits one member.
function validate({ writer, entries }) {
    const other = writer.parent.children.get(writer.name === "a" ? "b" : "a")
    if (entries.length !== 2 || !other || !entries.some(e => e.frame === other)) return false
    const candidate = (frame) => {
        const local = entries.find(e => e.frame === frame)?.pose ?? frame.transform.deref()
        return SE3.compose(worldTransform(frame), local).position
    }
    const a = candidate(writer.parent.children.get("a"))
    const b = candidate(writer.parent.children.get("b"))
    const oldA = frameWorldTransform(writer.parent.children.get("a")).position
    const oldB = frameWorldTransform(writer.parent.children.get("b")).position
    // This fixture's ink is a straight segment; equal world displacement of
    // both ends proves its entire linear continuation stays five apart.
    return Math.abs(Math.hypot(...a.map((v, i) => v - b[i])) - 5) < 1e-9 &&
        a.every((v, i) => Math.abs((v - oldA[i]) - (b[i] - oldB[i])) < 1e-9) &&
        Math.abs(a[1]) < 1e-9 && Math.abs(b[1]) < 1e-9 &&
        Math.abs(a[2]) < 1e-9 && Math.abs(b[2]) < 1e-9
}

function setup(order = "a-first", responder = pair()) {
    const scheduler = buildWorld({ admit: responder, validate })
    // Admission is active and both identities are seated before either runs.
    // No user-written wait is needed to make the relation govern the first step.
    scheduler.hotSwapChild("a", fork("a", "goto 1 0\nwait 1"), { deferStart: true })
    scheduler.hotSwapChild("b", fork("b", "fw 2\nwait 1", at(5)), { deferStart: true })
    if (order === "b-first") {
        const a = scheduler.root.children.get("a"), b = scheduler.root.children.get("b")
        scheduler.root.children.clear()
        scheduler.root.children.set("b", b)
        scheduler.root.children.set("a", a)
    }
    return scheduler
}

function assertPair(scheduler) {
    const a = world("a", scheduler), b = world("b", scheduler)
    assert.ok(a && b)
    assert.ok(Math.abs(Math.hypot(...a.map((v, i) => v - b[i])) - 5) < 1e-9,
        `published pair is not five apart: ${JSON.stringify([a, b])}`)
}

test("acceptance: both motions preserve the pair at each tick boundary, in either traversal", () => {
    for (const order of ["a-first", "b-first"]) {
        const scheduler = setup(order)
        assertPair(scheduler)
        const trace = drive(scheduler, { after: () => assertPair(scheduler) })
        assert.equal(scheduler.done, true)
        assertPair(scheduler)
        assert.deepEqual(scheduler.errors, [])
        assert.ok((trace.get("b") ?? []).some(e => e.type === "path"), "B really walked")
        // Different histories can choose different realizations, never a false pair.
        assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]],
            order === "a-first" ? [3, 8] : [1, 6])
    }
})

test("acceptance: a finished actor accepts a pen-up hand request through the same admission", () => {
    const scheduler = setup()
    const trace = drive(scheduler, { after: () => assertPair(scheduler) })
    const a = scheduler.root.children.get("a")
    assert.equal(a.done, true)
    assert.equal(a.batch, null, "there is no executor to keep alive")
    const oldRevision = scheduler.motionRevision
    const oldInk = (trace.get("a") ?? []).filter(e => e.type === "path").length
    const result = scheduler.requestMotion(a, at(4), oldRevision)
    assert.equal(result.kind, "accept")
    assertPair(scheduler)
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [4, 9])
    assert.deepEqual(takeSync(a).find(e => e.type === "head")?.position, [4, 0, 0])
    assert.deepEqual(takeSync(scheduler.root.children.get("b")).find(e => e.type === "head")?.position, [4, 0, 0],
        "B's head receives its accepted local pose (world 9)")
    assert.equal(a.done, true)
    assert.equal(a.batch, null)
    assert.equal((trace.get("a") ?? []).filter(e => e.type === "path").length, oldInk,
        "a pen-up hand move does not rewrite deposited ink")
    assert.equal(scheduler.requestMotion(a, at(5), oldRevision).kind, "stale")
    assertPair(scheduler)
    scheduler.removeChild("a")
    assert.equal(scheduler.requestMotion(a, at(7), scheduler.motionRevision).kind, "stale")

    // A fresh play starts from its own program and has no inherited hand offset.
    const fresh = setup()
    assertPair(fresh)
    assert.deepEqual([world("a", fresh)[0], world("b", fresh)[0]], [0, 5])
})

test("acceptance: independent validation stops a well-formed but false reply", () => {
    const scheduler = setup("a-first", pair({ broken: true }))
    assertPair(scheduler)
    drive(scheduler, { after: () => assertPair(scheduler) })
    assert.ok(scheduler.errors.some(e => /independent validation/.test(e.message)))
    assertPair(scheduler)
})

test("acceptance: valid endpoints alone cannot admit a chord through a broken relationship", () => {
    const admit = ({ frame, requested }) => {
        const other = frame.parent.children.get("b")
        return { accepted: true, transform: requested,
            component: [{ frame: other, transform: other.transform.deref() }] }
    }
    const scheduler = buildWorld({ admit, validate })
    scheduler.hotSwapChild("a", fork("a", "goto 10 0\nwait 1"), { deferStart: true })
    scheduler.hotSwapChild("b", fork("b", "", at(5)), { deferStart: true })
    assertPair(scheduler)
    drive(scheduler, { after: () => assertPair(scheduler) })
    assert.ok(scheduler.errors.some(e => /independent validation/.test(e.message)))
    assertPair(scheduler)
})

test("acceptance: a hand cannot bypass a running actor or revive a stale place", () => {
    const scheduler = setup()
    const a = scheduler.root.children.get("a")
    assert.equal(scheduler.requestMotion(a, at(2), scheduler.motionRevision).kind, "busy")
    assertPair(scheduler)
})

test("acceptance: contention reports busy without calling a false relationship impossible", () => {
    const scheduler = buildWorld({ admit: pair(), validate })
    const a = scheduler.hotSwapChild("a", fork("a", ""))
    scheduler.hotSwapChild("b", fork("b", "fw 3\nwait 1", at(5)))
    assert.equal(a.done, true)
    assertPair(scheduler)
    const verdict = scheduler.requestMotion(a, at(1), scheduler.motionRevision)
    assert.equal(verdict.kind, "busy")
    assert.equal(a.error, null)
    assertPair(scheduler)
    drive(scheduler, { after: () => assertPair(scheduler) })
    assert.equal(scheduler.errors.length, 0)
})

test("characterization: a parent's local motion does not carry a child's birth origin", () => {
    const root = createFrame("origin", null)
    const parent = createFrame("parent", null, { parent: root, origin: at(0) })
    const child = createFrame("child", null, { parent, origin: at(2) })
    assert.equal(frameWorldTransform(child).position[0], 2)
    parent.transform.swap(() => at(10))
    assert.equal(frameWorldTransform(parent).position[0], 10)
    assert.equal(frameWorldTransform(child).position[0], 2)
})

test("characterization: valid circle endpoints do not license their ink chord", () => {
    const first = [5, 0], last = [0, 5], midpoint = first.map((x, i) => (x + last[i]) / 2)
    assert.equal(Math.hypot(...first), 5)
    assert.equal(Math.hypot(...last), 5)
    assert.ok(Math.hypot(...midpoint) < 5)
})

test("characterization: notifying between two writes exposes a half pair", () => {
    const a = createAtom(0), b = createAtom(5), seen = []
    a.watch("half", () => seen.push([a.deref(), b.deref()]))
    a.swap(() => 1)
    b.swap(() => 6)
    assert.deepEqual(seen, [[1, 5]])
})

test("acceptance: component watchers run only after all members are installed", () => {
    const scheduler = setup()
    const a = scheduler.root.children.get("a")
    const seen = []
    a.transform.watch("p0i-complete", () => seen.push([world("a", scheduler)[0], world("b", scheduler)[0]]))
    drive(scheduler)
    assert.ok(seen.length > 0)
    assert.ok(seen.every(([x, y]) => Math.abs(x - y) === 5),
        `a watcher read a partially published pair: ${JSON.stringify(seen)}`)
    assertPair(scheduler)
})
