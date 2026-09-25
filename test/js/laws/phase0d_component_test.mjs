// Phase 0d: one accepted component update across two ambients.
//
// Fixture (analytic, no solver). Hand-before-rest, free rigid pair, no pin:
//
//   A = (0,0)   B = (5,0)   |AB| = 5
//   request A -> (1,0)
//   minimal-disturbance rest => B -> (6,0)      (|1-6| = 5, nearest to B's old 5)
//
// A and B are real ambients. Their *placement* is the birth origin: A's origin is
// the world origin, B's is (5,0), so B's accepted local pose is (1,0) -> world (6,0).
// The responder returns one component update; the scheduler commits it. The four
// named questions below are the probe.
//
// Run: node --test test/js/laws/phase0d_component_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot, frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const IDENT = SE3.identity()
const at = (x, y = 0) => ({ rotation: IDENT.rotation, position: [x, y, 0] })

function fork(name, src, origin = IDENT) {
    return {
        name, origin, frame: null,
        style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
        code: { ast: parseProgram(src), functions: {} },
        env: { userspace: new Map(), loopCounter: 0, scope: {} },
    }
}

function world(name, scheduler) {
    const frame = scheduler.root.children.get(name)
    return frame && frameWorldTransform(frame).position
}

function buildWorld({ admit, capacity = 64 } = {}) {
    return createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: capacity,
        motionAdmission: admit,
        settledOnly: false,   // inherited concurrent component base, opted in
        onShout: () => {},
    })
}

// Observe a real command's request (not the proposal alone): every admitted
// command records actor, from and requested in the actor's LOCAL frame.
function componentResponder(record, { aName = "a", bName = "b" } = {}) {
    return ({ command, from, requested, frame }) => {
        record.push({ actor: frame.name, command, from: [...from.position], requested: [...requested.position] })
        if (frame.name !== aName) return { accepted: true, transform: requested }

        const b = frame.parent.children.get(bName)
        if (!b?.batch) return { accepted: true, transform: requested }

        // Hand accepted at (1,0); rest translated by the same displacement.
        const accepted = { rotation: requested.rotation, position: [1, 0, 0] }
        const origin = b.origin.position
        const localB = {
            rotation: b.batch.transform.rotation,
            position: [6 - origin[0], -origin[1], -origin[2]],
        }
        return { accepted: true, transform: accepted, component: [{ frame: b, transform: localB }] }
    }
}

// Drive ticks, draining each child's channel into a per-address trace.
function drive(scheduler, { maxTicks = 40, after } = {}) {
    const trace = new Map()
    const push = (name, events) => {
        if (!trace.has(name)) trace.set(name, [])
        trace.get(name).push(...events)
    }
    for (let i = 0; i < maxTicks && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        for (const frame of scheduler.registry.values()) {
            if (frame === scheduler.root) continue
            const events = frame.channel.drain()
            if (events.length) push(frame.address ?? frame.name, events)
        }
        if (after) after(i)
    }
    return trace
}

const ends = (trace, address) =>
    (trace.get(address) ?? []).filter((e) => e.type === "path").map((p) => p.points.at(-1))
const nz = (v) => v.map((n) => (n === 0 ? 0 : n))   // fold -0 from rotateVec

// ---------------------------------------------------------------------------
// Q1 — does B's next command start from the accepted 6, not its old local 5?
// ---------------------------------------------------------------------------
test("Q1: the component update reaches B's next command, not just B's observable", () => {
    const record = []
    // B is seated first so A's admission can find it. A moves first (its goto is
    // the only instant-0 motion); B waits, then fw 2 must start from the new pose.
    const scheduler = buildWorld({ admit: componentResponder(record) })
    scheduler.hotSwapChild("b", fork("b", "wait 1\nfw 2\nwait 1", at(5)))
    scheduler.hotSwapChild("a", fork("a", "goto 1 0\nwait 1"))

    const trace = drive(scheduler)

    const bRequest = record.find((r) => r.actor === "b" && r.command === "fw")
    assert.deepEqual(nz(bRequest.from), [1, 0, 0], "B's fw must start from the accepted local pose (world 6)")
    assert.deepEqual(nz(bRequest.requested), [3, 0, 0], "and so land at local 3 (world 8)")

    assert.deepEqual(nz(world("a", scheduler)), [1, 0, 0])
    assert.deepEqual(nz(world("b", scheduler)), [8, 0, 0], "starts at world 6, fw 2 lands at world 8")
    assert.deepEqual(nz(ends(trace, "b")[0]), [3, 0, 0], "B's ink follows the accepted start, not 5->7")
})

// ---------------------------------------------------------------------------
// Q2 — can any observer sample new A with old B (or old A with new B)?
// ---------------------------------------------------------------------------
test("Q2: one component commit publishes A and B together — no half-update snapshot", () => {
    const record = []
    const scheduler = buildWorld({ admit: componentResponder(record) })

    const b = fork("b", "wait 1\nfw 2\nwait 1", at(5))
    scheduler.hotSwapChild("b", b)
    const half = []
    const sample = () => half.push([world("a", scheduler)?.[0] ?? null, world("b", scheduler)[0]])

    sample() // before A exists: only B placed at 5
    scheduler.hotSwapChild("a", fork("a", "goto 1 0\nwait 1"))
    sample() // A's admission already committed both atoms in one synchronous step

    drive(scheduler, { after: () => sample() })

    assert.deepEqual(half[0], [null, 5], "B alone, before the hand")
    assert.deepEqual(half[1], [1, 6], "A and B published in the same commit")
    for (const [a, bPos] of half.slice(1)) {
        assert.ok(!((a === 1 && bPos === 5) || (a === 0 && bPos === 6)),
            `half a component update escaped: ${JSON.stringify([a, bPos])}`)
    }
})

// ---------------------------------------------------------------------------
// Q3 — what if B already has a pending proposal (parked at its own admission)?
// ---------------------------------------------------------------------------
test("Q3: a component target already inside its own proposal faults the transaction", () => {
    const record = []
    // B parks at its own proposal during its seat drain (hotSwapChild drains inline).
    // A is then seated while B is still parked, so the transaction cannot be atomic:
    // it aborts whole rather than committing B then watching B's own reply clobber it.
    const scheduler = buildWorld({ admit: componentResponder(record) })
    scheduler.hotSwapChild("b", fork("b", "fw 3\nwait 1", at(5)))
    const duringProposal = world("b", scheduler)

    scheduler.hotSwapChild("a", fork("a", "goto 1 0\nwait 1"))
    const afterAbort = world("b", scheduler)

    const trace = drive(scheduler)
    const a = scheduler.root.children.get("a")
    const bMove = record.find((r) => r.actor === "b" && r.command === "fw")

    assert.deepEqual(nz(duringProposal), [5, 0, 0], "B is parked at its own proposal, still at world 5")
    assert.deepEqual(nz(afterAbort), [5, 0, 0], "the transaction aborted before publishing anything")
    assert.match(a.error?.message ?? "", /target 'b' is mid-instant/, "the conflict is visible, not silent")
    assert.deepEqual(nz(a.transform.deref().position), [0, 0, 0], "the hand did not move either — all or nothing")
    assert.deepEqual(nz(bMove.from), [0, 0, 0], "B ran its own proposal from its pre-instant pose")
    assert.deepEqual(nz(bMove.requested), [3, 0, 0])
    assert.deepEqual(nz(world("b", scheduler)), [8, 0, 0], "B settled on its own proposal")
    assert.deepEqual(nz(ends(trace, "b")[0]), [3, 0, 0])
})

// ---------------------------------------------------------------------------
// Q4 — does actor traversal order change the response?
// ---------------------------------------------------------------------------
test("Q4: traversal order decides the response", () => {
    const run = (order) => {
        const record = []
        const scheduler = buildWorld({ admit: componentResponder(record) })
        scheduler.hotSwapChild("b", fork("b", "wait 1\nfw 2\nwait 1", at(5)))
        scheduler.hotSwapChild("a", fork("a", "wait 1\ngoto 1 0\nwait 1"))
        // Reorder the frontier's traversal without re-seating.
        const b = scheduler.root.children.get("b")
        const a = scheduler.root.children.get("a")
        scheduler.root.children.clear()
        for (const f of order === "a-first" ? [a, b] : [b, a]) scheduler.root.children.set(f.name, f)
        const trace = drive(scheduler)
        return {
            bFrom: record.find((r) => r.actor === "b" && r.command === "fw")?.from,
            bInk: ends(trace, "b"),
            bWorld: frameWorldTransform(b).position,
        }
    }

    const aFirst = run("a-first")
    const bFirst = run("b-first")

    assert.deepEqual(nz(aFirst.bFrom), [1, 0, 0], "hand first: B's fw starts from the accepted 6")
    assert.deepEqual(nz(bFirst.bFrom), [0, 0, 0], "rest first: B's fw ran before the hand and started from 5")
    assert.deepEqual(nz(aFirst.bInk[0]), [3, 0, 0], "hand first: B drew to world 8")
    assert.deepEqual(nz(aFirst.bWorld), [8, 0, 0])
    assert.deepEqual(nz(bFirst.bInk[0]), [2, 0, 0], "rest first: B drew to world 7 before the hand committed")
    assert.deepEqual(nz(bFirst.bWorld), [6, 0, 0], "yet B's accepted pose says world 6 — ink and truth diverge")
    assert.notDeepEqual(aFirst, bFirst, "the same source changed its response with traversal order")
})
