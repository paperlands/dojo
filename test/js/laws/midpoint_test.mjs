// EXPERIMENT 2 — a midpoint touched from either side (pure analytic phase).
// (id:laws-experiment-2-midpoint)
//
// Run: node --test test/js/laws/midpoint_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import {
    componentHandFirst, requestOnly, validateMidpoint, midpointOf,
    midpointResidual, rawMidpointResidual, midpointAddress, createMidpointStore,
} from "./midpoint_ref.mjs"

const near = (got, want, eps = 1e-9) =>
    assert.ok(Math.abs(got - want) <= eps, `expected ${want}, got ${got}`)
const near3 = (got, want, eps = 1e-9) => {
    assert.equal(got.length, 3)
    for (let i = 0; i < 3; i++) near(got[i], want[i], eps)
}
const x = (v) => v[0]

const ONE = { a: [0, 0, 0], b: [10, 0, 0], m: [5, 0, 0] }

// ---------------------------------------------------------------------------
// One dimension — three identities, one relation.
// ---------------------------------------------------------------------------
test("P1 requesting the midpoint moves both endpoints by the same displacement", () => {
    const out = componentHandFirst(ONE, { who: "m", to: [8, 0, 0] })
    assert.equal(out.ok, true)
    assert.equal(out.met, true)
    near3(out.poses.a, [3, 0, 0])
    near3(out.poses.b, [13, 0, 0])
    near3(out.poses.m, [8, 0, 0])
    assert.equal(out.valid, true, "the independent validator accepts the candidate")
    assert.ok(validateMidpoint(out.poses).ok)
})

test("P2 requesting an endpoint redistributes along the relation", () => {
    const out = componentHandFirst(ONE, { who: "a", to: [2, 0, 0] })
    assert.equal(out.met, true)
    near3(out.poses.a, [2, 0, 0])          // the writer meets its target
    near3(out.poses.b, [9.6, 0, 0])        // −r/5
    near3(out.poses.m, [5.8, 0, 0])        // 2r/5
    assert.ok(validateMidpoint(out.poses).ok)
    // Requesting B by the same displacement mirrors it.
    const swapped = componentHandFirst(ONE, { who: "b", to: [12, 0, 0] })
    near3(swapped.poses.b, [12, 0, 0])
    near3(swapped.poses.a, [-0.4, 0, 0])
    near3(swapped.poses.m, [5.8, 0, 0])
})

test("P3 pin one endpoint: the free endpoint carries the doubled motion", () => {
    const out = componentHandFirst(ONE, { who: "m", to: [8, 0, 0] }, { pinned: ["a"] })
    assert.equal(out.met, true)
    near3(out.poses.a, [0, 0, 0], 1e-12)
    near3(out.poses.b, [16, 0, 0], 1e-12)
    near3(out.poses.m, [8, 0, 0])
    assert.ok(validateMidpoint(out.poses).ok)
})

test("P4 pin both endpoints: the midpoint request is blocked, not solved", () => {
    const out = componentHandFirst(ONE, { who: "m", to: [8, 0, 0] }, { pinned: ["a", "b"] })
    assert.equal(out.met, false)
    assert.equal(out.moved, false)
    assert.equal(out.blocked, true)
    near3(out.poses.m, [5, 0, 0])
})

test("P5 the current default blocks the same requests", () => {
    const viaMid = requestOnly(ONE, { who: "m", to: [8, 0, 0] })
    assert.equal(viaMid.met, false)
    assert.equal(viaMid.moved, false)
    assert.equal(viaMid.blocked, true)
    near3(viaMid.poses.m, [5, 0, 0], 1e-12)
    // Its locus for a requested endpoint is a single point too: the accepted
    // position. Only the two others being held leaves no room.
    const viaA = requestOnly(ONE, { who: "a", to: [2, 0, 0] })
    assert.equal(viaA.met, false)
    assert.equal(viaA.moved, false)
    near3(viaA.poses.a, [0, 0, 0], 1e-12)
})

test("P6 exchange A and B: nothing changes", () => {
    const straight = componentHandFirst(ONE, { who: "m", to: [8, 0, 0] })
    const exchanged = componentHandFirst({ a: [10, 0, 0], b: [0, 0, 0], m: [5, 0, 0] },
        { who: "m", to: [8, 0, 0] })
    near3(exchanged.poses.a, [13, 0, 0])
    near3(exchanged.poses.b, [3, 0, 0])
    near3(exchanged.poses.m, [8, 0, 0])
    assert.equal(x(straight.poses.m), x(exchanged.poses.m))
    assert.equal(midpointAddress({ a: "A", b: "B", m: "M" }),
        midpointAddress({ a: "B", b: "A", m: "M" }))
})

// ---------------------------------------------------------------------------
// Rotated 3D — the surviving mechanism is coordinate-free.
// ---------------------------------------------------------------------------
const rotate = (v, axis, angle) => {
    const [ux, uy, uz] = axis
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
    return [
        (t * ux * ux + c) * v[0] + (t * ux * uy - s * uz) * v[1] + (t * ux * uz + s * uy) * v[2],
        (t * ux * uy + s * uz) * v[0] + (t * uy * uy + c) * v[1] + (t * uy * uz - s * ux) * v[2],
        (t * ux * uz - s * uy) * v[0] + (t * uy * uz + s * ux) * v[1] + (t * uz * uz + c) * v[2],
    ]
}

test("P7 under a rigid rotation the same displacement is the answer", () => {
    const R = (v) => rotate(rotate(v, [0, 0, 1], 0.7), [1, 0, 0], -0.4)
    const world = { a: R([0, 0, 0]), b: R([10, 0, 0]), m: R([5, 0, 0]) }
    const d = [0.3, -1.2, 0.5]
    const out = componentHandFirst(world, { who: "m", to: [world.m[0] + d[0], world.m[1] + d[1], world.m[2] + d[2]] })
    assert.equal(out.met, true)
    near3(out.poses.a, [world.a[0] + d[0], world.a[1] + d[1], world.a[2] + d[2]], 1e-9)
    near3(out.poses.b, [world.b[0] + d[0], world.b[1] + d[1], world.b[2] + d[2]], 1e-9)
    near3(out.poses.m, [world.m[0] + d[0], world.m[1] + d[1], world.m[2] + d[2]], 1e-9)
    assert.ok(validateMidpoint(out.poses).ok)
})

// ---------------------------------------------------------------------------
// Why the relation is not a pair of distances: equal arms leave a bisector.
// ---------------------------------------------------------------------------
test("P8 equal distances alone give a bisector, not the midpoint", () => {
    const a = [0, 0, 0], b = [10, 0, 0]
    const equidistant = [[5, 0, 0], [5, 3, 0], [5, -7, 0], [5, 0, 12]]
    for (const p of equidistant) {
        const da = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2])
        const db = Math.hypot(p[0] - b[0], p[1] - b[1], p[2] - b[2])
        near(da, db, 1e-9)
    }
    // Only one of them is the midpoint; the affine relation pins it to one point
    // while AM = MB admits the whole perpendicular bisector.
    const mid = midpointOf(a, b)
    near3(mid, [5, 0, 0])
    assert.equal(equidistant.filter((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]) < 1e-12).length, 1)
})

// ---------------------------------------------------------------------------
// Tolerances in geometric units; the validator is independent of the producer.
// ---------------------------------------------------------------------------
test("P9 the validator rejects a poisoned candidate and the residual is a length", () => {
    // |2M − A − B| is TWICE the point error: a tolerance on the raw form is
    // twice as loose as one on the geometric point error.
    const cand = { a: [0, 0, 0], b: [10, 0, 0], m: [5.000002, 0, 0] }
    near(midpointResidual(cand.m, cand.a, cand.b), 0.000002, 1e-12)
    near(rawMidpointResidual(cand.m, cand.a, cand.b), 0.000004, 1e-12)
    assert.equal(validateMidpoint(cand, 1e-6).ok, false)
    assert.equal(validateMidpoint(cand, 1e-5).ok, true)
    // A wrong configuration is refused however it was produced.
    assert.equal(validateMidpoint({ a: [0, 0, 0], b: [10, 0, 0], m: [6, 0, 0] }).ok, false)
})

// ---------------------------------------------------------------------------
// Two instances, no shared ownership.
// ---------------------------------------------------------------------------
test("P10 two instances do not share internals; retracting one leaves the other", () => {
    const store = createMidpointStore()
    const first = { a: "A", b: "B", m: "M1", owner: "line 1" }
    const second = { a: "A", b: "B", m: "M2", owner: "line 2" }
    const k1 = store.apply(first)
    const k2 = store.apply(second)
    assert.notEqual(k1, k2, "the midpoint identity is part of the address")
    assert.equal(store.count(), 2)
    assert.equal(store.retract("line 1"), "retracted")
    assert.equal(store.count(), 1)
    assert.equal(store.lawAt(k2)?.owner, "line 2", "the sibling instance survives")
    assert.equal(store.lawAt(k1), null)
    // Pure realizations of the two instances do not touch one another.
    const world1 = { a: [0, 0, 0], b: [10, 0, 0], m: [5, 0, 0] }
    const world2 = { a: [0, 0, 0], b: [4, 0, 0], m: [2, 0, 0] }
    const moved1 = componentHandFirst(world1, { who: "m", to: [8, 0, 0] })
    assert.equal(x(moved1.poses.m), 8)
    assert.deepEqual(world2, { a: [0, 0, 0], b: [4, 0, 0], m: [2, 0, 0] },
        "the sibling instance's configuration is untouched")
})
