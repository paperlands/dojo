// The handle's geometry: screen → declared plane → birth coordinates. Pure, so
// the mapping that must be right is testable without a browser.
// (id:laws-decl-handle)
// Run: node --test test/js/laws/handle_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import {
    birthPlane, touchPlane, birthLocal, requestedPose, hitTest, readout, OUTCOME,
} from "../../../assets/js/turtling/laws/handle.js"

const Q90 = Versor.raw(Math.SQRT1_2, 0, 0, -Math.SQRT1_2)   // rt 90: +x → −y
const place = (position, rotation = SE3.identity().rotation) => ({ rotation, position })
const nz = (v) => v.map((n) => { const r = +n.toFixed(6); return r === 0 ? 0 : r })  // fold -0

test("the declared plane is the place's own birth plane, not the camera's", () => {
    const flat = birthPlane(place([0, 0, 0]))
    assert.deepEqual(flat.origin, [0, 0, 0])
    assert.deepEqual(flat.normal.map((n) => +n.toFixed(6)), [0, 0, 1])

    // A heading about z leaves the plane's normal alone; a placement moves it.
    const turned = birthPlane(place([10, 4, 0], Q90))
    assert.deepEqual(turned.origin, [10, 4, 0])
    assert.deepEqual(turned.normal.map((n) => +n.toFixed(6)), [0, 0, 1])
})

test("a pointer ray meets the plane, and refuses to invent one", () => {
    const flat = birthPlane(place([0, 0, 0]))
    assert.deepEqual(touchPlane({ origin: [2, 3, 5], direction: [0, 0, -1] }, flat), [2, 3, 0])
    // Parallel to the plane: no touch.
    assert.equal(touchPlane({ origin: [0, 0, 5], direction: [1, 0, 0] }, flat), null)
    // The plane is behind the eye: no touch.
    assert.equal(touchPlane({ origin: [0, 0, 5], direction: [0, 0, 1] }, flat), null)
})

test("a world touch becomes the actor's birth coordinates", () => {
    // Placed at (10,0), turned 90°: +x now runs along −y.
    const placed = place([10, 0, 0], Q90)
    assert.deepEqual(nz(birthLocal([10, 1, 0], placed)), [-1, 0, 0])
    assert.deepEqual(nz(birthLocal([10, 0, 0], placed)), [0, 0, 0])

    // Round trip: birth coordinates composed back through the place are the world
    // point again — one meaning of "where", not two.
    for (const world of [[10, 1, 0], [8, -2, 0], [12, 3, 0]]) {
        const local = birthLocal(world, placed)
        const back = SE3.compose(placed, { rotation: SE3.identity().rotation, position: local }).position
        back.forEach((n, i) => assert.ok(Math.abs(n - world[i]) < 1e-9, `${back} != ${world}`))
    }
})

test("the request moves position and leaves the accepted heading alone", () => {
    const accepted = place([3, 0, 0], Q90)
    const requested = requestedPose(accepted, [3, -1, 0])
    assert.deepEqual(requested.position, [3, -1, 0])
    assert.equal(requested.rotation, accepted.rotation, "a positional truth does not turn the actor")
})

test("the handle is hit only where it is drawn", () => {
    const projected = { x: 100, y: 50 }
    assert.equal(hitTest({ x: 100, y: 50 }, projected), true)
    assert.equal(hitTest({ x: 112, y: 50 }, projected), true)
    assert.equal(hitTest({ x: 140, y: 50 }, projected), false)
    assert.equal(hitTest({ x: 100, y: 100 }, projected), false)
    assert.equal(hitTest({ x: 105, y: 50 }, projected, 4), false)
})

test("the readout tells busy, unresolved and rejected apart", () => {
    const accepted = [1, 0, 0], requested = [2, 0, 0]
    const line = (verdict) => readout({ point: "a", accepted, requested, verdict })

    assert.deepEqual(line({ kind: "accept" }), {
        point: "a", accepted, requested, outcome: "accepted",
    })
    assert.equal(line({ kind: "refuse" }).outcome, "rejected")
    assert.equal(line({ kind: "busy" }).outcome, "busy")
    assert.equal(line({ kind: "unresolved" }).outcome, "unresolved")
    assert.equal(line({ kind: "stale" }).outcome, "obsolete")
    assert.equal(line(undefined).outcome, "unknown")
    // The three that matter must not collapse into one word.
    assert.equal(new Set([OUTCOME.refuse, OUTCOME.busy, OUTCOME.unresolved]).size, 3)
})

test("a touch from above maps onto a turned place's plane and back", () => {
    // The whole chain, exactly as the pointer path runs it.
    const placed = place([10, 0, 0], Q90)
    const hit = touchPlane({ origin: [10, 3, 5], direction: [0, 0, -1] }, birthPlane(placed))
    assert.deepEqual(hit, [10, 3, 0])
    const local = birthLocal(hit, placed)
    assert.deepEqual(nz(local), [-3, 0, 0])
    assert.equal(nz(local)[2], 0, "the plane is where it says it is")
})
