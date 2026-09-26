// EXPERIMENT 1 — one truth, two representations.
// (id:laws-experiment-1-representation)
//
// Question: does a harmless change of representation alter validity, freedom or
// motion? The representations below are EXPERIMENT-LOCAL fixtures, not runtime.
// The only runtime reads are the guards/tolerance semantics already shipped
// (`expression.js::guardsOf`, `constraints.js::stateOf`, `replacement.js::addressOf`).
//
// Run: node --test test/js/laws/lowering_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { stateOf } from "../../../assets/js/turtling/laws/constraints.js"
import { guardsOf, predicateOk } from "../../../assets/js/turtling/laws/expression.js"
import { addressOf, bindLaw, createLawStore } from "../../../assets/js/turtling/laws/replacement.js"

// ---------------------------------------------------------------------------
// The two representations of one truth: two points, one distance.
// ---------------------------------------------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)

// Representation A — the ordinary distance. The residual is a LENGTH.
const ordinary = {
    residual: (a, b, r) => len(sub(b, a)) - r,
    accepts: (a, b, r, tol) =>
        finite3(a) && finite3(b) && Number.isFinite(r) && r >= 0 &&
        Math.abs(ordinary.residual(a, b, r)) <= tol,
}

// Representation B — the squared-distance lowering. The raw residual is a LENGTH².
// `|d² − r²|` scales with the world's size, so one absolute threshold means a
// different geometric tolerance at every scale. Dividing by the same-dimension
// scale `d + r` recovers `|d − r|` exactly for r ≥ 0.
const squared = {
    rawResidual: (a, b, r) => dot(sub(b, a), sub(b, a)) - r * r,
    geometricResidual: (a, b, r) => {
        const d = len(sub(b, a))
        const scale = d + r
        return scale > 0 ? Math.abs(d * d - r * r) / scale : 0
    },
    accepts: (a, b, r, tol) =>
        finite3(a) && finite3(b) && Number.isFinite(r) && r >= 0 &&
        squared.geometricResidual(a, b, r) <= tol,
}

const AXIS = (x) => [x, 0, 0]
const ORIGIN = [0, 0, 0]

// ---------------------------------------------------------------------------
// W1 — positive radius: both descriptions accept the same configurations.
// ---------------------------------------------------------------------------
test("W1 a positive radius: both descriptions accept the same configurations", () => {
    const tol = 1e-6
    const configurations = [
        [5, 0, 0], [4, 3, 0], [-5, 0, 0], [0, 5, 0], [3, 4, 0],
    ]
    for (const p of configurations) {
        const a = ordinary.accepts(ORIGIN, p, 5, tol)
        const b = squared.accepts(ORIGIN, p, 5, tol)
        assert.equal(a, b, `disagreement at ${JSON.stringify(p)}: ordinary=${a} squared=${b}`)
    }
    assert.ok(ordinary.accepts(ORIGIN, AXIS(5), 5, tol))
    assert.ok(squared.accepts(ORIGIN, AXIS(5), 5, tol))
    assert.ok(!ordinary.accepts(ORIGIN, AXIS(6), 5, tol))
    assert.ok(!squared.accepts(ORIGIN, AXIS(6), 5, tol))
})

// ---------------------------------------------------------------------------
// W2 — zero radius: relative freedom is zero; common translation remains.
// ---------------------------------------------------------------------------
test("W2 zero radius: the relative freedom is zero and the common translation survives", () => {
    const tol = 1e-6
    // Both descriptions force coincidence, and neither holds the pair down.
    for (const t of [[0, 0, 0], [7, -2, 3]]) {
        const a = t
        const b = t
        assert.ok(ordinary.accepts(a, b, 0, tol))
        assert.ok(squared.accepts(a, b, 0, tol))
    }
    // The pair translates together: translating both keeps the truth.
    const a = [2, 1, 0]
    const b = [2, 1, 0]
    const t = [10, -4, 1]
    assert.ok(ordinary.accepts([a[0] + t[0], a[1] + t[1], a[2] + t[2]],
        [b[0] + t[0], b[1] + t[1], b[2] + t[2]], 0, tol))
    // The shipped state query reads the same truth: coincident, not pinned, dof 3.
    const state = stateOf({
        at: a,
        constraints: [{ feature: "distance", other: b, radius: 0, otherHeld: false }],
    })
    assert.equal(state.truth.pinned, false, "two movable coincident points are not a pin")
    assert.equal(state.truth.coincident, true)
    assert.equal(state.interaction.dof, 3, "coincidence removes the 3 relative dof, not the 3 translation dof")
    assert.equal(state.interaction.movable, "coupled")
    assert.deepEqual(state.interaction.partners, [b])
    // Held reference: the same zero radius becomes a pin (dof 0), no translation.
    const pinned = stateOf({
        at: a,
        constraints: [{ feature: "distance", other: b, radius: 0, otherHeld: true }],
    })
    assert.equal(pinned.truth.pinned, true)
    assert.equal(pinned.interaction.dof, 0)
})

test("W2b the radius guard is semantic: squaring alone admits a negative length", () => {
    // The poisoned lowering: rawResidual is zero at r = -5 exactly as at r = +5.
    assert.equal(squared.rawResidual(ORIGIN, AXIS(5), -5), 0)
    assert.equal(squared.rawResidual(ORIGIN, AXIS(5), 5), 0)
    // The guarded representations refuse r = -5; the shipped guard is the same rule.
    assert.equal(ordinary.accepts(ORIGIN, AXIS(5), -5, 1e-6), false)
    assert.equal(squared.accepts(ORIGIN, AXIS(5), -5, 1e-6), false)
    assert.deepEqual(guardsOf("distance"), { finite: true, nonNegative: true })
    assert.equal(predicateOk("distance", -5), false)
})

// ---------------------------------------------------------------------------
// W3 — endpoint reversal and consistent renaming change nothing.
// ---------------------------------------------------------------------------
test("W3 endpoint reversal and consistent renaming change nothing", () => {
    const tol = 1e-6
    const a = [1, 2, 3]
    const b = [4, 6, 3]
    assert.equal(ordinary.residual(a, b, 5), ordinary.residual(b, a, 5))
    assert.equal(squared.geometricResidual(a, b, 5), squared.geometricResidual(b, a, 5))
    // A relabelling of the same two identities reaches the same address.
    const p = bindLaw({ feature: "distance", endpoints: [1, 2], scope: 1, frame: 1, predicate: 5 })
    const q = bindLaw({ feature: "distance", endpoints: [2, 1], scope: 1, frame: 1, predicate: 5 })
    assert.equal(addressOf(p), addressOf(q))
    // And the accepted set is symmetric.
    for (const t of [[0, 5, 0], [3, 4, 0], [9, 0, 0]]) {
        assert.equal(ordinary.accepts(ORIGIN, t, 5, tol), ordinary.accepts(t, ORIGIN, 5, tol))
        assert.equal(squared.accepts(ORIGIN, t, 5, tol), squared.accepts(t, ORIGIN, 5, tol))
    }
})

// ---------------------------------------------------------------------------
// W4 — duplicate predicates add no preference weight.
// ---------------------------------------------------------------------------
test("W4 duplicate predicates add no preference weight", () => {
    // The store already treats a repeated statement as one law at one address.
    const store = createLawStore()
    const lawAB = bindLaw({ feature: "distance", endpoints: ["A", "B"], scope: "A", frame: "A", predicate: 5 })
    store.apply(lawAB)
    store.apply(lawAB)
    assert.equal(store.count(), 1, "a repeated statement is one truth, not two weights")
    // A naive per-statement weighted lowering WOULD change the minimizer.
    // Two points: A=0 held, C=10 held; B free. Laws AB=5, BC=5.
    const objective = (x, dup) => (x - 5) ** 2 * (dup ? 2 : 1) + (x - 10) ** 2
    const argmin = (f) => {
        let best = null, bestV = Infinity
        for (let i = 0; i <= 2000; i++) {
            const x = -0 + (i / 2000) * 20
            const v = f(x)
            if (v < bestV) { bestV = v; best = x }
        }
        return best
    }
    const one = argmin((x) => objective(x, false))
    const two = argmin((x) => objective(x, true))
    assert.ok(Math.abs(one - 7.5) < 0.02, `one statement minimises at 7.5, got ${one}`)
    assert.ok(Math.abs(two - 20 / 3) < 0.02, `a duplicated weight biases to 20/3, got ${two}`)
    assert.ok(Math.abs(one - two) > 0.5, "the duplicate moved the minimiser: the hazard is real")
})

// ---------------------------------------------------------------------------
// W5 — tolerances are geometric, not one threshold reused across scaled residuals.
// ---------------------------------------------------------------------------
test("W5 one absolute threshold on the squared residual is a different tolerance at every scale", () => {
    const tol = 1e-6
    // Small world: the ordinary check rejects, the raw squared check accepts.
    const small = { r: 1e-3, d: 1e-3 + 1e-4 }
    assert.equal(ordinary.accepts(ORIGIN, AXIS(small.d), small.r, tol), false)
    assert.equal(squared.rawResidual(ORIGIN, AXIS(small.d), small.r) <= tol, true,
        "the squared residual under-rejects at small scale")
    // Large world: the ordinary check accepts, the raw squared check rejects.
    const large = { r: 1e3, d: 1e3 + 1e-9 }
    assert.equal(ordinary.accepts(ORIGIN, AXIS(large.d), large.r, tol), true)
    assert.equal(squared.rawResidual(ORIGIN, AXIS(large.d), large.r) <= tol, false,
        "the squared residual over-rejects at large scale")
    // The geometric-normalised squared residual is exactly |d − r|, so it agrees.
    for (const { r, d } of [{ r: 1e-3, d: 1.0001e-3, }, { r: 1, d: 1.000000001 }, { r: 1e3, d: 1e3 + 1e-9 }]) {
        assert.ok(Math.abs(squared.geometricResidual(ORIGIN, AXIS(d), r) - Math.abs(d - r)) < 1e-9)
        assert.equal(squared.accepts(ORIGIN, AXIS(d), r, tol),
            ordinary.accepts(ORIGIN, AXIS(d), r, tol))
    }
})

// ---------------------------------------------------------------------------
// W6 — the absolute-value / sign helper counterexample.
// Compiler auxiliaries must not invent a physical continuity requirement.
// ---------------------------------------------------------------------------
test("W6 an absolute-value auxiliary is existential, with no continuity obligation", () => {
    const c = 5
    // The source truth: abs(x) = c admits both branches.
    const source = (x) => Math.abs(x) === c
    assert.ok(source(c) && source(-c))
    // The relational lowering: y is a fresh auxiliary. y*y = x*x, y >= 0, y = c.
    const lowered = (x, y) => y >= 0 && y * y === x * x && y === c
    assert.ok(lowered(c, c), "the +c branch satisfies the lowering")
    assert.ok(lowered(-c, c), "the -c branch satisfies the lowering")
    // The feasible set is two isolated points: no continuous path connects them
    // while staying feasible (the only continuous path in x crosses x = 0,
    // where abs(x) = 0 != c).
    const feasibleX = []
    for (let i = -400; i <= 400; i++) {
        const x = (i / 40) * (c / 10)   // -c..c in steps of c/400
        if (Math.abs(Math.abs(x) - c) < 1e-9) feasibleX.push(x)
    }
    assert.equal(feasibleX.length, 2, "exactly two isolated feasible values")
    const gate = (x0, x1) => {
        // A continuity gate on the auxiliary: sample the straight path in x.
        const n = 64
        for (let i = 0; i <= n; i++) if (!source(x0 + (x1 - x0) * (i / n))) return false
        return true
    }
    assert.equal(gate(c, -c), false, "a continuity gate refuses the branch switch the source permits")
    // The ruling this fixture records: continuity belongs to motion of physical
    // points, not to a mathematical auxiliary.
})

test("W6b a sign auxiliary is discrete: it must never be asked to interpolate", () => {
    // arm = |area| = 10 with an orientation helper s in {-1, +1}.
    const area = (s) => s * 10
    const admissible = (s) => Math.abs(area(s)) === 10
    assert.ok(admissible(1) && admissible(-1))
    // The two handednesses are both feasible; the helper's domain has two values.
    const helperDomain = [-1, 1]
    assert.equal(helperDomain.length, 2)
    const interpolate = (s0, s1, t) => s0 + (s1 - s0) * t
    // Any interpolation strictly between the two is outside the helper's domain.
    for (const t of [0.25, 0.5, 0.75]) {
        assert.ok(!helperDomain.includes(interpolate(1, -1, t)),
            "a sign helper is not a coordinate to be swept through")
    }
})
