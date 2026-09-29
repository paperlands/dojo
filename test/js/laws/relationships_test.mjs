// Rungs A and B, pure core: a point in an authored plane, and a signed angle
// that holds its opening. (id:relationships-rung-plane, id:relationships-rung-angle)
//
// The witnesses here are the external checks: the reading (=measure("bearing")=),
// the candidate producer and the independent validator must agree, and a
// rotation of the whole fixture must not change the meaning.
//
// Run: node --test test/js/laws/relationships_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import {
    signedAngle, realizeAngle, validateAngle, wrapDegrees,
    planeOf, projectToPlane, validateInPlane, arcSamples,
    compassFrom, pointAtBearing, validateBearing, realizeBearing,
    rotatePointAbout, realizeRigidOpening, planeOfAxis, meetPlaneSphere, nearestOnMeet,
} from "../../../assets/js/turtling/laws/relationships.js"
import { measure } from "../../../assets/js/turtling/laws/relations.js"
import { validateDistance } from "../../../assets/js/turtling/laws/realize.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { AXIS_X, AXIS_Z } from "../../../assets/js/turtling/se3.js"

const IDENT = Versor.fromAxisAngle(AXIS_Z, 0)
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)
const rot = (q, v) => q.rotateVec(v[0], v[1], v[2])
const frame = (position, rotation = IDENT) => ({ position, rotation, time: 0 })
const read = (f) => ({ position: f.position, rotation: f.rotation, time: f.time ?? 0 })

// ---------------------------------------------------------------------------
// The contract: one definition feeds the reading and the check.
// ---------------------------------------------------------------------------
test("the signed angle and the reading measure the same thing", () => {
    const V = [0, 0, 0], A = [5, 0, 0], B = [0, 4, 0]
    // A bearing is compass(target) − heading(observer), in [0, 360). From one
    // observer the heading cancels; the shortest signed opening is the wrapped difference.
    const bearingA = measure("bearing", frame(A), frame(V), read)
    const bearingB = measure("bearing", frame(B), frame(V), read)
    near(signedAngle(V, A, B), wrapDegrees(bearingB - bearingA), 1e-9)
})

// ---------------------------------------------------------------------------
// Rung B — the opening holds.
// ---------------------------------------------------------------------------
test("the producer rotates the moving arm and the validator agrees", () => {
    const V = [0, 0, 0], fixed = [5, 0, 0], moving = [0, 3, 0]
    const want = 90
    const out = realizeAngle({ vertex: V, fixed, moving }, want)
    assert.equal(out.ok, true)
    // the moving arm's own length is preserved
    near(Math.hypot(out.pose[0] - V[0], out.pose[1] - V[1]), 3, 1e-9)
    // the independent validator accepts the candidate
    assert.equal(validateAngle({ vertex: V, fixed, moving: out.pose }, want).ok, true)
    // and the raw reading agrees
    near(signedAngle(V, fixed, out.pose), want, 1e-9)
})

test("swapping the arms and negating the angle is the corresponding behaviour", () => {
    const V = [0, 0, 0], A = [5, 0, 0], B = [0, 3, 0]
    near(signedAngle(V, A, B), -signedAngle(V, B, A), 1e-9)
    const forward = realizeAngle({ vertex: V, fixed: A, moving: B }, 60)
    const mirrored = realizeAngle({ vertex: V, fixed: B, moving: A }, -60)
    assert.equal(validateAngle({ vertex: V, fixed: A, moving: forward.pose }, 60).ok, true)
    assert.equal(validateAngle({ vertex: V, fixed: B, moving: mirrored.pose }, -60).ok, true)
    near(Math.abs(signedAngle(V, A, forward.pose)), 60, 1e-9)
    near(Math.abs(signedAngle(V, B, mirrored.pose)), 60, 1e-9)
})

test("the angular display boundary is not a geometric discontinuity", () => {
    // 179 and -179 are two degrees apart; the wrap says so.
    near(wrapDegrees(179 - -179), -2, 1e-9)
    near(wrapDegrees(358), -2, 1e-9)
    const V = [0, 0, 0], fixed = [5, 0, 0], moving = [0, 3, 0]
    const at = realizeAngle({ vertex: V, fixed, moving }, 180)
    // A straight opening validates against both spellings of the same angle.
    assert.equal(validateAngle({ vertex: V, fixed, moving: at.pose }, 180).ok, true)
    assert.equal(validateAngle({ vertex: V, fixed, moving: at.pose }, -180).ok, true)
})

test("zero-length arms are an explained undefined reading, not an angle", () => {
    const V = [0, 0, 0], fixed = [5, 0, 0], moving = [0, 0, 0]
    assert.equal(signedAngle(V, fixed, moving), null)
    const out = realizeAngle({ vertex: V, fixed, moving }, 90)
    assert.equal(out.ok, false)
    assert.match(out.reason, /zero length/)
    const check = validateAngle({ vertex: V, fixed, moving }, 90)
    assert.equal(check.ok, false)
    assert.match(check.reason, /no direction/)
    assert.equal(signedAngle(V, V, fixed), null, "a fixed arm on the vertex has no direction")
})

test("the visual arc uses the same convention as the reading and the check", () => {
    const V = [0, 0, 0]
    const arc = arcSamples(V, 2, 0, 90, 4)
    assert.equal(arc.length, 5)
    // the sampled end lies at compass 90 from the vertex: (sin, cos) = (1, 0)
    near(arc[4][0], 2, 1e-9)
    near(arc[4][1], 0, 1e-9)
    near(arc[0][0], 0, 1e-9)
    near(arc[0][1], 2, 1e-9)
})

// ---------------------------------------------------------------------------
// Rung A — the plane survives looking.
// ---------------------------------------------------------------------------
test("a plane is a reading of a frame; projection and check agree", () => {
    const plane = planeOf(frame([0, 0, 0], IDENT))
    assert.deepEqual(plane.normal.map((n) => +n.toFixed(9)), [0, 0, 1])
    const p = [4, 5, 6]
    const on = projectToPlane(p, plane)
    assert.deepEqual(on.map((n) => +n.toFixed(9)), [4, 5, 0])
    assert.equal(validateInPlane(on, plane).ok, true)
    assert.equal(validateInPlane(p, plane).ok, false)
})

test("rotating the whole fixture and its frame preserves the meaning", () => {
    const S = Versor.fromAxisAngle(AXIS_X, 23)
    const F = frame([1, 2, 3], Versor.fromAxisAngle(AXIS_Z, 37))
    const plane = planeOf(F)
    const P = [4, 5, 6]
    const here = projectToPlane(P, plane)
    // rotate the fixture, the frame and the point by the same S
    const movedPlane = planeOf(frame(rot(S, F.position), S.multiply(F.rotation)))
    const movedP = rot(S, P)
    const movedHere = projectToPlane(movedP, movedPlane)
    const expected = rot(S, here)
    for (let i = 0; i < 3; i++) near(movedHere[i], expected[i], 1e-9)
    assert.equal(validateInPlane(movedHere, movedPlane).ok, true)
})

test("distance and plane are satisfied together on the circle", () => {
    const O = [0, 0, 0]
    const plane = planeOf(frame(O, IDENT))
    const on = [3, 4, 0]                       // on the circle: |P−O| = 5, in the plane
    assert.equal(validateDistance(on, O, 5).ok, true)
    assert.equal(validateInPlane(on, plane).ok, true)
    const offPlane = [3, 3.9999, 0.01]         // still near distance 5, off the plane
    assert.equal(validateInPlane(offPlane, plane).ok, false)
    const offCircle = [3, 4, 0].map((v) => v * 1.2)
    assert.equal(validateDistance(offCircle, O, 5).ok, false)
})

// ---------------------------------------------------------------------------
// What each truth leaves free — equality, not membership.
// ---------------------------------------------------------------------------
test("a fixed distance is a circle, never the disc inside it", () => {
    const O = [0, 0, 0]
    assert.equal(validateDistance([5, 0, 0], O, 5).ok, true)
    assert.equal(validateDistance([2, 0, 0], O, 5).ok, false, "inside the disc is not on the circle")
    assert.equal(validateDistance([0, 0, 0], O, 5).ok, false)
})

test("a fixed bearing is a ray: many distances, one direction", () => {
    const V = [0, 0, 0]
    assert.equal(validateBearing({ vertex: V, moving: [0, 2, 0] }, 0).ok, true)
    assert.equal(validateBearing({ vertex: V, moving: [0, 7, 0] }, 0).ok, true)
    assert.equal(validateBearing({ vertex: V, moving: [1, 0, 0] }, 0).ok, false)
    assert.equal(compassFrom(V, V), null, "the origin is excluded: no direction")
    assert.equal(validateBearing({ vertex: V, moving: V }, 0).ok, false)
})

test("a fixed bearing and a fixed distance leave one position", () => {
    const V = [0, 0, 0]
    const p = pointAtBearing(V, 0, 5)
    assert.deepEqual(p.map((n) => +n.toFixed(9)), [0, 5, 0])
    assert.equal(validateBearing({ vertex: V, moving: p }, 0).ok, true)
    assert.equal(validateDistance(p, V, 5).ok, true)
})

test("two fixed arm lengths and a fixed opening rotate together", () => {
    const V = [0, 0, 0], a = [3, 0, 0], b = [0, 4, 0]     // opening −90
    const before = signedAngle(V, a, b)
    const out = realizeRigidOpening({ vertex: V, a, b }, [0, 3, 0])
    assert.equal(out.ok, true)
    near(Math.hypot(out.a[0] - V[0], out.a[1] - V[1]), 3, 1e-9, "arm A keeps its length")
    near(Math.hypot(out.b[0] - V[0], out.b[1] - V[1]), 4, 1e-9, "arm B keeps its length")
    near(signedAngle(V, out.a, out.b), before, 1e-9, "the opening holds")
    assert.deepEqual(out.a.map((n) => +n.toFixed(6)), [0, 3, 0], "A met the hand's direction")
    assert.deepEqual(out.b.map((n) => +n.toFixed(6)), [-4, 0, 0], "and B rotated with it")
})

test("two independently fixed bearings freeze the arms instead", () => {
    const V = [0, 0, 0], a = [0, 3, 0], b = [4, 0, 0]   // bearings 0 and 90
    assert.equal(validateBearing({ vertex: V, moving: a }, 0).ok, true)
    assert.equal(validateBearing({ vertex: V, moving: b }, 90).ok, true)
    near(signedAngle(V, a, b), 90, 1e-9, "the opening is implied by the two bearings")
    assert.equal(validateBearing({ vertex: V, moving: [3, 0, 0] }, 0).ok, false, "a's direction is not free")
})

// ---------------------------------------------------------------------------
// A framed coordinate and its bounded meet with a distance.
// ---------------------------------------------------------------------------
test("a framed coordinate names the declaring frame's own axis", () => {
    const y = planeOfAxis(frame([0, 0, 0], IDENT), "y", 0)
    assert.deepEqual(y.normal.map((n) => +n.toFixed(9)), [0, 1, 0])
    const R = Versor.fromAxisAngle(AXIS_Z, 90)
    const turned = planeOfAxis(frame([0, 0, 0], R), "y", 0)
    assert.deepEqual(turned.normal.map((n) => +n.toFixed(9)), [-1, 0, 0], "the frame's local +y, in the world")
})

test("a plane and a sphere meet as a circle, an uncertain tangency, or nothing", () => {
    const plane = planeOfAxis(frame([0, 0, 0], IDENT), "y", 0)
    const circle = meetPlaneSphere(plane, [0, 2, 0], 5)
    assert.equal(circle.kind, "circle")
    assert.deepEqual(circle.center.map((n) => +n.toFixed(9)), [0, 0, 0])
    near(circle.radius, Math.sqrt(21), 1e-9)
    assert.equal(meetPlaneSphere(plane, [0, 2, 0], 2).kind, "uncertain")
    assert.equal(meetPlaneSphere(plane, [0, 2, 0], 2 + 1e-7).kind, "uncertain")
    assert.equal(meetPlaneSphere(plane, [0, 2, 0], 1).kind, "empty")
    assert.equal(meetPlaneSphere(plane, [0, 0, 0], 0).kind, "point", "a point-sphere on the plane")
})

test("the nearest point on the meet is a consequence of the meet", () => {
    const plane = planeOfAxis(frame([0, 0, 0], IDENT), "y", 0)
    const circle = meetPlaneSphere(plane, [0, 2, 0], 5)
    const at = nearestOnMeet(circle, [4, 0, 0])
    near(at.at[0], Math.sqrt(21), 1e-9)
    near(at.at[1], 0, 1e-9)
    assert.equal(nearestOnMeet(meetPlaneSphere(plane, [0, 2, 0], 1), [4, 0, 0]).kind, "contradiction")
    assert.equal(nearestOnMeet(meetPlaneSphere(plane, [0, 2, 0], 2), [4, 0, 0]).kind, "unresolved")
})
