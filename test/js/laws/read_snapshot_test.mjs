// A read is a snapshot of the accepted state at execution, never a subscription.
// A law is the coupling; an emitted label and an executed goto are history, like
// ink. (id:laws-ordered-order, id:laws-decl-exposure, id:laws-ordered-lifetime)
//
// Run: node --test test/js/laws/read_snapshot_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { resolveBinding } from "../../../assets/js/turtling/scheduler.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const drag = (scheduler, frame, x) => scheduler.requestMotion(frame,
    { rotation: frame.transform.deref().rotation, position: [x, 0, 0] }, scheduler.motionRevision).kind

test("a drag before a command is read; a drag after it is history, not a subscription", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\njmp 100\nwait 1\nlabel A.x 10\ngoto A.x"))
    const A = find(host, "A")

    // While the walk waits, the hand moves A. The next commands see the accepted x.
    assert.equal(drag(scheduler, A, 7), "accept", "the drag lands before the read")
    const trace = drive(scheduler)
    const labels = [...trace.values()].flat().filter((e) => e.type === "label")
    assert.equal(labels[0].text, "7", "the label reads the moved x, not the birth x")
    assert.equal(host.transform.deref().position[0], 7, "goto uses the same accepted read")

    // A later drag changes the world, but it re-runs nothing: the label is history.
    assert.equal(drag(scheduler, A, 3), "accept", "the later drag is accepted")
    assert.equal(labels.length, 1, "no label is re-emitted")
    assert.equal(host.transform.deref().position[0], 7, "the turtle is not a subscription")
    assert.equal(resolveBinding(host, "A.x"), 3, "but the current read is the accepted state")
})
