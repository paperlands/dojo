// Phase 2b — one distance relation: realize, revise, read, and refuse the lie.
// (id:laws-build-p2b, id:laws-ordered-replacement, id:laws-activated-order)
// Run: node --test test/js/laws/phase2_distance_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, resolveBinding } from "../../../assets/js/turtling/scheduler.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const pos = (f) => frameWorldTransform(f).position.map((n) => +n.toFixed(6))
const dist = (a, b) => Math.hypot(...pos(a).map((n, i) => n - pos(b)[i]))
const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const source = (body) => "let A\nlet B\n" + body

test("acceptance: `let A.distance = 5` realizes one law", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    assert.equal(host.error, null)
    assert.deepEqual(pos(A), [5, 0, 0], "A realized five from B (coincident → +x)")
    assert.equal(scheduler.laws.active().length, 1)
    assert.equal(scheduler.laws.active()[0].predicate, 5)
    assert.equal(scheduler.laws.active()[0].feature, "distance")
})

test("acceptance: revising the same distance address replaces, not conjoins", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\n  wait 1\n  let A.distance = 10\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    assert.deepEqual(pos(A), [10, 0, 0], "the later reach revised the law")
    assert.equal(scheduler.laws.active().length, 1, "one address, one law")
    assert.equal(scheduler.laws.active()[0].predicate, 10)
})

test("acceptance: a read sees the realized A.x/A.y/A.z", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as m do\n  wait 1\nend\nas B do\n  let A.distance = 5\nend")))
    drive(scheduler)
    const m = find(host, "m")
    assert.equal(resolveBinding(m, "A.x"), 5, "A.x is the realized accepted x")
    assert.equal(resolveBinding(m, "A.y"), 0)
    assert.equal(resolveBinding(m, "A.z"), 0)
})

test("acceptance: a hand move is projected onto the law, not refused", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    const revision = scheduler.motionRevision
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
        position: [20, 0, 0] }, revision)
    assert.equal(r.kind, "accept", "continuation, not refusal")
    assert.deepEqual(pos(A), [5, 0, 0], "the radial push is absorbed")
    assert.equal(dist(A, B).toFixed(6), "5.000000")
    assert.deepEqual(pos(B), [0, 0, 0], "the untouched endpoint stayed")
})

test("acceptance: a request that keeps the law is admitted", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
        position: [0, 5, 0] }, revision).kind, "accept", "five stays five")
    assert.deepEqual(pos(A), [0, 5, 0])
})

test("acceptance: an authored step that would break the law is refused", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\n  fw 100\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    assert.equal(B.error, null, "a refusal is not a wound")
    assert.equal(dist(A, B).toFixed(6), "5.000000", "the law held")
    assert.deepEqual(pos(B), [0, 0, 0], "B's step was refused, so B did not move")
})

test("acceptance: a negative distance is a located relation fault", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = -5\nend")))
    drive(scheduler)
    const B = host.children.get("B")
    assert.equal(B.error?.kind, "relation")
    assert.match(B.error?.message ?? "", /distance/)
})

test("acceptance: a relation never introduces a missing endpoint", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "as B do\n  let C.distance = 5\nend"))
    drive(scheduler)
    assert.equal(find(host, "C"), null, "no C was created")
    assert.equal(find(host, "B").error?.kind, "relation")
    assert.match(find(host, "B").error?.message ?? "", /Unknown target: C/)
})

// Phase 2d — the hand's policy: hand-first, conserving untouched points.
// (id:laws-build-p2d)

test("acceptance: a tangential drag follows the circle", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
        position: [5, 5, 0] }, revision).kind, "accept")
    assert.equal(dist(A, B).toFixed(6), "5.000000", "the law held")
    assert.ok(pos(A)[1] > 1, "A moved tangentially")
    assert.deepEqual(pos(B), [0, 0, 0], "B stayed")
})

test("acceptance: an admissible target is kept exactly", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
        position: [0, 5, 0] }, revision).kind, "accept")
    assert.deepEqual(pos(A), [0, 5, 0], "already on the circle: no projection")
})

test("acceptance: zero radius pins A to B through a drag", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 0\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    assert.equal(dist(A, B).toFixed(6), "0.000000")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
        position: [5, 0, 0] }, revision).kind, "accept")
    assert.deepEqual(pos(A), [0, 0, 0], "a zero radius projects everything back to B")
})

test("acceptance: the accepted path keeps the residual at zero", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source(
        "as B do\n  let A.distance = 5\nend")))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    for (const target of [[8, 0, 0], [5, 3, 0], [0, 7, 0], [-4, -3, 0], [3, 4, 0.5]]) {
        const revision = scheduler.motionRevision
        assert.equal(scheduler.requestMotion(A, { rotation: A.transform.deref().rotation,
            position: target }, revision).kind, "accept")
        assert.equal(+dist(A, B).toFixed(6), 5, `residual after ${target}`)
    }
    assert.deepEqual(pos(B), [0, 0, 0], "the untouched endpoint never moved")
})
