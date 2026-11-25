// The circle hand, measured. A circle — a distance met by a plane — used to take the
// frozen camera plane, and the law clamped that request back onto the circle. In an
// oblique view the clamp IS the whole error: the pointer walks the projected ellipse
// while the point walks the circle. The first two tests are the pair that says so —
// the defect recorded, then the hand that removes it — and the rest are the four ways
// the removal could have been bought too dearly: a branch jump, a lost turn, an
// off-curve teleport, a phase guessed where the view cannot disclose one.
// Assertions are in SCREEN space and in samples of the hand's own ring, so they mean
// the same thing at any camera or zoom. (id:laws-decl-handle, id:laws-decl-anchor)
// Run: node --test test/js/laws/circle_hand_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { circleHand, handFor } from "../../../assets/js/turtling/laws/hand.js"
import { facingPlane, touchPlane } from "../../../assets/js/turtling/laws/handle.js"
import { nearest } from "../../../assets/js/turtling/laws/meet.js"

const W = 1000, H = 1000, T = Math.tan(Math.PI / 6), UP = [0, 1, 0]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a) => { const n = Math.hypot(...a) || 1; return a.map((x) => x / n) }
const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)

// A pinhole at `eye` looking at the origin — the camera the conic witness already uses.
const pinhole = (eye, up = UP) => {
    const f = unit(sub([0, 0, 0], eye)), r = unit(cross(f, up)), u = cross(r, f)
    const project = (w) => {
        const v = sub(w, eye), z = dot(v, f)
        return z <= 0 ? null : { x: W / 2 + (dot(v, r) / (z * T)) * (W / 2), y: H / 2 - (dot(v, u) / (z * T)) * (H / 2) }
    }
    return {
        f, project,
        rayAt: (px, py) => {
            const nx = ((px - W / 2) / (W / 2)) * T, ny = -((py - H / 2) / (H / 2)) * T
            return { origin: [...eye], direction: unit([f[0] + nx * r[0] + ny * u[0], f[1] + nx * r[1] + ny * u[1], f[2] + nx * r[2] + ny * u[2]]) }
        },
    }
}

const R = 5, N = 96
const ARC = (Math.PI * 2) / N                      // one sample of the hand's own ring
const wrap = (t) => Math.atan2(Math.sin(t), Math.cos(t))
const LOCUS = { kind: "circle", center: [0, 0, 0], normal: [0, 0, 1], radius: R }
const at = (phi) => [R * Math.cos(phi), R * Math.sin(phi), 0]
const offCircle = (p) => Math.abs(Math.hypot(p[0], p[1]) - R) + Math.abs(p[2])
const OBLIQUE = [6, -8, 4]                          // the view the defect lives in

// A grab and the moves that follow it: freeze once, then read the phase the hand
// answers with, in samples of its own ring, so a step can be named without a camera.
const grab = (cam, anchor = at(0)) => {
    const state = circleHand.freeze({ anchor, ray: cam.rayAt(0, 0), project: cam.project, locus: LOCUS })
    return {
        state,
        held: anchor,
        phase: (p) => state.rig.phaseOf(p),
        apart: (a, b) => wrap(state.rig.phaseOf(a) - state.rig.phaseOf(b)) / ARC,
        place: (pointer, accepted) => circleHand.place(state, { pointer, project: cam.project, anchor: accepted }),
    }
}

// The world's move, faithfully: the frozen plane through the grab, its offset carried,
// then the law's projection onto the circle. This is what shipped before the hand.
const onPlane = (cam, accepted) => {
    const plane = facingPlane(accepted, cam.f)
    const s0 = cam.project(accepted)
    const offset = sub(accepted, touchPlane(cam.rayAt(s0.x, s0.y), plane))
    return (pointer) => {
        const hit = touchPlane(cam.rayAt(pointer.x, pointer.y), plane)
        if (!hit) return accepted
        const landed = nearest(LOCUS, hit.map((v, k) => v + offset[k]))
        return landed.ok ? landed.at : accepted
    }
}

test("the defect, recorded: the frozen plane loses the circle it is clamped to", () => {
    const cam = pinhole(OBLIQUE)
    const move = onPlane(cam, at(0))
    let worst = 0
    for (let i = 0; i <= N; i++) {
        const pointer = cam.project(at((i / N) * Math.PI * 2))
        worst = Math.max(worst, gap(cam.project(move(pointer)), pointer))
    }
    // 3px is the tolerance the browser rung already documents for following a curve.
    assert.ok(worst > 3, `frozen plane worst gap ${worst.toFixed(2)}px — if this ever goes under 3, the hand below is redundant`)
})

test("oblique: the hand follows the projected circle a finger can see", () => {
    const cam = pinhole(OBLIQUE)
    const g = grab(cam)
    assert.ok(g.state, "the hand freezes on an oblique view of the circle")
    let accepted = g.held, worst = 0, off = 0, advance = 0, prev = null
    for (let i = 0; i <= N; i++) {
        const pointer = cam.project(at((i / N) * Math.PI * 2))
        const placed = g.place(pointer, accepted)
        worst = Math.max(worst, gap(cam.project(placed), pointer))
        off = Math.max(off, offCircle(placed))
        if (prev) advance = Math.max(advance, g.apart(placed, prev))
        prev = placed
        accepted = placed                              // the law accepts a point already on the circle
    }
    assert.ok(worst < 1, `worst gap ${worst.toFixed(2)}px — better than the 3px the plane cannot reach`)
    assert.ok(off < 1e-9, "every placement is on the circle")
    // One sample of walk, so the phase may not run further than a sample or so.
    assert.ok(advance < 2, `the phase ran ${advance.toFixed(2)} samples for a one-sample walk — a branch jump`)
})

test("a zero-delta grab keeps the grip: the hand does not move what it was handed", () => {
    const cam = pinhole(OBLIQUE)
    const anchor = at(0.7)                             // deliberately between two samples
    const g = grab(cam, anchor)
    const placed = g.place(cam.project(anchor), anchor)
    assert.ok(gap(cam.project(placed), cam.project(anchor)) < 0.5, "the grab moved the point it was handed")
    assert.ok(offCircle(placed) < 1e-9, "and it kept the point on the circle")
})

test("reversal: the phase tracks back — no hysteresis, no jump home", () => {
    const cam = pinhole(OBLIQUE)
    const g = grab(cam)
    const start = g.held
    let accepted = start, worst = 0, off = 0
    const move = (world) => {
        const placed = g.place(cam.project(world), accepted)
        worst = Math.max(worst, gap(cam.project(placed), cam.project(world)))
        off = Math.max(off, offCircle(placed))
        accepted = placed
    }
    for (let i = 1; i <= 30; i++) move(at(i * ARC))
    assert.ok(Math.abs(g.apart(accepted, at(30 * ARC))) < 0.5, "the walk out did not arrive")
    for (let i = 29; i >= 0; i--) move(at(i * ARC))
    assert.ok(Math.abs(g.apart(accepted, start)) < 0.5, `came back ${g.apart(accepted, start).toFixed(2)} samples from the start`)
    assert.ok(worst < 1 && off < 1e-9, `worst gap ${worst.toFixed(2)}px on the way back`)
})

test("a full turn comes home, staying on the circle the whole way", () => {
    const cam = pinhole(OBLIQUE)
    const g = grab(cam)
    const start = cam.project(g.held)
    let accepted = g.held, off = 0, advance = 0, prev = g.held
    for (let i = 1; i <= N; i++) {
        const placed = g.place(cam.project(at(i * ARC)), accepted)
        off = Math.max(off, offCircle(placed))
        advance = Math.max(advance, g.apart(placed, prev))
        accepted = placed
        prev = placed
    }
    assert.ok(gap(cam.project(accepted), start) < 0.5, "a turn did not end where it began")
    assert.ok(off < 1e-9, "the point never left the circle")
    assert.ok(advance < 2, `the phase ran ${advance.toFixed(2)} samples — a dial carries no memory of its step size`)
})

test("an off-curve pull lands on the circle without teleporting across it", () => {
    const cam = pinhole(OBLIQUE)
    const g = grab(cam)
    // The finger slips off the curve along the ellipse's own normal — the honest
    // tear-off — and the point must stay where the finger left it, out on the curve.
    const i0 = g.state.rig.index(Math.round((g.phase(g.held) / (Math.PI * 2)) * N))
    const a = g.state.rig.samples[(i0 + N - 2) % N].screen
    const b = g.state.rig.samples[(i0 + 2) % N].screen
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
    const s0 = cam.project(g.held)
    let placed = g.held, run = 0
    for (let t = 0; t <= 300; t += 10) {               // and keeps slipping
        placed = g.place({ x: s0.x + nx * t, y: s0.y + ny * t }, g.held)
        run = Math.max(run, Math.abs(g.apart(placed, g.held)))
    }
    assert.ok(offCircle(placed) < 1e-9, "a pull off the curve still lands ON the curve")
    assert.ok(run < 3, `the phase ran ${run.toFixed(2)} samples — the point teleported along the curve`)
})

test("grazing: an edge-on view discloses no phase, so the hand holds", () => {
    const cam = pinhole([-10, 0, 0])                   // the eye sits in the circle's own plane
    const g = grab(cam, at(0))
    assert.ok(g.state, "the ring still samples (as a segment); it is the PHASE that is undecidable")
    assert.deepEqual(g.place(cam.project(at(1.2)), g.held), g.held, "a grazing view holds rather than guessing")
    assert.deepEqual(g.place({ x: W * 0.9, y: H * 0.9 }, g.held), g.held, "and it keeps holding for the whole sweep")
})

test("refusal advances nothing: the proposal depends on the world, not on the walk", () => {
    const cam = pinhole(OBLIQUE)
    const straight = grab(cam, at(0))
    const decoyed = grab(cam, at(0))
    const clean = [], poked = []
    for (let i = 0; i <= N; i++) {
        const pointer = cam.project(at(i * ARC))
        clean.push(straight.place(pointer, straight.held))
        // The finger is torn away twice and the law REFUSES it; the world never moves.
        decoyed.place({ x: 10, y: 10 }, decoyed.held)
        decoyed.place({ x: W - 10, y: H - 10 }, decoyed.held)
        poked.push(decoyed.place(pointer, decoyed.held))
    }
    assert.deepEqual(poked, clean, "a refused move advanced the phase: the hand remembered its walk")
})

test("the whole-law gate still chooses the hand: circle only, and it rejects nothing", () => {
    const sphere = { kind: "sphere", center: [0, 0, 0], radius: R }
    assert.equal(handFor(LOCUS), circleHand)
    assert.notEqual(handFor(sphere), circleHand, "a sphere keeps its own hand")
    assert.equal(handFor({ kind: "plane", point: [0, 0, 0], normal: [0, 0, 1] }), null, "everything else keeps the frozen plane")
    assert.equal(circleHand.rejects, false, "a hand that cannot freeze falls back to the plane, never to a refusal")
})
