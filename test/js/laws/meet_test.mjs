// The set algebra: named sets, their meet, and the honest non-answers.
// (id:laws-freedom, id:relationships-todo-coordinate-authoring)
//
// Run: node --test test/js/laws/meet_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
    SPACE, EMPTY, UNCERTAIN, UNRESOLVED,
    point, points, line, circle, plane, sphere, cone, halfplane, ray, conic, conicSamples,
    meet, meetAll, dofOf, nearest,
} from "../../../assets/js/turtling/laws/meet.js"
import { validateDistance } from "../../../assets/js/turtling/laws/realize.js"

const at3 = (p) => p.map((n) => +n.toFixed(6))
const Y0 = plane([0, 0, 0], [0, 1, 0])
const Z5 = plane([0, 0, 5], [0, 0, 1])
const R5 = sphere([0, 2, 0], 5)

test("the named meets of the algebra", () => {
    const xyLine = meet(Y0, Z5)
    assert.equal(xyLine.kind, "line")
    assert.deepEqual(at3(xyLine.dir), [1, 0, 0])

    const circleSet = meet(Y0, R5)
    assert.equal(circleSet.kind, "circle")
    assert.equal(+circleSet.radius.toFixed(6), +Math.sqrt(21).toFixed(6))

    const twoSpheres = meet(sphere([0, 0, 0], 5), sphere([4, 0, 0], 5))
    assert.equal(twoSpheres.kind, "circle")
    assert.deepEqual(at3(twoSpheres.center), [2, 0, 0])

    // a line through a sphere: two points, both branches named
    const hits = meet(xyLine, sphere([10, 0, 5], 5))
    assert.equal(hits.kind, "points")
    assert.deepEqual(hits.at.map(at3).sort((a, b) => a[0] - b[0]), [[5, 0, 5], [15, 0, 5]])

    assert.equal(meet(plane([0, 100, 0], [0, 1, 0]), sphere([0, 0, 0], 5)).kind, "empty")
    assert.equal(meet(SPACE, circle([0, 0, 0], [0, 1, 0], 5)).kind, "circle")
    assert.equal(meet(EMPTY, R5).kind, "empty")
})

test("a meet with no named case is unresolved, never a guess", () => {
    assert.equal(meet(points([[0, 0, 0], [1, 0, 0]]), sphere([0, 0, 5], 1)).kind, "unresolved")
    assert.equal(meet(points([[0, 0, 0]]), Y0).kind, "unresolved")
    assert.equal(meet(UNCERTAIN, R5).kind, "uncertain")
    assert.equal(meetAll([Y0, UNRESOLVED, R5]).kind, "unresolved", "short-circuits")
})

test("the fold names the conjunction and its freedom", () => {
    const lineSet = meetAll([Y0, Z5])
    assert.equal(dofOf(lineSet), 1)
    const circleSet = meetAll([Y0, R5])
    assert.equal(dofOf(circleSet), 1)
    const pointSet = meetAll([Y0, Z5, plane([3, 0, 0], [1, 0, 0])])
    assert.equal(pointSet.kind, "point")
    assert.equal(dofOf(pointSet), 0)
    assert.equal(dofOf(SPACE), 3)
    assert.equal(dofOf(EMPTY), 0)
})

test("nearest follows the set, and a finite set keeps its branch", () => {
    const lineSet = meet(Y0, Z5)
    assert.deepEqual(at3(nearest(lineSet, [7, 1, 1]).at), [7, 0, 5])

    const hits = meet(lineSet, sphere([10, 0, 5], 5))   // [5,0,5] and [15,0,5]
    // A wish nearer a branch takes it...
    assert.deepEqual(at3(nearest(hits, [14, 0, 5]).at), [15, 0, 5])
    // ...even when the current branch is the other: a deliberate move crosses.
    assert.deepEqual(at3(nearest(hits, [14, 0, 5], { keep: [5, 0, 5] }).at), [15, 0, 5])
    // An ambiguous wish (the branch midpoint) keeps the current branch.
    const kept = nearest(hits, [10, 0, 5], { keep: [5, 0, 5] })
    assert.deepEqual(at3(kept.at), [5, 0, 5])
    assert.equal(kept.branch, "kept")

    assert.equal(nearest(EMPTY, [0, 0, 0]).kind, "contradiction")
    assert.equal(nearest(UNCERTAIN, [0, 0, 0]).kind, "unresolved")
})

test("a projection cannot borrow the coincident fallback when the question is invalid", () => {
    // Toward [1.7e308 x 3] the sphere projection used to report success along +x —
    // a failed normalization reported as coincidence. And an unaskable pair shares
    // no answer with a coincident one. (P2)
    const diag = nearest(sphere([0, 0, 0], 1), [1.7e308, 1.7e308, 1.7e308])
    assert.ok(diag.ok)
    for (const i of [0, 1, 2]) {
        assert.ok(Math.abs(diag.at[i] - 1 / Math.sqrt(3)) < 1e-15, `component ${i} of ${at3(diag.at)}`)
    }
    assert.deepEqual(nearest(sphere([NaN, 0, 0], 1), [1, 2, 3]), { ok: false, kind: "unresolved" },
        "an invalid center is not a coincidence")
    assert.equal(meet(sphere([NaN, 0, 0], 1), sphere([0, 0, 0], 1)).kind, "unresolved",
        "and no meet is named from one")
    assert.equal(meet(circle([NaN, 0, 0], [0, 1, 0], 5), circle([5, 0, 0], [0, 1, 0], 5)).kind, "unresolved",
        "the circle foot may not borrow +x either")
})

test("a coerced operand is not a valid one: meet answers unresolved, never a malformed locus", () => {
    // null coerces to 0 in subtraction, so a finite difference proves nothing about
    // the operands. Valid centers precede every geometric early return.
    assert.equal(meet(sphere([null, 0, 0], 1), sphere([1, 0, 0], 1)).kind, "unresolved",
        "a finite difference does not establish valid centers")
    assert.equal(meet(sphere([null, 0, 0], 1), sphere([0, 0, 0], 1)).kind, "unresolved",
        "the coincidence branch may not answer with a malformed locus")
    assert.equal(meet(circle([null, 0, 0], [0, 1, 0], 5), circle([0, 0, 0], [0, 1, 0], 5)).kind, "unresolved",
        "and neither may the circle's")
    assert.equal(meet(sphere(["1", 0, 0], 1), sphere([0, 0, 0], 1)).kind, "unresolved",
        "a coercible string is no more a coordinate")
})

test("nearest on a wide cone stays on the nappe nearest the target", () => {
    // A double nappe: 100° and 80° are one surface, so a +side target must not
    // flip to the far nappe as the tilt passes 90°. (id:laws-freedom)
    const wide = cone([0, 0, 0], [1, 0, 0], 100)
    const plus = nearest(wide, [80, 0, 20]).at
    const minus = nearest(wide, [-80, 0, 20]).at
    assert.ok(plus[0] > 0, `a +side target lands on the +nappe, got ${at3(plus)}`)
    assert.ok(minus[0] < 0, `a -side target lands on the -nappe, got ${at3(minus)}`)
})

test("a held cone point passes through the apex, never teleporting", () => {
    const c = cone([0, 0, 0], [1, 0, 0], 30)
    const held = nearest(c, [43.3, 0, 25]).at          // the point, on the +nappe
    const at = (x) => nearest(c, [x, 0, 25], { keep: held }).at
    assert.ok(at(43)[0] > 0 && at(43)[2] > 0, "it starts on the +nappe")
    assert.ok(Math.hypot(...at(0)) < 1e-9, `at the crossing it is the apex, got ${at3(at(0))}`)
    assert.ok(at(-43)[0] < 0 && at(-43)[2] > 0, "and it comes out on the −nappe")
})

test("a line and a circle meet in 0, 1 or 2 points; so do circle cuts", () => {
    const ci = circle([0, 0, 0], [0, 1, 0], 5)
    const through = meet(line([0, 0, 0], [1, 0, 0]), ci)
    assert.equal(through.kind, "points")
    assert.deepEqual(through.at.map(at3).sort((a, b) => a[0] - b[0]), [[-5, 0, 0], [5, 0, 0]])
    assert.equal(meet(line([0, 0, 5], [1, 0, 0]), ci).kind, "point", "tangent")
    assert.equal(meet(line([0, 0, 9], [1, 0, 0]), ci).kind, "empty")

    assert.equal(meet(ci, plane([0, 0, 0], [1, 0, 0])).kind, "points")
    assert.equal(meet(ci, plane([0, 0, 0], [0, 1, 0])).kind, "circle", "its own plane")
    assert.equal(meet(ci, plane([9, 0, 0], [1, 0, 0])).kind, "empty")

    const s = meet(ci, sphere([5, -3, 0], 5))
    assert.equal(s.kind, "points")
    for (const p of s.at) {
        assert.ok(Math.abs(Math.hypot(p[0], p[2]) - 5) < 1e-6, "on the circle")
        assert.ok(Math.abs(Math.hypot(p[0] - 5, p[1] + 3, p[2]) - 5) < 1e-6, "on the sphere")
    }
})

test("a cone: a fixed angle from an axis, and its conic section", () => {
    const c = cone([0, 0, 0], [0, 1, 0], 45)          // axis +y, half-angle 45°
    assert.equal(dofOf(c), 2)
    // both nappes are the cone; a 90° point is not
    assert.equal(meet(c, point([1, 1, 0])).kind, "point")
    assert.equal(meet(c, point([1, -1, 0])).kind, "point")
    assert.equal(meet(c, point([1, 0, 0])).kind, "empty")
    // projection keeps the radius and sets the angle
    assert.deepEqual(at3(nearest(c, [2, 0, 0]).at), at3([Math.SQRT2, Math.SQRT2, 0]))
    // a perpendicular plane cuts a circle; an oblique one is a conic, named later
    const section = meet(c, plane([0, 1, 0], [0, 1, 0]))
    assert.equal(section.kind, "circle")
    assert.equal(+section.radius.toFixed(6), 1)
    const hyper = meet(c, plane([1, 0, 0], [1, 0, 0]))
    assert.equal(hyper.kind, "conic")
    assert.equal(hyper.shape, "hyperbola", "a plane parallel to the axis")
    assert.equal(meet(c, plane([0, 0, 0], [0, 1, 0])).kind, "point", "through the apex")
    // a line meets the double cone in up to two points
    const hits = meet(c, line([1, -5, 0], [0, 1, 0]))
    assert.equal(hits.kind, "points")
    assert.deepEqual(hits.at.map(at3).sort((a, b) => a[1] - b[1]), [[1, -1, 0], [1, 1, 0]])
    assert.ok(hits.at.every((p) => meet(c, point(p)).kind === "point"), "every hit is on the cone")
})

test("a plane cuts the cone into the conic family", () => {
    const c = cone([0, 0, 0], [0, 1, 0], 45)
    const nrm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n) }
    // the cutting plane's tilt chooses the family
    assert.equal(meet(c, plane([0, 1, 0], nrm([1, 1.732, 0]))).shape, "ellipse")
    assert.equal(meet(c, plane([0, 1, 0], nrm([1, 1, 0]))).shape, "parabola")
    assert.equal(meet(c, plane([0, 1, 0], [1, 0, 0])).shape, "hyperbola")

    const ell = meet(c, plane([0, 1, 0], nrm([1, 1.732, 0])))
    assert.equal(dofOf(ell), 1)
    const samples = conicSamples(ell)
    assert.ok(samples.length >= 1 && samples[0].length > 8)
    assert.equal(meet(ell, point(samples[0][0])).kind, "point", "a sampled point is on the conic")
    assert.equal(meet(ell, point([0, 0, 0])).kind, "empty", "the apex is not on the ellipse")
    const crossing = meet(ell, line(samples[0][0], samples[0][samples[0].length - 1]))
    assert.ok(["point", "points", "empty"].includes(crossing.kind))
})


test("a half-plane folds the other nappe and meets a plane in a ray", () => {
    const hp = halfplane([0, 0, 0], [0, 1, 0], [1, 0, 0])
    assert.equal(dofOf(hp), 2)
    const behind = nearest(hp, [0, 4, 3])
    assert.ok(behind.ok)
    assert.ok(behind.at[0] >= -1e-9, "the fold lands on the allowed half")
    const cut = meet(hp, plane([0, 0, 0], [0, 0, 1]))
    assert.equal(cut.kind, "ray")
    const along = nearest(cut, [5, 0, 0])
    assert.ok(along.ok && along.at[0] > 0)
})

// A small denominator is not emptiness. `1 − c²` cancels as planes approach
// parallel, so a near-parallel pair must return the line it is, not EMPTY.
// (id:laws-contradiction)
test("near-parallel planes meet in a line; only exact parallelism empties", () => {
    const base = plane([0, 0, 0], [0, 1, 0])
    // 1e-5 degrees about z: a real, resolvable angle.
    const tilt = (1e-5 * Math.PI) / 180
    const n = [-Math.sin(tilt), Math.cos(tilt), 0]
    const far = plane([0, 0.0001, 0], n)
    const cut = meet(base, far)
    assert.equal(cut.kind, "line", "a tiny angle is still an angle")
    // The intersection is far away, and the witness lies on both planes.
    const p = nearest(cut, [0, 0, 0]).at
    assert.ok(Math.abs(p[0]) > 100, `the line is far, got ${JSON.stringify(p)}`)
    const onBase = nearest(base, p).at
    const onFar = nearest(far, p).at
    assert.ok(Math.hypot(onBase[0] - p[0], onBase[1] - p[1], onBase[2] - p[2]) <= 1e-6, "the witness is on both planes")
    assert.ok(Math.hypot(onFar[0] - p[0], onFar[1] - p[1], onFar[2] - p[2]) <= 1e-6, "and the tilted one")
    // Bit-identical normals, separated: a genuine contradiction.
    assert.equal(meet(base, plane([0, 5, 0], [0, 1, 0])).kind, "empty")
    // Below what doubles can resolve, we cannot tell parallel from a distant meet.
    const tiny = plane([0, 5, 0], [1e-12, 1, 0])
    assert.equal(meet(base, tiny).kind, "uncertain")
    // Sharing the origin does not make a below-threshold tilt the same plane: the
    // answer is uncertain, and it claims no freedom.
    const shared = meet(base, plane([0, 0, 0], [5e-10, 1, 0]))
    assert.equal(shared.kind, "uncertain")
    assert.equal(dofOf(shared), null, "an unplaced crossing claims no freedom")
})

// The same illusion for a line and a plane: `n·dir` is the sine of the line's
// angle to the plane, so a near-parallel line crosses far away — not never.
// (id:laws-contradiction)
test("near-parallel line and plane cross far away; only exact parallelism empties", () => {
    const ln = meet(plane([0, 0, 0], [0, 1, 0]), plane([0, 0, 0], [0, 0, 1]))   // the x-axis
    assert.equal(ln.kind, "line")
    // A resolvable tilt: the crossing is on the line, far out.
    const slant = plane([0, 0.0001, 0], [1e-7, 1, 0])
    const hit = meet(ln, slant)
    assert.equal(hit.kind, "point")
    assert.ok(Math.abs(hit.at[0]) > 100, `the crossing is far, got ${JSON.stringify(hit.at)}`)
    const onSlant = nearest(slant, hit.at).at
    assert.ok(Math.hypot(onSlant[0] - hit.at[0], onSlant[1] - hit.at[1], onSlant[2] - hit.at[2]) <= 1e-3,
        "the crossing lies on the plane")
    // Exactly parallel and off the plane: the line never meets it.
    assert.equal(meet(ln, plane([0, 5, 0], [0, 1, 0])).kind, "empty")
    // Below what doubles can resolve, the far crossing is not established.
    assert.equal(meet(ln, plane([0, 5, 0], [1e-13, 1, 0])).kind, "uncertain")
    // The same for a line sharing the plane's origin.
    assert.equal(meet(ln, plane([0, 0, 0], [5e-10, 1, 0])).kind, "uncertain")
    assert.equal(meet(ln, plane([0, 0, 0], [0, 1, 0])).kind, "line", "exactly parallel and in the plane")
})

// A squared clearance compares against a SQUARED budget: two small intersecting spheres are
// a circle, and a point of it satisfies BOTH original laws. The old length-vs-squared mix
// collapsed the circle to a midpoint that violated both. (id:cull-hunt-dimensional-tolerance)
test("meet: a squared clearance keeps its units, so a real circle survives", () => {
    const set = meetAll([sphere([0, 0, 0], 1e-4), sphere([1e-4, 0, 0], 1e-4)])
    assert.equal(set.kind, "circle")
    const q = nearest(set, [5e-5, 1e-4, 0])
    assert.equal(validateDistance(q.at, [0, 0, 0], 1e-4).ok, true, "on the first sphere")
    assert.equal(validateDistance(q.at, [1e-4, 0, 0], 1e-4).ok, true, "on the second sphere")
})

// The tolerance has UNITS: separation, nesting and tangency are all LENGTH tests, and a
// discriminant is classified by the distance between its roots — not against a fixed
// epsilon, and not blind to the coefficient scale. (id:cull-hunt-dimensional-tolerance)
test("meet: separation is a length, and a scaled conic names the SAME roots", () => {
    // two r=5 spheres 1e-7 apart are a single point within the length budget
    const t = meetAll([sphere([0, 0, 0], 5), sphere([10 + 1e-7, 0, 0], 5)])
    assert.equal(t.kind, "point")
    assert.equal(validateDistance(t.at, [0, 0, 0], 5).ok, true)
    assert.equal(validateDistance(t.at, [10 + 1e-7, 0, 0], 5).ok, true)
    // the same conic scaled by 1e-7 names the same two intersections
    const circleAt = (k) => conic("circle", [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [k, 0, k, 0, 0, -k])
    const ln = line([0, 0, 0], [1, 0, 0])
    const one = meet(ln, circleAt(1)), tiny = meet(ln, circleAt(1e-7))
    assert.equal(one.kind, "points")
    assert.equal(tiny.kind, "points")
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++)
        assert.ok(Math.abs(one.at[i][j] - tiny.at[i][j]) < 1e-9, "same root")
})
