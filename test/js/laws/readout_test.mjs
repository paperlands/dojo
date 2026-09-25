// Derived values: recomputed once at the commit, source-owned, with early cutoff.
// No reactive runtime and no command replay. (id:laws-build-p3-slider)
//
// Run: node --test test/js/laws/readout_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, resolveBinding } from "../../../assets/js/turtling/scheduler.js"
import { createReadouts } from "../../../assets/js/turtling/laws/readout.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const drag = (scheduler, frame, x) => scheduler.requestMotion(frame,
    { rotation: frame.transform.deref().rotation, position: [x, 0, 0] }, scheduler.motionRevision).kind

test("store: an unchanged value is not re-announced; a source release takes its nodes", () => {
    const store = createReadouts()
    const seen = []
    store.watch((change) => seen.push(change.value))

    let n = 0
    store.register("source", "site", () => ++n)
    store.recompute({})
    store.recompute({})
    assert.deepEqual(seen, [1, 2], "a computed value is announced each time it changes")

    let fixed = 7
    store.register("stable", "site", () => fixed)
    store.recompute({})
    store.recompute({})
    assert.equal(seen.filter((v) => v === 7).length, 1, "equal value stops propagation")

    assert.equal(store.release("source"), true)
    assert.equal(store.size, 1, "only the other source's node remains")
    assert.equal(store.release("source"), false, "release is idempotent")
})

test("store: a read that cannot answer yet is not a value", () => {
    const store = createReadouts()
    const seen = []
    store.watch((change) => seen.push(change.value))
    store.register("s", "site", () => { throw new Error("not ready") })
    assert.deepEqual(store.recompute({}), [])
    assert.deepEqual(seen, [])
})

const CHAIN = [
    "let A",
    "let D",
    "as B do",
    "  let A.distance = 5",
    "  wait 1",
    "  let A.distance = 10",
    "end",
    "wait 1",
    "as B do",
    "end",
].join("\n")

test("readout: a source-owned value recomputes at the commit and releases with its scope", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", CHAIN))
    const A = find(host, "A")
    const B = find(host, "B")
    const D = find(host, "D")

    const seen = []
    scheduler.readouts.watch((change) => seen.push({
        value: change.value,
        a: frameWorldTransform(A).position[0],
        owner: scheduler.laws.active().find((l) => l.feature === "distance")?.owner?.line ?? null,
    }))
    // The source is B's frame; B's statement owns the derived value.
    scheduler.readouts.register(B.id, "distance", (snapshot) => snapshot.measure("distance", A, B))
    drive(scheduler)

    assert.ok(seen.length >= 1, "the revision announced a value")
    const last = seen.at(-1)
    assert.equal(last.value, 10, "the readout is the accepted distance")
    assert.equal(last.a, 10, "the watcher saw the accepted geometry with the value")
    assert.equal(last.owner, 6, "and the law's owner, not a half-update")

    // The re-entry rewires B: the source is gone, so its derived value goes too.
    assert.equal(scheduler.readouts.size, 0, "the source owned the node and took it away")
    const before = seen.length
    const revision = scheduler.motionRevision
    scheduler.requestMotion(D, { rotation: D.transform.deref().rotation, position: [1, 0, 0] }, revision)
    assert.equal(seen.length, before, "no update after release, even on a later commit")
})

// The source expression: `let s = A.x` introduces one source-owned derived value.
test("express: `let s = A.x` recomputes when the point moves", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\njmp 100\nlet s = A.x\nwait 1"))
    const A = find(host, "A")
    const seen = []
    scheduler.readouts.watch((change) => seen.push(change.value))
    assert.equal(drag(scheduler, A, 7), "accept", "the hand moves A")
    drive(scheduler)
    assert.ok(seen.includes(7), `the live read recomputed from the commit (saw ${seen})`)
})

test("express: the declaring scope owns the readout", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as S do",
        "  let s = A.x",
        "end",
        "wait 1",
        "as S do",
        "end",
    ].join("\n")))
    assert.equal(scheduler.readouts.size, 1, "the live statement registered one node")
    drive(scheduler)
    assert.equal(scheduler.readouts.size, 0, "the re-entry released its source's node")
})

// A loop re-reaches the same statement: one node, updated in place, never a pile.
test("express: a loop re-reaching `let s` updates one node, not many", () => {
    const scheduler = buildWorld({})
    scheduler.hotSwapChild("host", fork("host",
        "let A\njmp 100\nloop 8 do\n  let s = A.x\n  goto A.x\n  wait 1\nend"))
    const A = find(scheduler.root, "A")
    const seen = []
    scheduler.readouts.watch((change) => seen.push(change.value))
    assert.equal(drag(scheduler, A, 7), "accept", "the hand moves A")
    drive(scheduler)
    assert.equal(scheduler.readouts.size, 1, "eight reaches, one source-owned node")
    assert.ok(seen.includes(7), `the readout recomputes on the commit (saw ${seen})`)
    assert.equal(scheduler.laws.active().length, 0, "no law was needed for the readout")
})

// A scalar is a value, not a frame: a read of `s` is the derived value, and a
// one-shot `goto s` uses it. (id:laws-build-p3-readout-built)
test("express: a read of `s` is the derived value and `goto s` uses it", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\njmp 100\nlet s = A.x\nwait 1\ngoto s"))
    const A = find(host, "A")
    assert.equal(resolveBinding(host, "s"), 0, "the scalar reads its declared value")
    assert.equal(drag(scheduler, A, 7), "accept", "the hand moves A")
    assert.equal(resolveBinding(host, "s"), 7, "the scalar follows the accepted state")
    drive(scheduler)
    assert.equal(host.transform.deref().position[0], 7, "goto read the current scalar")
})

// A constraint revision lands at the commit, and the scalar sees the accepted
// geometry in the same publish. (id:laws-build-p3-readout-built)
test("constraint: a law revision propagates to a scalar at the commit", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as B do",
        "  let A.distance = 5",
        "  wait 1",
        "  let A.distance = 10",
        "end",
        "let s = A.x",
    ].join("\n")))
    assert.equal(resolveBinding(host, "s"), 5, "the scalar reads the first accepted geometry")
    drive(scheduler)
    assert.equal(resolveBinding(host, "s"), 10, "the revision propagated to the scalar")
    assert.equal(scheduler.readouts.size, 1, "still one source-owned node")
})
