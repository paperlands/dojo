// The explained evaluator is the same arithmetic as applyAction: the wrapper is a parity
// check, reasons appear only where a point was already refused. (id:laws-hand-action-algebra)
import { test } from "node:test"
import assert from "node:assert/strict"
import { actionBetween, applyAction, interpretAction } from "../../../assets/js/turtling/laws/action.js"
import { nearest } from "../../../assets/js/turtling/laws/meet.js"
import { SE3, AXIS_Y, AXIS_Z } from "../../../assets/js/turtling/se3.js"
import { coneFrame } from "../../../assets/js/turtling/laws/cone.js"

const near = (a, b) => a && b && Math.hypot(...a.map((x, i) => x - b[i])) < 1e-8
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l) }
const spin = (axis, radians, p) => SE3.rotateLocal({ rotation: SE3.identity().rotation, position: [0, 0, 0] }, axis, radians * 180 / Math.PI)
const circle = (normal, radius = 5) => ({ kind: "circle", center: [0, 0, 0], normal, radius })

const parity = (label, action, locus, base, frame = SE3.identity()) => {
    const out = interpretAction(action, locus, base, frame)
    const legacy = applyAction(action, locus, base, frame)
    assert.equal(out.ok, legacy !== null, `${label}: ok disagrees with the point|null API`)
    if (out.ok) assert.deepEqual(out.at, legacy, `${label}: same point`)
    return out
}

test("every existing family and gauge fixture is parity with applyAction", () => {
    parity("translation", actionBetween(null, [2, 0, 0], [3, 4, 0]), null, [10, 0, 0])
    const sphere = { kind: "sphere", center: [2, 3, 0], radius: 5 }
    parity("sphere", actionBetween(sphere, [7, 3, 0], [2, 8, 0]), sphere, [7, 3, 0])
    parity("sphere antipode", actionBetween(sphere, [7, 3, 0], [-3, 3, 0]), sphere, [7, 3, 0])
    const c = circle([0, 0, 1])
    parity("circle", actionBetween(c, [5, 0, 0], [0, 5, 0]), c, [5, 0, 0])
    parity("circle flipped normal", actionBetween(c, [5, 0, 0], [0, 5, 0]), circle([0, 0, -1]), [5, 0, 0])
    parity("circle normal scale", actionBetween(c, [5, 0, 0], [0, 5, 0]), circle([0, 0, 7]), [5, 0, 0])
    const cone = { kind: "cone", apex: [0, 0, 0], axis: [0, 0, 1], halfAngle: 30 }
    const a = coneFrame(cone.apex, cone.axis, cone.halfAngle)
    parity("cone", actionBetween(cone, a.point(3, 0), a.point(5, Math.PI / 2)), cone, a.point(3, 0))
    parity("identity", null, c, [5, 0, 0])
})

test("family failure is a reason, never a silent point", () => {
    const sphere = { kind: "sphere", center: [2, 3, 0], radius: 5 }
    const action = actionBetween(sphere, [7, 3, 0], [2, 8, 0])
    const plane = { kind: "plane", point: [0, 0, 0], normal: [1, 0, 0] }
    assert.deepEqual(interpretAction(action, plane, [7, 3, 0]), { ok: false, reason: "family" })
    const translation = actionBetween(null, [0, 0, 0], [1, 0, 0])
    assert.deepEqual(interpretAction(translation, { kind: "sphere", center: [0, 0, 0], radius: 5 }, [5, 0, 0]),
        { ok: false, reason: "family" })
})

test("compatible-full-clamp is interpretable; the nearest clamp is not this evaluator's question", () => {
    const translation = actionBetween(null, [5, 0, 0], [7, 0, 0])
    const plane = { kind: "plane", point: [5, 0, 0], normal: [1, 0, 0] }
    const out = interpretAction(translation, plane, [5, 0, 0])
    assert.equal(out.ok, true, "the wish exists")
    assert.ok(near(out.at, [7, 0, 0]))
    const projected = nearest(plane, out.at, { keep: [5, 0, 0] })
    assert.ok(near(projected.at, [5, 0, 0]), "the projection clamps back: zero displacement")
    // The family failure has no wish at all.
    const sphereAction = actionBetween({ kind: "sphere", center: [0, 0, 0], radius: 5 }, [5, 0, 0], [0, 5, 0])
    assert.equal(interpretAction(sphereAction, plane, [5, 0, 0]).ok, false)
})

test("orthogonal circle chart is inapplicable; a half turn stays answerable", () => {
    const quarter = actionBetween(circle([0, 0, 1]), [5, 0, 0], [0, 5, 0])
    assert.deepEqual(interpretAction(quarter, circle([1, 0, 0]), [5, 0, 0]), { ok: false, reason: "chart" })
    const half = actionBetween(circle([0, 0, 1]), [5, 0, 0], [-5, 0, 0])
    assert.equal(interpretAction(half, circle([1, 0, 0]), [5, 0, 0]).ok, true)
    // A rigid re-expression loses an ulp of the normal's norm; the roundoff bound still admits it.
    const frame = SE3.translateLocal(SE3.rotateLocal(SE3.rotateLocal(SE3.identity(), AXIS_Z, 70), AXIS_Y, 35), 10, 20, 30)
    const point = (p) => SE3.apply(frame, p)
    const rotate = (v) => frame.rotation.rotateVec(...v)
    const n = unit([1, 2, 3])
    const u = unit([n[1] * 0 - n[2] * 0, n[2] * 1 - n[0] * 0, n[0] * 0 - n[1] * 1])   // ⟂ n
    const m = unit([n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]) // ⟂ n, u
    const locus = { ...circle(rotate(n)), center: point([0, 0, 0]) }
    const re = actionBetween(locus, point(u.map((x) => x * 5)), point(u.map((x) => x * -5)), frame)
    const out = interpretAction(re, { ...locus, normal: rotate(m) }, point(u.map((x) => x * 5)), frame)
    assert.equal(out.ok, true)
})

test("a circle with no normal is a normal reason; non-finite arithmetic is nonfinite", () => {
    const action = actionBetween(circle([0, 0, 1]), [5, 0, 0], [0, 5, 0])
    assert.deepEqual(interpretAction(action, circle([0, 0, 0]), [5, 0, 0]), { ok: false, reason: "normal" })
    const bad = { kind: "translation", by: [NaN, 0, 0] }
    assert.deepEqual(interpretAction(bad, null, [0, 0, 0]), { ok: false, reason: "nonfinite" })
})
