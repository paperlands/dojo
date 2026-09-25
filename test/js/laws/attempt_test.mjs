// Attempt lifetime: one settlement boundary, and the release it owes.
//
// A failed declaration is an attempt that owns its held set wherever its members
// live. These witnesses exercise every failure origin through the same contract:
// accepted geometry and laws unchanged; the correct affected set held; unrelated
// points playable; source-located evidence; repair releases across scopes; one
// repair does not clear another attempt's hold.
//
// Run: node --test test/js/laws/attempt_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const world = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(6))
const holds = (frame) => frame.heldAttempts?.size ?? 0
const drag = (scheduler, frame, x) => scheduler.requestMotion(frame,
    { rotation: frame.transform.deref().rotation, position: [x, 0, 0] }, scheduler.motionRevision).kind

// Failure origin 1 — the proposal refuses before the surviving-predicate check.
test("contract: a pin that fails at proposal holds the pair and locates the fault", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "let D",
        "as B do",
        "  let A.distance = 5",
        "end",
        "as C do",
        "  let A = [1, 0, 0]",
        "end",
    ].join("\n")))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    const C = find(host, "C")
    const D = find(host, "D")
    assert.equal(A.error, null, "the accepted geometry is unchanged")
    assert.deepEqual(world(A), [5, 0, 0], "A still satisfies the distance")
    assert.equal(C.error?.kind, "obstructed", "the conflicting author faults")
    assert.equal(C.error?.span?.line, 7, "the fault is located at its statement")
    assert.ok(holds(A) > 0 && holds(B) > 0, "the affected pair is held")
    assert.equal(drag(scheduler, A, 0), "refuse", "a held member refuses motion")
    assert.equal(drag(scheduler, D, 3), "accept", "an unrelated point stays playable")
})

// Failure origin 2 — the proposal succeeds, but the surviving set cannot be
// realized with the current policy (a pinned component member): rejected, held.
test("contract: an unsupported composition is rejected, held and located", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "let B",
        "let C",
        "let D",
        "as O do",
        "  let C = [10, 0, 0]",
        "end",
        "as A do",
        "  let B.distance = 5",
        "  wait 1",
        "  let B.distance = 10",
        "end",
        "as B do",
        "  let C.distance = 5",
        "end",
    ].join("\n")))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    const C = find(host, "C")
    const D = find(host, "D")
    assert.equal(A.error?.kind, "obstructed", "the anchored component cannot be solved")
    assert.equal(A.error?.span?.line, 11, "located at the revision")
    assert.deepEqual(world(B), [5, 0, 0], "the accepted prefix stands")
    assert.deepEqual(world(C), [10, 0, 0], "the pinned member is not moved")
    assert.equal(scheduler.laws.active().length, 3, "no lie was published")
    assert.ok(holds(A) > 0 && holds(B) > 0, "the affected component is held")
    assert.equal(drag(scheduler, D, 3), "accept", "an unrelated point stays playable")
})

// The hold must cover the whole component, not just the first conflicting pair.
test("hold: a far component member is held too, not only the conflicting pair", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "let B",
        "let C",
        "let E",
        "as O do",
        "  let C = [10, 0, 0]",
        "end",
        "as A do",
        "  let B.distance = 5",
        "  wait 1",
        "  let B.distance = 10",
        "end",
        "as B do",
        "  let C.distance = 5",
        "end",
        "as E do",
        "  let C.distance = 10",
        "end",
    ].join("\n")))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    const C = find(host, "C")
    const E = find(host, "E")
    assert.equal(A.error?.kind, "obstructed", "the revision is obstructed")
    assert.ok([A, B, C, E].every((f) => holds(f) > 0), "the complete component is held")
    assert.equal(drag(scheduler, E, 3), "refuse", "a far member is not free to move")
})

// Failure origin 3 — the being act conflicts with an active pin.
test("contract: a birth conflict holds the being and its declaring frame", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet A = origin\nfw 10\nlet A"))
    drive(scheduler)
    const A = find(host, "A")
    assert.deepEqual(world(A), [0, 0, 0], "the pin's geometry stands")
    assert.equal(host.error?.kind, "obstructed")
    assert.equal(host.error?.span?.line, 4, "located at the re-reached being act")
    assert.ok(holds(A) > 0 && holds(host) > 0, "the being and its declarer are held")
})

// Release — the user's defect: the attempt owns a sibling outside the repaired scope.
test("release: repairing the faulted scope frees its sibling members", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "let D",
        "as B do",
        "  let A.distance = 5",
        "  let A = [1, 0, 0]",
        "end",
        "wait 1",
        "as B do",
        "end",
    ].join("\n")))
    const A = find(host, "A")
    const D = find(host, "D")
    // The failed pin faults B during the seat drain; the host is parked at `wait 1`.
    assert.equal(holds(A), 1, "the sibling A is held by B's attempt")
    assert.equal(drag(scheduler, A, 0), "refuse", "and refuses motion")
    assert.equal(drag(scheduler, D, 3), "accept", "while an unrelated point is playable")
    drive(scheduler)
    assert.equal(holds(A), 0, "repairing B released the sibling A")
    assert.equal(holds(find(host, "B")), 0)
    assert.equal(scheduler.laws.active().length, 0, "B's law was retracted with it")
    assert.equal(drag(scheduler, A, 3), "accept", "A is free again")
})

// Overlap — one repair must not clear another attempt's hold.
test("overlap: releasing one attempt leaves another attempt's hold intact", () => {
    const source = [
        "let A",
        "as B do",
        "  let A.distance = 5",
        "  let A = [1, 0, 0]",
        "end",
        "as C do",
        "  let A.distance = 7",
        "end",
        "wait 1",
        "as B do",
        "end",
        "wait 1",
        "as C do",
        "end",
    ].join("\n")
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source))
    const A = find(host, "A")
    assert.equal(holds(A), 2, "two failed attempts share A")
    const seen = [holds(A)]
    drive(scheduler, { after: () => seen.push(holds(A)) })
    assert.ok(seen.includes(1), `releasing B's attempt left C's hold (saw ${seen})`)
    assert.equal(holds(A), 0, "releasing C's attempt freed A")
})

// Removal — not a repair: the identity is gone, so the attempt must release.
test("removal: removing the faulted scope frees a sibling member", () => {
    const scheduler = buildWorld({})
    scheduler.hotSwapChild("A", fork("A", ""))
    scheduler.hotSwapChild("s", fork("s", "let A.distance = 5\nlet A = origin"))
    const A = find(scheduler.root, "A")
    assert.equal(holds(A), 1, "a faults the pin and holds the sibling A")
    scheduler.removeChild("s")
    assert.equal(holds(A), 0, "removing the author released its sibling member")
    assert.equal(scheduler.laws.active().length, 0, "its law went with it")
})

test("removal: removing a held member releases the attempt", () => {
    const scheduler = buildWorld({})
    scheduler.hotSwapChild("A", fork("A", ""))
    scheduler.hotSwapChild("s", fork("s", "let A.distance = 5\nlet A = origin"))
    assert.equal(scheduler.root._attempts.size, 1)
    scheduler.removeChild("A")
    assert.equal(scheduler.root._attempts.size, 0, "the vanished member released the attempt")
})
