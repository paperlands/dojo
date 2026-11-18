// Skew lines cannot name a perpendicular foot as their intersection. (id:laws-meet-axioms)
// Run: node --test test/js/laws/meet_line_line_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { EMPTY, UNCERTAIN, UNRESOLVED, line, meet } from "../../../assets/js/turtling/laws/meet.js"
import { ACCEPT_TOL } from "../../../assets/js/turtling/laws/relationships.js"

const at3 = (p) => p.map((n) => +(Math.abs(n) < 1e-12 ? 0 : n).toFixed(6))
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const unit = (v) => { const l = len(v); return [v[0] / l, v[1] / l, v[2] / l] }

// Distance from a point to a line, measured independently of the meet.
const distanceTo = (ln, p) => len(cross(sub(p, ln.point), unit(ln.dir)))

test("non-parallel lines with a positive separation meet in nothing", () => {
    // the witness the probe recorded: the x-axis and a line through (0,1,1) along +y
    const a = line([0, 0, 0], [1, 0, 0])
    const b = line([0, 1, 1], [0, 1, 0])
    assert.equal(meet(a, b), EMPTY, "skew pair: a then b")
    assert.equal(meet(b, a), EMPTY, "skew pair: b then a")

    // translated, and far from the origin: the budget is absolute, the answer is not
    assert.equal(meet(line([10, 0, 0], [1, 0, 0]), line([10, 1, 1], [0, 1, 0])), EMPTY)
    assert.equal(meet(line([1e6, 0, 0], [1, 0, 0]), line([1e6, 1, 1], [0, 1, 0])), EMPTY)

    // a real angle just above the conditioning threshold is still skew, not parallel
    const near = line([0, 1e-3, 1e-3], [1, 1e-8, 0])
    assert.equal(meet(line([0, 0, 0], [1, 0, 0]), near), EMPTY)
    assert.equal(meet(near, line([0, 0, 0], [1, 0, 0])), EMPTY)
})

test("coplanar non-parallel lines meet at one point, in either order", () => {
    const cases = [
        ["axes at the origin", line([0, 0, 0], [1, 0, 0]), line([0, 0, 0], [0, 1, 0]), [0, 0, 0]],
        ["translated crossing", line([10, 0, 0], [1, 0, 0]), line([5, 3, 0], [0, 1, 0]), [5, 0, 0]],
        ["tilted in 3D", line([0, 0, 0], [1, 1, 1]), line([0, 0, 0], [1, -1, 0]), [0, 0, 0]],
        ["large coordinates", line([1e6, 0, 0], [1, 0, 0]), line([1e6 + 3, 7, 0], [0, 1, 0]), [1e6 + 3, 0, 0]],
        // angle 1e-8 rad: above REL_TOL, so a real crossing, however ill-conditioned
        ["near-parallel crossing", line([0, 0, 0], [1, 0, 0]), line([0, 0, 0], [1, 1e-8, 0]), [0, 0, 0]],
    ]
    for (const [label, a, b, want] of cases) {
        const ab = meet(a, b), ba = meet(b, a)
        assert.equal(ab.kind, "point", label)
        assert.deepEqual(at3(ab.at), at3(want), label)
        assert.deepEqual(at3(ba.at), at3(want), `${label} (reversed order)`)
    }
})

test("the length budget is a band, and the band still admits a representative", () => {
    const a = line([0, 0, 0], [1, 0, 0])
    // separation 5e-7, inside ACCEPT_TOL: a point is named, and it lies on both lines
    const b = line([0, 5e-7, 5e-7], [0, 1, 0])
    const inside = meet(a, b)
    assert.equal(inside.kind, "point")
    assert.ok(distanceTo(a, inside.at) <= ACCEPT_TOL, "the answer lies on the first line")
    assert.ok(distanceTo(b, inside.at) <= ACCEPT_TOL, "the answer lies on the second line")

    // separation 2e-6, outside it: nothing is named
    assert.equal(meet(a, line([0, 2e-6, 2e-6], [0, 1, 0])), EMPTY)
})

test("parallel lines keep their prior behaviour", () => {
    const a = line([0, 0, 0], [1, 0, 0])
    // a coincident pair answers with the set it already had, not a new point
    const coincident = meet(a, line([5, 0, 0], [2, 0, 0]))
    assert.equal(coincident.kind, "line")
    assert.deepEqual(at3(coincident.dir), at3(a.dir))
    // an offset pair is empty
    assert.equal(meet(a, line([0, 1, 0], [1, 0, 0])), EMPTY)
})

test("soundness sweep: any named point lies on both lines", () => {
    const dirs = [[1, 0, 0], [0, 1, 0], [1, 1, 1], [1, 2, 3], [1, 1e-8, 0], [-1, 0, 2]]
    const offsets = [[0, 0, 0], [0, 1, 1], [3, -2, 5], [0, 5e-7, 5e-7], [1e6, 0, 0]]
    let named = 0
    for (const d1 of dirs) for (const d2 of dirs) for (const o of offsets) {
        const a = line([0, 0, 0], d1)
        const b = line(o, d2)
        for (const [first, second] of [[a, b], [b, a]]) {
            const got = meet(first, second)
            if (got.kind !== "point") continue
            named++
            assert.ok(distanceTo(first, got.at) <= ACCEPT_TOL,
                `${JSON.stringify(d1)} / ${JSON.stringify(d2)} at ${JSON.stringify(o)}: on first`)
            assert.ok(distanceTo(second, got.at) <= ACCEPT_TOL,
                `${JSON.stringify(d1)} / ${JSON.stringify(d2)} at ${JSON.stringify(o)}: on second`)
        }
    }
    assert.ok(named > 0, "the sweep must name some points, or it measures nothing")
})

test("invalid or unresolvable line arithmetic never names a non-finite point", () => {
    const cases = [
        [line([1e308, 0, 0], [1, 0, 0]), line([-1e308, 1, 0], [0, 1, 0])],
        [line([1e308, 0, 0], [1, 0, 0]), line([-1e308, 0, 0], [1, 0, 0])],
        [line([1e308, 1e308, 0], [1, 1, 0]), line([-1e308, -1e308, 0], [1, -1, 0])],
        [line([null, 0, 0], [1, 0, 0]), line([0, 1, 1], [0, 1, 0])],
        [line([0, 0, 0], [0, 0, 0]), line([0, 0, 0], [0, 1, 0])],
    ]
    for (const [a, b] of cases) {
        assert.equal(meet(a, b), UNRESOLVED)
        assert.equal(meet(b, a), UNRESOLVED)
    }
})

test("a real line angle below the conditioning threshold is uncertain, not parallel", () => {
    const a = line([0, 0, 0], [1, 0, 0])
    for (const p of [[0, 0, 0], [0, 1, 0], [0, 1, 1]]) {
        const b = line(p, [1, 1e-12, 0])
        assert.equal(meet(a, b), UNCERTAIN)
        assert.equal(meet(b, a), UNCERTAIN)
    }
})
