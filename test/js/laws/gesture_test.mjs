// The gesture's composition. The predicates and the formatting are witnessed
// elsewhere; what is proved here is that they compose — arbitration, the grab
// offset, cancellation on a changed declaration, and ownership restoration.
// (id:laws-decl-handle)
// Run: node --test test/js/laws/gesture_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { createGesture } from "../../../assets/js/turtling/laws/gesture.js"
import { frameWorldTransform, worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}

// A screen whose world-to-pixel scale is 100, and a ray that falls straight down
// on the pixel it is given — so a witness can name a world point in pixels.
const harness = (scheduler, frames, { controlsEnabled = true, requestMotion } = {}) => {
    const requests = []
    const readouts = []
    const state = { captured: null, controls: { enabled: controlsEnabled }, woke: 0 }
    const gesture = createGesture({
        candidates: () => frames.map((frame) => ({ name: frame.name, frame })),
        anchorOf: (frame) => frameWorldTransform(frame),
        birthOf: (frame) => worldTransform(frame),
        registered: (frame) => scheduler.registry.get(frame.id) === frame,
        requestMotion: (frame, pose, revision) => {
            requests.push({ frame, pose })
            return requestMotion ? requestMotion(frame, pose, revision) : { kind: "accept" }
        },
        revision: () => scheduler.motionRevision,
        wake: () => { state.woke++ },
        project: (world) => ({ x: world[0] * 100, y: world[1] * 100 }),
        rayAt: (x, y) => ({ origin: [x / 100, y / 100, 5], direction: [0, 0, -1] }),
        capture: ({ pointerId }) => { state.captured = pointerId },
        release: () => { state.captured = null },
        setControls: (enabled) => { state.controls.enabled = enabled },
        controlsEnabled: () => state.controls.enabled,
        onReadout: (line) => readouts.push(line),
    })
    return {
        gesture, requests, readouts, state,
        down: (at) => gesture.pointerDown({ pointerId: 1, ...at }),
        move: (at) => gesture.pointerMove({ pointerId: 1, ...at }),
        up: () => gesture.pointerUp({ pointerId: 1 }),
        cancel: () => gesture.pointerCancel({ pointerId: 1 }),
        last: () => readouts.at(-1),
    }
}

// A settled, finished play with one declared place at (3,0), turned 90°.
const seated = (source = "let a\nas a do\n  goto 3 0\n  rt 90\nend") => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source))
    drive(scheduler)
    return { scheduler, host, a: find(host, "a") }
}

test("positive: an off-centre grab moves by the pointer's delta, never by a jump", () => {
    const { scheduler, a } = seated()
    assert.deepEqual(a.transform.deref().position.slice(0, 2), [3, 0], "settled at (3,0)")
    const before = [...a.transform.deref().position]
    const heading = a.transform.deref().rotation
    // The request is expressed in the place's BIRTH frame, so that is the frame it
    // is read back through. (id:laws-decl-anchor)
    const worldAt = (pose) => SE3.compose(worldTransform(a), pose).position
    const startWorld = worldAt({ rotation: heading, position: before })

    const h = harness(scheduler, [a])
    // The point is at pixel (300, 0). Grab 6 px right, 5 px down — off centre.
    const grab = h.down({ x: 306, y: 5 })
    assert.equal(grab.claimed, true)
    assert.equal(grab.point, "a")
    assert.equal(grab.frame, a, "the frame travels back, so a cue can be exact")
    assert.equal(h.state.captured, 1, "the pointer was captured")
    assert.equal(h.state.controls.enabled, false, "the hand owns the camera")

    // Move 2 px right, 2 px down. The point must move by the POINTER's world
    // delta — 0.02 each way at 100 px per unit — and not jump to the pointer,
    // which is still 6 px and 5 px away from where it was grabbed.
    assert.deepEqual(h.move({ x: 308, y: 7 }), { moved: true, outcome: "accepted" })
    assert.equal(h.requests.length, 1)
    const requested = h.requests[0].pose
    const moved = worldAt(requested).map((n, i) => n - startWorld[i])
    assert.ok(Math.abs(moved[0] - 0.02) < 1e-9 && Math.abs(moved[1] - 0.02) < 1e-9,
        `not the pointer's delta: ${moved}`)
    // And it did not snap: the point is not under the pointer.
    const underPointer = worldAt(requested)
    assert.ok(Math.hypot(underPointer[0] - 3.08, underPointer[1] - 0.07) > 0.01,
        "the point snapped to the pointer")
    assert.equal(requested.rotation, heading, "heading preserved through the drag")
    assert.equal(h.state.woke, 1, "an accepted move wakes the canvas")
    assert.deepEqual(h.last().outcome, "accepted")
    assert.deepEqual(h.last().accepted, before)

    h.up()
    assert.equal(h.state.captured, null, "capture released")
    assert.equal(h.state.controls.enabled, true, "camera handed back")
})

test("positive: the camera's own previous state comes back, not an unconditional enable", () => {
    const { scheduler, a } = seated()
    const h = harness(scheduler, [a], { controlsEnabled: false })
    assert.equal(h.down({ x: 300, y: 0 }).claimed, true)
    assert.equal(h.state.controls.enabled, false, "already off, and stays off while dragging")
    h.up()
    assert.equal(h.state.controls.enabled, false, "restored to what it was, not forced on")
})

test("negative: an out-of-plane point is refused, and says why", () => {
    // The program itself moves the place out of its plane. Nothing errors.
    const { scheduler, a } = seated("let a\nas a do\n  pitch 90\n  fw 1\nend")
    const before = [...a.transform.deref().position]
    assert.notEqual(before[2], 0, "the place really left the plane")

    const h = harness(scheduler, [a])
    // The pointer lands exactly on the drawn point.
    assert.equal(h.down({ x: before[0] * 100, y: before[1] * 100 }).claimed, false)
    assert.deepEqual(h.requests, [], "no motion request was submitted")
    assert.deepEqual(a.transform.deref().position, before, "accepted geometry is unchanged")
    assert.equal(h.state.captured, null, "nothing was captured")
    assert.equal(h.state.controls.enabled, true, "the camera was never taken")
    assert.equal(h.last().outcome, "unsupported", "and the explanation is visible")
})

test("lifetime: removing the declaration mid-drag ends the capture and frees the camera", () => {
    const { scheduler, host, a } = seated()
    const h = harness(scheduler, [a])
    assert.equal(h.down({ x: 300, y: 0 }).claimed, true)
    assert.equal(h.state.controls.enabled, false)

    // The scope is replaced by one that declares nothing. The frame survives.
    scheduler.removeChild("host")
    assert.equal(scheduler.registry.get(a.id), undefined, "the whole subtree left the play")

    assert.deepEqual(h.move({ x: 340, y: 0 }), { moved: false, cancelled: true })
    assert.deepEqual(h.requests, [], "no stale motion acted")
    assert.equal(h.state.captured, null, "capture ended")
    assert.equal(h.state.controls.enabled, true, "camera control restored")
    assert.equal(h.last().outcome, "obsolete", "and the reason is the identity, not the pointer")
    assert.equal(find(host, "a"), a, "the retained frame is still the same frame")
})

test("lifetime: cancellation discards the pending target and keeps accepted movement", () => {
    // Unturned, so local and world axes agree and the numbers read plainly.
    const { scheduler, a } = seated("let a\nas a do\n  goto 3 0\nend")
    const accepted = []
    const h = harness(scheduler, [a], {
        requestMotion: (frame, pose) => { accepted.push([...pose.position]); return { kind: "accept" } },
    })
    h.down({ x: 300, y: 0 })
    h.move({ x: 310, y: 0 })
    h.move({ x: 320, y: 0 })
    assert.equal(accepted.length, 2, "two moves were accepted")

    h.cancel()
    assert.equal(h.state.captured, null)
    assert.equal(h.state.controls.enabled, true)
    assert.equal(h.last().outcome, "cancelled")
    assert.equal(accepted.length, 2, "cancellation asked for nothing further")
    assert.deepEqual(accepted[0], [3.1, 0, 0], "and undid nothing already accepted")
})

test("one pointer owns the hand, and only the owner's events are obeyed", () => {
    const { scheduler, a } = seated()
    const h = harness(scheduler, [a])
    assert.equal(h.down({ x: 300, y: 0 }).claimed, true)
    // A second pointer is refused while the first owns the gesture.
    assert.deepEqual(h.gesture.pointerDown({ pointerId: 2, x: 300, y: 0 }), { claimed: false })
    // And a foreign pointer's move is ignored.
    assert.deepEqual(h.gesture.pointerMove({ pointerId: 2, x: 400, y: 0 }), { moved: false })
    assert.deepEqual(h.gesture.pointerUp({ pointerId: 2 }), { ended: false })
    assert.equal(h.state.captured, 1, "still the first pointer's capture")
    h.up()
    assert.equal(h.state.captured, null)
})

test("disposal during a drag leaves no active gesture", () => {
    const { scheduler, a } = seated()
    const h = harness(scheduler, [a])
    h.down({ x: 300, y: 0 })
    assert.deepEqual(h.gesture.dispose(), { ended: true })
    assert.equal(h.state.captured, null)
    assert.equal(h.state.controls.enabled, true)
    assert.deepEqual(h.gesture.grabbed, null)
    assert.deepEqual(h.gesture.dispose(), { ended: false })
})

test("a refused move is reported and changes nothing", () => {
    const { scheduler, a } = seated()
    const before = [...a.transform.deref().position]
    const h = harness(scheduler, [a], { requestMotion: () => ({ kind: "refuse" }) })
    h.down({ x: 300, y: 0 })
    assert.deepEqual(h.move({ x: 310, y: 0 }), { moved: true, outcome: "rejected" })
    assert.equal(h.state.woke, 0, "a refused move wakes nothing")
    assert.deepEqual(a.transform.deref().position, before, "accepted geometry is untouched")
})
