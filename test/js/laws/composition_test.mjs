// Step 3 — one shared solve question across relationships, proven through the hand.
// (id:laws-free-relations-contract, D058)
//
// A bearing and a distance over one point compose: the relationship is the authority,
// the frame supplies measurement context (never extra movement permission). Both
// predicates stay independently measurable, either reach order is lawful, and a hand
// request is answered by the shared question, not by a second solver.
// Run: node --test test/js/laws/composition_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { measure } from "../../../assets/js/turtling/laws/relations.js"
import { validityDependents } from "../../../assets/js/turtling/laws/component.js"
import { AUTHORED } from "../../../assets/js/turtling/laws/authored.js"
import { buildWorld, fork, drive } from "./harness.mjs"

const DIST_THEN_BEAR = "let O = origin\nlet A\nlet distance(A,O) = 5\nlet A.bearing = 30"
const BEAR_THEN_DIST = "let O = origin\nlet A\nlet A.bearing = 30\nlet distance(A,O) = 5"

const read = (frame) => {
    const t = frameWorldTransform(frame)
    return { position: t.position, rotation: t.rotation }
}
const distanceAO = (A, O) => measure("distance", A, O, read)
const bearingA = (A, host) => measure("bearing", A, host, read)
const near = (got, want, why) => assert.ok(Math.abs(got - want) < 1e-6, `${why}: got ${got}, want ${want}`)
const pos = (f) => f ? frameWorldTransform(f).position.map((n) => +n.toFixed(4)) : null

function seat(source, origin = SE3.identity(), options = {}) {
    const scheduler = buildWorld(options)
    const host = scheduler.hotSwapChild("host", fork("host", source, origin))
    drive(scheduler)
    return { scheduler, host, O: host.children.get("O"), A: host.children.get("A") }
}
const features = (scheduler) => scheduler.laws.active().map((l) => l.feature).sort()
const request = (scheduler, A, to) => scheduler.requestMotion(A,
    { rotation: frameWorldTransform(A).rotation, position: to }, scheduler.motionRevision, "world")

test("S3: a distance and a bearing over one point hold together, in either reach order", () => {
    for (const source of [DIST_THEN_BEAR, BEAR_THEN_DIST]) {
        const { scheduler, host, O, A } = seat(source)
        assert.equal(host.error, null, source)
        assert.equal(host.unresolved, null, source)
        assert.deepEqual(features(scheduler), ["bearing", "distance", "position"], source)
        near(distanceAO(A, O), 5, "the distance holds")
        near(bearingA(A, host), 30, "the bearing holds")
        assert.deepEqual(pos(O), [0, 0, 0], "O stays at the frame origin")
    }
})

test("S3: the known-supported hand request is accepted by the shared question", () => {
    const { scheduler, host, O, A } = seat(DIST_THEN_BEAR)
    const r = request(scheduler, A, [10, 0, 0])
    assert.equal(r.kind, "accept", "a supported request is answered, not refused")
    near(distanceAO(A, O), 5, "the accepted position satisfies the distance")
    near(bearingA(A, host), 30, "the accepted position satisfies the bearing")
})

test("S3: the frame supplies measurement context, never movement permission", () => {
    const { scheduler, host, O, A } = seat(DIST_THEN_BEAR)
    const beforeO = pos(O)
    request(scheduler, A, [9, 9, 0])
    assert.deepEqual(pos(O), beforeO, "O does not move under an A request")
    const active = scheduler.laws.active()
    const byPlacement = validityDependents(active, [{ id: host.id, aspect: "placement" }])
    assert.ok(byPlacement.some((l) => l.feature === "bearing"), "the bearing reads F's placement")
    for (const law of active) {
        assert.ok(!law.endpoints.includes(host.id), "the frame is in no solve closure")
    }
})

test("S3: an actual placement change rechecks the relationship; the live head is not substituted", () => {
    const scheduler = buildWorld()
    const identity = SE3.identity()
    const first = scheduler.hotSwapChild("host", fork("host", DIST_THEN_BEAR, identity))
    drive(scheduler)
    const beforeA = pos(first.children.get("A"))
    const turned = { position: [0, 0, 0], rotation: SE3.rotateLocal(identity, { x: 0, y: 0, z: 1 }, 90).rotation }
    const host = scheduler.hotSwapChild("host", fork("host", DIST_THEN_BEAR, turned))
    drive(scheduler)
    const A = host.children.get("A"), O = host.children.get("O")
    assert.notDeepEqual(pos(A), beforeA, "the placement moved the reading")
    near(distanceAO(A, O), 5, "the distance still holds under the new placement")
    near(bearingA(A, host), 30, "the bearing still holds under the new placement")
    assert.deepEqual(validityDependents(scheduler.laws.active(), [{ id: host.id, aspect: "position" }])
        .filter((l) => l.feature === "bearing"), [])
})

test("S3: an admission refusal retains both obligations and mutates nothing", () => {
    // A responder that declines: this is admission refusal, not a geometric reduction.
    const { scheduler, A } = seat(DIST_THEN_BEAR, SE3.identity(),
        { admit: () => ({ accepted: false, reason: "cannot place" }) })
    const beforeA = pos(A)
    const r = request(scheduler, A, [4, 4, 0])
    assert.notEqual(r.kind, "accept", "an admission refusal is not an accepted answer")
    assert.deepEqual(pos(A), beforeA, "no mutation on an admission refusal")
    assert.deepEqual(features(scheduler), ["bearing", "distance", "position"], "both obligations are retained")
})

test("S3: an unsupported geometric reduction retains both obligations and mutates nothing", () => {
    // The bearing has no named locus, so the hand's shared reduction cannot be formed.
    // This is a geometric unsupported, distinct from an admission refusal.
    const { scheduler, O, A } = seat(DIST_THEN_BEAR)
    const beforeA = pos(A)
    const originalSet = AUTHORED.bearing.set
    AUTHORED.bearing.set = () => null
    try {
        const r = request(scheduler, A, [10, 0, 0])
        assert.notEqual(r.kind, "accept", "no supported reduction is offered")
        assert.deepEqual(pos(A), beforeA, "no mutation on an unsupported reduction")
        assert.deepEqual(features(scheduler), ["bearing", "distance", "position"], "both obligations are retained")
        near(distanceAO(A, O), 5, "the accepted distance prefix stands")
    } finally { AUTHORED.bearing.set = originalSet }
})
