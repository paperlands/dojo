// Phase 2b — analytic realization and independent validation, pure.
// (id:laws-build-p2b, id:laws-build-solve-seam)
// Run: node --test test/js/laws/realize_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { realizeDistance, validateDistance, ACCEPT_TOL } from "../../../assets/js/turtling/laws/realize.js"

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
