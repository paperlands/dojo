// What a read reports about what it REACHED. The evaluator's record is a reference, never a
// spelling: a dotted read names the frame it resolved, so reaching that frame is the fact.
//
// Characterization of the reporting rule (id:laws-dependency-driven-place): `reads.frames` carries
// the reached frames and `reads.live` marks that a frame-touching read happened. A read that reaches
// its frame and then fails on the PROPERTY still records the frame — the property is the read's
// business, the reached frame is the dependency. (Measured before the rule moved: the record was
// written at the door after success, so that failure recorded nothing.)
//
// Run: node --test test/js/runtime/dependency_record_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "../laws/harness.mjs"

const reading = () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let B\nwait 1"))
    drive(scheduler)
    const evaluator = host.deps.mathEvaluator
    return { host, B: host.children.get("B"), evaluator, reads: evaluator.beginReads() }
}
// The record holds the FRAME, by identity — not a name that could resolve again to something else.
const reached = (reads) => [...reads.frames]

test("a successful read records the frame it reached", () => {
    const { B, evaluator, reads } = reading()
    evaluator.resolveExternal("B.x")
    assert.equal(reads.live, true, "a frame-touching read is a live read")
    assert.deepEqual(reached(reads), [B], "the reached frame, by identity")
})

test("a read that reaches its frame and fails the property still records that frame", () => {
    const { B, evaluator, reads } = reading()
    assert.throws(() => evaluator.resolveExternal("B.noSuchProperty"), /Undefined property/)
    assert.deepEqual(reached(reads), [B], "reaching B is what the record is about")
})
