// The point's state and the ghost locus, pure. (id:laws-decl-point-agent,
// id:laws-freedom)
// Run: node --test test/js/laws/constraints_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { stateOf, project, silhouette, axesOf, sphereCurves, slider } from "../../../assets/js/turtling/laws/constraints.js"

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const dist = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]))
const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0)

test("free: three degrees, no locus", () => {
    const s = stateOf({ at: [1, 2, 3] })
    assert.equal(s.tag, "free")
    assert.equal(s.dof, 3)
    assert.equal(s.locus, null)
    assert.deepEqual(s.normals, [])
})

test("headed: observational, no locus", () => {
    const s = stateOf({ at: [1, 2, 3], headed: true })
    assert.equal(s.tag, "headed")
    assert.equal(s.dof, 0)
    assert.equal(s.locus, null)
})

test("pinned: no freedom, a point locus", () => {
    const s = stateOf({ at: [1, 2, 3], constraints: [{ pinned: true }] })
    assert.equal(s.tag, "pinned")
    assert.equal(s.dof, 0)
    assert.equal(s.locus.kind, "point")
})

test("unresolved: no accepted position", () => {
    assert.equal(stateOf({ at: null }).tag, "unresolved")
    assert.equal(stateOf({ at: [NaN, 0, 0] }).tag, "unresolved")
})

test("tag: not a place, not exposed, or faulted reads unresolved", () => {
    assert.equal(stateOf({ at: [0, 0, 0], exposed: false }).tag, "unresolved")
    assert.equal(stateOf({ at: [0, 0, 0], isPlace: false }).tag, "unresolved")
    assert.equal(stateOf({ at: [0, 0, 0], error: { kind: "walk" } }).tag, "unresolved")
    assert.equal(stateOf({ at: [0, 0, 0], unresolved: { reason: "x" } }).tag, "unresolved")
})

test("one distance: a sphere, one normal, two degrees", () => {
    const s = stateOf({ at: [5, 0, 0], constraints: [{ feature: "distance", other: [0, 0, 0], radius: 5 }] })
    assert.equal(s.tag, "free")
    assert.equal(s.dof, 2)
    assert.deepEqual(s.normals, [[1, 0, 0]])
    assert.deepEqual(s.locus, { kind: "sphere", center: [0, 0, 0], radius: 5 })
})

test("coincident points take a stated direction, disclosed as policy", () => {
    const s = stateOf({ at: [0, 0, 0], constraints: [{ feature: "distance", other: [0, 0, 0], radius: 5 }] })
    assert.deepEqual(s.normals, [[1, 0, 0]])
})

test("project: a desired point lands on the sphere, radially", () => {
    const s = stateOf({ at: [5, 0, 0], constraints: [{ feature: "distance", other: [0, 0, 0], radius: 5 }] })
    assert.deepEqual(project(s, [10, 0, 0]), [5, 0, 0])
    const p = project(s, [3, 4, 0])
    assert.ok(near(dist(p, [0, 0, 0]), 5), "on the sphere")
    assert.deepEqual(p.map((n) => +n.toFixed(6)), [3, 4, 0], "along the requested ray")
})

test("project: at the pole it keeps the stated direction", () => {
    const s = stateOf({ at: [5, 0, 0], constraints: [{ feature: "distance", other: [0, 0, 0], radius: 5 }] })
    assert.deepEqual(project(s, [0, 0, 0]), [5, 0, 0])
})

test("project: nothing constrains it — the target passes through", () => {
    assert.deepEqual(project(stateOf({ at: [0, 0, 0] }), [7, 8, 9]), [7, 8, 9])
})

test("silhouette: a circle about the centre in the plane ⟂ the sight", () => {
    const ring = silhouette({ kind: "sphere", center: [1, 2, 3], radius: 4 }, [0, 0, -1], 8)
    assert.equal(ring.length, 9)
    for (const p of ring) {
        assert.ok(near(p[2], 3), "the sight plane")
        assert.ok(near(dist(p, [1, 2, 3]), 4), "radius holds")
    }
})

test("axes: the normal rests, the tangent moves, and no camera enters", () => {
    const s = stateOf({ at: [5, 0, 0], constraints: [{ feature: "distance", other: [0, 0, 0], radius: 5 }] })
    const ax = axesOf(s)
    assert.deepEqual(ax.normal, [1, 0, 0], "the constraint normal is the resting axis")
    assert.ok(near(dot(ax.normal, ax.tangent[0]), 0))
    assert.ok(near(dot(ax.normal, ax.tangent[1]), 0))
    assert.ok(near(dot(ax.tangent[0], ax.tangent[1]), 0), "tangents are orthogonal")
    assert.ok(near(Math.hypot(...ax.tangent[0]), 1), "unit")
    assert.equal(axesOf(stateOf({ at: [0, 0, 0] })), null, "a free point has no axis")
})

test("curves: parallel shares A's latitude; the meridian passes through A", () => {
    const locus = { kind: "sphere", center: [0, 0, 0], radius: 10 }
    const a = [10 / Math.SQRT2, 0, 10 / Math.SQRT2]
    const c = sphereCurves(locus, a, 8)
    for (const p of c.parallel) assert.ok(near(dist(p, [0, 0, 0]), 10), "on the sphere")
    for (const p of c.parallel) assert.ok(near(p[2], a[2]), "same latitude")
    assert.ok(c.meridian.some((p) => dist(p, a) < 1e-9), "the meridian passes through A")
})

test("zero radius: the held endpoint fixes one point, not two degrees", () => {
    const s = stateOf({ at: [0, 0, 0], constraints: [{ feature: "distance", other: [3, 0, 0], radius: 0, otherHeld: true }] })
    assert.equal(s.tag, "pinned")
    assert.equal(s.dof, 0)
    assert.deepEqual(s.locus, { kind: "point", at: [3, 0, 0] })
    assert.equal(s.truth.pinned, true)
    assert.equal(s.interaction.offered, false)
})

// Coincidence is a shared translation, not a pin, unless the other point is
// held. Two movable coincident points keep their common freedom. (id:laws-freedom)
test("coincidence: a movable other leaves the pair's common translation", () => {
    const s = stateOf({ at: [0, 0, 0], constraints: [{ feature: "distance", other: [0, 0, 0], radius: 0 }] })
    assert.equal(s.truth.pinned, false, "a movable other does not pin")
    assert.equal(s.truth.coincident, true)
    assert.equal(s.dof, 3, "the pair translates as one")
    assert.equal(s.locus, null, "no sphere and no point is named")
    assert.equal(s.interaction.movable, "coupled")
    assert.deepEqual(s.interaction.partners, [[0, 0, 0]])
    assert.equal(s.interaction.offered, true, "the point is still offered")
    assert.equal(s.tag, "free")
})

// One query returns role, truth, status and interaction as separate facts; the
// tag is only the view's derived label. (id:laws-decl-point-agent)
test("separation: role, truth, status and interaction are distinct", () => {
    const headed = stateOf({ at: [1, 2, 3], headed: true, constraints: [{ pinned: true }] })
    assert.equal(headed.role, "headed")
    assert.equal(headed.truth.pinned, true)
    assert.equal(headed.status, "accepted")
    assert.equal(headed.interaction.offered, false, "a headed identity is not a hand's target")
    const previous = stateOf({ at: [1, 2, 3], unresolved: { reason: "hold" } })
    assert.equal(previous.role, "point")
    assert.equal(previous.status, "previous", "the geometry is known but not offered")
    assert.equal(previous.interaction.offered, false)
    assert.equal(previous.tag, "unresolved")
})

// A pin is known even when the position is not, but geometry is never invented
// from an absent position. (id:laws-decl-point-agent)
test("unresolved: a known pin names no locus without an accepted position", () => {
    const s = stateOf({ at: null, constraints: [{ pinned: true }] })
    assert.equal(s.status, "unresolved")
    assert.equal(s.truth.pinned, true, "the pin is still known")
    assert.equal(s.locus, null, "no point is named from nothing")
    assert.equal(s.at, null)
})

test("headed and pinned are separate facts, not one exclusive tag", () => {
    const s = stateOf({ at: [0, 0, 0], headed: true, constraints: [{ pinned: true }] })
    assert.equal(s.tag, "headed", "the role the view draws" )
    assert.equal(s.headed, true)
    assert.equal(s.pinned, true, "the pin is still known")
})

test("project at the centre uses the same +x policy as realization", () => {
    const s = stateOf({ at: [0, 0, 0], constraints: [{ feature: "distance", other: [0, 0, 0], radius: 5 }] })
    assert.deepEqual(project(s, [0, 0, 0]), [5, 0, 0])
})

test("slider: a bounded scalar and the exact locus it names, from one query", () => {
    const zero = slider({ at: [5, 0, 0], other: [0, 0, 0], value: -3 })
    assert.equal(zero.value, 0, "a negative slider input is clamped to the bound")
    assert.deepEqual(zero.locus, { kind: "point", at: [0, 0, 0] })
    const seven = slider({ at: [5, 0, 0], other: [0, 0, 0], value: 7, min: 0, max: 10 })
    assert.equal(seven.value, 7)
    assert.deepEqual(seven.locus, { kind: "sphere", center: [0, 0, 0], radius: 7 })
    assert.equal(slider({ at: [5, 0, 0], other: [0, 0, 0], value: 99, max: 10 }).value, 10,
        "an over-range input is clamped to the declared bound")
})
