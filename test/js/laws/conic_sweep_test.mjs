// The sweep: revise a plane and watch the cone section slide through the family.
// The locus is exact; the family is named from the discriminant. (id:laws-freedom)
// Run: node --test test/js/laws/conic_sweep_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { cone, plane, meet, dofOf, conicSamples } from "../../../assets/js/turtling/laws/meet.js"

// Axis +y, half-angle 45°. The cutting plane's normal swings from the axis
// outward: ellipse until it parallels a generator (90° − 45° = 45°), then
// parabola at the boundary, then hyperbola past it.
const C = cone([0, 0, 0], [0, 1, 0], 45)
const nrm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n) }
const familyAt = (deg) => {
    const r = (deg * Math.PI) / 180
    return meet(C, plane([0, 1, 0], nrm([Math.sin(r), Math.cos(r), 0]))).shape
}

test("a plane's tilt slides the section ellipse → parabola → hyperbola", () => {
    assert.equal(familyAt(10), "ellipse")
    assert.equal(familyAt(30), "ellipse")
    assert.equal(familyAt(45), "parabola")
    assert.equal(familyAt(60), "hyperbola")
    assert.equal(familyAt(80), "hyperbola")
})

test("revising a plane's offset slides the locus, never the family", () => {
    const normal = nrm([1, 0.35, 0])
    const a = meet(C, plane([0, 1, 0], normal))
    const b = meet(C, plane([0, 2, 0], normal))
    assert.equal(a.kind, "conic")
    assert.equal(a.shape, b.shape, "parallel planes cut the same family")
    assert.equal(dofOf(a), 1)
    const originA = a.origin.map((x) => +x.toFixed(6))
    const originB = b.origin.map((x) => +x.toFixed(6))
    assert.notDeepEqual(originA, originB, "the section moved")

    const samples = conicSamples(a)
    assert.ok(samples.length >= 1 && samples[0].length > 8, "a bounded trace, not the locus")
    assert.equal(meet(a, { kind: "point", at: samples[0][0] }).kind, "point",
        "a sampled point is on the exact locus")
})
