// Authored bearing: the evaluator's reading, a vertical plane, a signed half.
// (id:relationships-row-contract)
// Run: node --test test/js/laws/bearing_law_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { stateOf } from "../../../assets/js/turtling/laws/constraints.js"
import { DEFAULT_ARM } from "../../../assets/js/turtling/laws/realize.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { AUTHORED } from "../../../assets/js/turtling/laws/authored.js"
import { RELATION, KIND } from "../../../assets/js/turtling/laws/expression.js"
import { headingOf, compassOf } from "../../../assets/js/turtling/laws/relations.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const wrap = (d) => { let w = d % 360; if (w <= -180) w += 360; if (w > 180) w -= 360; return w }
const bearingOf = (origin, heading, p) => {
    const dx = p[0] - origin[0], dy = p[1] - origin[1]
    if (Math.hypot(dx, dy) < 1e-9 || heading == null) return null
    return wrap(compassOf(dx, dy) - heading)
}

const SOURCE = "let B = [0, 0, 0]\ngoto 5 1 0\nlet P\nas B do\n  let P.bearing = 30\nend"

test("the read and the law are the same bearing row", () => {
    assert.equal(RELATION.bearing, AUTHORED.bearing)
    assert.equal(RELATION.bearing.kind, KIND.angle)
    assert.equal(RELATION.bearing.family, "relational")
    assert.ok(AUTHORED.bearing.read)
    assert.ok(AUTHORED.bearing.set)
})

test("the parser authors a bearing", () => {
    const law = parseProgram("let P\nlet P.bearing = 30").find((n) => n.type === "Law")
    assert.equal(law.value, "bearing")
    assert.equal(law.meta.target, "P")
})

test("an authored bearing puts the point on that turn from the frame's nose", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", SOURCE))
    drive(scheduler)
    const B = host.children.get("B")
    const P = host.children.get("P")
    const b = frameWorldTransform(B)
    const p = frameWorldTransform(P).position
    const got = bearingOf(b.position, headingOf(b.rotation), p)
    assert.ok(got != null, "the bearing is defined")
    assert.ok(Math.abs(got - 30) < 1e-4, `bearing ${got}`)
    assert.ok(Math.abs(p[2] - 0) < 1e-6, "the height is kept")
})

test("a hand request stays on the signed half", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", SOURCE))
    drive(scheduler)
    const P = host.children.get("P")
    const B = host.children.get("B")
    const r = scheduler.requestMotion(P, { rotation: P.transform.deref().rotation, position: [0, 8, 2] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 5 })
    assert.equal(r.kind, "accept")
    const b = frameWorldTransform(B)
    const p = frameWorldTransform(P).position
    const got = bearingOf(b.position, headingOf(b.rotation), p)
    assert.ok(Math.abs(got - 30) < 1e-4, `bearing ${got}`)
    assert.ok(Math.abs(p[2] - 2) < 1e-4, "the wish's height is kept")
})

test("the freedom display names the half-plane, and a height law meets in a ray", () => {
    const hp = AUTHORED.bearing.set(
        { feature: "bearing", frame: "F", predicate: 30, endpoints: ["P"] },
        { poseOf: () => ({ position: [0, 0, 0], rotation: { x: 0, y: 0, z: 0, w: 1 } }) },
    )
    assert.equal(hp.kind, "halfplane")
    const state = stateOf({ at: [1, 0, 0], constraints: [
        { feature: "bearing", set: hp },
        { feature: "coordinate", axis: "z", value: 0, plane: { point: [0, 0, 0], normal: [0, 0, 1] } },
    ] })
    assert.equal(state.locus.kind, "ray")
    assert.equal(state.dof, 1)
})

test("a bearing declared at the vertex resolves to a repeatable unit arm", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let B = [0, 0, 0]\nlet P\nas B do\n  let P.bearing = 30\nend"))
    drive(scheduler)
    const B = host.children.get("B")
    const P = host.children.get("P")
    const b = frameWorldTransform(B)
    const p = frameWorldTransform(P).position
    assert.ok(scheduler.laws.active().some((l) => l.feature === "bearing"), "the law resolves, not refused")
    const got = bearingOf(b.position, headingOf(b.rotation), p)
    assert.ok(Math.abs(got - 30) < 1e-4, `bearing ${got}`)
    assert.ok(Math.abs(Math.hypot(p[0] - b.position[0], p[1] - b.position[1]) - DEFAULT_ARM) < 1e-6, "the paper-scale arm")
})
