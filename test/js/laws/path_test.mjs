// Trajectory validation: a legal endpoint is not a legal path. (id:laws-build-p4)
// Run: node --test test/js/laws/path_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { sampleSegment, segmentResidual, segmentKeepsDistance, pathOk } from "../../../assets/js/turtling/laws/path.js"

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
