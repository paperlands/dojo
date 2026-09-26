// One relational surface: measure() is the only definition, and the evaluator's
// read and the law's check agree because they supply the same reading. (id:eval-relational)
// Run: node --test test/js/laws/relations_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { measure, headingOf, elevationOf } from "../../../assets/js/turtling/laws/relations.js"
import { buildWorld, fork, drive } from "./harness.mjs"
import { resolveBinding, frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const identity = { x: 0, y: 0, z: 0, w: 1 }
const readings = (positions, rotations = {}, times = {}) => (frame) => ({
    position: positions[frame],
    rotation: rotations[frame] ?? identity,
    time: times[frame] ?? 0,
})

test("measure: distance reads two positions", () => {
    const read = readings({ a: [0, 0, 0], b: [3, 4, 0] })
    assert.equal(measure("distance", "b", "a", read), 5)
})

test("measure: bearing is the turn to the target, signed by the observer's facing", () => {
    // The compass is the paper's: 0 is +y (north), +x is due east. An identity
    // frame faces +x, so it faces EAST — a target due its nose reads zero turn.
    const ahead = readings({ a: [0, 0, 0], b: [1, 0, 0] })
    assert.equal(measure("bearing", "b", "a", ahead), 0, "due +x is dead ahead when facing east")
    const behind = readings({ a: [0, 0, 0], b: [-1, 0, 0] })
    assert.equal(Math.abs(measure("bearing", "b", "a", behind)), 180, "due west is a half turn, either way")
    // north is to the LEFT of an east-facing observer: 90 west of north, i.e. −90.
    const left = readings({ a: [0, 0, 0], b: [0, 1, 0] })
    assert.equal(measure("bearing", "b", "a", left), -90, "due +y is a quarter turn left")
    // Facing north (a quarter turn left), the same target is dead ahead.
    const facingNorth = readings({ a: [0, 0, 0], b: [0, 1, 0] },
        { a: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } })
    assert.ok(Math.abs(measure("bearing", "b", "a", facingNorth)) < 1e-9, "the observer's facing moves the zero")
})

test("measure: a zero projected direction has no bearing", () => {
    // Coincident endpoints project no direction at all — and atan2(0, 0) is 0, a
    // number, so subtracting the observer's facing turns silence into a turn nobody
    // stated (−90 at identity). Nothing is the honest answer.
    const same = readings({ a: [0, 0, 0], b: [0, 0, 0] })
    assert.equal(measure("bearing", "b", "a", same), null,
        "a target at the observer's own position names no way to turn")
    const overhead = readings({ a: [0, 0, 0], b: [0, 0, 4] })
    assert.equal(measure("bearing", "b", "a", overhead), null,
        "and one straight above projects none — the same rule as a nose at the normal")
    // The rule is zero, not small: a real, if tiny, direction still answers.
    const near = readings({ a: [0, 0, 0], b: [1e-6, 0, 0] })
    assert.equal(measure("bearing", "b", "a", near), 0, "a tiny projection is still a direction")
})

test("measure: sync is signed", () => {
    const read = readings({ a: [0, 0, 0], b: [0, 0, 0] }, {}, { a: 10, b: 7 })
    assert.equal(measure("sync", "b", "a", read), -3, "a target behind the observer is negative")
})

test("the aim readings: heading is the plane compass, elevation the off-plane angle", () => {
    const q = (about, deg) => ({
        ...{ x: 0, y: 0, z: 0, w: 1 },
        [about]: Math.sin(deg * Math.PI / 360),
        w: Math.cos(deg * Math.PI / 360),
    })
    assert.equal(headingOf(q('z', 0)), 90, "identity faces +x, which the compass calls east")
    assert.ok(Math.abs(headingOf(q('z', 90)) - 0) < 1e-9, "a quarter turn left faces north")
    assert.ok(Math.abs(headingOf(q('z', -90)) - 180) < 1e-9, "a quarter turn right faces south")
    assert.equal(headingOf(q('y', 30)), 90, "pitch does not turn you")
    assert.equal(headingOf(q('x', 30)), 90, "roll does not turn you either")
    assert.equal(elevationOf(q('z', 90)), 0, "a plane turn stays on the paper")
    assert.equal(elevationOf(q('x', 30)), 0, "and roll does not lift the nose")
    assert.ok(Math.abs(elevationOf(q('y', 30)) + 30) < 1e-9,
        "the `pitch` command dives, so the reading is the negation of its angle")
    // The pole: the compass has NO bearing, and nothing is its honest answer —
    // while elevation still answers, which is why the pair is never both blind.
    assert.equal(headingOf(q('y', 90)), null, "nose down the normal: no compass bearing")
    assert.equal(headingOf(q('y', -90)), null, "and the same straight up")
    assert.equal(elevationOf(q('y', 90)), -90, "elevation names the pole instead")
    assert.equal(elevationOf(q('y', -90)), 90)
    assert.equal(measure("elevation", "b", "a", readings({ b: [0, 0, 0] })), 0,
        "and it reads through the same one measurement")
})

// The collapse: the evaluator's read is the same measurement the law checks.
const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}

test("coherence: a source read and the active law agree on the distance", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nas B do\n  let A.distance = 5\nend"))
    drive(scheduler)
    const B = find(host, "B")
    assert.equal(scheduler.laws.active()[0].predicate, 5, "the law's value")
    assert.equal(resolveBinding(B, "A.distance"), 5, "the evaluator's read of the same relation")
})

test("a read with no answer is null, and a healthy one still answers", () => {
    // A quarter turn to the right: the compass reads south (180).
    const healthy = buildWorld()
    const walker = healthy.hotSwapChild("host", fork("host", "as A do\n  rt 90\nend"))
    drive(healthy)
    assert.equal(resolveBinding(walker, "A.heading"), 180, "the compass read answers")
    assert.equal(resolveBinding(walker, "A.elevation"), 0, "and so does the elevation")

    // A nose up the paper normal has no compass bearing at all: null, no wound, and
    // the elevation still names the pole — nothing is not the same as no answer.
    const degenerate = buildWorld()
    const host = degenerate.hotSwapChild("host", fork("host", "let A\nas A do\n  pitch 90\nend"))
    drive(degenerate)
    assert.equal(resolveBinding(host, "A.heading"), null, "no bearing is nothing, and that is an answer")
    assert.equal(resolveBinding(host, "A.elevation"), -90, "elevation names which pole")

    // Coincident endpoints: the same nothing through the evaluator's own read. A
    // target at the reader's own position names no direction, so no turn can be
    // named — while its distance is honestly 0. Zero is an answer; nothing is not.
    const together = buildWorld()
    const pair = together.hotSwapChild("host", fork("host", "let A\ngoto 0 0"))
    drive(together)
    assert.equal(resolveBinding(pair, "A.distance"), 0, "the distance to a coincident point answers 0")
    assert.equal(resolveBinding(pair, "A.bearing"), null,
        "a bearing with no projected direction is nothing — not −the observer's facing")
})

test("nothing taken for a measure wounds at the hole, and poisons no pose", () => {
    // Measured 2026-09-26, before the guards: the NaN propagated — `rt A.heading`
    // left every host coordinate NaN, and no error surfaced anywhere. `null + 1` is
    // 1 in JavaScript, so nothing taken for a measure is the same corruption a step
    // further out. The refusal is at the demand, and it names the hole.
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nas A do\n  pitch 90\nend\nrt A.heading\nfw 10"))
    drive(scheduler)
    assert.equal(scheduler.errors.length, 1, "exactly one located wound, not a silent walk")
    assert.match(scheduler.errors[0].message, /rt|No measure/)
    const pose = frameWorldTransform(host)
    assert.ok(pose.position.every(Number.isFinite) && Number.isFinite(pose.rotation.w),
        "the host's pose is untouched by a reading that could not answer")
})
