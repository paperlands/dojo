// One descriptor per authored relation: wiring is uniform, entries stay explicit.
// (id:relationships-row-contract)
// Run: node --test test/js/laws/authored_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { AUTHORED, parseProperty, parseSupport, payloadOf, addressShape } from "../../../assets/js/turtling/laws/authored.js"
import { RELATION, KIND } from "../../../assets/js/turtling/laws/expression.js"
import { addressOf, bindLaw } from "../../../assets/js/turtling/laws/replacement.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { marksOf, circleCurve, coneCurve, planePatch } from "../../../assets/js/turtling/laws/constraints.js"
import { conic } from "../../../assets/js/turtling/laws/meet.js"

const FIELDS = ["name", "kind", "guard", "address", "endpoints", "measure", "propose", "validate"]

test("each authored relation is one explicit row", () => {
    for (const [name, row] of Object.entries(AUTHORED)) {
        assert.equal(row.name, name)
        for (const field of FIELDS) {
            assert.ok(row[field] != null, `${name} has ${field}`)
        }
    }
})


test("RELATION and AUTHORED share the authored rows", () => {
    assert.equal(RELATION.distance, AUTHORED.distance)
    assert.equal(RELATION.tilt, AUTHORED.tilt)
    assert.equal(RELATION.distance.kind, KIND.length)
})

test("parse, address and payload read the same table", () => {
    assert.deepEqual(parseProperty("distance"), { feature: "distance" })
    assert.deepEqual(parseProperty("y"), { feature: "coordinate", axis: "y" })
    assert.deepEqual(parseProperty("tilt"), { feature: "tilt" })
    assert.equal(parseProperty("heading"), null)
    assert.match(parseSupport(), /tilt/)
    assert.equal(payloadOf("tilt"), "expr")
    assert.equal(payloadOf("position"), "coords")
    const d = bindLaw({ feature: "distance", endpoints: ["B", "A"], scope: "s", frame: "s", predicate: 5 })
    const r = bindLaw({ feature: "distance", endpoints: ["A", "B"], scope: "s", frame: "s", predicate: 9 })
    assert.equal(addressOf(d), addressOf(r), "distance address is an unordered pair")
    assert.ok(addressShape("tilt"))
})

test("the parser authors a tilt from the table, not a special branch", () => {
    const law = parseProgram("let P\nlet P.tilt = 30").find((n) => n.type === "Law")
    assert.equal(law.value, "tilt")
    assert.equal(law.meta.target, "P")
})

test("marksOf derives the cone window from the circle the locus names", () => {
    const cone = { kind: "cone", apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 30 }
    const at = [4, 2, 0]
    const marks = marksOf(cone, { at })
    const cc = coneCurve(cone, at)
    assert.equal(marks.curves.length, 1)
    assert.equal(marks.curves[0].length, cc.ring.length)
    assert.equal(marks.axes.length, 4)
    const circle = { kind: "circle", center: [0, 0, 0], radius: 5, normal: [0, 1, 0] }
    assert.deepEqual(marksOf(circle).curves[0], circleCurve(circle))
    const plane = { kind: "plane", point: [0, 0, 0], normal: [0, 1, 0] }
    const patch = planePatch(plane, [2, 0, 3])
    assert.deepEqual(marksOf(plane, { at: [2, 0, 3] }).curves[0], patch.corners)
})

// The locus is exact; the drawing is sampled. A conic can only be a trace, so
// marksOf discloses it as one — dashed, never in `curves` beside the exact curves.
// An exact continuation is earned only when play asks. (id:laws-freedom)
test("a conic marks as a trace, never as an exact curve", () => {
    const ellipse = conic("ellipse", [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1, 0, 0, -1])
    const marks = marksOf(ellipse)
    assert.equal(marks.curves.length, 0, "no exact curve is claimed")
    assert.ok(marks.traces.length >= 1 && marks.traces[0].length > 8, "a bounded trace is offered")
})
