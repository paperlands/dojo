// State transports named geometry, not a second inventory of its fields. (D058)
import { test } from "node:test"
import assert from "node:assert/strict"
import { stateOf, marksOf } from "../../../assets/js/turtling/laws/constraints.js"
import { copyLocus, SPACE, EMPTY, UNCERTAIN, UNRESOLVED } from "../../../assets/js/turtling/laws/meet.js"
import { angleOf } from "../../../assets/js/turtling/laws/angle.js"

test("geometry forwarding: every named kind survives without a state-side field schema", () => {
    const loci = [
        { kind: "plane", point: [0, 0, 0], normal: [0, 0, 1] },
        { kind: "halfplane", point: [0, 0, 0], normal: [0, 0, 1], dir: [1, 0, 0] },
        { kind: "line", point: [0, 0, 0], dir: [1, 0, 0] },
        { kind: "ray", point: [0, 0, 0], dir: [1, 0, 0] },
        { kind: "circle", center: [0, 0, 0], normal: [0, 0, 1], radius: 2, keep: [1, 0, 0] },
        { kind: "sphere", center: [0, 0, 0], radius: 2 },
        { kind: "cone", apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 45 },
        { kind: "angle", apex: [0, 0, 0], axis: [1, 0, 0], degrees: 135 },
        { kind: "point", at: [1, 0, 0] },
        { kind: "points", at: [[1, 0, 0], [2, 0, 0]] },
        { kind: "conic", shape: "ellipse", origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0],
            normal: [0, 0, 1], Q: [1, 0, 1, 0, 0, -1] },
    ]
    for (const set of loci) {
        const state = stateOf({ at: [2, 0, 0], constraints: [{ set }] })
        assert.deepEqual(state.locus, set, set.kind)
        assert.notEqual(state.locus, set, `${set.kind}: no mutable alias`)
    }
})

test("geometry forwarding: modifiers and nested data are copied, not stripped or shared", () => {
    const set = { kind: "points", at: [[1, 2, 3]], meaning: { branch: ["held"] } }
    const state = stateOf({ at: [1, 2, 3], constraints: [{ set }] })
    state.locus.at[0][0] = 99
    state.locus.meaning.branch.push("extra")
    assert.deepEqual(set, { kind: "points", at: [[1, 2, 3]], meaning: { branch: ["held"] } })
})

test("geometry forwarding: space and nonanswers are not invented drawing loci", () => {
    for (const set of [SPACE, EMPTY, UNCERTAIN, UNRESOLVED, { kind: "unknown" }, null]) {
        assert.equal(copyLocus(set), null)
    }
})

test("geometry forwarding: record to state to marks preserves the ordinary-angle predicate", () => {
    const set = { kind: "angle", apex: [0, 0, 0], axis: [1, 0, 0], degrees: 135 }
    const state = stateOf({ at: [-Math.SQRT2, Math.SQRT2, 0], constraints: [{ set }] })
    const marks = marksOf(state.locus, { at: state.at })
    assert.ok(marks.curves[0].length > 10)
    for (const point of marks.curves[0]) {
        const got = angleOf(point, [0, 0, 0], [1, 0, 0])
        assert.ok(Math.abs(got.radians * 180 / Math.PI - 135) < 1e-9)
    }
})
