// The follower is a direction already in the law, not a new engine. A distance
// address is [target, observer]: the observer is the reference, the target the
// dependent. Dragging the observer moves the target; dragging the target projects
// it back (hand-first). (id:laws-build-p3-slider, id:codex-prim-communication)
//
// Run: node --test test/js/laws/follower_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const pos = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(2))
const drag = (scheduler, frame, x) => scheduler.requestMotion(frame,
    { rotation: frame.transform.deref().rotation, position: [x, 0, 0] }, scheduler.motionRevision).kind

const COUPLE = [
    "let H",
    "jmp 100",
    "let A",
    "as A do",
    "  let H.distance = 0",     // observer A is the reference; target H depends on it
    "end",
].join("\n")

test("follower: dragging the observer moves the target", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", COUPLE))
    drive(scheduler)
    const A = find(host, "A")
    const H = find(host, "H")
    assert.deepEqual(pos(A), [100, 0, 0])
    assert.deepEqual(pos(H), [100, 0, 0], "H coincides with its reference at birth")

    assert.equal(drag(scheduler, A, 50), "accept", "the hand drags the reference")
    assert.deepEqual(pos(A), [50, 0, 0], "the reference takes the requested pose")
    assert.deepEqual(pos(H), [50, 0, 0], "and the dependent follows it")
})

test("follower: dragging the dependent projects it back, it does not drive", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", COUPLE))
    drive(scheduler)
    const H = find(host, "H")
    assert.equal(drag(scheduler, H, 30), "accept", "a request is admitted")
    assert.deepEqual(pos(H), [100, 0, 0], "but it is projected back onto its reference")
    assert.equal(scheduler.laws.active().length, 1, "still one coupling")
})
