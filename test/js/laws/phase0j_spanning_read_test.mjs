// Characterization: two reads made as one observation can straddle an accepted
// component change. This uses the real resolver and finished-hand admission;
// the interleaving is injected, not a claim that ordinary JS arguments yield here.
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, world } from "./harness.mjs"
import { resolveBinding } from "../../../assets/js/turtling/scheduler.js"

function analyticPair({ frame, requested }) {
    const other = frame.parent.children.get(frame.name === "a" ? "b" : "a")
    const delta = requested.position[0] - frame.transform.deref().position[0]
    const previous = other.transform.deref()
    return { accepted: true, transform: requested, component: [{
        frame: other, transform: { ...previous, position: [previous.position[0] + delta, 0, 0] },
    }] }
}

function validatesPair({ entries }) {
    if (entries.length !== 2) return false
    const a = entries.find(e => e.frame.name === "a")?.pose.position
    const b = entries.find(e => e.frame.name === "b")?.pose.position
    return a?.length === 3 && b?.length === 3 &&
        Math.abs(Math.hypot(a[0] - (5 + b[0]), a[1] - b[1], a[2] - b[2]) - 5) < 1e-9
}

test("characterization: one reader sees old A and new B when its reads span a commit", () => {
    const scheduler = buildWorld({ admit: analyticPair, validate: validatesPair })
    const a = scheduler.hotSwapChild("a", fork("a", ""))
    scheduler.hotSwapChild("b", fork("b", "", at(5)))
    const reader = scheduler.hotSwapChild("reader", fork("reader", ""))

    const before = resolveBinding(reader, "a.x")
    const verdict = scheduler.requestMotion(a, at(1), scheduler.motionRevision)
    const after = resolveBinding(reader, "b.x")

    assert.equal(verdict.kind, "accept")
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [1, 6])
    assert.deepEqual([before, after], [0, 6])
    assert.notEqual(after - before, 5, "both reads came from valid states, not one world")
})
