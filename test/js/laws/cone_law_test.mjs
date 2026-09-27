// The authored cone: `let P.tilt = θ` — a fixed angle from the declaring frame's
// nose, the 3-D protractor. (id:relationships-todo-coordinate-authoring, id:laws-freedom)
//
// Run: node --test test/js/laws/cone_law_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { stateOf, coneCurve, marksOf } from "../../../assets/js/turtling/laws/constraints.js"
import { DEFAULT_ARM } from "../../../assets/js/turtling/laws/realize.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const pos = (f) => frameWorldTransform(f).position.map((n) => +n.toFixed(4))
const tiltOf = (p) => { const r = Math.hypot(...p); return r < 1e-9 ? null : (Math.acos(p[0] / r) * 180) / Math.PI }

const SOURCE = "let B = [0, 0, 0]\ngoto 5 1 0\nlet P\nas B do\n  let P.tilt = 30\nend"

test("the parser authors a tilt", () => {
    const law = parseProgram("let P\nlet P.tilt = 30").find((n) => n.type === "Law")
    assert.equal(law.value, "tilt")
    assert.equal(law.meta.target, "P")
})

test("an authored tilt puts the point on the cone about the frame's nose", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", SOURCE))
    drive(scheduler)
    const p = [...frameWorldTransform(host.children.get("P")).position]
    assert.ok(Math.abs(tiltOf(p) - 30) < 1e-6, `tilt ${tiltOf(p)}`)
    assert.ok(Math.abs(Math.hypot(...p) - Math.hypot(5, 1)) < 1e-6, "the radius is preserved")
})

test("a hand request composes onto the cone", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", SOURCE))
    drive(scheduler)
    const P = host.children.get("P")
    const r = scheduler.requestMotion(P, { rotation: P.transform.deref().rotation, position: [0, 5, 0] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 5 })
    assert.equal(r.kind, "accept")
    const p = [...frameWorldTransform(P).position]
    assert.ok(Math.abs(tiltOf(p) - 30) < 1e-6, "the opening holds")
    assert.ok(Math.abs(Math.hypot(...p) - 5) < 1e-6, "the wish's radius is kept")
})

test("the freedom display names the cone and samples its window", () => {
    const state = stateOf({ at: [4, 2, 0], constraints: [
        { feature: "tilt", apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 30 },
    ] })
    assert.equal(state.locus.kind, "cone")
    assert.equal(state.dof, 2)
    const cc = coneCurve(state.locus, [4, 2, 0])
    assert.ok(cc.ring.length > 8)
    assert.equal(cc.generators.length, 4)
})

test("a tilt and a plane meet in a section: circle or conic", () => {
    const base = { feature: "tilt", apex: [0, 0, 0], axis: [0, 1, 0], halfAngle: 45 }
    const cut = (normal) => ({ feature: "coordinate", axis: "y", value: 1, plane: { point: [0, 1, 0], normal } })
    const circle = stateOf({ at: [1, 1, 0], constraints: [base, cut([0, 1, 0])] })
    assert.equal(circle.locus.kind, "circle")
    const n = Math.hypot(1, 1.732)
    const section = stateOf({ at: [1, 1, 0], constraints: [base, cut([1 / n, 1.732 / n, 0])] })
    assert.equal(section.locus.kind, "conic")
    assert.equal(section.locus.shape, "ellipse")
    assert.equal(section.dof, 1)
})

test("a tilt declared at the apex resolves to a repeatable generator", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let B = [0, 0, 0]\nlet P\nas B do\n  let P.tilt = 30\nend"))
    drive(scheduler)
    const P = host.children.get("P")
    const p = [...frameWorldTransform(P).position]
    assert.ok(scheduler.laws.active().some((l) => l.feature === "tilt"), "the law resolves, not refused")
    assert.ok(Math.abs(tiltOf(p) - 30) < 1e-6, `tilt ${tiltOf(p)}`)
    assert.ok(Math.abs(Math.hypot(...p) - DEFAULT_ARM) < 1e-6, "the paper-scale arm is the default")
})

test("a tilt outside [0, 180] folds to the same cone, never a domain error", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let B = [0, 0, 0]\nlet P\nas B do\n  let P.tilt = 190\nend"))
    drive(scheduler)
    const P = host.children.get("P")
    const p = [...frameWorldTransform(P).position]
    assert.ok(scheduler.laws.active().some((l) => l.feature === "tilt"), "190 resolves")
    assert.ok(Math.abs(tiltOf(p) - 170) < 1e-6, `190 folds to 170, got ${tiltOf(p)}`)
})

test("tilt 360 is tilt 0: the axis, and it has a mark", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let B = [0, 0, 0]\nlet P\nas B do\n  let P.tilt = 360\nend"))
    drive(scheduler)
    const P = host.children.get("P")
    const p = [...frameWorldTransform(P).position]
    assert.ok(scheduler.laws.active().some((l) => l.feature === "tilt"), "360 resolves")
    assert.ok(tiltOf(p) < 1e-6, `the axis, got ${tiltOf(p)}`)
    const state = stateOf({ at: p, constraints: [
        { feature: "tilt", apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 0 },
    ] })
    assert.equal(state.dof, 1, "a closed cone is a line, one degree")
    const marks = marksOf(state.locus, { at: p })
    assert.equal(marks.curves.length, 0, "no window")
    assert.equal(marks.axes.length, 1, "the axis is the dotted mark")
})
