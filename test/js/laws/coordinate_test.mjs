// Experiment 4 witnesses: a framed coordinate truth joined with a distance.
// (id:relationships-todo-coordinate-spike, id:relationships-transition-hypothesis)
//
// Run: node --test test/js/laws/coordinate_test.mjs
//
// These are external checks. The producer (a component meet) and the independent
// validators must agree; reach order must not change the answer; retraction must
// return exactly the freedom the removed truth was holding.
import { test } from "node:test"
import assert from "node:assert/strict"

import {
    coordinateTruth, distanceTruth, validateCoordinate, validateDistance,
    meetPlaneSphere, nearestOn, feasibleSet, sequentialProject,
    createPlay, reach, retract, request,
} from "./coordinate_ref.mjs"
import { componentHandFirst, validateMidpoint, midpointOf } from "./midpoint_ref.mjs"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { AXIS_Z } from "../../../assets/js/turtling/se3.js"

const IDENT = Versor.fromAxisAngle(AXIS_Z, 0)
const at3 = (p) => p.map((n) => +n.toFixed(6))
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)
const ROT_Y0 = coordinateTruth({ position: [0, 0, 0], rotation: IDENT }, "y", 0)

// ---------------------------------------------------------------------------
// The declaration: a framed coordinate is one reading, one assertion.
// ---------------------------------------------------------------------------
test("a framed coordinate reads and checks the same plane; the axis is the meaning", () => {
    assert.equal(validateCoordinate([4, 0, 6], ROT_Y0).ok, true, "on the XZ plane")
    assert.equal(validateCoordinate([4, 0.01, 6], ROT_Y0).ok, false, "off it")
    // `A.y = 0` and `A.z = 0` are different planes: the normal is the frame's own axis.
    const zPlane = coordinateTruth({ position: [0, 0, 0], rotation: IDENT }, "z", 0)
    assert.deepEqual(at3(ROT_Y0.normal), [0, 1, 0])
    assert.deepEqual(at3(zPlane.normal), [0, 0, 1])
    assert.equal(validateCoordinate([4, 0, 6], zPlane).ok, false, "a y-plane point need not be on z=0")
})

test("rotating the declaring frame rotates the plane with it", () => {
    const R = Versor.fromAxisAngle(AXIS_Z, 90)
    const F = { position: [0, 0, 0], rotation: R }
    const t = coordinateTruth(F, "y", 0)
    // local +y turns to world −x under Rz(90): the plane is x = 0.
    assert.deepEqual(at3(t.normal), [-1, 0, 0], "the frame's local y-axis, in the world")
    assert.equal(validateCoordinate([0, 3, 7], t).ok, true, "x = 0 is on it")
    assert.equal(validateCoordinate([1, 3, 7], t).ok, false, "x = 1 is off it")
})

// ---------------------------------------------------------------------------
// The meet: the feasible set of the whole active set.
// ---------------------------------------------------------------------------
test("a plane and a sphere meet as a circle, an uncertain tangency or nothing", () => {
    const B = [0, 2, 0]
    const circle = meetPlaneSphere(ROT_Y0, distanceTruth(B, 5))
    assert.equal(circle.kind, "circle")
    assert.deepEqual(at3(circle.center), [0, 0, 0], "the sphere centre projected to the plane")
    near(circle.radius, Math.sqrt(21), 1e-9, "r² − d² = 25 − 4")

    // Near d = r we do not name exact topology: point, circle and near-miss
    // are indistinguishable within the tolerance.
    for (const r of [2, 2 + 1e-7, 2 - 1e-7]) {
        assert.equal(meetPlaneSphere(ROT_Y0, distanceTruth(B, r)).kind, "uncertain", `r = ${r}`)
    }

    // d > r: no solution — a demonstrated impossibility, not an approximation.
    const empty = meetPlaneSphere(ROT_Y0, distanceTruth(B, 1))
    assert.equal(empty.kind, "empty")
})

test("a request lands on the circle and satisfies both truths", () => {
    const B = [0, 2, 0]
    const coord = coordinateTruth({ position: [0, 0, 0], rotation: IDENT }, "y", 0)
    const dist = distanceTruth(B, 5)
    const feasible = feasibleSet([{ ...coord, kind: "coordinate" }, { ...dist, kind: "distance" }])
    assert.equal(feasible.kind, "circle")
    const out = nearestOn(feasible, [4, 0, 0])
    assert.equal(out.ok, true)
    near(out.at[0], Math.sqrt(21), 1e-9, "the radial projection stays on the circle")
    assert.equal(validateCoordinate(out.at, coord).ok, true)
    assert.equal(validateDistance(out.at, B, 5).ok, true)
})

// ---------------------------------------------------------------------------
// Either reach order: one meet, one answer.
// ---------------------------------------------------------------------------
test("the two truths compose in either reach order, with one accepted point", () => {
    const B = [0, 2, 0]
    const host = { position: [0, 0, 0], rotation: IDENT }
    const coordTruth = { kind: "coordinate", ...coordinateTruth(host, "y", 0), target: "A" }
    const distTruth = { kind: "distance", ...distanceTruth(B, 5), target: "A" }

    const distanceFirst = reach(createPlay({ poses: { A: [4, 0, 0] } }),
        { owner: "line:dist", address: "dist|B|A", truth: distTruth })
    const coordSecond = reach(distanceFirst.play,
        { owner: "line:coord", address: "coord|y|A", truth: coordTruth })
    const a1 = request(coordSecond.play, "A", [4, 0, 0])

    const coordFirst = reach(createPlay({ poses: { A: [4, 0, 0] } }),
        { owner: "line:coord", address: "coord|y|A", truth: coordTruth })
    const distSecond = reach(coordFirst.play,
        { owner: "line:dist", address: "dist|B|A", truth: distTruth })
    const a2 = request(distSecond.play, "A", [4, 0, 0])

    assert.equal(a1.verdict, "accepted")
    assert.equal(a2.verdict, "accepted")
    assert.deepEqual(at3(a1.at), at3(a2.at), "reach order does not choose the point")
    assert.equal(validateCoordinate(a1.at, coordTruth).ok, true)
    assert.equal(validateDistance(a1.at, B, 5).ok, true)
})

// ---------------------------------------------------------------------------
// The counterexample: the shipped per-row shape breaks a truth in either order.
// ---------------------------------------------------------------------------
test("sequential per-row projection breaks one truth in either order", () => {
    const B = [0, 2, 0]
    const coord = { kind: "coordinate", ...coordinateTruth({ position: [0, 0, 0], rotation: IDENT }, "y", 0) }
    const dist = { kind: "distance", ...distanceTruth(B, 5) }
    const hand = [4, 0, 0]

    const planeFirst = sequentialProject(hand, [coord, dist])
    const sphereFirst = sequentialProject(hand, [dist, coord])

    // Each keeps one truth and loses the other; the two orders disagree.
    assert.equal(validateCoordinate(planeFirst, coord).ok, false, "plane-first leaves the plane")
    assert.equal(validateDistance(planeFirst, B, 5).ok, true)
    assert.equal(validateCoordinate(sphereFirst, coord).ok, true)
    assert.equal(validateDistance(sphereFirst, B, 5).ok, false, "sphere-first leaves the sphere")
    assert.notDeepEqual(at3(planeFirst), at3(sphereFirst))
    // The meet is the only shape that keeps both.
    const meet = nearestOn(feasibleSet([coord, dist]), hand)
    assert.equal(validateCoordinate(meet.at, coord).ok, true)
    assert.equal(validateDistance(meet.at, B, 5).ok, true)
})

// ---------------------------------------------------------------------------
// Retraction returns the right freedom.
// ---------------------------------------------------------------------------
test("removing one truth returns exactly the freedom it was holding", () => {
    const coord = { kind: "coordinate", ...coordinateTruth({ position: [0, 0, 0], rotation: IDENT }, "y", 0), target: "A" }
    const dist = { kind: "distance", ...distanceTruth([0, 2, 0], 5), target: "A" }

    // Both: a circle.
    const both = feasibleSet([coord, dist])
    assert.equal(both.kind, "circle")
    assert.equal(both.dof, 1)

    // Remove the distance: the plane is all that is left.
    assert.equal(feasibleSet([coord]).kind, "plane")
    assert.equal(feasibleSet([coord]).dof, 2)
    // Remove the coordinate: the sphere.
    assert.equal(feasibleSet([dist]).kind, "sphere")
    assert.equal(feasibleSet([dist]).dof, 2)
    // Remove both: free space.
    assert.equal(feasibleSet([]).kind, "space")
    assert.equal(feasibleSet([]).dof, 3)

    // The removed truth is not silently retained: a point off the old circle is
    // now reachable in the plane, and the distance no longer constrains it.
    let play = createPlay()
    for (const [owner, address, truth] of [["line:coord", "coord|y|A", coord], ["line:dist", "dist|B|A", dist]]) {
        play = reach(play, { owner, address, truth }).play
    }
    const freed = retract(play, "line:dist")
    assert.equal(freed.verdict, "retracted")
    assert.equal(freed.play.truths.length, 1)
    const moved = request(freed.play, "A", [4, 0, 0])
    assert.equal(moved.verdict, "accepted")
    assert.deepEqual(at3(moved.at), [4, 0, 0], "the plane alone lets A reach the hand")
    assert.equal(validateDistance(moved.at, [0, 2, 0], 5).ok, false, "and the distance is gone")
})

// ---------------------------------------------------------------------------
// The same skeleton carries an affine word: the method is a capability.
// ---------------------------------------------------------------------------
test("the same reach/retract skeleton carries a midpoint, validated independently", () => {
    const A = [0, 0, 0], B = [10, 0, 0], M = midpointOf(A, B)
    const truth = { kind: "midpoint", a: A, b: B, m: M, target: "A" }

    let play = reach(createPlay({ poses: { A, B, M } }),
        { owner: "line:mid", address: "midpoint|A|B|M", truth }).play
    assert.equal(play.truths.length, 1)

    // The affine method sees the component; the independent validator agrees.
    const out = componentHandFirst({ a: A, b: B, m: M }, { who: "m", to: [8, 0, 0] })
    assert.equal(out.ok, true)
    assert.equal(out.valid, true, "2M = A + B after the component move")
    assert.equal(validateMidpoint(out.poses).ok, true)
    assert.deepEqual(at3(out.poses.m), [8, 0, 0], "the writer met the hand")

    // A second invocation of the same word owns its own requirement; retracting
    // one leaves the other. (id:relationships-every-owner)
    const truth2 = { kind: "midpoint", a: A, b: B, m: M, target: "A" }
    const two = reach(play, { owner: "line:mid2", address: "midpoint|A|B|M2", truth: truth2 }).play
    assert.equal(two.truths.length, 2)
    const one = retract(two, "line:mid")
    assert.equal(one.play.truths.length, 1)
    assert.equal(one.play.truths[0].owner, "line:mid2")
})
