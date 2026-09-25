// Phase 0h: the supervisor sends a message; the worker adopts it.
//
// The component commit must not reach into a sibling's actor state. It publishes
// the accepted component as one observed snapshot and posts a rebase message to
// each sibling's inbox; that sibling's own executor adopts the pose at its next
// command. The supervisor never assigns `batch.transform`.
// (laws-build.org id:laws-build-solve-seam; Armstrong: communicate, don't share)
//
// Run: node --test test/js/laws/phase0h_supervisor_message_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld as baseWorld, fork, at, nz, drive, ends, componentResponder } from "./harness.mjs"
// Inherited concurrent component base, gated off by default; opt in explicitly.
const buildWorld = (opts = {}) => baseWorld({ ...opts, settledOnly: false })

const TWO_STEP = "wait 1\nfw 2\nwait 1"

test("a component commit publishes an observation and posts a rebase message", () => {
    const record = []
    const scheduler = buildWorld({ admit: componentResponder(record) })
    const b = scheduler.hotSwapChild("b", fork("b", TWO_STEP, at(5)))
    scheduler.hotSwapChild("a", fork("a", "goto 1 0\nwait 1"))

    assert.deepEqual(nz(b.transform.deref().position), [1, 0, 0], "the accepted component is published")
    assert.deepEqual(nz(b.batch.transform.position), [0, 0, 0], "the supervisor did not write the worker's pose")
    assert.deepEqual(nz(b.batch.rebase.position), [1, 0, 0], "a rebase message is waiting in the inbox")
})

test("the worker adopts the rebase at its next command, not in the callback", () => {
    const record = []
    const scheduler = buildWorld({ admit: componentResponder(record) })
    const b = scheduler.hotSwapChild("b", fork("b", TWO_STEP, at(5)))
    scheduler.hotSwapChild("a", fork("a", "goto 1 0\nwait 1"))
    const batch = b.batch   // the worker's state is dropped when the frame finishes

    const trace = drive(scheduler)

    assert.deepEqual(nz(batch.transform.position), [3, 0, 0], "adopted local 1, then fw 2 -> 3")
    assert.equal(batch.rebase, undefined, "the inbox is consumed")
    assert.deepEqual(nz(ends(trace, "b")[0]), [3, 0, 0])
})

test("a replaced member never adopts the old run's rebase", () => {
    const record = []
    const scheduler = buildWorld({ admit: componentResponder(record) })
    const old = scheduler.hotSwapChild("b", fork("b", TWO_STEP, at(5)))
    scheduler.hotSwapChild("a", fork("a", "goto 1 0\nwait 1"))
    assert.deepEqual(nz(old.batch.rebase.position), [1, 0, 0])

    scheduler.hotSwapChild("b", fork("b", "goto 9 0\nwait 1"))
    const next = scheduler.root.children.get("b")
    assert.equal(old.done, true)
    assert.equal(next.batch.rebase, undefined, "a fresh run carries no stale rebase")
    const oldBatch = old.batch
    const nextBatch = next.batch

    drive(scheduler)
    assert.deepEqual(nz(nextBatch.transform.position), [9, 0, 0], "the replacement ran its own program")
    assert.deepEqual(nz(oldBatch.transform.position), [0, 0, 0], "the old run never moved")
})
