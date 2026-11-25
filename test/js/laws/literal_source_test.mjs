// Earned witnesses for a literal centre in source. (id:laws-distance-literal-address)
//
// The address identifies which relationship is revised; the predicate states what must
// hold; bounded methods decide whether we can realize it. Keep them separate.
// Run: node --test test/js/laws/literal_source_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { validityDependents } from "../../../assets/js/turtling/laws/component.js"
import { buildWorld, fork, drive } from "./harness.mjs"

const pos = (f) => (f ? frameWorldTransform(f).position.map((n) => +n.toFixed(4)) : null)
const features = (scheduler) => scheduler.laws.active().map((l) => l.feature).sort()
const run = (source, origin = SE3.identity()) => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", source, origin))
    drive(scheduler)
    return { scheduler, host, A: host.children.get("A"), B: host.children.get("B") }
}
const distanceLaws = (scheduler) => scheduler.laws.active().filter((l) => l.feature === "distance")

test("literal source 1: A reaches the framed origin; no extra identity or position law", () => {
    const { scheduler, host, A } = run("let A\nlet distance(A, origin) = 5")
    assert.equal(host.error, null)
    assert.equal(host.unresolved, null)
    assert.deepEqual([...host.children.keys()], ["A"], "no synthetic identity")
    assert.deepEqual(features(scheduler), ["distance"], "no position law is installed")
    assert.deepEqual(pos(A), [5, 0, 0], "A is five from the framed origin")
})

test("literal source 2: a second declaration revises the one law at its address", () => {
    const { scheduler, A } = run("let A\nlet distance(A, origin) = 5\nlet distance(A, origin) = 10")
    const laws = distanceLaws(scheduler)
    assert.equal(laws.length, 1, "one relationship")
    assert.equal(laws[0].expression.radius, 10)
    assert.equal(laws[0].owner.line, 3, "the latest accepted owner")
    assert.deepEqual(pos(A), [10, 0, 0])
})

test("literal source 3: a revision replaces only A–origin; the others remain", () => {
    const { scheduler, host, A } = run("let A\nlet distance(A, origin) = 5\nlet A.bearing = 30\nlet distance(A, origin) = 10")
    assert.equal(host.error, null)
    const laws = distanceLaws(scheduler)
    assert.equal(laws.length, 1, "one distance obligation")
    assert.equal(laws[0].expression.radius, 10, "revised")
    assert.equal(scheduler.laws.active().filter((l) => l.feature === "bearing").length, 1, "the bearing remains")
    const at = frameWorldTransform(A).position
    assert.ok(Math.abs(Math.hypot(...at) - 10) < 1e-6)
})

test("literal source 3b: a pin obstruction refuses the revision atomically", () => {
    // The prefix is lawful: A is pinned exactly on its sphere. The revision then
    // conflicts with the pin, so the failed reach is the FOURTH line, not the pin.
    const { scheduler, host, A } = run("let A\nlet distance(A, origin) = 5\nlet A.position = (5,0,0)\nlet distance(A, origin) = 10")
    assert.ok(host.error, "the revision conflicts with the retained pin and is refused")
    const law = distanceLaws(scheduler)[0]
    assert.equal(law.expression.radius, 5, "the accepted radius stands")
    assert.equal(law.owner.line, 2, "the accepted owner stands")
    assert.deepEqual(pos(A), [5, 0, 0], "no partial mutation")
})

test("literal source 4: two literal centres retain two obligations", () => {
    const shared = run("let A\nlet distance(A, origin) = 5\nlet distance(A, (10,0,0)) = 5")
    assert.equal(shared.host.error, null)
    const laws = distanceLaws(shared.scheduler)
    assert.equal(laws.length, 2, "two distinct addresses conjoin")
    assert.notEqual(laws[0].address, laws[1].address)
    assert.deepEqual(pos(shared.A), [5, 0, 0], "a shared configuration satisfies both")
    const split = run("let A\nlet B\nlet distance(A, origin) = 5\nlet distance(B, (1,1)) = 5")
    assert.equal(distanceLaws(split.scheduler).length, 2, "independent centres, independent obligations")
})

test("literal source 5: a known-supported hand request accepts, preserving the predicate", () => {
    const { scheduler, A } = run("let A\nlet distance(A, origin) = 5")
    const r = scheduler.requestMotion(A, { rotation: frameWorldTransform(A).rotation, position: [10, 0, 0] },
        scheduler.motionRevision, "world")
    assert.equal(r.kind, "accept")
    const at = frameWorldTransform(A).position
    assert.ok(Math.abs(Math.hypot(...at) - 5) < 1e-6, "A stays on the sphere about the framed origin")
})

test("literal source 6: a fixed numeric centre depends on neither owner placement nor its live head", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet distance(A, origin) = 5"))
    drive(scheduler)
    const law = distanceLaws(scheduler)[0]
    assert.deepEqual(validityDependents([law], [{ id: host.id, aspect: "placement" }]), [])
    assert.deepEqual(validityDependents([law], [{ id: host.id, aspect: "position" }]), [],
        "walking F's head is not a placement read")
    const turned = { position: [10, 0, 0], rotation: SE3.rotateLocal(SE3.identity(), { x: 0, y: 0, z: 1 }, 90).rotation }
    const moved = scheduler.hotSwapChild("host", fork("host", "let A\nlet distance(A, origin) = 5", turned))
    drive(scheduler)
    const at = frameWorldTransform(moved.children.get("A")).position
    assert.ok(Math.abs(Math.hypot(...at) - 5) < 1e-6, "five from the same world origin")
})

test("literal source 7: replacement, deletion and fresh play leave no stale obligation", () => {
    const { scheduler, host } = run("let A\nlet distance(A, origin) = 5")
    assert.equal(distanceLaws(scheduler).length, 1)
    // Replacement: a fresh source without the relationship drops it.
    scheduler.hotSwapChild("host", fork("host", "let A"))
    drive(scheduler)
    assert.equal(scheduler.laws.count(), 0, "the relationship did not outlive its source")
    // Deletion: removing the scope retracts everything it declared.
    scheduler.hotSwapChild("host", fork("host", "let A\nlet distance(A, origin) = 5"))
    drive(scheduler)
    assert.equal(distanceLaws(scheduler).length, 1)
    scheduler.removeChild("host")
    assert.equal(scheduler.laws.count(), 0, "no stale obligation after deletion")
    void host
})

test("literal source 8: distance zero fixes A to the framed value, inventing nothing", () => {
    const { scheduler, host, A } = run("let A\nlet distance(A, origin) = 0")
    assert.equal(host.error, null)
    assert.deepEqual(features(scheduler), ["distance"], "no pin record, no position law")
    assert.deepEqual([...host.children.keys()], ["A"], "no invented identity")
    assert.deepEqual(pos(A), [0, 0, 0], "A coincides with the framed value")
})

test("literal source 9: either input order installs and answers the hand", () => {
    for (const source of ["let A\nlet distance(A, origin) = 5", "let A\nlet distance(origin, A) = 5"]) {
        const { scheduler, host, A } = run(source)
        assert.equal(host.error, null, source)
        assert.equal(host.unresolved, null, source)
        assert.deepEqual(pos(A), [5, 0, 0], source)
        const r = scheduler.requestMotion(A, { rotation: frameWorldTransform(A).rotation, position: [10, 0, 0] },
            scheduler.motionRevision, "world")
        assert.equal(r.kind, "accept", source)
        assert.ok(Math.abs(Math.hypot(...frameWorldTransform(A).position) - 5) < 1e-6, source)
    }
})

test("literal source 10: a one-live-input relationship composes with an existing one-point truth", () => {
    const { scheduler, host, A } = run("let A\nlet A.y = 1\nlet distance(A, origin) = 5")
    assert.equal(host.error, null, "the distance joins the coordinate's one-point meet")
    assert.equal(host.unresolved, null)
    assert.deepEqual(features(scheduler), ["coordinate", "distance"])
    const at = frameWorldTransform(A).position
    assert.ok(Math.abs(Math.hypot(...at) - 5) < 1e-6, "the distance holds")
    assert.ok(Math.abs(at[1] - 1) < 1e-6, "the coordinate holds")
})

test("literal source 11: signed coordinates parse; negative zero normalizes", () => {
    const { scheduler, host, A } = run("let A\nlet distance(A, (-2, 0)) = 5")
    assert.equal(host.error, null)
    const centre = distanceLaws(scheduler)[0].expression.references[1].value
    assert.deepEqual(centre, [-2, 0, 0])
    assert.ok(Math.abs(Math.hypot(...frameWorldTransform(A).position.map((x, i) => x - [-2, 0, 0][i])) - 5) < 1e-6)
    const nz = run("let A\nlet distance(A, (-0, -0)) = 5")
    assert.ok(distanceLaws(nz.scheduler)[0].expression.references[1].value.every((c) => Object.is(c, 0)),
        "negative zero normalizes to zero")
})
