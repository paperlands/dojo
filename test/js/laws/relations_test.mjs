// One relational surface: measure() is the only definition, and the evaluator's
// read and the law's check agree because they supply the same reading. (id:eval-relational)
// Run: node --test test/js/laws/relations_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { measure, headingOf } from "../../../assets/js/turtling/laws/relations.js"
import { buildWorld, fork, drive } from "./harness.mjs"
import { resolveBinding } from "../../../assets/js/turtling/scheduler.js"

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

test("measure: bearing is signed by the observer's heading", () => {
    const north = readings({ a: [0, 0, 0], b: [0, 1, 0] })
    assert.equal(measure("bearing", "b", "a", north), 0, "due +y with zero heading")
    const east = readings({ a: [0, 0, 0], b: [1, 0, 0] })
    assert.equal(measure("bearing", "b", "a", east), 90, "due +x with zero heading")
})

test("measure: sync is signed", () => {
    const read = readings({ a: [0, 0, 0], b: [0, 0, 0] }, {}, { a: 10, b: 7 })
    assert.equal(measure("sync", "b", "a", read), -3, "a target behind the observer is negative")
})

test("headingOf: a quarter turn about the turtle's y-axis is 90 degrees", () => {
    const q = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }
    assert.ok(Math.abs(headingOf(q) - 90) < 1e-9)
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
