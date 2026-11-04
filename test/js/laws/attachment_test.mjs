// Attachment — a position stated relative to a NAMED frame.
//
// The hand's request names the frame its pose is expressed in. `world` and `parent` are
// names; a named frame is the same mechanism, and it is the thing a sentence like "put
// this at the stem's tip" needs. (id:laws-figures-phase34-ref)
//
// Discriminating on purpose: the anchor is ROTATED and OFFSET, so copying the position
// without the orientation fails here. A case where both readings agree is not evidence.
//
// Run: node --test test/js/laws/attachment_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

// outer walks to (100,0,0), turns left 90°, walks 30 along its new heading, and declares
// `tip` where it arrived. `mark` is a FREE POINT at the world origin — a different part,
// not kin to `tip`. The anchor is reached because the language already lets any frame be
// named as a frame of reference ("a FRAME OF REFERENCE need not be kin"); the anchor is
// rotated AND offset, so a position-only copy fails here.
const SOURCE = `
as outer do
  goto 100 0
  lt 90
  fw 30
  let tip
end
let mark
wait 1
`
const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const pos = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(3))
const rot = (frame) => frameWorldTransform(frame).rotation
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps

function settled() {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", SOURCE))
    for (let i = 0; i < 8; i++) {
        drive(scheduler, { maxTicks: 4 })
        scheduler.readouts.drain()
    }
    return { scheduler, host, tip: find(host, "tip"), mark: find(host, "mark") }
}

test("attachment: a mark stated in a rotated frame's own pose lands ON it, orientation included", () => {
    const { scheduler, tip, mark } = settled()
    assert.ok(tip && mark, "the anchor and the mark both exist")
    const anchor = pos(tip)
    assert.ok(near(anchor[0], 100) && near(anchor[1], 30),
        `the anchor was set up at a rotated, offset place, got ${JSON.stringify(anchor)}`)

    // The pose is stated RELATIVE to the named frame: identity means "on it, aligned with it".
    // A pose that already carried the anchor's own rotation would compose it twice — which is
    // the design saying the frame is a frame, not a hint.
    const onIt = { rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [0, 0, 0] }
    const verdict = scheduler.requestMotion(mark, onIt, scheduler.motionRevision, "tip")
    assert.equal(verdict.kind, "accept", JSON.stringify(verdict))
    for (let i = 0; i < 4; i++) { drive(scheduler, { maxTicks: 4 }); scheduler.readouts.drain() }

    assert.deepEqual(pos(mark), anchor, "the mark stands where the named frame stands")
    const m = rot(mark)
    const t = rot(tip)
    assert.ok(near(m.w, t.w) && near(m.x, t.x) && near(m.y, t.y) && near(m.z, t.z),
        "and it is ORIENTED by that frame — a position-only copy would leave identity here")
    assert.ok(!(near(m.z, 0) && near(m.w, 1)), "the frame's turn rode along")
})

test("attachment: a statement in a named frame is a position, not motion", () => {
    const { scheduler, mark } = settled()
    assert.equal(mark.isPlace, true, "the mark is a place, so its position belongs in its origin")
    scheduler.requestMotion(mark, { rotation: rot(mark), position: [5, 5, 0] }, scheduler.motionRevision, "world")
    for (let i = 0; i < 4; i++) { drive(scheduler, { maxTicks: 4 }); scheduler.readouts.drain() }
    assert.deepEqual(pos(mark), [5, 5, 0], "a stated place is re-stated where it was asked")
    assert.deepEqual(mark.transform.deref().position.map((n) => +n.toFixed(3)), [0, 0, 0],
        "and it keeps no motion of its own — the position lives in the origin")
})

test("attachment: a name that resolves to nothing is an unresolved wish, never a crash", () => {
    const { scheduler, mark } = settled()
    const verdict = scheduler.requestMotion(mark, { rotation: rot(mark), position: [1, 0, 0] },
        scheduler.motionRevision, "nowhere")
    assert.equal(verdict.kind, "unresolved", JSON.stringify(verdict))
    assert.match(verdict.message ?? "", /nowhere/, "and it names what could not be found")
    assert.deepEqual(pos(mark), [0, 0, 0], "the mark did not move")
})
