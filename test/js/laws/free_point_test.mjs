// The free spatial point — Phase 0 boundary, Phase 1 look-then-drag.
//
// Rulings under test:
//   ▪ `let B` makes a free spatial point. `as B do` gives that same identity a
//     head; its point then follows the head and is no longer independently
//     draggable.
//   ▪ A free B has x/y/z, no aim: heading and elevation both invent an
//     orientation it never stated. Bearing to B is different from B's own aim.
//   ▪ Looking never changes geometry. A drag is a motion request; a relationship
//     is a truth. Neither is an assignment nor an identity alias.
//   ▪ Publish only accepted geometry. A failed calculation is unresolved, not
//     proof that the truths are impossible.
//
// Phase 0 pinned the boundary; its two known gaps are now acceptance (a
// declaring body reads its own point; a free point has no invented aim).
// Phase 1 makes the drag 3D: for a free B, the camera-facing plane through B
// at pointer-down is frozen until release; the grab offset is kept; existing
// admission accepts or refuses the proposed world position.
// Run: node --test test/js/laws/free_point_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { createGesture } from "../../../assets/js/turtling/laws/gesture.js"
import { freePoint } from "../../../assets/js/turtling/laws/batch.js"
import {
    resolveBinding, frameWorldTransform, worldTransform,
} from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })


// --- a view, and a hand on it -------------------------------------------------
// `project` and `rayAt` are a matched pair: the ray through a projected point
// passes through that point. So a witness can name world points in pixels, and
// the drag plane really is camera-facing. Orthographic rays keep the numbers
// exact; the gesture sees only `project`/`rayAt`, exactly as the stage feeds it.
const sub = (a, b) => a.map((n, i) => n - b[i])
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0)
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
]
const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n) }

const view = ({ eye = [0, 0, 5], dir = [0, 0, -1], scale = 100 } = {}) => {
    const d = norm(dir)
    const up = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
    const r = norm(cross(d, up))
    const u = cross(r, d)
    return {
        dir: d,
        project: (w) => {
            const s = sub(w, eye)
            return { x: dot(s, r) * scale, y: dot(s, u) * scale }
        },
        rayAt: (x, y) => ({
            origin: [0, 1, 2].map((i) => eye[i] + r[i] * (x / scale) + u[i] * (y / scale)),
            direction: [...d],
        }),
    }
}

// A pinhole view: rays converge at the eye, like the stage's raycaster. The same
// matched pair as above — the ray through a projected point passes through it —
// so the only new fact is the perspective.
const pinhole = ({ eye = [0, 0, 5], dir = [0, 0, -1], up = [0, 1, 0], scale = 100 } = {}) => {
    const d = norm(dir)
    const r = norm(cross(d, up))
    const u = cross(r, d)
    return {
        dir: d,
        project: (w) => {
            const s = sub(w, eye)
            return { x: (dot(s, r) / dot(s, d)) * scale, y: (dot(s, u) / dot(s, d)) * scale }
        },
        rayAt: (x, y) => ({
            origin: [...eye],
            direction: norm([0, 1, 2].map((i) => d[i] + r[i] * (x / scale) + u[i] * (y / scale))),
        }),
    }
}

// A tilted view: 30° down from the flat one, so a screen-y drag has a z term.
const TILT = [0, 1, -Math.sqrt(3)]            // unit: [0, 0.5, −0.866…]

const harness = (scheduler, frames, { controlsEnabled = true, requestMotion, canTouch, start = view() } = {}) => {
    const requests = []
    const readouts = []
    const state = { captured: null, controls: { enabled: controlsEnabled }, woke: 0, view: start }
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
        project: (world) => state.view.project(world),
        rayAt: (x, y) => state.view.rayAt(x, y),
        facing: () => state.view.dir,        // the camera's viewing direction
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
        look: (v) => { state.view = v },   // the camera turns; no hand on B
    }
}

// One free `let b` at the origin, a reader `m` in another ambient at (4,0,0).
const freeB = (source = "let b\nas m do\n  goto 4 0\nend") => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", source))
    drive(scheduler)
    return { scheduler, host, b: host.children.get("b"), m: host.children.get("m") }
}

const accepted = (frame) => SE3.compose(worldTransform(frame), frame.transform.deref()).position

// ===========================================================================
// Phase 0 — the boundary. Characterization: present behavior, NOT law.
// ===========================================================================

test("characterization: B.x/y/z read the accepted position — from another body", () => {
    const { scheduler, b, m } = freeB()
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(b, {
        rotation: b.transform.deref().rotation, position: [3, 2, 0],
    }, revision).kind, "accept")
    assert.deepEqual([resolveBinding(m, "b.x"), resolveBinding(m, "b.y"), resolveBinding(m, "b.z")],
        [3, 2, 0], "the accepted position answers a reader in another ambient")
})

// ===========================================================================
// Phase 0 — the known gaps. These FAIL until the phase named closes them.
// ===========================================================================

test("acceptance: a declaring body reads its own declared point", () => {
    // Own children are the nearest kin, so the declaring body resolves the
    // place it declared by bare name — the same scope the `as` door uses.
    // Free point first: `let b` and nothing else — b.x is b's accepted x.
    const free = buildWorld({ admit: pass })
    const fHost = free.hotSwapChild("host", fork("host", "let b\ngoto b.x 1"))
    drive(free)
    assert.equal(fHost.error, null, "the declaring body names its own free point")
    assert.deepEqual(accepted(fHost).map((n) => +n.toFixed(6)), [0, 1, 0],
        "b.x is 0 — the accepted x of the free point")

    // And once `as b` has given it a head: the same identity, its accepted x.
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let b\nas b do\n  goto 3 0\nend\ngoto b.x 1"))
    drive(scheduler)
    assert.equal(host.error, null, "the declaring body names its own declared point")
    assert.deepEqual(accepted(host).map((n) => +n.toFixed(6)), [3, 1, 0],
        "b.x is b's accepted position")
})

test("acceptance: a free point exposes no invented orientation (bearing ≠ heading)", () => {
    const { scheduler, b, m } = freeB()
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(b, {
        rotation: b.transform.deref().rotation, position: [3, 2, 0],
    }, revision).kind, "accept")
    assert.deepEqual([resolveBinding(m, "b.x"), resolveBinding(m, "b.y"), resolveBinding(m, "b.z")],
        [3, 2, 0], "a free B has x/y/z")

    // The law is not "no zero": it is no INVENTION and no silence. The read must
    // wound (located) or stay unresolved — never answer a number, never fall through.
    let threw = null
    try { resolveBinding(m, "b.heading") } catch (e) { threw = e }
    assert.ok(threw, "b.heading must wound or stay unresolved — a free point has no heading to read")

    // Elevation is that same orientation through the other door: a free point has
    // none, so answering 0 would invent "level" exactly as heading invents a yaw.
    threw = null
    try { resolveBinding(m, "b.elevation") } catch (e) { threw = e }
    assert.ok(threw, "b.elevation must wound too — one door shut is not a boundary")

    // Bearing TO B is a real reading and is not B's own heading: it is the compass
    // to b LESS the observer's own facing. m stands at [4,0] facing +x (east, 90),
    // and b lies to its north-west, so the turn is negative — a left turn.
    const bearing = resolveBinding(m, "b.bearing")
    const expected = Math.atan2(3 - 4, 2 - 0) * (180 / Math.PI) - 90
    assert.ok(Math.abs(bearing - expected) < 1e-6,
        `bearing to b is ${expected}, not b's heading`)
})

test("acceptance: dragging is not confined to B's birth plane", () => {
    // (1) A free B the program moved OUT of its birth plane (z = 2) can be
    //     grabbed — the plane is the view's, not the birth frame's.
    {
        const { scheduler, b } = freeB("let b")
        const revision = scheduler.motionRevision
        assert.equal(scheduler.requestMotion(b, {
            rotation: b.transform.deref().rotation, position: [0, 0, 2],
        }, revision).kind, "accept", "program motion leaves the plane freely")

        const h = harness(scheduler, [b], {
            canTouch: freePoint,
            requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
        })
        assert.equal(h.down({ x: 0, y: 0 }).claimed, true, "an out-of-plane point is a point")
        assert.deepEqual(h.move({ x: 100, y: 0 }), { moved: true, outcome: "accepted" })
        assert.deepEqual(accepted(b).map((n) => +n.toFixed(6)), [1, 0, 2],
            "a flat-view drag keeps its z — and does not refuse the point")
    }

    // (2) Under a tilted view, a drag can change B's z. One screen-y step maps
    //     along the view's up axis: [0, cos 30°, sin 30°] at 100 px/unit.
    {
        const { scheduler, b } = freeB("let b")
        const h = harness(scheduler, [b], {
            canTouch: freePoint,
            start: view({ dir: TILT }),
            requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
        })
        const at = h.state.view.project(accepted(b))
        assert.equal(h.down(at).claimed, true)
        assert.deepEqual(h.move({ x: at.x, y: at.y + 100 }), { moved: true, outcome: "accepted" })
        assert.ok(Math.abs(accepted(b)[2] - 0.5) < 1e-6,
            `tilt view, drag B → B.z changes: z = ${accepted(b)[2]}`)
    }
})

// ===========================================================================
// Phase 1 — look, then drag in 3D. The exit tests.
// ===========================================================================

test("look → B unchanged: a look issues no motion, geometry or otherwise", () => {
    const { scheduler, b } = freeB("let b")
    const before = [...accepted(b)]
    const h = harness(scheduler, [b], {
        canTouch: freePoint,
        requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
    })
    h.look(view({ dir: TILT }))
    h.look(view())
    assert.deepEqual(h.requests, [], "looking never changes geometry")
    assert.deepEqual(accepted(b), before)

    // A hand that misses B asks for nothing either.
    assert.equal(h.down({ x: 500, y: 500 }).claimed, false)
    h.move({ x: 520, y: 500 })
    assert.deepEqual(h.requests, [], "no grab, no request")
    assert.deepEqual(accepted(b), before)
})

test("an agent-anchored B never claims the pointer", () => {
    const { scheduler, b } = freeB("let b\nas b do\n  goto 3 0\nend")
    assert.equal(freePoint(b), false, "as b gave the point its head")
    const h = harness(scheduler, [b], {
        canTouch: freePoint,
        requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
    })
    const at = h.state.view.project(accepted(b))
    assert.deepEqual(h.down(at), { claimed: false })
    assert.equal(h.state.captured, null, "nothing was captured")
    assert.equal(h.state.controls.enabled, true, "the camera was never taken")
    assert.deepEqual(h.requests, [])
})

test("rotate the view during capture: the frozen plane does not jump", () => {
    const { scheduler, b } = freeB("let b")
    const h = harness(scheduler, [b], {
        canTouch: freePoint,
        start: view({ dir: TILT }),
        requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
    })
    // Pointer-down under the TILTED view: the camera-facing plane through B is
    // tilted, so it is not B's birth plane and the two cannot be confused.
    const anchor = [...accepted(b)]
    const plane = { origin: anchor, normal: [...h.state.view.dir] }   // frozen at pointer-down
    const at = h.state.view.project(accepted(b))
    assert.equal(h.down(at).claimed, true)

    // A programmatic look mid-capture: the hand never asked for it.
    h.look(view())
    assert.deepEqual(h.requests, [], "looking during a capture changes nothing yet")

    // The drag continues on the plane frozen at pointer-down — this move maps
    // to z = −0.866 on that plane. A birth-plane drag would propose z = 0, off
    // the frozen plane by 0.75; a re-derived view plane would leave it too.
    const moved = h.move({ x: at.x, y: at.y + 100 })
    assert.deepEqual(moved, { moved: true, outcome: "accepted" })
    const world = SE3.compose(worldTransform(b), h.requests[0].pose).position
    const offPlane = Math.abs(dot(sub(world, plane.origin), plane.normal))
    assert.ok(offPlane < 1e-9, `the proposal left the frozen plane by ${offPlane}`)
})

test("cancel and refusal produce no false motion, in 3D", () => {
    // Cancel: accepted movement stands; nothing pending is ever applied.
    {
        const { scheduler, b } = freeB("let b")
        const h = harness(scheduler, [b], {
            canTouch: freePoint,
            start: view({ dir: TILT }),
            requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
        })
        const at = h.state.view.project(accepted(b))
        h.down(at)
        assert.deepEqual(h.move({ x: at.x, y: at.y + 100 }), { moved: true, outcome: "accepted" })
        const stood = [...accepted(b)]
        assert.ok(Math.abs(stood[2] - 0.5) < 1e-6, "the accepted move really went 3D")
        h.cancel()
        assert.equal(h.state.captured, null)
        assert.deepEqual(accepted(b), stood, "cancel undoes no accepted move")
        assert.equal(h.requests.length, 1, "and asks for nothing further")
    }

    // Refusal: no geometry changes, z included — a refused move is not motion.
    {
        const { scheduler, b } = freeB("let b")
        const before = [...accepted(b)]
        const h = harness(scheduler, [b], {
            canTouch: freePoint,
            start: view({ dir: TILT }),
            requestMotion: () => ({ kind: "refuse" }),
        })
        const at = h.state.view.project(accepted(b))
        h.down(at)
        assert.deepEqual(h.move({ x: at.x, y: at.y + 100 }), { moved: true, outcome: "rejected" })
        assert.deepEqual(accepted(b), before, "a failed calculation is not motion")
    }
})

test("the accepted z is published: a reader in another ambient sees one instant", () => {
    const source = "let b\nas m do\n  wait 1\nend"
    const { scheduler, b, m } = freeB(source)
    const h = harness(scheduler, [b], {
        canTouch: freePoint,
        start: view({ dir: TILT }),
        requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
    })
    const at = h.state.view.project(accepted(b))
    h.down(at)
    h.move({ x: at.x, y: at.y + 100 })
    const stood = [...accepted(b)]

    // The same play's reader sees the same accepted geometry — no second store.
    const round = (n) => Math.round(n * 1e9) / 1e9   // readings round to 1e-9
    assert.equal(resolveBinding(m, "b.z"), round(stood[2]), "reader and point agree")
    assert.equal(resolveBinding(m, "b.y"), round(stood[1]))
})

test("a fresh play inherits no hand state", () => {
    const source = "let b\nas m do\n  wait 1\nend"
    const { scheduler, b } = freeB(source)
    const h = harness(scheduler, [b], {
        canTouch: freePoint,
        start: view({ dir: TILT }),
        requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
    })
    const at = h.state.view.project(accepted(b))
    h.down(at)
    h.move({ x: at.x, y: at.y + 100 })
    const stood = [...accepted(b)]
    assert.ok(Math.abs(stood[2]) > 1e-6, "the hand really moved the point off its plane")

    // `fresh` is the NEW PLAY door: realize anew, inherit nothing.
    const next = scheduler.hotSwapChild("host", fork("host", source), { fresh: true })
    drive(scheduler)
    const again = next.children.get("b")
    assert.ok(again, "the fresh play seats the declaration again")
    assert.deepEqual(accepted(again).map((n) => +n.toFixed(6)), [0, 0, 0],
        "a fresh play inherits no hand state")
})

test("perspective: a flat camera drags in xy only — z is never invented", () => {
    // The drag plane is THE CAMERA'S plane through B — parallel to the image
    // plane — not the plane ⟂ the line of sight through B. Under perspective
    // those differ off-axis: the sight plane tilts at the screen edge and would
    // slide the point to [2.419, 0.968, 0.161] even on a flat view.
    const { scheduler, b } = freeB("let b")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(b, {
        rotation: b.transform.deref().rotation, position: [2, 1, 0],
    }, revision).kind, "accept")
    const h = harness(scheduler, [b], {
        canTouch: freePoint,
        start: pinhole(),
        requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
    })
    const at = h.state.view.project(accepted(b))       // (40, 20): 100 px/unit at depth 5
    assert.equal(h.down(at).claimed, true)
    h.move({ x: at.x + 10, y: at.y })
    const world = SE3.compose(worldTransform(b), h.requests[0].pose).position
    assert.deepEqual(world.map((n) => +n.toFixed(6)), [2.5, 1, 0],
        "flat camera: the drag stays on z = 0, exactly under the cursor")
})

test("characterization (not law): the pixel→plane mapping follows the live camera", () => {
    // The PLANE is frozen at pointer-down; the rays are not. After a mid-capture
    // look, a finger returning to its down pixel does not return the point to its
    // grab position. Phase 1 freezes the plane because the ruling names the plane;
    // freezing the mapping itself would need the down-time camera at the seam.
    // Named here so nobody mistakes this for a law.
    const { scheduler, b } = freeB("let b")
    const h = harness(scheduler, [b], {
        canTouch: freePoint,
        requestMotion: (frame, pose, rev) => scheduler.requestMotion(frame, pose, rev),
    })
    const at = h.state.view.project(accepted(b))
    h.down(at)
    const anchor = [...accepted(b)]
    h.look(view({ dir: TILT }))
    h.move({ x: at.x, y: at.y })                       // the very pixel it was grabbed on
    const world = SE3.compose(worldTransform(b), h.requests[0].pose).position
    assert.ok(Math.hypot(...sub(world, anchor)) > 0.5,
        "the point left its grab position while the finger returned to its pixel")
})
