// What ONE observation freezes. An observation is the reader's configuration: the members it
// captured and the pose each held. Membership binds POSES — a frame born during the window has
// none, so its geometric reads refuse — and the clock is not part of it: `sync` answers the live
// timeline, and a new ambient's time is read live too.
//
// Characterization, not a law. The audit left this unclassified; it is classified here as the
// CONTRACT: geometry is the configuration, the clock is the timeline. Widening it (capturing
// time in the same entry) is a deliberate act, and this file is where its witness must land.
// (id:laws-dependency-driven-place, D011)
//
// Run: node --test test/js/runtime/observation_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "../laws/harness.mjs"
import { resolveBinding } from "../../../assets/js/turtling/scheduler.js"

// A settled host with one sibling B at [3,0,0] and one logical second on its clock, so the
// observer's own time is 1 and B.sync starts at 0.
const reading = () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet B\nwait 1"))
    drive(scheduler)
    const B = host.children.get("B")
    B.transform.swap(() => ({ ...B.transform.deref(), position: [3, 0, 0] }))
    B.elapsedTime = 1
    return { scheduler, host, B, evaluator: host.deps.mathEvaluator }
}

test("an observation freezes its members and the pose each held", () => {
    const { host, B, evaluator } = reading()
    evaluator.beginObservation()
    const before = resolveBinding(host, "B.x")
    B.transform.swap(() => ({ ...B.transform.deref(), position: [50, 0, 0] }))
    const after = resolveBinding(host, "B.x")
    evaluator.endObservation()
    assert.equal(before, 3, "the captured pose")
    assert.equal(after, before, "the snapshot answers, not whatever is lying there")
})

test("the window covers POSES: a frame born during it has none", () => {
    const { scheduler, host, evaluator } = reading()
    evaluator.beginObservation()
    scheduler.hotSwapChild("late", fork("late", "let z"))
    drive(scheduler)
    assert.throws(() => resolveBinding(host, "late.x"), /New ambient during observation/,
        "a geometric read of a frame the snapshot never captured")
    // The temporal door never consults the configuration, so a clock still answers. The window's
    // membership binds geometry, not time — measured, so the contract says what it does and no more.
    assert.equal(resolveBinding(host, "late.time"), 0, "a new ambient's clock is read live")
    evaluator.endObservation()
})

test("the clock is not frozen: sync answers the live timeline", () => {
    const { host, B, evaluator } = reading()
    evaluator.beginObservation()
    const before = resolveBinding(host, "B.sync")
    B.elapsedTime = 9
    const after = resolveBinding(host, "B.sync")
    evaluator.endObservation()
    assert.equal(before, 0, "one second on B's clock, one on the observer's")
    assert.equal(after, 8, "the SAME observation answers the moved clock — measured, not assumed")
})
