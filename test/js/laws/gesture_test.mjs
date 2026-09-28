// The gesture's composition. The predicates and the formatting are witnessed
// elsewhere; what is proved here is that they compose — arbitration, the grab
// offset, cancellation on a changed declaration, and ownership restoration.
// (id:laws-decl-handle)
// Run: node --test test/js/laws/gesture_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { createGesture } from "../../../assets/js/turtling/laws/gesture.js"
import { DRAG_SLOP } from "../../../assets/js/turtling/laws/feel.js"
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
const harness = (scheduler, frames, { controlsEnabled = true, requestMotion, canTouch, locusOf, facing = [0, 0, -1], slop = 0, view = null, detents = null } = {}) => {
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
        project: view ? (world) => view.project(world) : (world) => ({ x: world[0] * 100, y: world[1] * 100 }),
        rayAt: view ? (x, y) => view.rayAt(x, y) : (x, y) => ({ origin: [x / 100, y / 100, 5], direction: [...facing] }),
        facing: view ? () => view.facing() : () => facing,
        capture: ({ pointerId }) => { state.captured = pointerId },
        release: () => { state.captured = null },
        setControls: (enabled) => { state.controls.enabled = enabled },
        controlsEnabled: () => state.controls.enabled,
        onReadout: (line) => readouts.push(line),
        locusOf,
        detents,
        slop,
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

// A real perspective camera, so a witness names a direction in pixels and the
// ball answers the geometry the shell draws. The flat world×100 ray could not
// see the far side at all. (id:laws-decl-interface)
const pinhole = (eye, { width = 800, height = 800, fov = 60, up = [0, 1, 0] } = {}) => {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const unit = (a) => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n] }
    const f = unit([-eye[0], -eye[1], -eye[2]])
    const r = unit(cross(f, up))
    const u = cross(r, f)
    const half = Math.tan(fov * Math.PI / 360)
    return {
        facing: () => [...f],
        project(world) {
            const v = sub(world, eye)
            const z = dot(v, f)
            if (z <= 0) return null
            return {
                x: width / 2 + (dot(v, r) / (z * half)) * (width / 2),
                y: height / 2 - (dot(v, u) / (z * half)) * (height / 2),
            }
        },
        rayAt(x, y) {
            const nx = ((x - width / 2) / (width / 2)) * half
            const ny = -((y - height / 2) / (height / 2)) * half
            return {
                origin: [...eye],
                direction: unit([
                    f[0] + nx * r[0] + ny * u[0],
                    f[1] + nx * r[1] + ny * u[1],
                    f[2] + nx * r[2] + ny * u[2],
                ]),
            }
        },
    }
}

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

// The ball's hand is its own surface under the pointer: the grabbed point follows
// the finger, the mirrored back included. (id:laws-decl-anchor)
test("a zero-delta grab moves nothing, at every camera angle", () => {
    const eyes = [[0, 0, 60], [0, 18, 60], [0, 52, 30], [60, 0, 0], [-60, 0, 0]]
    for (const eye of eyes) {
        const { scheduler, A, world } = onSphere([3, 0, 4])
        const before = [...A.transform.deref().position]
        const view = pinhole(eye)
        const h = harness(scheduler, [A], {
            view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
        })
        const px = view.project(world)
        assert.equal(h.down(px).claimed, true, `claimed at ${eye}`)
        h.move(px)
        assert.ok(same(A.transform.deref().position, before, 1e-9),
            `an identical pixel is an identical point at ${eye}`)
    }
})

test("a zero-delta grab at the pole moves nothing", () => {
    const { scheduler, A } = onSphere([0, 0, 5])
    const before = [...A.transform.deref().position]
    const view = pinhole([0, 40, 40])
    const h = harness(scheduler, [A], {
        view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const px = view.project([0, 0, 5])
    assert.equal(h.down(px).claimed, true)
    h.move(px)
    assert.ok(same(A.transform.deref().position, before, 1e-9), "the pole holds where the pointer holds")
    assert.ok(Math.abs(Math.hypot(...A.transform.deref().position) - 5) < 1e-9, "still on the sphere")
})

// The bug that started this: a point seen from the far side used to pull the
// other way. The mirrored back must turn with the finger. (id:laws-decl-anchor)
test("a grab follows the pointer, on the near face and the far one", () => {
    const cases = [
        { eye: [0, 30, 60], at: [3, 0, 4], where: "near" },
        { eye: [-60, 0, 20], at: [3, 0, 4], where: "far" },
        { eye: [0, 30, -60], at: [3, 0, 4], where: "under" },
    ]
    for (const { eye, at, where } of cases) {
        const { scheduler, A } = onSphere(at)
        const view = pinhole(eye)
        const h = harness(scheduler, [A], {
            view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
        })
        const s0 = view.project(at)
        assert.equal(h.down(s0).claimed, true, `claimed ${where}`)
        const d = { x: 24, y: 8 }
        h.move({ x: s0.x + d.x, y: s0.y + d.y })
        const s1 = view.project(A.transform.deref().position)
        const moved = Math.hypot(s1.x - s0.x, s1.y - s0.y)
        const cos = ((s1.x - s0.x) * d.x + (s1.y - s0.y) * d.y) / (moved * Math.hypot(d.x, d.y))
        assert.ok(cos > 0.5, `the point follows the pointer ${where}, cos = ${cos.toFixed(2)}`)
    }
})

test("a full circular hand path comes home on the ball", () => {
    const { scheduler, A } = onSphere([5 * Math.cos(Math.PI / 15), 0, 5 * Math.sin(Math.PI / 15)])
    const view = pinhole([0, 0, 60])
    const h = harness(scheduler, [A], {
        view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const start = [...A.transform.deref().position]
    const s0 = view.project(start)
    const hub = view.project([0, 0, 0])
    const r = Math.hypot(s0.x - hub.x, s0.y - hub.y)
    const a0 = Math.atan2(s0.y - hub.y, s0.x - hub.x)
    const at = (frac) => ({ x: hub.x + r * Math.cos(a0 + frac * Math.PI * 2), y: hub.y + r * Math.sin(a0 + frac * Math.PI * 2) })
    assert.equal(h.down(s0).claimed, true)
    for (let i = 1; i <= 3; i++) h.move(at(i / 12))
    assert.ok(Math.abs(A.transform.deref().position[1]) > 1, "a quarter turn moves the azimuth")
    for (let i = 4; i <= 12; i++) h.move(at(i / 12))
    const landed = A.transform.deref().position
    assert.ok(Math.abs(Math.hypot(...landed) - 5) < 1e-9, "and stays on the sphere")
    assert.ok(same(landed, start, 1e-6), `and a full turn comes home, got ${landed}`)
})

test("stretching out reaches the paper; pulling in lifts off it", () => {
    const { scheduler, A } = onSphere([5 * Math.cos(Math.PI / 15), 0, 5 * Math.sin(Math.PI / 15)])
    const view = pinhole([0, 0, 60])
    const h = harness(scheduler, [A], {
        view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const rho0 = Math.hypot(A.transform.deref().position[0], A.transform.deref().position[1])
    const s0 = view.project(A.transform.deref().position)
    const hub = view.project([0, 0, 0])
    const n = Math.hypot(s0.x - hub.x, s0.y - hub.y)
    assert.equal(h.down(s0).claimed, true)
    h.move({ x: hub.x + ((s0.x - hub.x) / n) * 80, y: hub.y + ((s0.y - hub.y) / n) * 80 })
    const landed = A.transform.deref().position
    assert.ok(Math.abs(landed[2]) < 1e-6, `out lands on the paper circle, got z = ${landed[2]}`)
    const rho = Math.hypot(landed[0], landed[1])
    assert.ok(rho + 1e-9 >= rho0, `out grows the parallel, ${rho0} → ${rho}`)

    const { scheduler: s2, A: B } = onSphere([5, 0, 0])
    const h2 = harness(s2, [B], {
        view, canTouch: freePoint, locusOf: locusOfWorld(s2), requestMotion: realMotion(s2),
    })
    h2.down(view.project([5, 0, 0]))
    h2.move(hub)
    assert.ok(B.transform.deref().position[2] > 0.9,
        `inward lifts off the paper, got ${B.transform.deref().position}`)
})

test("an off-centre grab on a sphere does not snap to the pointer", () => {
    const { scheduler, A } = onSphere([3, 0, 4])
    const view = pinhole([0, 30, 60])
    const h = harness(scheduler, [A], {
        view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const before = [...A.transform.deref().position]
    const s0 = view.project(before)
    assert.equal(h.down({ x: s0.x + 6, y: s0.y + 5 }).claimed, true)
    assert.equal(h.move({ x: s0.x + 8, y: s0.y + 7 }).outcome, "accepted")
    const landed = A.transform.deref().position
    assert.ok(Math.abs(Math.hypot(...landed) - 5) < 1e-6, "still on the sphere")
    const s1 = view.project(landed)
    const step = Math.hypot(s1.x - s0.x, s1.y - s0.y)
    assert.ok(step < 12, `a tiny step is a tiny move, got ${step.toFixed(1)} px`)
    assert.ok(Math.hypot(s1.x - (s0.x + 8), s1.y - (s0.y + 7)) > 3, `snapped to the pointer: ${landed}`)
})

test("a click inside slop does not move the point", () => {
    const { scheduler, a } = seated()
    const before = [...a.transform.deref().position]
    const h = harness(scheduler, [a], { slop: DRAG_SLOP })
    assert.equal(h.down({ x: 300, y: 0 }).claimed, true)
    assert.deepEqual(h.move({ x: 301, y: 0 }), { moved: false })
    h.up()
    assert.deepEqual(a.transform.deref().position, before, "a click is not a drag")
    assert.equal(h.requests.length, 0)
})

test("a short pull moves the point with the finger", () => {
    const { scheduler, A } = onSphere([5 * Math.cos(Math.PI / 15), 0, 5 * Math.sin(Math.PI / 15)])
    const view = pinhole([0, 0, 60])
    const h = harness(scheduler, [A], {
        view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const s0 = view.project(A.transform.deref().position)
    assert.equal(h.down(s0).claimed, true)
    h.move({ x: s0.x - 20, y: s0.y })
    const s1 = view.project(A.transform.deref().position)
    const moved = Math.hypot(s1.x - s0.x, s1.y - s0.y)
    assert.ok(moved > 12 && moved < 24, `a 20 px pull moves the point by about 20 px, got ${moved}`)
})

test("dragging in to the centre climbs to the pole without spinning", () => {
    const { scheduler, A } = onSphere([5, 0, 0])
    const view = pinhole([0, 0, 60])
    const h = harness(scheduler, [A], {
        view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const hub = view.project([0, 0, 0])
    assert.equal(h.down(view.project([5, 0, 0])).claimed, true)
    h.move(hub)
    const landed = A.transform.deref().position
    assert.ok(landed[2] > 4, `the centre is the pole, got ${landed}`)
    assert.ok(Math.abs(landed[1]) < 0.3, `and it did not spin, got ${landed}`)
})

test("at the pole, a left pull and an up pull leave at a like pace", () => {
    const go = (d) => {
        const { scheduler, A } = onSphere([0, 0, 5])
        const view = pinhole([0, 40, 40])
        const h = harness(scheduler, [A], {
            view, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
        })
        const s0 = view.project([0, 0, 5])
        assert.equal(h.down(s0).claimed, true)
        h.move({ x: s0.x + d.x, y: s0.y + d.y })
        const p = A.transform.deref().position
        return Math.hypot(p[0], p[1], p[2] - 5)
    }
    const left = go({ x: 40, y: 0 })
    const along = go({ x: 0, y: 40 })
    assert.ok(left > 0.2 && along > 0.2, `both pulls leave the pole, left ${left} along ${along}`)
    assert.ok(Math.max(left, along) / Math.min(left, along) < 4,
        `left/right must not explode beside the other axis: left ${left} along ${along}`)
})

// Slight stickiness: a grab that starts on a landmark is held there a little.
// (id:laws-decl-anchor)
test("the paper detent holds a grab that starts on the paper", () => {
    const at = [0, 5, 0]
    const view = pinhole([0, 30, 60])
    const run = (detents) => {
        const { scheduler, A } = onSphere(at)
        const h = harness(scheduler, [A], {
            view, detents, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
        })
        const s0 = view.project(at)
        assert.equal(h.down(s0).claimed, true)
        h.move({ x: s0.x, y: s0.y + 0.5 })
        return A.transform.deref().position[2]
    }
    const raw = run(null)
    const stuck = run({ paper: true })
    assert.ok(Math.abs(raw) > 0.02, `the raw grab leaves the paper, got z = ${raw}`)
    assert.ok(Math.abs(stuck) < Math.abs(raw) / 2, `the detent holds it near the paper, ${raw} → ${stuck}`)
})

test("the pole detent holds a grab that starts on the pole", () => {
    const at = [0, 0, 5]
    const view = pinhole([0, 40, 40])
    const run = (detents) => {
        const { scheduler, A } = onSphere(at)
        const h = harness(scheduler, [A], {
            view, detents, canTouch: freePoint, locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
        })
        const s0 = view.project(at)
        assert.equal(h.down(s0).claimed, true)
        h.move({ x: s0.x + 0.5, y: s0.y })
        const p = A.transform.deref().position
        return Math.hypot(p[0], p[1], p[2] - 5)
    }
    const raw = run(null)
    const stuck = run({ poles: true })
    assert.ok(raw > 0.01, `the raw grab leaves the pole, got ${raw}`)
    assert.ok(stuck < raw / 2, `the detent holds it near the pole, ${raw} → ${stuck}`)
})

// A cone is a 2-DOF surface: its hand is the cone's own polar about the apex, and
// the ball's detents must not fire on it. (id:laws-decl-anchor)
test("a cone point circles without jumping the height, and the detents never bend it", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let B = [0, 0, 0]\nlet P\nas B do\n  let P.tilt = 30\nend"))
    drive(scheduler)
    const P = find(host, "P")
    const before = [...frameWorldTransform(P).position]
    const view = pinhole([150, -450, 600])
    const h = harness(scheduler, [P], {
        view, detents: { paper: true, poles: true }, canTouch: freePoint,
        locusOf: locusOfWorld(scheduler), requestMotion: realMotion(scheduler),
    })
    const s0 = view.project(before)
    const hub = view.project([0, 0, 0])               // B, the apex
    const r0 = Math.hypot(s0.x - hub.x, s0.y - hub.y)
    const psi0 = Math.atan2(s0.y - hub.y, s0.x - hub.x)
    const tiltOf = (p) => { const r = Math.hypot(...p); return r < 1e-9 ? 0 : (Math.acos(p[0] / r) * 180) / Math.PI }
    assert.equal(h.down(s0).claimed, true)
    // Circling the apex's projection is a pure turn: the height — the tilt — is
    // held on every step, so a circle never jumps the height, and the ball's
    // detents never bend it. (id:laws-freedom)
    let spread = 0
    for (let i = 1; i <= 8; i++) {
        const psi = psi0 + (i * Math.PI) / 12
        h.move({ x: hub.x + r0 * Math.cos(psi), y: hub.y + r0 * Math.sin(psi) })
        const p = [...frameWorldTransform(P).position]
        assert.ok(Math.abs(tiltOf(p) - 30) < 1e-3, `a circle holds the tilt, got ${tiltOf(p)} at step ${i}`)
        spread = Math.max(spread, Math.hypot(p[0] - before[0], p[1] - before[1], p[2] - before[2]))
    }
    assert.ok(spread > 0.5, `the point circles, got ${spread.toFixed(2)}`)
})
