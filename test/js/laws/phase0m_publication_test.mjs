// Phase 0m: publication is a critical section.
//
// A component installs every member, then notifies. A notifier may try to raise
// another hand request. If that nested request is allowed to publish, the outer
// request finishes afterwards and writes its own, older head slots — display and
// accepted geometry then name two different configurations.
//
// The rule under test: a hand request raised while a publication is open is
// refused with `busy` (retryable), never interleaved. No queue, no version store.
// Run: node --test test/js/laws/phase0m_publication_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, drive } from "./harness.mjs"
import { takeSync } from "../../../assets/js/turtling/scheduler.js"

// Equal world displacement of both ends preserves |AB| = 5 (the phase0i fixture).
const pair = ({ command, requested, frame }) => {
    if (command !== "hand") return { accepted: true, transform: requested }
    const other = frame.parent.children.get(frame.name === "a" ? "b" : "a")
    const current = frame.transform.deref()
    const delta = requested.position[0] - current.position[0]
    const pose = { ...other.transform.deref(), position: [other.transform.deref().position[0] + delta, 0, 0] }
    return { accepted: true, transform: requested, component: [{ frame: other, transform: pose }] }
}

const headX = (frame) => takeSync(frame)?.find((e) => e.type === "head")?.position[0]

const setup = () => {
    const scheduler = buildWorld({ admit: pair })
    const a = scheduler.hotSwapChild("a", fork("a", ""))
    const b = scheduler.hotSwapChild("b", fork("b", "goto 5 0"))
    drive(scheduler)
    return { scheduler, a, b }
}

test("a hand request raised inside publication is refused, not interleaved", () => {
    const { scheduler, a, b } = setup()
    assert.deepEqual([a.transform.deref().position[0], b.transform.deref().position[0]], [0, 5])
    takeSync(a); takeSync(b)   // discard the seating heads

    let nested
    let armed = true
    a.transform.watch("p0m-reentrancy", () => {
        if (!armed) return
        armed = false
        nested = scheduler.requestMotion(a, at(2), scheduler.motionRevision)
    })

    const outer = scheduler.requestMotion(a, at(1), scheduler.motionRevision)
    assert.equal(outer.kind, "accept")
    assert.equal(nested?.kind, "busy", "a request during publication is refused for retry")

    // Nothing newer was accepted, so the visible head names the accepted pair.
    assert.deepEqual([a.transform.deref().position[0], b.transform.deref().position[0]], [1, 6])
    assert.equal(headX(a), 1, "the visible head must name the accepted configuration")
    assert.equal(headX(b), 6)

    // The refusal is a retry door, not a drop: the later attempt lands whole.
    const retry = scheduler.requestMotion(a, at(2), scheduler.motionRevision)
    assert.equal(retry.kind, "accept")
    assert.deepEqual([a.transform.deref().position[0], b.transform.deref().position[0]], [2, 7])
    assert.equal(headX(a), 2)
    assert.equal(headX(b), 7)
})
