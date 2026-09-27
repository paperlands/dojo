// The whole-law gate fails closed: an active law it cannot check, or a bound
// reference that is missing, is unresolved — never a silent pass and never proof
// of contradiction. (id:laws-activation-order, id:laws-contradiction)
//
// Run: node --test test/js/laws/whole_law_gate_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { addressOf } from "../../../assets/js/turtling/laws/replacement.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const pos = (f) => frameWorldTransform(f).position.map((n) => +n.toFixed(6))
const addrs = (scheduler) => scheduler.laws.active().map(addressOf).sort()

function seat(source) {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source))
    drive(scheduler)
    return { scheduler, host }
}

const DISTANCE_HOST = "let A\nlet B\nas B do\n  let A.distance = 5\nend"

// A law whose bound participant is not in this world. Normal play cannot make one
// (removal retracts), so it is injected to probe the gate itself.
const ghostDistance = (host, a) => ({
    feature: "distance", address: "ghost|A", endpoints: [a.id, "GHOST"], scope: host.id, frame: host.id, predicate: 999,
})

test("a ghost law makes a hand request unresolved, and nothing moves", () => {
    const { scheduler, host } = seat(DISTANCE_HOST)
    const A = host.children.get("A")
    scheduler.laws.apply(ghostDistance(host, A))
    assert.equal(scheduler.laws.active().length, 2, "the ghost is in the store")

    const before = pos(A)
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation, position: [0, 5, 0] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 5 })
    assert.equal(r.kind, "unresolved", "an unmeasurable law refuses the motion")
    assert.match(r.message, /missing bound participant/)
    assert.deepEqual(pos(A), before, "the accepted world is unchanged")
})

test("an injected unknown active feature is unresolved, not skipped", () => {
    const { scheduler, host } = seat(DISTANCE_HOST)
    const A = host.children.get("A")
    // An explicit address bypasses the FEATURES lookup, so the gate itself is what
    // sees an unrecognized active feature.
    scheduler.laws.apply({ feature: "area", address: "area|A", endpoints: [A.id], scope: host.id, frame: host.id, predicate: 1 })
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature).sort(), ["area", "distance"])

    const before = pos(A)
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation, position: [0, 5, 0] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 5 })
    assert.equal(r.kind, "unresolved", "an unrecognized active law refuses the motion")
    assert.match(r.message, /does not recognize 'area'/)
    assert.deepEqual(pos(A), before, "the accepted world is unchanged")
})

test("a poisoned store cannot publish another law unchecked", () => {
    const { scheduler, host } = seat(DISTANCE_HOST)
    const A = host.children.get("A")
    scheduler.laws.apply(ghostDistance(host, A))
    const before = addrs(scheduler)

    // A second scope reaches a plain distance; the poisoned store must refuse it
    // at settlement rather than publish a world it cannot check.
    const s2 = scheduler.hotSwapChild("s2", fork("s2", "let A\nlet B\nas B do\n  let A.distance = 7\nend"))
    drive(scheduler)
    assert.deepEqual(addrs(scheduler), before, "no law address is added or replaced")
    assert.equal(s2.children.get("B")?.unresolved?.reason, "the distance has a missing bound participant",
        "the second scope ends unresolved for the unmeasurable law")
})

test("an unknown authored form is refused at binding, nothing installs", () => {
    const { scheduler } = seat("let A")
    const before = addrs(scheduler)
    // A dotted property that is not a supported relation is a local parse refusal.
    scheduler.hotSwapChild("s2", fork("s2", "let A\nlet A.area = 3"))
    drive(scheduler)
    assert.deepEqual(addrs(scheduler), before, "an unknown authored form does not install")
})
