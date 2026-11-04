// Phase 3, first increment — two connected distances respond to one requested
// change; an unrelated point stays still. (id:laws-build-p3, id:laws-build-solve-seam)
//
// The boundary is settled configurations, discrete ink-free reconfiguration. One
// bound law, the affected component derived from its endpoints, a joint candidate
// over the component, validated and published together.
//
// Run: node --test test/js/laws/phase3_component_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, resolveBinding } from "../../../assets/js/turtling/scheduler.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const world = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(6))
const dist = (a, b) => Math.hypot(...world(a).map((n, i) => n - world(b)[i]))

// A is the held anchor. L1 (A—B) is revised 5 → 10; L2 (B—C) shares B. D is
// unrelated. a begins at 0, B at 5, C at 0, so the original B→C direction is -x.
const CHAIN = [
    "let A",
    "let B",
    "let C",
    "let D",
    "as A do",
    "  let B.distance = 5",
    "  wait 1",
    "  let B.distance = 10",
    "end",
    "as B do",
    "  let C.distance = 5",
    "end",
].join("\n")

test("acceptance: two connected distances respond to one revision; an unrelated point stays", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", CHAIN))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    const C = find(host, "C")
    const D = find(host, "D")

    assert.equal(A.error, null, "the revision is accepted, not a contradiction")
    assert.deepEqual(world(A), [0, 0, 0], "the declaring frame is the held anchor")
    assert.deepEqual(world(B), [10, 0, 0], "the revised law moved its endpoint")
    assert.deepEqual(world(C), [5, 0, 0], "the connected law moved its endpoint too")
    assert.deepEqual(world(D), [0, 0, 0], "the unrelated point never moved")
})

test("acceptance: the joint candidate satisfies every distance in the component", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", CHAIN))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    const C = find(host, "C")
    assert.equal(dist(A, B).toFixed(6), "10.000000", "the revised law holds")
    assert.equal(dist(B, C).toFixed(6), "5.000000", "the connected law still holds")
    const predicates = scheduler.laws.active().map((l) => l.predicate).sort((a, b) => b - a)
    assert.deepEqual(predicates, [10, 5], "one address revised, the other untouched")
})

test("acceptance: discrete revision inks nothing — no connector stroke", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", CHAIN))
    const trace = drive(scheduler)
    const paths = [...trace.values()].flat().filter((e) => e.type === "path")
    assert.deepEqual(paths, [], "a law revision draws no ink")
})

// The watcher must see the whole joint commit, not a half-update with correct
// final coordinates. swapDeferred installs every pose before any notify fires,
// and the law install precedes the fan. (id:laws-build-solve-seam)
test("watcher: the joint revision is seen with B, C and the new owner together", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", CHAIN))
    const B = find(host, "B")
    const C = find(host, "C")
    const seen = []
    const probe = () => {
        const law = scheduler.laws.active().find((l) => l.feature === "distance" && l.predicate === 10)
        seen.push({ b: world(B), c: world(C), owner: law?.owner?.line ?? null })
    }
    B.transform.watch("review-watcher", probe)
    C.transform.watch("review-watcher", probe)
    drive(scheduler)
    const moved = seen.filter((s) => s.b[0] === 10)
    assert.ok(moved.length > 0, "the watcher saw the revised pose")
    for (const s of moved) {
        assert.deepEqual(s.c, [5, 0, 0], "C is already at its joint pose, never a half-update")
        assert.equal(s.owner, 8, "the law owner is the revision's statement")
    }
})

// One scalar payload: the value is not part of the address, so a revision
// replaces in place and the bound kind and guard survive. (id:laws-build-p3a)
const PAYLOAD = "let A\nas B do\n  let A.distance = 5\n  wait 1\n  let A.distance = 10\nend"

test("store: revising the one scalar payload keeps one address and owner", () => {
    const scheduler = buildWorld({})
    scheduler.hotSwapChild("host", fork("host", PAYLOAD))
    drive(scheduler)
    const active = scheduler.laws.active()
    assert.equal(active.length, 1, "one address, revised in place")
    assert.equal(active[0].predicate, 10, "the later value is the accepted payload")
    assert.equal(active[0].kind, "length", "the payload kind survives lowering")
    assert.deepEqual(active[0].guards, { finite: true, nonNegative: true }, "the domain guard is bound, not re-derived")
    assert.equal(active[0].owner?.line, 5, "the later statement owns the address")
})

// The collapse, on a reconfigured component: the evaluator's reads and the
// active laws are the same measurement. (id:eval-relational)
test("coherence: after the joint revision, reads and laws agree", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", CHAIN))
    drive(scheduler)
    const B = find(host, "B")
    const C = find(host, "C")
    assert.equal(resolveBinding(B, "A.distance"), 10, "the revised law, read from B")
    assert.equal(resolveBinding(C, "B.distance"), 5, "the connected law, read from C")
})
