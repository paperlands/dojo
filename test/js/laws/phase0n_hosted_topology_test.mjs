// Hosted topology diagnostic: root / source-seated host / source-spawned a,b.
// Run: node --test test/js/laws/phase0n_hosted_topology_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, nz } from "./harness.mjs"
import { frameWorldTransform, worldTransform, takeSync } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

// b names a as its declaring frame; its ink is deposited in a's channel.
// The host steps between births, so the siblings have distinct inertial origins.
const source = `jmpto 10 0
as a do
  wait 0.001
  fw 1
end
jmpto 15 0
as b a do
  wait 0.001
  fw 2
end`

const position = (frame) => nz(frameWorldTransform(frame).position)
const paths = (events) => events.filter(e => e.type === "path")
const points = (event) => event.points.map(nz)

function hosted(scheduler, key, origin = at(0)) {
    return scheduler.hotSwapChild(key, fork("host", source, origin))
}

// A narrow analytic distance fixture, deliberately not a general solver. The
// answer is expressed in each child's BIRTH frame, not world or drawing frame.
function pair({ frame, requested }) {
    if (frame.name === "host") return { accepted: true, transform: requested }
    const other = frame.parent.children.get(frame.name === "a" ? "b" : "a")
    const delta = requested.position[0] - frame.transform.deref().position[0]
    const previous = other.transform.deref()
    return { accepted: true, transform: requested, component: [{ frame: other,
        transform: { rotation: previous.rotation,
            position: [previous.position[0] + delta, ...previous.position.slice(1)] } }] }
}

function validate({ writer, entries }) {
    if (writer.name === "host") return entries.length === 1
    const a = writer.parent.children.get("a"), b = writer.parent.children.get("b")
    if (entries.length !== 2 || !a || !b || !entries.some(e => e.frame === a) ||
        !entries.some(e => e.frame === b)) return false
    const next = (frame) => SE3.compose(worldTransform(frame), entries.find(e => e.frame === frame).pose).position
    const ap = next(a), bp = next(b)
    return Math.abs(bp[0] - ap[0] - 5) < 1e-9 &&
        Math.abs(bp[1] - ap[1]) < 1e-9 && Math.abs(bp[2] - ap[2]) < 1e-9
}

function finish(scheduler) {
    const trace = new Map()
    const drain = () => {
        for (const frame of scheduler.registry.values()) {
            const events = frame.channel.drain()
            if (events.length) trace.set(frame.id, [...(trace.get(frame.id) ?? []), ...events])
        }
    }
    drain() // hotSwapChild can already have emitted a first slice
    for (let i = 0; i < 40 && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        drain()
    }
    assert.equal(scheduler.done, true)
    assert.deepEqual(scheduler.errors, [])
    return trace
}

test("hosted birth poses, declaring frame, and deposited ink use different coordinates", () => {
    const scheduler = buildWorld({ admit: pair, validate })
    const host = hosted(scheduler, "seat-1")
    const trace = finish(scheduler)
    const a = host.children.get("a"), b = host.children.get("b")
    assert.ok(a && b, "the source, not the fixture, spawns both actors")
    assert.equal(a.parent, host)
    assert.equal(b.parent, host)
    assert.equal(b.targetFrame, "a")
    assert.deepEqual(nz(a.origin.position), [10, 0, 0])
    assert.deepEqual(nz(b.origin.position), [15, 0, 0])
    assert.deepEqual(nz(a.transform.deref().position), [3, 0, 0])
    assert.deepEqual(nz(b.transform.deref().position), [3, 0, 0])
    assert.deepEqual(position(a), [13, 0, 0]) // world = host origin + a birth + a pose
    assert.deepEqual(position(b), [18, 0, 0])
    const aInk = paths(trace.get(a.id) ?? [])
    assert.deepEqual(aInk.filter(e => !e.sourceId).map(points), [[[0, 0, 0], [1, 0, 0]]])
    assert.deepEqual(aInk.filter(e => e.sourceId === b.id).map(points),
        [[[6, 0, 0], [8, 0, 0]]], "b deposits in a coordinates, not its own or the root's")
    assert.deepEqual(paths(trace.get(b.id) ?? []), [], "b's ink belongs to the declaring frame")
    assert.deepEqual(nz(takeSync(b).find(e => e.type === "head").position), [8, 0, 0],
        "the deposited head is projected into a's frame too")
})

test("scoped actors stay separate; finished hosted hand moves heads, not deposited ink", () => {
    const calls = []
    const scheduler = buildWorld({ admit: request => { calls.push(request.frame.address); return pair(request) }, validate })
    const leftHost = hosted(scheduler, "seat-left")
    const rightHost = hosted(scheduler, "seat-right", at(100))
    const trace = finish(scheduler)
    const left = { a: leftHost.children.get("a"), b: leftHost.children.get("b") }
    const right = { a: rightHost.children.get("a"), b: rightHost.children.get("b") }
    assert.ok(left.a && left.b && right.a && right.b)
    assert.deepEqual([left.a.address, left.b.address, right.a.address, right.b.address],
        ["seat-left/a", "seat-left/b", "seat-right/a", "seat-right/b"])
    assert.notEqual(left.a.id, right.a.id)
    assert.deepEqual(position(right.a), [113, 0, 0])
    assert.deepEqual(position(right.b), [118, 0, 0])
    // A hand point lives in a's birth frame: world 114 on the right is local 4,
    // not local 114; the sibling's declaring frame is a different projection.
    assert.deepEqual(nz(SE3.unapply(worldTransform(right.a), [114, 0, 0])), [4, 0, 0])
    assert.deepEqual(nz(SE3.unapply(worldTransform(left.a), [14, 0, 0])), [4, 0, 0])
    assert.notEqual(left.b.id, right.b.id)
    assert.ok(paths(trace.get(left.a.id) ?? []).some(e => e.sourceId === left.b.id))
    assert.ok(paths(trace.get(right.a.id) ?? []).some(e => e.sourceId === right.b.id))
    assert.ok(!paths(trace.get(left.a.id) ?? []).some(e => e.sourceId === right.b.id))
    assert.deepEqual(new Set(calls.filter(address => address.includes("/"))),
        new Set(["seat-left/a", "seat-left/b", "seat-right/a", "seat-right/b"]))
    const before = [left.a, left.b, right.a, right.b].map(position)
    const ink = paths(trace.get(left.a.id) ?? []).map(e => ({ sourceId: e.sourceId, points: e.points }))
    const revision = scheduler.motionRevision
    const count = calls.length
    assert.equal(left.a.done, true)
    assert.equal(left.a.batch, null)
    assert.equal(scheduler.requestMotion(left.a, at(4), revision).kind, "accept")
    assert.equal(calls.length, count + 1)
    assert.equal(scheduler.motionRevision, revision + 1)
    assert.deepEqual([left.a, left.b].map(position), [[14, 0, 0], [19, 0, 0]])
    assert.deepEqual([right.a, right.b].map(position), before.slice(2))
    assert.deepEqual(nz(takeSync(left.a).find(e => e.type === "head").position), [4, 0, 0])
    assert.deepEqual(nz(takeSync(left.b).find(e => e.type === "head").position), [9, 0, 0],
        "b's finished head projects into its declaring frame")
    assert.deepEqual(paths(left.a.channel.drain()), [], "a hand contributes no new ink")
    assert.deepEqual(paths(left.b.channel.drain()), [])
    assert.deepEqual(paths(trace.get(left.a.id) ?? []).map(e => ({ sourceId: e.sourceId, points: e.points })), ink)
    assert.equal(scheduler.requestMotion(left.a, at(5), revision).kind, "stale")
})
