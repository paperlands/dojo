// The gesture's composition. The predicates and the formatting are witnessed
// elsewhere; what is proved here is that they compose — arbitration, the grab
// offset, cancellation on a changed declaration, and ownership restoration.
// (id:laws-decl-handle)
// Run: node --test test/js/laws/gesture_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { createGesture } from "../../../assets/js/turtling/laws/gesture.js"
import { exposed, freePoint } from "../../../assets/js/turtling/laws/batch.js"
import { stateOf, heldIdentity } from "../../../assets/js/turtling/laws/constraints.js"
import { constraintsOn, bindWorld } from "../../../assets/js/turtling/laws/authored.js"
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
const harness = (scheduler, frames, { controlsEnabled = true, requestMotion, canTouch, locusOf, facing = [0, 0, -1] } = {}) => {
    const requests = []
    const readouts = []
    const state = { captured: null, controls: { enabled: controlsEnabled }, woke: 0 }
    const gesture = createGesture({
        candidates: () => frames.map((frame) => ({ name: frame.name, frame })),
        anchorOf: (frame) => frameWorldTransform(frame),
        birthOf: (frame) => worldTransform(frame),
        registered: (frame) => scheduler.registry.get(frame.id) === frame,
        canTouch,
        requestMotion: (frame, pose, revision) => {
            requests.push({ frame, pose })
            return requestMotion ? requestMotion(frame, pose, revision) : { kind: "accept" }
        },
        revision: () => scheduler.motionRevision,
        wake: () => { state.woke++ },
        project: (world) => ({ x: world[0] * 100, y: world[1] * 100 }),
        rayAt: (x, y) => ({ origin: [x / 100, y / 100, 5], direction: [...facing] }),
        facing: () => facing,
        capture: ({ pointerId }) => { state.captured = pointerId },
        release: () => { state.captured = null },
        setControls: (enabled) => { state.controls.enabled = enabled },
        controlsEnabled: () => state.controls.enabled,
        onReadout: (line) => readouts.push(line),
        locusOf,
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


test("only a free point can be touched; attaching as A cancels an ongoing grab", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let a"))
    const a = host.children.get("a")
    const h = harness(scheduler, [a], {
        canTouch: freePoint,
        requestMotion: (frame, pose, revision) => scheduler.requestMotion(frame, pose, revision),
    })
    assert.equal(h.down({ x: 0, y: 0 }).claimed, true)
    assert.equal(h.move({ x: 100, y: 0 }).outcome, "accepted")
    assert.deepEqual(a.transform.deref().position.slice(0, 2), [1, 0])

    // A body arriving mid-capture withdraws the free-point privilege before
    // another pointer move. Joining through `as` is fenced in declaration_test.
    a.actorState = { style: { showTurtle: 10 } }
    assert.equal(h.move({ x: 200, y: 0 }).cancelled, true)
    assert.deepEqual(a.transform.deref().position.slice(0, 2), [1, 0],
        "the last accepted point stays; the head gets no pointer request")
    assert.equal(h.state.captured, null)
    assert.equal(h.down({ x: 100, y: 0 }).claimed, false)
})
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

test("an off-plane point composes like any other: the view plane decides", () => {
    // The program itself moves the place out of its birth plane. Nothing errors —
    // and the drag is not refused: the frozen view plane says where it goes.
    const { scheduler, a } = seated("let a\nas a do\n  pitch 90\n  fw 1\nend")
    const before = [...a.transform.deref().position]
    assert.notEqual(before[2], 0, "the place really left the plane")

    const h = harness(scheduler, [a], {
        requestMotion: (frame, pose, revision) => scheduler.requestMotion(frame, pose, revision),
    })
    assert.equal(h.down({ x: before[0] * 100, y: before[1] * 100 }).claimed, true,
        "an out-of-plane point is a point")
    assert.deepEqual(h.move({ x: before[0] * 100 + 20, y: before[1] * 100 }), { moved: true, outcome: "accepted" })
    assert.deepEqual(a.transform.deref().position.map((n) => +n.toFixed(6)),
        [before[0] + 0.2, before[1], before[2]].map((n) => +n.toFixed(6)), "the drag moved on the view plane — z included")
    h.up()
    assert.equal(h.state.controls.enabled, true, "the camera was handed back")
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


// The real source-law combination, never an injected description: one distance from a
// held B, authored, parsed and realized by the scheduler the shell runs. (id:laws-decl-anchor)
const onSphere = (at = [3, 0, 4]) => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet B\nas B do\n  let A.distance = 5\nend"))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    assert.ok(same(A.transform.deref().position, [5, 0, 0]), "the law realized A on the sphere")
    scheduler.requestMotion(A, { rotation: A.transform.deref().rotation, position: at }, scheduler.motionRevision)
    drive(scheduler)
    assert.ok(same(A.transform.deref().position, at), `A sits on a valid sphere point, got ${A.transform.deref().position}`)
    return { scheduler, A, B, world: frameWorldTransform(A).position }
}

const same = (a, b, eps = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= eps
const realMotion = (scheduler) => (frame, pose, revision) => scheduler.requestMotion(frame, pose, revision)
const pixel = (world) => ({ x: world[0] * 100, y: world[1] * 100 })

// The locus the turtle reads: the same query `_stateOf` makes, on the same store —
// never a description a test injected. (id:laws-decl-point-agent)
const locusOfWorld = (scheduler) => (frame) => {
    const laws = scheduler.laws.active()
    const ctx = bindWorld((id) => scheduler.registry.get(id), {
        writerId: frame.id,
        positionOf: (f) => frameWorldTransform(f).position,
        poseOf: (f) => worldTransform(f),
        heldOf: (id) => heldIdentity(scheduler.registry.get(id), laws, scheduler.registry),
    })
    return stateOf({
        at: frameWorldTransform(frame).position,
        headed: frame.generator != null || frame.actorState != null,
        exposed: exposed(frame),
        isPlace: frame.isPlace === true,
        error: frame.error ?? null,
        unresolved: frame.unresolved ?? frame.held ?? null,
        constraints: constraintsOn(frame.id, laws, ctx),
    }).locus
}

// The old rule read the camera: inside ~18° of the paper's Z the drag plane became the
// sphere-centre XY plane and the anchor's z was dropped from the grab. Crossing that
// angle must now change nothing at all.
test("a zero-delta grab moves nothing, at every camera angle", () => {
    const facings = [[0, 0, -1], [0, 0.3, -1], [0, 1, -Math.sqrt(3)], [0, 1, -1], [1, 0, 0]]
    for (const facing of facings) {
        const { scheduler, A, world } = onSphere([3, 0, 4])
        const before = [...A.transform.deref().position]
        const h = harness(scheduler, [A], { facing, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler) })
        // A press inside the hit radius, nudged a few pixels against the sight so
        // the frozen plane lies ahead of the ray rather than on it.
        const su = Math.hypot(facing[0], facing[1])
        const px = {
            x: world[0] * 100 - (su > 1e-9 ? 8 * facing[0] / su : 0),
            y: world[1] * 100 - (su > 1e-9 ? 8 * facing[1] / su : 0),
        }
        assert.equal(h.down(px).claimed, true, `claimed at ${facing}`)
        assert.equal(h.move(px).outcome, "accepted", `accepted at ${facing}`)
        assert.deepEqual(A.transform.deref().position, before,
            `an identical pixel is an identical point at ${facing}`)
    }
})

test("a zero-delta grab at the pole moves nothing", () => {
    const { scheduler, A } = onSphere([0, 0, 5])
    const before = [...A.transform.deref().position]
    const h = harness(scheduler, [A], {
        facing: [0, 1, -1], canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const px = { x: 0, y: -8 }        // inside the ring, clear of the frozen plane
    assert.equal(h.down(px).claimed, true)
    assert.equal(h.move(px).outcome, "accepted")
    assert.deepEqual(A.transform.deref().position, before, "the pole holds where the pointer holds")
    assert.ok(Math.abs(Math.hypot(...A.transform.deref().position) - 5) < 1e-9, "still on the sphere")
})

test("a dial holds the latitude in a tilted view too", () => {
    const { scheduler, A } = onSphere([5, 0, 0])
    const h = harness(scheduler, [A], {
        facing: [0, 1, -Math.sqrt(3)], canTouch: freePoint, locusOf: locusOfWorld(scheduler),
        requestMotion: realMotion(scheduler),
    })
    assert.equal(h.down({ x: 500, y: 0 }).claimed, true)
    assert.equal(h.move({ x: 500, y: 40 }).outcome, "accepted")
    const landed = A.transform.deref().position
    assert.ok(Math.abs(landed[2]) < 1e-9, `a dial leaves z alone, tilted or not, got ${landed}`)
    assert.ok(Math.abs(landed[1]) > 0.1, "and it did turn")
})


// The user's report: from lat −12° at R = 100 in the paper view, coming back to the
// plane took four full-width pulls, and the dial spiralled off its own parallel. Both
// are the law's radial projection of a plane request. A sphere's hand is its own
// coordinates instead, so a dial is a dial and one drawn radius of reach is the paper.
test("a dial turns the azimuth and leaves the latitude alone", () => {
    const { scheduler, A } = onSphere([5 * Math.cos(Math.PI / 15), 0, 5 * Math.sin(Math.PI / 15)])
    const h = harness(scheduler, [A], {
        canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const z0 = A.transform.deref().position[2]
    assert.equal(h.down({ x: 489, y: 0 }).claimed, true)
    // A dial is the hand's angle around the pole: a circular path, not a straight one.
    const start = [...A.transform.deref().position]
    const r = Math.hypot(start[0], start[1]) * 100         // the pole's own circle, in pixels
    for (let i = 1; i <= 3; i++) {
        const a = (i / 12) * Math.PI * 2
        h.move({ x: r * Math.cos(a), y: r * Math.sin(a) })
    }
    assert.ok(A.transform.deref().position[1] > 1, "a quarter turn moves the azimuth")
    for (let i = 4; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2
        h.move({ x: r * Math.cos(a), y: r * Math.sin(a) })
    }
    const landed = A.transform.deref().position
    assert.ok(Math.abs(landed[2] - z0) < 1e-9, `a dial keeps the latitude, got z = ${landed[2]}, wanted ${z0}`)
    assert.ok(Math.abs(Math.hypot(...landed) - 5) < 1e-9, "and stays on the sphere")
    assert.ok(same(landed, start), `and a full turn comes home, got ${landed}`)
})

test("one drawn radius of reach lands on the paper circle", () => {
    const { scheduler, A } = onSphere([5 * Math.cos(Math.PI / 15), 0, 5 * Math.sin(Math.PI / 15)])
    const h = harness(scheduler, [A], {
        canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    assert.equal(h.down({ x: 489, y: 0 }).claimed, true)
    // lat 12° is 0.209 rad, so a fifth of the drawn radius (~105 px here) reaches the paper,
    // and the rest of the reach holds it there: the paper is a floor.
    h.move({ x: 489 + 120, y: 0 })
    assert.ok(Math.abs(A.transform.deref().position[2]) < 1e-9,
        `the equator is reached and held, got z = ${A.transform.deref().position[2]}`)
    h.move({ x: 989, y: 0 })
    assert.ok(Math.abs(A.transform.deref().position[2]) < 1e-9, "and a full drawn radius holds it")

    // Inward, the hand lifts it off the paper again.
    const { scheduler: s2, A: B } = onSphere([5, 0, 0])
    const h2 = harness(s2, [B], {
        canTouch: freePoint, locusOf: locusOfWorld(s2), requestMotion: realMotion(s2),
    })
    h2.down({ x: 500, y: 0 })
    h2.move({ x: 400, y: 0 })            // a fifth of a drawn radius inward
    assert.ok(B.transform.deref().position[2] > 0.9,
        `an inward reach lifts the point off the paper, got ${B.transform.deref().position}`)
})

test("a short pull is still fine control", () => {
    const { scheduler, A } = onSphere([5 * Math.cos(Math.PI / 15), 0, 5 * Math.sin(Math.PI / 15)])  // lat 12°, R = 5
    const h = harness(scheduler, [A], {
        canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    h.down({ x: 489, y: 0 })
    h.move({ x: 509, y: 0 })
    const moved = 1.0396 - A.transform.deref().position[2]
    assert.ok(moved < 0.25, `a 20 px pull moves z by under a quarter, got ${moved}`)
    assert.ok(moved > 0, "and it does move")
})
