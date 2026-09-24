// The handle's geometry: screen → declared plane → birth coordinates. Pure, so
// the mapping that must be right is testable without a browser.
// (id:laws-decl-handle)
// Run: node --test test/js/laws/handle_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import {
    birthPlane, touchPlane, birthLocal, requestedPose, hitTest, readout, inPlane,
    eligibility, outcomeOf, OUTCOME, GRAZE,
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

test("a verdict becomes an outcome in one place", () => {
    const accepted = [1, 0, 0], requested = [2, 0, 0]
    const line = (verdict) => readout({ point: "a", accepted, requested, outcome: outcomeOf(verdict) })

    assert.deepEqual(line({ kind: "accept" }), {
        point: "a", accepted, requested, outcome: "accepted",
    })
    assert.equal(line({ kind: "refuse" }).outcome, "rejected")
    assert.equal(line({ kind: "busy" }).outcome, "busy")
    assert.equal(line({ kind: "unresolved" }).outcome, "unresolved")
    assert.equal(line({ kind: "stale" }).outcome, "obsolete")
    assert.equal(line(undefined).outcome, "unknown")
    // The words that matter must not collapse into one.
    assert.equal(new Set([OUTCOME.rejected, OUTCOME.busy, OUTCOME.unresolved,
        OUTCOME.unsupported, OUTCOME.obsolete, OUTCOME.cancelled]).size, 6)
    // One outcome representation: no line can describe two contradictory answers.
    assert.equal(Object.keys(readout({ point: "a", accepted, requested, outcome: OUTCOME.busy })).length, 4)
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

test("a genuinely tilted plane is not world z", () => {
    // A tilt about x actually moves the normal; the rotated-plane cases above turn
    // about z, which leaves it alone.
    const QX90 = Versor.raw(Math.SQRT1_2, Math.SQRT1_2, 0, 0)
    const tilted = birthPlane(place([0, 0, 0], QX90))
    assert.notDeepEqual(nz(tilted.normal), [0, 0, 1], "the normal moved")
    assert.ok(Math.abs(Math.hypot(...tilted.normal) - 1) < 1e-9, "and it is still a unit normal")

    // Straight down the normal lands on the origin, whatever the plane's tilt.
    const n = tilted.normal
    const hit = touchPlane({ origin: n.map((v) => v * 5), direction: n.map((v) => -v) }, tilted)
    hit.forEach((v) => assert.ok(Math.abs(v) < 1e-9, `${hit} is not the origin`))
})

test("a near-parallel ray is refused, not stretched into a touch", () => {
    const flat = birthPlane(place([0, 0, 0]))
    // Exactly parallel, and near-parallel: at 1e-7 the intersection lands 10,000
    // units away, which is not a touch on this plane.
    assert.equal(touchPlane({ origin: [0, 0, 0.001], direction: [1, 0, -1e-12] }, flat), null)
    assert.equal(touchPlane({ origin: [0, 0, 0.001], direction: [1, 0, -1e-7] }, flat), null)
    assert.equal(touchPlane({ origin: [0, 0, 0.001], direction: [1, 0, -1e-4] }, flat), null)
    // An ordinary oblique ray still touches: the guard is an angle, not a mood.
    const oblique = touchPlane({ origin: [0, 0, 1], direction: [0.2, 0, -1] }, flat)
    assert.ok(oblique && Math.abs(oblique[0] - 0.2) < 1e-9, `${oblique}`)
})

test("the plane is a domain: a pose that left it is unsupported, not retargeted", () => {
    assert.equal(inPlane(place([3, -1, 0])), true)
    assert.equal(inPlane(place([3, -1, 0.5])), false)
    assert.equal(inPlane(place([3, -1, 1e-12])), true, "float noise is not a departure")

    const accepted = [3, -1, -1]        // pitch 90, then fw 1: outside the plane
    const line = readout({ point: "a", accepted, requested: null, outcome: OUTCOME.unsupported })
    assert.equal(line.outcome, "unsupported")
    assert.notEqual(line.outcome, OUTCOME.busy)
    assert.notEqual(line.outcome, OUTCOME.unresolved)
    assert.notEqual(line.outcome, OUTCOME.rejected)
})

test("scaling a ray cannot change its meaning", () => {
    const flat = birthPlane(place([0, 0, 0]))
    const ray = (direction, origin = [0, 0, 1]) => ({ origin, direction })
    // The same grazing ray, written at two magnitudes, is refused both times.
    assert.equal(touchPlane(ray([1, 0, -0.0005]), flat), null)
    assert.equal(touchPlane(ray([10, 0, -0.005]), flat), null)
    assert.equal(touchPlane(ray([1000, 0, -0.5]), flat), null)
    // And the same ordinary ray at two magnitudes touches the same point.
    const one = touchPlane(ray([0.2, 0, -1]), flat)
    const ten = touchPlane(ray([2, 0, -10]), flat)
    assert.deepEqual(one, ten)
    assert.ok(Math.abs(one[0] - 0.2) < 1e-9 && Math.abs(one[2]) < 1e-9)
    // A degenerate direction has no angle, so it is refused rather than guessed.
    assert.equal(touchPlane(ray([0, 0, 0]), flat), null)
    assert.equal(touchPlane({ origin: [0, 0, 1], direction: [0, 0, -1] },
        { origin: [0, 0, 0], normal: [0, 0, 0] }), null)
    assert.ok(GRAZE > 0)
})

test("missing geometry is not the domain origin", () => {
    assert.equal(inPlane(place([3, 4, 0])), true)
    assert.equal(inPlane(null), false, "an unknown pose is not supported")
    assert.equal(inPlane({ position: [3, 4] }), false, "a malformed pose is not supported")
    assert.equal(inPlane({ position: [3, 4, NaN] }), false)
    assert.equal(inPlane({}), false)
    assert.equal(inPlane(undefined), false)
})

test("eligibility asks liveness first: participation is not registration", () => {
    const frame = { name: "a", parent: { declared: new Set(["a"]) } }
    const accepted = place([1, 0, 0])

    assert.deepEqual(eligibility({ frame, registered: true, accepted }), { ok: true, reason: null })

    // A retained reference whose subtree was removed still holds its old parent's
    // declaration set — so `exposed` alone would say yes while the frame is gone.
    assert.deepEqual(eligibility({ frame, registered: false, accepted }),
        { ok: false, reason: OUTCOME.obsolete })

    const detached = { name: "a", parent: { declared: new Set() } }
    assert.deepEqual(eligibility({ frame: detached, registered: true, accepted }),
        { ok: false, reason: OUTCOME.unresolved })

    assert.deepEqual(eligibility({ frame, registered: true, accepted: place([1, 0, -1]) }),
        { ok: false, reason: OUTCOME.unsupported })

    assert.deepEqual(eligibility({ frame: null, registered: true, accepted }),
        { ok: false, reason: OUTCOME.obsolete })
})
