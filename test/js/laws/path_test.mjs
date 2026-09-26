// Trajectory validation: a legal endpoint is not a legal path. (id:laws-build-p4)
// Run: node --test test/js/laws/path_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { sampleSegment, segmentResidual, segmentKeepsDistance, pathOk, segmentOk, arcOk, arcPoint } from "../../../assets/js/turtling/laws/path.js"

test("path: the diameter chord leaves the circle", () => {
    const worst = segmentResidual([5, 0, 0], [-5, 0, 0], [0, 0, 0], 5, 16)
    assert.ok(worst >= 5 - 1e-9, `the midpoint is the centre (worst residual ${worst})`)
    assert.equal(segmentKeepsDistance([5, 0, 0], [-5, 0, 0], [0, 0, 0], 5), false,
        "moving by the straight chord is refused")
})

test("path: a fine arc stays near the locus", () => {
    const arc = []
    for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI
        arc.push([5 * Math.cos(a), 5 * Math.sin(a), 0])
    }
    let worst = 0
    for (let i = 0; i < 32; i++) worst = Math.max(worst, segmentResidual(arc[i], arc[i + 1], [0, 0, 0], 5, 4))
    assert.ok(worst < 0.05, `an arc drawn in fine steps stays on the circle (worst ${worst})`)
})

test("pathOk: a rigidly moved component keeps its law; a chorded point does not", () => {
    const rigid = pathOk({
        paths: [{ from: [0, 0, 0], to: [10, 0, 0] }, { from: [0, 0, 0], to: [10, 0, 0] }],
        laws: [{ a: 0, b: 1, radius: 0 }],
    })
    assert.equal(rigid.ok, true, "the pair moves together, so the coincidence holds throughout")

    const chord = pathOk({
        paths: [{ from: [5, 0, 0], to: [-5, 0, 0] }],
        others: [[0, 0, 0]],
        laws: [{ a: 0, b: -1, radius: 5 }],
    })
    assert.equal(chord.ok, false, "the intervening path is checked, not just the endpoint")
})

// A hole in the check is not a pass: a non-finite path or a law whose named
// participant is absent is refused, never silently skipped. (id:laws-build-p4)
test("pathOk: a non-finite path and a missing participant are refused", () => {
    assert.equal(pathOk({ paths: [{ from: [NaN, 0, 0], to: [0, 0, 0] }] }).ok, false,
        "a NaN endpoint is not a legal path")
    assert.equal(pathOk({
        paths: [{ from: [0, 0, 0], to: [1, 0, 0] }], others: [], laws: [{ a: 0, b: -2, radius: 1 }],
    }).ok, false, "a law naming an absent held participant is refused")
    assert.equal(pathOk({
        paths: [{ from: [0, 0, 0], to: [1, 0, 0] }], others: [], laws: [{ a: 0, b: 0, radius: NaN }],
    }).ok, false, "a non-finite radius is refused")
})

// Straight relative motion is quadratic: the analytic checker agrees with dense
// sampling and settles the diameter chord without a sample count. (id:laws-build-p4)
test("segmentOk: the exact extrema of a straight move", () => {
    const chord = segmentOk({ from: [5, 0, 0], to: [-5, 0, 0], other: [0, 0, 0], radius: 5 })
    assert.equal(chord.ok, false, "a diameter chord leaves the circle")
    assert.ok(Math.abs(chord.residual - 5) < 1e-9, "the vertex is the centre")
    assert.equal(segmentOk({ from: [5, 0, 0], to: [5, 0, 0], other: [0, 0, 0], radius: 5 }).ok, true,
        "a zero-length move keeps the distance")
    // The analytic extrema agree with dense sampling on a coarse chord.
    const from = [0, 5, 0], to = [1, 4.898979485566356, 0]
    const dense = segmentResidual(from, to, [0, 0, 0], 5, 400)
    const analytic = segmentOk({ from, to, other: [0, 0, 0], radius: 5 }).residual
    assert.ok(Math.abs(analytic - dense) < 1e-6, `analytic and dense agree (${analytic} vs ${dense})`)
    assert.equal(segmentOk({ from, to, other: [0, 0, 0], radius: 5 }).ok, false,
        "the straight chord between two points on the circle bulges inward")
})

// An arc is a representation, not a sample: a well-formed arc keeps its radius by
// construction, and a malformed one is refused before any point is derived.
// (id:laws-build-p4-arc)
test("arcOk: a represented arc keeps its radius; a malformed one is refused", () => {
    assert.equal(arcOk({ center: [0, 0, 0], radius: 5, axis: [0, 0, 1], fromAngle: 0, toAngle: Math.PI }).ok, true)
    assert.equal(arcOk({ center: [0, 0, 0], radius: 5, axis: [0, 0, 2], fromAngle: 0, toAngle: Math.PI }).ok, false,
        "a non-unit axis is not an arc representation")
    const p = arcPoint({ center: [1, 2, 3], radius: 5, axis: [0, 0, 1], fromAngle: 0, toAngle: Math.PI }, 0.5)
    assert.ok(Math.abs(Math.hypot(p[0] - 1, p[1] - 2, p[2] - 3) - 5) < 1e-9, "a derived point is on the radius")
})
