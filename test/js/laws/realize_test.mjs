// Phase 2b — analytic realization and independent validation, pure.
// (id:laws-build-p2b, id:laws-build-solve-seam)
// Run: node --test test/js/laws/realize_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { realizeDistance, validateDistance, realizeTilt, DEFAULT_ARM, ACCEPT_TOL } from "../../../assets/js/turtling/laws/realize.js"

const close = (a, b) => Math.abs(a - b) <= 1e-9

test("realize: a nonzero separation moves the target to the wanted distance", () => {
    const r = realizeDistance([10, 0, 0], [0, 0, 0], 5)
    assert.equal(r.ok, true)
    assert.equal(r.moved, true)
    assert.deepEqual(r.pose, [5, 0, 0], "along the existing direction")
})

test("realize: an already-feasible pair is kept, not nudged", () => {
    const r = realizeDistance([5, 0, 0], [0, 0, 0], 5)
    assert.equal(r.ok, true)
    assert.equal(r.moved, false)
    assert.deepEqual(r.pose, [5, 0, 0])
})

test("realize: coincident points take a repeatable direction, disclosed as policy", () => {
    const a = realizeDistance([0, 0, 0], [0, 0, 0], 5)
    const b = realizeDistance([0, 0, 0], [0, 0, 0], 5)
    assert.deepEqual(a.pose, [5, 0, 0], "the stated +x direction")
    assert.deepEqual(a.pose, b.pose, "the same choice every time")
})

test("realize: the target moves along its own ray, the observer is held", () => {
    const r = realizeDistance([3, 4, 0], [0, 0, 0], 1)
    assert.ok(close(Math.hypot(...r.pose), 1))
    assert.deepEqual(r.pose.map((n) => +(n * 5).toFixed(9)), [3, 4, 0])
})

test("realize: a negative or non-finite value is a domain refusal, not a number", () => {
    assert.equal(realizeDistance([1, 0, 0], [0, 0, 0], -5).ok, false)
    assert.equal(realizeDistance([1, 0, 0], [0, 0, 0], NaN).ok, false)
    assert.equal(realizeDistance([1, 0, 0], [0, 0, 0], Infinity).ok, false)
})

test("validate: rejects a wrong distance, non-finite geometry and a bad domain", () => {
    assert.equal(validateDistance([5, 0, 0], [0, 0, 0], 5).ok, true)
    assert.equal(validateDistance([6, 0, 0], [0, 0, 0], 5).ok, false)
    assert.equal(validateDistance([NaN, 0, 0], [0, 0, 0], 5).ok, false)
    assert.equal(validateDistance([5, 0, 0], [0, 0, 0], -5).ok, false)
    assert.equal(validateDistance([5, 0, 0], [0, 0, 0], 5).distance, 5)
})

test("validate: accepts a realized candidate within the declared tolerance", () => {
    const r = realizeDistance([3, 4, 0], [0, 0, 0], 2)
    assert.equal(validateDistance(r.pose, [0, 0, 0], 2).ok, true)
    // just outside tolerance: rejected
    const off = [2 + 2 * ACCEPT_TOL, 0, 0]
    assert.equal(validateDistance(off, [0, 0, 0], 2).ok, false)
})

const radians = (d) => (d * Math.PI) / 180
const tiltOf = (p) => (Math.acos(p[0] / Math.hypot(... p)) * 180) / Math.PI

test("realizeTilt: a point off the cone keeps its radius and takes the opening", () => {
    const r = realizeTilt([0, 0, 0], [1, 0, 0], [0, 0, 1], [5, 1, 0], 30)
    assert.equal(r.ok, true)
    assert.equal(r.moved, true)
    assert.ok(close(Math.hypot(...r.pose), Math.hypot(5, 1)), "radius preserved")
    assert.ok(Math.abs(tiltOf(r.pose) - 30) <= 1e-9, `tilt ${tiltOf(r.pose)}`)
})

test("realizeTilt: an apex takes a repeatable generator at the paper-scale arm", () => {
    const a = realizeTilt([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, 0], 30)
    const b = realizeTilt([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, 0], 30)
    assert.equal(a.ok, true)
    assert.deepEqual(a.pose, b.pose, "the same choice every time")
    assert.ok(close(Math.hypot(...a.pose), DEFAULT_ARM), "the paper-scale arm")
    assert.ok(Math.abs(tiltOf(a.pose) - 30) <= 1e-9, `tilt ${tiltOf(a.pose)}`)
})

test("realizeTilt: the nappe nearest the point is kept", () => {
    const r = realizeTilt([0, 0, 0], [1, 0, 0], [0, 0, 1], [-5, -1, 0], 30)
    assert.ok(r.pose[0] < 0, "the lower nappe")
    assert.ok(Math.abs(tiltOf(r.pose) - 150) <= 1e-6, "180 - 30 on the lower nappe")
})

test("realizeTilt: a non-finite opening is a domain refusal, not a number", () => {
    assert.equal(realizeTilt([0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 1, 0], NaN).ok, false)
    assert.equal(realizeTilt([0, 0, 0], [0, 0, 0], [0, 0, 1], [1, 1, 0], 30).ok, false)
    assert.ok(Math.abs(radians(30) - Math.PI / 6) <= 1e-12)
})

test("realizeTilt: the default generator turns with the frame, not a world axis", () => {
    const a = realizeTilt([0, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0], 30)
    assert.ok(a.pose[1] > 0 && a.pose[2] > 0, "between the nose and the frame's up")
    // rotate the frame 90° about z: nose +y -> -x, up +z stays up
    const b = realizeTilt([0, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, 0], 30)
    const spun = [-a.pose[1], a.pose[0], a.pose[2]]
    for (let i = 0; i < 3; i++) assert.ok(close(spun[i], b.pose[i]), "the placement rotates with the frame")
})

test("realizeTilt: an explicit arm sets the apex default length", () => {
    const r = realizeTilt([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, 0], 30, 7)
    assert.ok(close(Math.hypot(...r.pose), 7), "the arm, not the unit default")
})
