// The point's state and the ghost locus, pure. (id:laws-decl-point-agent,
// id:laws-freedom)
// Run: node --test test/js/laws/constraints_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { stateOf, project, silhouette, axesOf, sphereCurves, slider, marksOf } from "../../../assets/js/turtling/laws/constraints.js"

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


test("with an eye, the silhouette is the tangent rim, not the equator", () => {
    const ring = silhouette({ kind: "sphere", center: [0, 0, 0], radius: 1 }, [0, 0, -1], 8, [0, 0, 5])
    const z = ring[0][2]
    const rho = Math.hypot(ring[0][0], ring[0][1])
    assert.ok(z > 0 && z < 1, "the rim sits in front of the centre")
    assert.ok(rho < 1, "and is smaller than the equator")
    for (const p of ring) {
        assert.ok(near(p[2], z), "one plane")
        assert.ok(near(Math.hypot(p[0], p[1]), rho), "one radius")
    }
})

test("a rim is a contour: drawn off the shell's axis, dropped on it", () => {
    const sphere = { kind: "sphere", center: [0, 0, 0], radius: 5 }
    const at = [5, 0, 0]
    const down = marksOf(sphere, { at, viewDir: [0, 0, -1], eye: [0, 0, 150] })
    assert.deepEqual(down.rings, [],
        "down the pole a second circumference would only overstate the radius")
    const tilted = marksOf(sphere, { at, viewDir: [-0.5, -0.4, -0.8], eye: [50, 40, 80] })
    assert.equal(tilted.rings.length, 1, "off the pole the rim is the ball's outline")
    assert.equal(marksOf(sphere, { at, viewDir: [0, 0, -1] }).rings.length, 1,
        "without an eye the rim is exact, so the gate does not apply")
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

// Coincidence is a shared truth, not a pin, unless the other point is held. The
// query holds the other participants, so the pair's common translation is not
// this point's independent freedom — the request method conserves the partner.
// (id:laws-freedom, id:laws-experiment-7-ruling)
test("coincidence names the coupling without offering the pair's translation", () => {
    const s = stateOf({ at: [0, 0, 0], constraints: [{ feature: "distance", other: [0, 0, 0], radius: 0 }] })
    assert.equal(s.truth.pinned, false, "a movable other does not pin")
    assert.equal(s.truth.coincident, true, "the coupling is named")
    assert.equal(s.dof, 0, "with the partner held there is no independent freedom")
    assert.deepEqual(s.locus, { kind: "point", at: [0, 0, 0] }, "the zero distance names the existing point")
    assert.equal(s.interaction.movable, "none", "no freedom the door cannot honor is offered")
    assert.deepEqual(s.interaction.partners, [[0, 0, 0]], "the coupling is still disclosed")
    assert.equal(s.interaction.offered, true, "the point is still touchable; the refusal is the answer")
    assert.equal(s.tag, "free")
})

// Zero freedom still answers geometry: the coincidence is a point set, so the
// locus and the projection come from the same meet as the freedom. (id:laws-freedom)
test("a zero distance composes: locus and projection read the one set", () => {
    const s = stateOf({ at: [0, 0, 0], constraints: [
        { feature: "distance", other: [0, 0, 0], radius: 0, otherHeld: false },
        { feature: "distance", other: [5, 0, 0], radius: 5, otherHeld: true },
    ] })
    assert.equal(s.dof, 0)
    assert.equal(s.interaction.movable, "none")
    assert.deepEqual(s.locus, { kind: "point", at: [0, 0, 0] }, "the existing point is on the sphere")
    assert.deepEqual(project(s, [5, 5, 0]), [0, 0, 0], "projection reads the same set, not the sphere alone")
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

test("a distance marks as a radius spoke from the point to its centre", () => {
    const sphere = { kind: "sphere", center: [0, 0, 0], radius: 5 }
    const marks = marksOf(sphere, { at: [5, 0, 0] })
    assert.equal(marks.curves.length, 2, "latitude and meridian")
    assert.deepEqual(marks.spokes, [[[0, 0, 0], [5, 0, 0]]], "the radius, not the normal")
    assert.deepEqual(marksOf({ kind: "circle", center: [0, 0, 0], radius: 3, normal: [0, 0, 1] },
        { at: [3, 0, 0] }).spokes, [[[0, 0, 0], [3, 0, 0]]])
})
