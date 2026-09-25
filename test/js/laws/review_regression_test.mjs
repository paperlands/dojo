// Review regressions: the eight findings of the ordered-law review.
//
// Each witness is the smallest world that made the finding true. They fence the
// transition boundary — bind → propose → validate all surviving truths → commit
// → notify — so no motion path, birth or declaration runs its own legality rule.
//
// Run: node --test test/js/laws/review_regression_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive, delayedResponder, settle } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { reparseProgram } from "../../../assets/js/turtling/parse.js"
import { exposed } from "../../../assets/js/turtling/laws/batch.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const pos = (frame) => frame.transform.deref().position.map((n) => +n.toFixed(6))
const world = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(6))
const dist = (a, b) => Math.hypot(...world(a).map((n, i) => n - world(b)[i]))

// 1. Source-active laws govern every motion path.
test("P1.1 ordinary program motion obeys an active law with no responder", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet B\nas B do\n  let A.distance = 5\n  fw 100\nend"))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    assert.equal(B.error, null, "a refusal is not a wound")
    assert.equal(dist(A, B).toFixed(6), "5.000000", "the law held")
    assert.deepEqual(world(B), [0, 0, 0], "the step was refused, so B did not move")
})

test("P1.1 the Promise admission path obeys the law too", async () => {
    const responder = delayedResponder()
    const scheduler = buildWorld({ admitAsync: responder.admit })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet B\nas B do\n  let A.distance = 5\n  fw 100\nend"))
    const B = find(host, "B")
    drive(scheduler, { maxTicks: 2 })
    assert.equal(B.suspension?.kind, "admission", "the walker parked for the reply")
    responder.calls[0].resolve({ accepted: true, transform: { rotation: B.transform.deref().rotation, position: [100, 0, 0] } })
    await settle()
    drive(scheduler)
    assert.equal(B.error, null, "a refused delayed move is not a wound")
    assert.equal(dist(find(host, "A"), B).toFixed(6), "5.000000", "the delayed reply obeyed the law")
})

// 2. Every surviving predicate is validated before publication; a connected
//    component reconfigures jointly, so a second declaration is not a lie.
test("P1.2 a second declaration reconfigures the component, never a lie", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as B do",
        "  let A.distance = 5",
        "end",
        "as C do",
        "  let A.distance = 10",
        "end",
    ].join("\n")))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    const C = find(host, "C")
    assert.equal(C.error, null, "the connected component is solved, not faulted")
    assert.equal(scheduler.laws.active().length, 2, "both addresses are active")
    assert.equal(dist(A, B).toFixed(6), "5.000000", "the first law still holds")
    assert.equal(dist(A, C).toFixed(6), "10.000000", "the second law holds")
})

test("P1.2 a re-reached let does not move a pinned point", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet A = origin\nfw 10\nlet A"))
    drive(scheduler)
    const A = find(host, "A")
    assert.deepEqual(world(A), [0, 0, 0], "the pin held through the being act")
})

// 3. Coordinate frames are bound once.
// 3. Running members cannot be corrected: the settled-only capability gate.
test("P3 a law revision that would correct a running member is refused, not rebased", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as A do",
        "  wait 5",
        "end",
        "as B do",
        "  let A.distance = 5",
        "end",
    ].join("\n")))
    // B faults during the seat drain, while A is still waiting.
    const A = find(host, "A")
    const B = find(host, "B")
    assert.equal(A.done, false, "A is a running member")
    assert.equal(B.error?.kind, "unsupported", "the correction is a gated capability")
    assert.match(B.error?.message ?? "", /running member/, "the refusal is located")
    assert.equal(scheduler.laws.active().length, 0, "no law was installed")
})

test("P1.3 a child born through `as` revises to the walk's here, not double-counted", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "fw 10\nas A do\n  fw 1\nend\nwait 1\nfw 10\nlet A"))
    drive(scheduler)
    const A = find(host, "A")
    assert.deepEqual(world(A), [20, 0, 0], "the being act lands at the parent, once")
})

test("P1.3 a pin is realized and checked in the frame it was authored in", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "goto 10 0",
        "as B do",
        "  let A = origin",
        "end",
    ].join("\n")))
    drive(scheduler)
    const A = find(host, "A")
    assert.deepEqual(world(A), [10, 0, 0], "the pin realized A at B's origin")
    const revision = scheduler.motionRevision
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
        position: [10, 0, 0] }, revision)
    assert.equal(r.kind, "accept", "a request that leaves A exactly on the pin is admitted")
})

// 4. Publication is law/geometry atomic and display-complete.
test("P1.4 geometry and law are never seen mixed by a watcher", () => {
    const scheduler = buildWorld({})
    const samples = []
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as B do",
        "  let A.distance = 5",
        "  wait 1",
        "  let A.distance = 10",
        "end",
    ].join("\n")))
    const A = find(host, "A")
    const B = find(host, "B")
    A.transform.watch("review-probe", () => {
        const law = scheduler.laws.active().find((l) => l.feature === "distance")
        if (law) samples.push({ d: dist(A, B), want: law.predicate })
    })
    drive(scheduler)
    assert.ok(samples.length > 0, "the watcher saw the commit")
    for (const s of samples) {
        assert.equal(s.d.toFixed(6), Number(s.want).toFixed(6), "the law beside the geometry is the new one")
    }
})

test("P1.4 a law that moves a finished headed point refreshes its head", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as A do",
        "  wait 1",
        "end",
        "wait 2",
        "as B do",
        "  let A.distance = 1",
        "end",
    ].join("\n")))
    drive(scheduler)
    const A = find(host, "A")
    assert.equal(A.done, true, "A's body finished")
    assert.ok(A.sync.head, "the law commit refreshed A's display projection")
})

// 6. "Declared" is not "reached".
test("P1.6 a later let does not expose a point while execution still waits", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "as A do\n  wait 1\nend\nwait 5\nlet A"))
    const A = find(host, "A")
    assert.equal(A !== null, true, "A exists as an ambient")
    assert.equal(host.declared.has("A"), true, "the parse names it")
    assert.equal(exposed(A), false, "but the walk has not reached its declaration")
    drive(scheduler)
    assert.equal(exposed(A), true, "after the reach it is exposed")
})

// 5. Editing lifetime, narrowed: a relationship-only edit is a fresh play until
// per-statement ownership survives a reparse. The witness makes the contract explicit
// instead of claiming a hot delete that does not exist.
test("P5 a relationship-only edit is a fresh play, not a hot delete", () => {
    const src = "let A\nas B do\n  let A.distance = 5\n  wait 1\n  let A.distance = 10\nend"
    const scheduler = buildWorld({})
    const spec = fork("host", src)
    const host = scheduler.hotSwapChild("host", spec)
    drive(scheduler)
    assert.equal(scheduler.laws.active()[0].predicate, 10, "the override is active")

    const edited = reparseProgram(src.replace("\n  let A.distance = 10", ""), src, spec.code.ast)
    const next = scheduler.hotSwapChild("host", { ...spec, code: { ...spec.code, ast: edited } })
    drive(scheduler)
    assert.notEqual(next, host, "the edit is a new seat, not a revision of the old one")
    assert.equal(scheduler.laws.active()[0].predicate, 5,
        "the fresh play re-encounters the earlier statement; it is not a hidden stack of laws")
})

// 3b. A pin names the declaring scope's stable placement frame, never its live head.
test("P3 a pin is authored in the placement frame, not the live head", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nas B do\n  let A = origin\n  fw 10\nend"))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    assert.equal(B.error, null, "the placement frame does not move with the head")
    assert.deepEqual(world(A), [0, 0, 0], "A stays at B's placement origin")
    assert.deepEqual(world(B), [10, 0, 0], "B's head walks; the pin does not chase it")
})

test("P3 a pin authored after the head walked still names the placement origin", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nas B do\n  fw 10\n  let A = origin\nend"))
    drive(scheduler)
    const A = find(host, "A")
    assert.deepEqual(world(A), [0, 0, 0],
        "the live head at 10 must not change what `origin` names")
})

// 7b. An early proposal failure must hold its component too.
test("P7 an incompatible pin holds the component even when PROPOSE refuses first", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A",
        "as B do",
        "  let A.distance = 5",
        "end",
        "as C do",
        "  let A = [1, 0, 0]",
        "end",
    ].join("\n")))
    drive(scheduler)
    const A = find(host, "A")
    const C = find(host, "C")
    assert.equal(C.error?.kind, "obstructed", "the pin conflicts with the distance")
    assert.ok(A.held, "the early proposal failure still holds A")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
        position: [0, 5, 0] }, revision).kind, "refuse", "no drag around the sphere while held")
})
