// The second driven feature: a coordinate. (id:laws-dependency-driven-place, id:laws-payload-boundary)
//
// Hypothesis: a row that declares `drive` becomes a follower with no lifecycle branch — the
// coordinate tracks one axis, leaving the others free, and the general path (read → project →
// rebind the accepted term → re-apply) places it. This is the DX probe: `let A.x = B.y`,
// move B, A.x follows while A.y stays free — the only spelling that expresses a PARTIAL
// dependency (a tuple pins all three coordinates).
//
// Counterexample (before the payload boundary): the reconstruction dropped the term's frame
// and the proposal read the observer's placement, so a driven coordinate could not land.
//
// REOPEN when a driven feature needs a lifecycle edit, or a replacement does not fully
// remove the retired driver's influence.
//
// Run: node --test test/js/laws/driven_coordinate_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive, nz } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const accept = ({ requested }) => ({ accepted: true, transform: requested })
const pos = (f) => nz(frameWorldTransform(f).position)
const move = (s, f, to) => s.requestMotion(f, { rotation: f.transform.deref().rotation, position: to }, s.motionRevision)

// 1. A driven coordinate tracks ONE axis and leaves the others free.
test("a driven coordinate tracks its axis and leaves the others free", () => {
    const scheduler = buildWorld({ admit: accept })
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet B\nlet A.x = B.y\nlet A.z = 0"))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    assert.equal(scheduler.readouts.size, 1, "the coordinate installed one driver")
    assert.deepEqual(pos(A), [0, 0, 0], "A starts at the origin")
    assert.equal(move(scheduler, B, [0, 5, 0]).kind, "accept")
    drive(scheduler)
    assert.deepEqual(pos(A), [5, 0, 0], "A.x followed B.y; A.y stayed free; A.z held 0")
})

// 2. Replacing the driven expression with a literal removes its influence completely.
test("a literal replacement retires the driven coordinate's influence", () => {
    const scheduler = buildWorld({ admit: accept })
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet B\nlet A.z = 0\nlet A.x = B.y\nlet A.x = 5"))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    assert.equal(scheduler.readouts.size, 0, "the literal coordinate retired the driver")
    assert.equal(pos(A)[0], 5, "A.x took the literal")
    assert.equal(move(scheduler, B, [0, 5, 0]).kind, "accept")
    drive(scheduler)
    assert.equal(pos(A)[0], 5, "B's move no longer affects A.x")
})
