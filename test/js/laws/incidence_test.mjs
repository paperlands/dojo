// Step 2 — two derived incidence views, from the bound meaning, not a second model.
// (id:laws-free-relations-read-validity, D058)
//
//   validity references — the inputs whose change requires this predicate to be
//                         rechecked (a point's live position, a frame's placement);
//   solve participants  — the positional entities a solve may move together.
//
// A shared placement frame is a validity dependency, never by itself a solve edge.
// Run: node --test test/js/laws/incidence_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { componentOf, validityDependents } from "../../../assets/js/turtling/laws/component.js"
import { boundReferences, boundParticipants } from "../../../assets/js/turtling/laws/authored.js"
import { buildWorld, fork, drive } from "./harness.mjs"

// One declaring frame F = host: two coordinate readings that depend on F's placement,
// one distance that couples A/B, and an isolated C.
const SOURCE = "let A\nlet B\nlet distance(A,B)=5\nlet A.x=1\nlet C\nlet C.y=1"
const AB_REMOVED = "let A\nlet B\nlet A.x=1\nlet C\nlet C.y=1"
const AB_REVISED = "let A\nlet B\nlet distance(A,B)=10\nlet A.x=1\nlet C\nlet C.y=1"

const pos = (f) => f ? frameWorldTransform(f).position.map((n) => +n.toFixed(4)) : null
const asc = (a, b) => a - b
const features = (laws) => laws.map((l) => l.feature).sort()

function seat(source = SOURCE, origin = SE3.identity()) {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", source, origin))
    drive(scheduler)
    return { scheduler, host, A: host.children.get("A"), B: host.children.get("B"), C: host.children.get("C") }
}
const solveOf = (scheduler, frame) => [...componentOf(scheduler.laws.active(), [frame.id]).frames].sort(asc)

test("S2: solve incidence couples only positional participants", () => {
    const { scheduler, A, B, C, host } = seat()
    assert.deepEqual(solveOf(scheduler, A), [A.id, B.id].sort(asc), "A and B solve together")
    assert.deepEqual(solveOf(scheduler, C), [C.id], "C solves alone")
    assert.ok(!solveOf(scheduler, A).includes(host.id), "the declaring frame is not a solve participant")
    assert.ok(!solveOf(scheduler, C).includes(host.id), "a shared placement frame never merges the assemblies")
    for (const law of scheduler.laws.active()) {
        assert.deepEqual(boundParticipants(law), law.endpoints, "participants are the positional endpoints")
        assert.deepEqual(law.endpoints.filter((id) => id === host.id), [], "the frame is not in any endpoint list")
    }
})

test("S2: validity incidence reads placement frames and live positions, separately", () => {
    const { scheduler, A, B, C, host } = seat()
    const active = scheduler.laws.active()
    const byPlacement = validityDependents(active, [{ id: host.id, aspect: "placement" }])
    assert.deepEqual(byPlacement, [], "world numeric coordinates do not read the owner's placement")
    assert.deepEqual(validityDependents(active, [{ id: host.id, aspect: "position" }]), [],
        "walking F's live head does not read F's placement")
    assert.deepEqual(features(validityDependents(active, [{ id: A.id, aspect: "position" }])), ["coordinate", "distance"],
        "A's live position is read by its coordinate and the distance")
    assert.deepEqual(features(validityDependents(active, [{ id: B.id, aspect: "position" }])), ["distance"])
    assert.deepEqual(features(validityDependents(active, [{ id: C.id, aspect: "position" }])), ["coordinate"],
        "moving C disturbs no A/B obligation")
    for (const law of active) {
        for (const ref of boundReferences(law)) {
            assert.ok(ref.aspect === "position" || ref.aspect === "placement", "only known aspects")
        }
    }
})

test("S2: moving C leaves the A/B assembly untouched", () => {
    const { scheduler, A, B, C } = seat()
    const beforeA = pos(A), beforeB = pos(B)
    const r = scheduler.requestMotion(C, { rotation: frameWorldTransform(C).rotation, position: [3, 1, 0] },
        scheduler.motionRevision, "world")
    assert.equal(r.kind, "accept")
    assert.deepEqual(pos(C), [3, 1, 0], "C satisfies its own coordinate")
    assert.deepEqual(pos(A), beforeA, "A did not move")
    assert.deepEqual(pos(B), beforeB, "B did not move")
})

test("S2: new owner placement does not change the numeric coordinate meanings", () => {
    const scheduler = buildWorld()
    const identity = SE3.identity()
    const first = scheduler.hotSwapChild("host", fork("host", SOURCE, identity))
    drive(scheduler)
    const beforeA = pos(first.children.get("A"))
    const turnedPose = { position: [0, 0, 0], rotation: SE3.rotateLocal(identity, { x: 0, y: 0, z: 1 }, 90).rotation }
    const turned = scheduler.hotSwapChild("host", fork("host", SOURCE, turnedPose))
    drive(scheduler)
    const A = turned.children.get("A"), B = turned.children.get("B"), C = turned.children.get("C")
    assert.ok(Math.abs(pos(A)[0] - 1) < 1e-6, "A.x=1 in world axes")
    assert.ok(Math.abs(pos(C)[1] - 1) < 1e-6, "C.y=1 in world axes")
    assert.equal(pos(A)[0], beforeA[0], "the constrained world coordinate did not change")
    // The two assemblies did not merge under the shared placement.
    assert.deepEqual(solveOf(scheduler, A), [A.id, B.id].sort(asc))
    assert.deepEqual(solveOf(scheduler, C), [C.id])
    // Walking F's live head is not a placement read: the position aspect names no coordinate.
    assert.deepEqual(validityDependents(scheduler.laws.active(), [{ id: turned.id, aspect: "position" }]), [])
})

test("S2: revising or removing AB updates connectivity without stale edges", () => {
    const removed = seat(AB_REMOVED)
    assert.deepEqual(solveOf(removed.scheduler, removed.A), [removed.A.id], "with AB gone, A is alone")
    assert.deepEqual(solveOf(removed.scheduler, removed.C), [removed.C.id])
    assert.deepEqual(features(removed.scheduler.laws.active()), ["coordinate", "coordinate"])
    const revised = seat(AB_REVISED)
    assert.deepEqual(solveOf(revised.scheduler, revised.A), [revised.A.id, revised.B.id].sort(asc),
        "a revision keeps the coupling")
    const distance = revised.scheduler.laws.active().find((l) => l.feature === "distance")
    assert.equal(distance.predicate, 10)
    assert.equal(revised.scheduler.laws.active().filter((l) => l.feature === "distance").length, 1,
        "no stale distance edge survives the revision")
})
