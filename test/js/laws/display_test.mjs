// The live readout with a shape: a polygon whose side count follows the accepted
// scalar, replaced on commit — not ink, not command replay. (id:laws-build-p3-slider)
//
// Run: node --test test/js/laws/display_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { polygonSides, polygon } from "../../../assets/js/turtling/laws/display.js"

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

test("polygonSides: bounded, truncated, at least a triangle", () => {
    assert.equal(polygonSides(1), 3, "a triangle is the floor")
    assert.equal(polygonSides(5.9), 5, "truncated")
    assert.equal(polygonSides(500), 64, "bounded above")
    assert.equal(polygonSides(NaN), 0)
})

test("polygon: one vertex per side, on the circle", () => {
    const p = polygon([0, 0, 0], 10, 4)
    assert.equal(p.length, 4)
    for (const v of p) assert.ok(Math.abs(Math.hypot(v[0], v[1]) - 10) < 1e-9)
})

test("display: the side count follows the drag at the commit, with no replay", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "jmp 100",
        "fn round(no) [no - (no // 1)]",
        "let n = round(A.x/10)",
        "wait 1",
    ].join("\n")))
    const A = find(host, "A")
    const id = host.scalars.get("n")

    let sides = 0
    let vertices = []
    scheduler.readouts.watch((change) => {
        if (change.id !== id) return
        sides = polygonSides(change.value)
        vertices = polygon(frameWorldTransform(A).position, 20, sides)
    })

    assert.equal(drag(scheduler, A, 50), "accept", "the hand drags A to fifty")
    assert.equal(sides, 5, "fifty in x is five sides")
    assert.equal(vertices.length, 5, "the projection has five vertices")

    assert.equal(drag(scheduler, A, 90), "accept", "the hand drags A to ninety")
    assert.equal(sides, 9, "ninety in x is nine sides")
    assert.equal(vertices.length, 9, "the projection follows, replaced not appended")

    assert.equal(scheduler.readouts.size, 1, "one source-owned node, no accumulation")
})
