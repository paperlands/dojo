// Pass 1: a framed coordinate's meaning and fail-closed validation. The parser
// still refuses `let A.y = c`, so these laws are injected and the GATE is what is
// tested, not the syntax. No candidate producer is wired here.
// (id:relationships-todo-coordinate-spike, id:relationships-todo-whole-gate)
//
// Run: node --test test/js/laws/coordinate_law_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { addressOf } from "../../../assets/js/turtling/laws/replacement.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { AXIS_Z } from "../../../assets/js/turtling/se3.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const pos = (f) => frameWorldTransform(f).position.map((n) => +n.toFixed(6))

function seat(origin = undefined) {
    const scheduler = buildWorld({ admit: pass })
    const host = origin
        ? scheduler.hotSwapChild("host", fork("host", "let A", origin))
        : scheduler.hotSwapChild("host", fork("host", "let A"))
    drive(scheduler)
    return { scheduler, host, A: host.children.get("A") }
}

const coord = (host, a, over = {}) => ({
    feature: "coordinate", axis: "y", endpoints: [a.id], scope: host.id, frame: host.id, predicate: 0, ...over,
})

function move(scheduler, frame, position) {
    const r = scheduler.requestMotion(frame, { rotation: frame.transform.deref().rotation, position }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 3 })
    return r
}

test("a coordinate law reads the declaring frame's own axis", () => {
    const { scheduler, host, A } = seat()
    scheduler.laws.apply(coord(host, A))

    assert.equal(move(scheduler, A, [1, 0, 0]).kind, "accept", "on the frame's y = 0 plane")
    assert.deepEqual(pos(A), [1, 0, 0])

    const before = pos(A)
    assert.equal(move(scheduler, A, [0, 1, 0]).kind, "refuse", "off the plane")
    assert.deepEqual(pos(A), before, "a refused motion does not publish")
})

test("a rotated declaring frame rotates its axis plane", () => {
    const origin = { position: [0, 0, 0], rotation: Versor.fromAxisAngle(AXIS_Z, 90) }
    const { scheduler, host, A } = seat(origin)
    scheduler.laws.apply(coord(host, A))

    // local +y turns to world −x: the plane is x = 0.
    assert.equal(move(scheduler, A, [1, 0, 0]).kind, "accept", "world x = 0 is on the plane")
    assert.deepEqual(pos(A), [0, 1, 0])

    const before = pos(A)
    assert.equal(move(scheduler, A, [0, 1, 0]).kind, "refuse", "world x = −1 is off it")
    assert.deepEqual(pos(A), before)
})

test("a coordinate address is point, axis and frame; a revision replaces", () => {
    const { scheduler, host, A } = seat()
    scheduler.laws.apply(coord(host, A))
    scheduler.laws.apply(coord(host, A, { axis: "z" }))
    assert.equal(scheduler.laws.active().length, 2, "a different axis conjoins")

    scheduler.laws.apply(coord(host, A, { predicate: 5 }))
    assert.equal(scheduler.laws.active().length, 2, "the same address replaces, not conjoins")
    const yLaw = scheduler.laws.active().find((l) => l.feature === "coordinate" && l.axis === "y")
    assert.equal(yLaw.predicate, 5)
    assert.equal(addressOf(coord(host, A, { predicate: 5 })), yLaw.address ?? addressOf(yLaw))
})

test("a missing frame is unresolved, and nothing publishes", () => {
    const { scheduler, host, A } = seat()
    scheduler.laws.apply(coord(host, A, { frame: "GHOST" }))
    const before = pos(A)
    const r = move(scheduler, A, [1, 0, 0])
    assert.equal(r.kind, "unresolved")
    assert.match(r.message, /missing bound reference/)
    assert.deepEqual(pos(A), before)
})

test("an unknown axis is unresolved, not skipped", () => {
    const { scheduler, host, A } = seat()
    scheduler.laws.apply(coord(host, A, { axis: "w" }))
    const before = pos(A)
    const r = move(scheduler, A, [1, 0, 0])
    assert.equal(r.kind, "unresolved")
    assert.match(r.message, /unknown axis 'w'/)
    assert.deepEqual(pos(A), before)
})

test("the parser authors a framed coordinate", () => {
    for (const [axis, src] of [["x", "let A\nlet A.x = 1"], ["y", "let A\nlet A.y = 0"], ["z", "let A\nlet A.z = 3"]]) {
        const law = parseProgram(src).find((n) => n.type === "Law")
        assert.equal(law?.value, "coordinate", src)
        assert.equal(law?.meta?.axis, axis, src)
    }
})

test("a definition place keeps its pinned geometry when its body starts", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let B = [0, 200, 5]\nas B do\n  as D do\n    fw 100\n  end\nend"))
    drive(scheduler, { maxTicks: 60 })
    const B = host.children.get("B")
    const D = [...B.children.values()].find((c) => c.name === "D")
    assert.deepEqual(pos(B), [0, 200, 5], "the pin holds")
    assert.deepEqual(pos(D), [100, 200, 5], "the nested body walks from the pinned place")
})
