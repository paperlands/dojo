// Experiment 6 witnesses: two derived relations, context-supplied writers, and
// a satisfy / follow split. (id:laws-experiment-6-distinctions)
//
// Run: node --test test/js/laws/component_method_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import {
    coordinate, distance, midpoint,
    createWorld, referencesOf, participantsOf, dependentsOf, solveComponentOf,
    addressOf, checkTruth, validateAll, namedSet,
    reach, request, moveIdentity, retract, methodFor,
} from "./component_ref.mjs"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { AXIS_X, AXIS_Z } from "../../../assets/js/turtling/se3.js"

const IDENT = Versor.fromAxisAngle(AXIS_Z, 0)
const P = (x, y = 0, z = 0) => ({ position: [x, y, z], rotation: IDENT })
const F0 = { position: [0, 0, 0], rotation: IDENT }
const at3 = (p) => p.map((n) => +n.toFixed(6))
const valid = (w) => validateAll(w.truths, w.poses).ok

const coord = (point, frame = "F", axis = "y", value = 0) => coordinate({ point, frame, axis, value })
const dist = (a, b, radius) => distance({ a, b, radius })
const mid = (a, m, b) => midpoint({ a, m, b })

// ---------------------------------------------------------------------------
// 1. The two derived relations are different relations.
// ---------------------------------------------------------------------------
test("validity dependency is not solve connectivity", () => {
    const t = coord("A")
    assert.deepEqual(referencesOf(t).sort(), ["A", "F"], "a change must recheck roles and frame")
    assert.deepEqual(participantsOf(t), ["A"], "a solve may only move the roles")

    // coordA and coordC share F but not a participant; a distance joins A and B.
    const truths = [coord("A"), dist("A", "B", 5), coord("C")]
    const solveC = solveComponentOf(truths, ["C"])
    assert.equal(solveC.length, 1, "C's solve component is only its own coordinate")
    assert.deepEqual(solveC[0].roles, ["C"])
    const solveA = solveComponentOf(truths, ["A"])
    assert.equal(solveA.length, 2, "A's solve component joins its coordinate and the distance")
    assert.deepEqual(dependentsOf(truths, ["C"]).map((x) => x.roles[0]), ["C"])
    assert.equal(dependentsOf(truths, ["F"]).length, 2, "F is a validity dependency of both coordinates")
})

// ---------------------------------------------------------------------------
// 2. An independent coordinate in the same frame is not handed A's method.
// ---------------------------------------------------------------------------
test("request on an independent coordinate in the same frame succeeds", () => {
    let w = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0), C: P(1, 0, 0), F: F0 } })
    w = reach(w, { owner: "ca", row: coord("A"), target: "A" }).world
    w = reach(w, { owner: "d", row: dist("A", "B", 5), target: "A" }).world
    w = reach(w, { owner: "cc", row: coord("C"), target: "C" }).world
    assert.equal(w.truths.length, 3)
    assert.equal(valid(w), true)
    const aBefore = at3(w.poses.A.position)

    const q = request(w, "C", [1, 1, 0])
    assert.equal(q.verdict, "accepted", "C can move on its own plane")
    assert.deepEqual(at3(q.world.poses.C.position), [1, 0, 0])
    assert.deepEqual(at3(q.world.poses.A.position), aBefore, "A is untouched")
})

// ---------------------------------------------------------------------------
// 3. Distance is symmetric; heldness comes from policy.
// ---------------------------------------------------------------------------
test("distance is symmetric: either endpoint is offered unless policy holds it", () => {
    let w = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0) } })
    w = reach(w, { owner: "d", row: dist("A", "B", 5), target: "A" }).world
    assert.ok(Math.abs(Math.hypot(...w.poses.A.position.map((v, i) => v - w.poses.B.position[i])) - 5) < 1e-9)

    const q = request(w, "B", [0, 7, 0])           // no policy holds B
    assert.equal(q.verdict, "accepted", "the other endpoint is offered")
    const moved = q.world.poses.B.position
    const aNow = q.world.poses.A.position
    assert.ok(Math.abs(Math.hypot(moved[0] - aNow[0], moved[1] - aNow[1], moved[2] - aNow[2]) - 5) < 1e-9, "|AB| = 5 after B moved")

    const held = request(w, "B", [0, 7, 0], { held: ["B"] })
    assert.equal(held.verdict, "unsupported", "heldness is policy, not the row")
    assert.deepEqual(at3(held.world.poses.B.position), [0, 2, 0])
})

// ---------------------------------------------------------------------------
// 4. A truth edit initializes; it is not a hand request at the old pose.
// ---------------------------------------------------------------------------
test("reaching a midpoint initializes it instead of blocking on the old pose", () => {
    let w = createWorld({ poses: { A: P(0, 0, 0), B: P(10, 0, 0), M: P(6, 0, 0) } })
    const r = reach(w, { owner: "m", row: mid("A", "M", "B"), target: "M" })
    assert.equal(r.verdict, "reached", "a witness exists even though M = 6 did not satisfy it")
    assert.deepEqual(at3(r.world.poses.M.position), [5, 0, 0], "M initialized to (A + B) / 2")
    assert.equal(valid(r.world), true)

    // Motion under the now-unchanged truth is a separate request.
    const q = request(r.world, "M", [8, 0, 0])
    assert.equal(q.verdict, "accepted")
    assert.deepEqual(at3(q.world.poses.M.position), [8, 0, 0])
    assert.deepEqual(at3(q.world.poses.A.position), [3, 0, 0])
    assert.deepEqual(at3(q.world.poses.B.position), [13, 0, 0])
})

// ---------------------------------------------------------------------------
// 5-6. reach is atomic and order-independent.
// ---------------------------------------------------------------------------
test("reach is atomic and order-independent", () => {
    const build = (coordFirst) => {
        let w = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0), F: F0 } })
        const events = coordFirst
            ? [{ owner: "c", row: coord("A"), target: "A" }, { owner: "d", row: dist("A", "B", 5), target: "A" }]
            : [{ owner: "d", row: dist("A", "B", 5), target: "A" }, { owner: "c", row: coord("A"), target: "A" }]
        for (const e of events) {
            const r = reach(w, e)
            assert.equal(r.verdict, "reached")
            assert.equal(valid(r.world), true)
            w = r.world
        }
        return w
    }
    const w1 = build(true), w2 = build(false)
    assert.deepEqual(at3(w1.poses.A.position), at3(w2.poses.A.position))
    assert.deepEqual(at3(w1.poses.A.position), [4.582576, 0, 0])
})

test("reach refuses an impossible composition, installing nothing", () => {
    let w = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0), F: F0 } })
    w = reach(w, { owner: "c", row: coord("A"), target: "A" }).world
    const r = reach(w, { owner: "d", row: dist("A", "B", 1), target: "A" })
    assert.equal(r.verdict, "contradiction")
    assert.equal(r.world.truths.length, 1)
    assert.deepEqual(at3(r.world.poses.A.position), at3(w.poses.A.position))
})

// ---------------------------------------------------------------------------
// 7. A moved declaring frame is reread live.
// ---------------------------------------------------------------------------
test("a moved declaring frame is reread live, not snapshotted", () => {
    let w = createWorld({ poses: { A: P(4, 0, 0), F: F0 } })
    w = reach(w, { owner: "c", row: coord("A"), target: "A" }).world
    const F2 = { position: [0, 0, 0], rotation: Versor.fromAxisAngle(AXIS_X, 30) }
    const moved = moveIdentity(w, "F", F2)
    assert.equal(moved.verdict, "accepted")

    const q = request(moved.world, "A", [4, 5, 5])
    assert.equal(q.verdict, "accepted")
    const n2 = F2.rotation.rotateVec(0, 1, 0)
    assert.ok(Math.abs(n2[0] * q.at[0] + n2[1] * q.at[1] + n2[2] * q.at[2]) <= 1e-6, "on F's new plane")
    assert.ok(Math.abs(q.at[1]) > 1e-3, "not on the old y = 0 plane")
})

// ---------------------------------------------------------------------------
// 8. Two owner-distinct midpoints solve together.
// ---------------------------------------------------------------------------
test("two midpoints sharing M solve as one linear system", () => {
    // 2M = A + B and 2M = C + D, both holding at M = 5.
    let w = createWorld({ poses: { A: P(0, 0, 0), B: P(10, 0, 0), C: P(2, 0, 0), D: P(8, 0, 0), M: P(5, 0, 0) } })
    w = reach(w, { owner: "o1", row: mid("A", "M", "B"), target: "M" }).world
    w = reach(w, { owner: "o2", row: mid("C", "M", "D"), target: "M" }).world
    assert.equal(w.truths.length, 2)

    const q = request(w, "M", [7, 0, 0])
    assert.equal(q.verdict, "accepted", "two midpoint rows are not 'unsupported'")
    assert.equal(valid(q.world), true, "both rows hold after the move")
    assert.deepEqual(at3(q.world.poses.M.position), [7, 0, 0])
    assert.deepEqual(at3(q.world.poses.A.position), [2, 0, 0])
    assert.deepEqual(at3(q.world.poses.B.position), [12, 0, 0])
    assert.deepEqual(at3(q.world.poses.C.position), [4, 0, 0])
    assert.deepEqual(at3(q.world.poses.D.position), [10, 0, 0])
})

// ---------------------------------------------------------------------------
// 9. The coordinate check is independent of the candidate's interpretation.
// ---------------------------------------------------------------------------
test("the independent coordinate check catches a wrong candidate axis", () => {
    let w = createWorld({ poses: { A: P(4, 0, 0), F: F0 } })
    w = reach(w, { owner: "c", row: coord("A", "F", "y", 0), target: "A" }).world

    // A candidate that interprets the frame's x-axis, not the authored y-axis.
    const wrongAxis = {
        follow: ({ truths, poses, writer, hand }) => {
            const t = truths[0]
            const F = poses[t.frame]
            const n = F.rotation.rotateVec(1, 0, 0)
            const point = F.position.map((c, i) => c + t.payload.value * n[i])
            const off = n[0] * (hand[0] - point[0]) + n[1] * (hand[1] - point[1]) + n[2] * (hand[2] - point[2])
            return { ok: true, proposal: { [writer]: { ...poses[writer], position: hand.map((x, i) => x - off * n[i]) } } }
        },
    }
    const q = request(w, "A", [4, 5, 5], { method: wrongAxis })
    assert.notEqual(q.verdict, "accepted", "local-y disagrees with the candidate")
    assert.deepEqual(at3(q.world.poses.A.position), [4, 0, 0])

    // The authored axis is accepted and satisfies local_y = 0.
    const right = request(w, "A", [4, 5, 5])
    assert.equal(right.verdict, "accepted")
    assert.ok(Math.abs(right.at[1]) <= 1e-6)
})

// ---------------------------------------------------------------------------
// 10. Near the tangency tolerance, freedom is uncertain.
// ---------------------------------------------------------------------------
test("freedom reports uncertainty near the tangency boundary", () => {
    const w = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0), F: F0 } })
    for (const r of [2, 2 + 1e-7, 2 - 1e-7]) {
        const set = namedSet([coord("A"), dist("A", "B", r)], w.poses, { point: "A" })
        assert.equal(set.kind, "uncertain", `r = ${r}`)
        assert.equal(set.dof, null)
    }
    const circle = namedSet([coord("A"), dist("A", "B", 5)], w.poses, { point: "A" })
    assert.equal(circle.kind, "circle")
    assert.equal(circle.dof, 1)
    const point = namedSet([dist("A", "B", 0)], w.poses, { point: "A" })
    assert.equal(point.kind, "point")
    assert.equal(point.dof, 0)
    const empty = namedSet([coord("A"), dist("A", "B", 1)], w.poses, { point: "A" })
    assert.equal(empty.kind, "empty")
    assert.equal(empty.dof, null)
})

// ---------------------------------------------------------------------------
// 11. Ownership, the fail-closed gate, and a lying method.
// ---------------------------------------------------------------------------
test("ownership, the fail-closed gate and a lying method", () => {
    const zero = P(0, 0, 0)
    let w = createWorld({ poses: { A: zero, M: zero, B: zero } })
    const r1 = reach(w, { owner: "o1", row: mid("A", "M", "B"), target: "M" })
    const r2 = reach(r1.world, { owner: "o2", row: mid("A", "M", "B"), target: "M" })
    assert.equal(r2.world.truths.length, 2, "an absent address keys on the owner")
    assert.equal(retract(r2.world, "o1").world.truths.length, 1)

    const bogus = { feature: "area", roles: ["A"], frame: null, payload: {} }
    assert.equal(reach(w, { owner: "x", row: bogus, target: "A" }).verdict, "unsupported")
    const orphan = checkTruth(dist("A", "GHOST", 5), w.poses)
    assert.equal(orphan.ok, false)
    assert.equal(orphan.kind, "unresolved")

    let two = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0), F: F0 } })
    two = reach(two, { owner: "c", row: coord("A"), target: "A" }).world
    two = reach(two, { owner: "d", row: dist("A", "B", 5), target: "A" }).world
    const liar = { follow: () => ({ ok: true, proposal: { A: P(999, 0, 0) } }) }
    const q = request(two, "A", [4, 0, 0], { method: liar })
    assert.notEqual(q.verdict, "accepted", "the original predicates reject the poison")
    assert.deepEqual(at3(q.world.poses.A.position), at3(two.poses.A.position))
    assert.equal(methodFor(two.truths) !== null, true)
})

// ---------------------------------------------------------------------------
// 12. Redundant, independently owned equations solve by rank.
// ---------------------------------------------------------------------------
test("two identical midpoint rows under different owners still move", () => {
    let w = createWorld({ poses: { A: P(0, 0, 0), B: P(10, 0, 0), M: P(5, 0, 0) } })
    w = reach(w, { owner: "o1", row: mid("A", "M", "B"), target: "M" }).world
    w = reach(w, { owner: "o2", row: mid("A", "M", "B"), target: "M" }).world
    assert.equal(w.truths.length, 2, "both owners are kept")
    const q = request(w, "M", [8, 0, 0])
    assert.equal(q.verdict, "accepted", "rank, not row count, decides")
    assert.equal(valid(q.world), true, "both original assertions hold")
    assert.deepEqual(at3(q.world.poses.M.position), [8, 0, 0])
    assert.deepEqual(at3(q.world.poses.A.position), [3, 0, 0])
    assert.deepEqual(at3(q.world.poses.B.position), [13, 0, 0])
})

// ---------------------------------------------------------------------------
// 13. Initialization may move a permitted participant other than the target.
// ---------------------------------------------------------------------------
test("reaching a midpoint may initialize by moving another permitted member", () => {
    let w = createWorld({ poses: { A: P(0, 0, 0), B: P(10, 0, 0), M: P(5, 0, 0), C: P(0, 0, 0), D: P(14, 0, 0) } })
    w = reach(w, { owner: "m1", row: mid("A", "M", "B"), target: "M" }).world
    const r = reach(w, { owner: "m2", row: mid("C", "M", "D"), target: "M", held: [] })
    assert.equal(r.verdict, "reached", "D = 10 is a witness; the target need not move alone")
    assert.equal(valid(r.world), true)
    const held = reach(w, { owner: "m2", row: mid("C", "M", "D"), target: "M", held: ["A", "B", "C", "D"] })
    assert.equal(held.verdict, "policy", "a held participant prevented it; not infeasible geometry")
})

// ---------------------------------------------------------------------------
// 14. Exact freedom needs the queried point and what is held.
// ---------------------------------------------------------------------------
test("freedom requires the queried point and held context", () => {
    const w = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0), F: F0 } })
    const dRow = dist("A", "B", 5)
    assert.equal(namedSet([dRow], w.poses).kind, "unknown", "no query point")
    const aboutB = namedSet([dRow], w.poses, { point: "A" })
    assert.equal(aboutB.kind, "sphere")
    assert.deepEqual(at3(aboutB.center), [0, 2, 0], "A is free about B, not the assembly")
    assert.equal(aboutB.held, "B")
    assert.equal(namedSet([dRow], w.poses, { point: "A", held: ["A"] }).kind, "held")
    assert.equal(namedSet([coord("A")], w.poses, { point: "B" }).kind, "unknown", "B is not the subject")
})

// ---------------------------------------------------------------------------
// 15. Fail-closed: unknown axis and a key namespace that cannot collide.
// ---------------------------------------------------------------------------
test("an unknown axis is a typed refusal, not a throw", () => {
    const w = createWorld({ poses: { A: P(4, 0, 0), F: F0 } })
    const bad = { feature: "coordinate", roles: ["A"], frame: "F", payload: { axis: "w", value: 0 } }
    const r = reach(w, { owner: "c", row: bad, target: "A" })
    assert.equal(r.verdict, "relation", "domain guard, before any geometry")
    assert.equal(r.world.truths.length, 0)
    assert.equal(checkTruth(bad, w.poses).ok, false)
})

test("an owner-derived key cannot collide with a spelled address", () => {
    assert.notEqual(addressOf({ owner: "o1", address: null }), addressOf({ owner: "o2", address: "owner:o1" }))
    const zero = P(0, 0, 0)
    let w = createWorld({ poses: { A: zero, M: zero, B: zero } })
    w = reach(w, { owner: "o1", row: mid("A", "M", "B"), target: "M" }).world
    w = reach(w, { owner: "o2", address: "owner:o1", row: mid("A", "M", "B"), target: "M" }).world
    assert.equal(w.truths.length, 2, "the spelled address is a distinct owner slot")
})

// ---------------------------------------------------------------------------
// 16. Ownership invariance: identical conditions, distinct owners.
// ---------------------------------------------------------------------------
test("identical conditions under different owners move as one capability", () => {
    let w = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0) } })
    w = reach(w, { owner: "d1", row: dist("A", "B", 5), target: "A" }).world
    w = reach(w, { owner: "d2", row: dist("A", "B", 5), target: "A" }).world
    assert.equal(w.truths.length, 2, "both owners are kept")
    const q = request(w, "A", [8, 0, 0])
    assert.equal(q.verdict, "accepted", "one condition, one capability")
    assert.equal(valid(q.world), true, "both owners validate on publication")
    const A = q.world.poses.A.position
    assert.ok(Math.abs(Math.hypot(A[0] - 0, A[1] - 2, A[2]) - 5) < 1e-9)

    // duplicates of both a coordinate and a distance select plane·sphere once
    let c = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0), F: F0 } })
    c = reach(c, { owner: "c1", row: coord("A"), target: "A" }).world
    c = reach(c, { owner: "c2", row: coord("A"), target: "A" }).world
    c = reach(c, { owner: "d1", row: dist("A", "B", 5), target: "A" }).world
    c = reach(c, { owner: "d2", row: dist("A", "B", 5), target: "A" }).world
    assert.equal(c.truths.length, 4)
    const r = request(c, "A", [4, 0, 0])
    assert.equal(r.verdict, "accepted", "plane and sphere each see one condition")
    assert.equal(valid(r.world), true)
})

// ---------------------------------------------------------------------------
// 17. Two *different* distance conditions are still outside the bounded method.
// ---------------------------------------------------------------------------
test("two different distance conditions stay unsupported", () => {
    let w = createWorld({ poses: { A: P(4, 0, 0), B: P(0, 2, 0), C: P(0, 0, 0) } })
    w = reach(w, { owner: "d1", row: dist("A", "B", 5), target: "A" }).world
    const before = [...w.poses.A.position]
    const r = reach(w, { owner: "d2", row: dist("A", "C", 3), target: "A" })
    assert.equal(r.verdict, "unsupported", "two distinct spheres are not one capability")
    assert.equal(r.world.truths.length, 1, "nothing installed")
    assert.deepEqual(at3(r.world.poses.A.position), at3(before))
})
