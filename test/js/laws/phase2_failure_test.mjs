// Phase 2c — failure and repair: an obstruction is visible, local and repairable.
// (id:laws-build-p2c, id:laws-activation-verdicts)
// Run: node --test test/js/laws/phase2_failure_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const pos = (f) => frameWorldTransform(f).position.map((n) => +n.toFixed(6))
const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const source = (body) => "let A\nlet B\n" + body

test("acceptance: pinning over a distance is a located obstruction, no lie", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\n  wait 1\n  let A = origin\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    assert.equal(B.error?.kind, "obstructed", "the conflicting statement faults this body")
    assert.deepEqual(pos(A), [5, 0, 0], "the last accepted prefix stands, not a broken pin")
    assert.equal(scheduler.laws.active().length, 1, "the failed pin is not stored")
    assert.equal(scheduler.laws.active()[0].feature, "distance")
})

test("acceptance: a distance over a pin is a located obstruction, no lie", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A = origin\n  wait 1\n  let A.distance = 5\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    assert.equal(B.error?.kind, "obstructed")
    assert.deepEqual(pos(A), [0, 0, 0], "A stays at the pinned accepted position")
    assert.equal(scheduler.laws.active().length, 1)
    assert.equal(scheduler.laws.active()[0].feature, "position")
})

test("acceptance: an unrelated point keeps moving beside the faulted pair", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet B\nlet C\nas B do\n  let A.distance = 5\n  let A = origin\nend"))
    drive(scheduler)
    const C = host.children.get("C")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(C, { rotation: C.transform.deref().rotation,
        position: [3, 0, 0] }, revision).kind, "accept", "no whole-canvas freeze")
    assert.deepEqual(pos(C), [3, 0, 0])
})

test("acceptance: removing the declaring scope releases the law", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as s do",
        "  let A.distance = 5",
        "end",
        "wait 1",
        "as s do",       // rewired without the relation: its site is gone
        "end",
    ].join("\n")))
    drive(scheduler)
    const A = host.children.get("A")
    assert.deepEqual(pos(A), [5, 0, 0], "the realized position stands on removal")
    assert.equal(scheduler.laws.active().length, 0, "the scope's law was retracted")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
        position: [20, 0, 0] }, revision).kind, "accept", "the hold is released")
    assert.deepEqual(pos(A), [20, 0, 0])
})

test("acceptance: a being act that would break a law faults, not lies", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as B do",
        "  let A.distance = 5",
        "end",
        "goto 100 0",
        "let A",          // re-reach adopts the host's [100,0,0], which breaks |AB|=5
    ].join("\n")))
    drive(scheduler)
    const A = host.children.get("A")
    assert.equal(host.error?.kind, "obstructed")
    assert.deepEqual(pos(A), [5, 0, 0], "the law held; A never moved")
    assert.equal(scheduler.laws.active().length, 1)
})
