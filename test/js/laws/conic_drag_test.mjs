// The conic hand, measured. A conic has no sphere branch in the gesture, so it
// takes the frozen camera plane and the law's nearest — which for a conic is a
// bounded sample (meet.js, conicSamples 128). This file records what that
// actually does under a finger. It is a characterization, not a law: it should
// go red the day the hand gets an exact, parameter-driven projection in the
// conic's own plane. (id:laws-freedom)
// Run: node --test test/js/laws/conic_drag_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { conic, conicSamples, nearest } from "../../../assets/js/turtling/laws/meet.js"
import { facingPlane, touchPlane } from "../../../assets/js/turtling/laws/handle.js"

const W = 1000, H = 1000, T = Math.tan(Math.PI / 6), UP = [0, 1, 0]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a) => { const n = Math.hypot(...a) || 1; return a.map((x) => x / n) }

// A pinhole at `eye`, looking at the origin.
const pinhole = (eye) => {
    const f = unit(sub([0, 0, 0], eye)), r = unit(cross(f, UP)), u = cross(r, f)
    const project = (w) => {
        const v = sub(w, eye), z = dot(v, f)
        return z <= 0 ? null : { x: W / 2 + (dot(v, r) / (z * T)) * (W / 2), y: H / 2 - (dot(v, u) / (z * T)) * (H / 2) }
    }
    const rayAt = (px, py) => {
        const nx = ((px - W / 2) / (W / 2)) * T, ny = -((py - H / 2) / (H / 2)) * T
        return { origin: [...eye], direction: unit([f[0] + nx * r[0] + ny * u[0], f[1] + nx * r[1] + ny * u[1], f[2] + nx * r[2] + ny * u[2]]) }
    }
    return { f, project, rayAt }
}

// An ellipse in the paper's plane, by the same quadratic the cone cut hands over.
const ellipse = (a, b) => conic("ellipse", [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [1 / (a * a), 0, 1 / (b * b), 0, 0, -1])

// The exact-ish nearest, by a dense trace — the reference the hand should match.
const reference = (co, target) => {
    let best = null, bestD = Infinity
    for (const b of conicSamples(co, { steps: 2000 })) for (const p of b) {
        const d = Math.hypot(...sub(p, target))
        if (d < bestD) { bestD = d; best = p }
    }
    return best
}

// Sweep a finger across the conic's projection and watch the hand (the real
// frozen plane through the anchor + `nearest`) against the fine reference.
const sweep = (co, eye, t0, dir, { span = 240, steps = 240 } = {}) => {
    const cam = pinhole(eye)
    const trace = conicSamples(co)[0]
    const anchor = trace[Math.floor(trace.length * t0)]
    const s0 = cam.project(anchor)
    const plane = facingPlane(anchor, cam.f)
    const offset = sub(anchor, touchPlane(cam.rayAt(s0.x, s0.y), plane))
    const seen = new Set()
    let moved = 0, flips = 0, flipsRef = 0, maxStep = 0, maxErr = 0, prev = null, prevRef = null
    for (let i = 0; i <= steps; i++) {
        const k = (i / steps - 0.5) * span
        const request = add(touchPlane(cam.rayAt(s0.x + dir[0] * k, s0.y + dir[1] * k), plane), offset)
        const at = nearest(co, request).at
        const want = reference(co, request)
        seen.add(at.map((x) => x.toFixed(4)).join(","))
        const p = cam.project(at), q = cam.project(want)
        if (prev) {
            const d = Math.hypot(p.x - prev.x, p.y - prev.y)
            if (d > 1e-6) moved += 1
            if (d > 20) flips += 1
            maxStep = Math.max(maxStep, d)
        }
        if (prevRef && Math.hypot(q.x - prevRef.x, q.y - prevRef.y) > 20) flipsRef += 1
        maxErr = Math.max(maxErr, Math.hypot(p.x - q.x, p.y - q.y))
        prev = p; prevRef = q
    }
    return { steps, moved, distinct: seen.size, flips, flipsRef, maxStep, maxErr, step: span / steps }
}

test("a conic point lands on the exact locus", () => {
    const co = ellipse(100, 60)
    const at = nearest(co, [30, 40, 0]).at
    const [A, B, C, D, E, F] = co.Q
    const d = sub(at, co.origin)
    const uu = dot(d, co.u), vv = dot(d, co.v)
    assert.ok(Math.abs(A * uu * uu + B * uu * vv + C * vv * vv + D * uu + E * vv + F) < 1e-6,
        `the hand lands on the quadratic, got ${at}`)
})

test("characterization (not law): the sampled conic hand staircases", () => {
    const m = sweep(ellipse(100, 60), [0, 0, 500], 0.25, [1, 0])
    assert.ok(m.distinct < m.steps * 0.75, `${m.distinct} distinct points for ${m.steps} finger steps`)
    assert.ok(m.maxStep > 2 * m.step, `a ${m.step}px finger step jumps the hand ${m.maxStep.toFixed(2)}px`)
    assert.ok(m.maxErr > 0.5, `the landed point is up to ${m.maxErr.toFixed(2)}px off the true nearest`)
})

test("characterization (not law): a nearest-point hand flips at the medial axis", () => {
    const m = sweep(ellipse(100, 60), [0, 0, 500], 0.05, [0, 1])
    assert.ok(m.flips >= 1, `the hand jumped ${m.maxStep.toFixed(0)}px`)
    assert.ok(m.flipsRef >= 1, "and the fine reference jumps too — the flip is the projection, not the sampling")
})
