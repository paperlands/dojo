// A hand: how a pointer moves one kind of locus. (id:laws-decl-hand)
//
// One lifecycle for every locus — freeze a frame at pointer-down, then project each
// move into a world request. A sphere's camera-plane disk and a cone's polar are
// strategies of that shape, so the gesture routes by the locus's data instead of
// branching on its kind. The frozen camera plane is the base every hand falls back
// to; it lives in the gesture, so a hand only ever overrides the plane.
// (id:laws-decl-anchor)
//
// Pure: rays, a projection and the lens functions in; a world point out.

import { facingPlane, touchPlane } from "./handle.js"
import { coneFrame, isOpenCone } from "./cone.js"
import { dot, unit, sub, add, scale, finite3 } from "./vec3.js"
import { basisOf } from "./meet.js"
import { CONE_RATE, CONE_EASE, DETENT_BAND, DETENT_HOLD } from "./feel.js"

const wrapPi = (t) => Math.atan2(Math.sin(t), Math.cos(t))
// The floor is ZERO, not the default epsilon: only an exactly-degenerate direction is left
// as given. A tiny nonzero normal must still normalize, or a scaled facing changes the hand.
const unit3 = (v) => unit(v, 0) ?? v

// A cone's hand is the cone's own polar about the apex's projection, forward:
// the pointer's screen ANGLE dials the azimuth and its screen RADIUS spends the
// height at the drawn-scale rate, eased. A circle about the hub is a pure turn
// that holds the height exactly — nothing can jump on a circle — and the azimuth
// accumulates, so a full turn comes home. A straight pull moves the point at the
// rate, never faster. (id:laws-decl-anchor)
export function coneRig(cone, anchor, x, y, project) {
    const frame = cone && typeof project === 'function' && Array.isArray(cone.apex) && Array.isArray(cone.axis)
        ? coneFrame(cone.apex, cone.axis, cone.halfAngle)
        : null
    if (!frame || !anchor) return null
    const { apex: A, axis: a, u, v, open, point } = frame
    const hub = project(A)
    if (!hub) return null
    const d = [anchor[0] - A[0], anchor[1] - A[1], anchor[2] - A[2]]
    const h0 = dot(d, a)
    const phi0 = Math.atan2(dot(d, v), dot(d, u))
    const r0 = Math.hypot(x - hub.x, y - hub.y)
    const psi0 = Math.atan2(y - hub.y, x - hub.x)
    // Which way the screen turns as the azimuth rises: the hand turns with it.
    const here = project(point(h0, phi0))
    const probe = project(point(h0, phi0 + 1e-3))
    let handed = 1
    if (here && probe) {
        const t0 = Math.atan2(here.y - hub.y, here.x - hub.x)
        const t1 = Math.atan2(probe.y - hub.y, probe.x - hub.x)
        if (Math.sin(t1 - t0) < 0) handed = -1
    }
    // Pixels per world unit of height at the grab — the rate's denominator.
    const up = project(point(h0 + 1, phi0))
    const scale = here && up ? Math.hypot(up.x - here.x, up.y - here.y) : 1
    return {
        apex: A, axis: a, u, v, open, h0, phi: phi0, h: h0, point,
        r0, psi0, psi: psi0, handed, hub: { x: hub.x, y: hub.y }, scale: scale > 1e-9 ? scale : 1,
    }
}

// The rig's point under the live pointer: the azimuth accumulates exactly (a dial
// carries no memory of its own step size) and the height eases toward the rate's
// target, so a circle holds the height and a pull never jumps. (id:laws-decl-anchor)
export function coneTurn(rig, x, y) {
    const dx = x - rig.hub.x, dy = y - rig.hub.y
    const r = Math.hypot(dx, dy)
    const psi = Math.atan2(dy, dx)
    rig.phi += rig.handed * wrapPi(psi - rig.psi)
    rig.psi = psi
    const want = rig.h0 + ((r - rig.r0) / rig.scale) * CONE_RATE
    rig.h += CONE_EASE * (want - rig.h)
    return rig.point(rig.h, rig.phi)
}

// A sphere's hand is its own face seen flat: the pointer meets the camera plane
// through the centre, the grab's offset in that plane rides with it, and the point
// lifts onto the near or far surface. Past the rim it rides the flat edge — the
// paper circle in the paper view, so no z is invented and the hand never squeezes
// toward a pole. A plane that misses refuses the claim. (id:laws-decl-anchor)
export const sphereHand = {
    rejects: true,
    freeze({ anchor, ray, facing, locus }) {
        const center = locus.center, radius = locus.radius
        const h0 = touchPlane(ray, facingPlane(center, facing))
        if (!h0) return null
        const f = unit3(facing)
        const ax = anchor[0] - center[0], ay = anchor[1] - center[1], az = anchor[2] - center[2]
        const along = ax * f[0] + ay * f[1] + az * f[2]
        return {
            center: [...center], radius,
            planeNormal: [...facing],
            far: along > 0,
            disk: [
                ax - along * f[0] - (h0[0] - center[0]),
                ay - along * f[1] - (h0[1] - center[1]),
                az - along * f[2] - (h0[2] - center[2]),
            ],
        }
    },
    place(state, { ray, detents }) {
        const hit = touchPlane(ray, facingPlane(state.center, state.planeNormal))
        if (!hit) return null
        const { center, radius, disk, far } = state
        const f = unit3(state.planeNormal)
        const vx = hit[0] - center[0] + disk[0]
        const vy = hit[1] - center[1] + disk[1]
        const vz = hit[2] - center[2] + disk[2]
        const r = Math.hypot(vx, vy, vz)
        let point
        if (r >= radius) {                                     // outside the disk: ride the flat edge
            const k = radius / r
            point = [center[0] + vx * k, center[1] + vy * k, center[2] + vz * k]
        } else {
            const lift = (far ? 1 : -1) * Math.sqrt(radius * radius - r * r)
            point = [center[0] + vx + f[0] * lift, center[1] + vy + f[1] * lift, center[2] + vz + f[2] * lift]
        }
        // The ball's own landmarks: a slight stickiness only the ball arms.
        return detents ? magnet(center, radius, point, detents) : point
    },
}

const RING = 96
const GRAZE_PX = 2        // below this minor semi-axis the phase is not observable

// A circle's hand follows the CURVE, not a plane through it: the frozen camera
// plane proposes a point the law clamps back to the circle, and in an oblique view
// that clamp IS the whole error. (id:laws-decl-handle, id:laws-decl-anchor)
export function circleRig(locus, anchor, project) {
    const center = locus?.center, r = locus?.radius
    const b = basisOf(locus?.normal)
    if (!b || !finite3(center) || !(r > 0) || !finite3(anchor)) return null
    const phaseOf = (p) => {
        const d = sub(p, center)
        return Math.atan2(dot(d, b.v), dot(d, b.u))
    }
    const point = (phi) => add(center, add(scale(b.u, r * Math.cos(phi)), scale(b.v, r * Math.sin(phi))))
    const index = (i) => ((i % RING) + RING) % RING
    const keep = Array.isArray(locus.keep) ? locus.keep : null
    const samples = []
    for (let i = 0; i < RING; i++) {
        const phi = (i / RING) * Math.PI * 2
        const p = point(phi)
        // A kept arc (a half-plane meet) offers only its own half: what is not there is
        // not sampled, so it can neither be reached nor counted.
        const on = !keep || dot(sub(p, center), keep) >= -1e-9
        samples.push({ phi, screen: on && typeof project === 'function' ? project(p) : null })
    }
    const seen = samples.filter((s) => s.screen && Number.isFinite(s.screen.x) && Number.isFinite(s.screen.y))
    if (seen.length < RING / 2) return null
    // A projected circle's screen covariance is diag(a²/2, b²/2): its smaller
    // eigenvalue is the MINOR semi-axis, so grazing drives it to zero.
    let mx = 0, my = 0
    for (const s of seen) { mx += s.screen.x; my += s.screen.y }
    mx /= seen.length; my /= seen.length
    let sxx = 0, sxy = 0, syy = 0
    for (const s of seen) {
        const dx = s.screen.x - mx, dy = s.screen.y - my
        sxx += dx * dx; sxy += dx * dy; syy += dy * dy
    }
    sxx /= seen.length; sxy /= seen.length; syy /= seen.length
    const half = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy))
    const minorEig = Math.max(0, (sxx + syy) / 2 - half)
    return {
        point, phaseOf, samples, index,
        observable: Math.sqrt(2 * minorEig) >= GRAZE_PX,
        phase: phaseOf(anchor),
    }
}

// The rig's point under the live pointer: the nearest sample of the PROJECTED ring.
// (id:laws-decl-handle)
export function circleTurn(rig, pointer, anchor, project) {
    const seed = rig.phaseOf(finite3(anchor) ? anchor : rig.point(rig.phase))
    // Holding answers with the world point VERBATIM: what a hand that cannot move
    // the point owes the finger is where the point is, not a re-derivation of it.
    const held = () => (finite3(anchor) ? [...anchor] : rig.point(rig.phase))
    // Grazing the plane collapses the ellipse to a segment and the phase is not
    // disclosed, so the hand HOLDS the accepted point instead of guessing.
    if (!rig.observable) return held()
    // The hand seeds from the ACCEPTED point's phase, so a refused move advances
    // nothing: the phase is READ from the world each move, never accumulated.
    // (id:laws-decl-handle)
    const i0 = rig.index(Math.round((seed / (Math.PI * 2)) * RING))
    if (!rig.samples[i0].screen) return held()
    const dist = (i) => {
        const s = rig.samples[i].screen
        return s ? Math.hypot(pointer.x - s.x, pointer.y - s.y) : Infinity
    }
    // Walk outward from the seed while a neighbour improves, both ways, and stop at the
    // first that does not: that is the local minimum in the ACCEPTED point's own basin.
    // It cannot reach the far branch — the climb halts at the barrier between them — so
    // it needs no step cap to keep up with a fast finger. (id:laws-freedom)
    let best = i0
    let bestD = dist(i0)
    for (const dir of [1, -1]) {
        let at = i0
        for (let n = 1; n < RING; n++) {
            const j = rig.index(at + dir)
            const d = dist(j)
            if (d >= bestD) break
            bestD = d
            best = j
            at = j
        }
    }
    // Then a ternary search BETWEEN the bracketing samples: a vertex fitted to three
    // samples is only a guess, and a finger landing between samples inherits its error.
    const arc = (Math.PI * 2) / RING
    const live = (phi) => {
        const s = typeof project === 'function' ? project(rig.point(phi)) : null
        return s && Number.isFinite(s.x) ? Math.hypot(pointer.x - s.x, pointer.y - s.y) : Infinity
    }
    let lo = rig.samples[best].phi - arc
    let hi = rig.samples[best].phi + arc
    if (typeof project === 'function') {
        for (let n = 0; n < 14 && hi - lo > 1e-4; n++) {
            const m1 = lo + (hi - lo) / 3
            const m2 = hi - (hi - lo) / 3
            if (live(m1) < live(m2)) hi = m2
            else lo = m1
        }
    }
    const phi = (lo + hi) / 2
    rig.phase = phi
    return rig.point(phi)
}

// A circle's hand is the circle's own projection, inverted. (id:laws-decl-anchor)
export const circleHand = {
    rejects: false,
    freeze({ anchor, project, locus }) {
        const rig = circleRig(locus, anchor, project)
        return rig ? { rig } : null
    },
    place(state, { pointer, anchor, project }) {
        return circleTurn(state.rig, pointer, anchor, project)
    },
}
// A cone's hand is its polar rig, frozen at the grab. (id:laws-decl-anchor)
export const coneHand = {
    rejects: false,
    freeze({ anchor, project, pointer, locus }) {
        const rig = coneRig(locus, anchor, pointer.x, pointer.y, project)
        return rig ? { rig } : null
    },
    place(state, { pointer }) {
        return coneTurn(state.rig, pointer.x, pointer.y)
    },
}

// Which hand a locus's own data names. A curved surface overrides the frozen
// camera plane; everything else keeps it. (id:laws-decl-anchor)
export function handFor(locus) {
    if (locus?.kind === 'sphere' && locus.radius > 0 && Array.isArray(locus.center)) return sphereHand
    if (locus?.kind === 'cone' && Array.isArray(locus.apex) && isOpenCone(locus.halfAngle)) return coneHand
    if (locus?.kind === 'circle' && locus.radius > 0 && Array.isArray(locus.center) && Array.isArray(locus.normal)) return circleHand
    return null
}

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

const slerp = (a, b, t) => {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
    const th = Math.acos(dot)
    if (th < 1e-9) return [...a]
    const s = Math.sin(th)
    const ka = Math.sin((1 - t) * th) / s
    const kb = Math.sin(t * th) / s
    return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]
}

export function magnet(center, radius, point, opts = {}) {
    const { paper = false, poles = false, band = DETENT_BAND, hold = DETENT_HOLD } = opts ?? {}
    if (!point || !(radius > 0) || !(band > 0) || (!paper && !poles)) return point
    const d = [point[0] - center[0], point[1] - center[1], point[2] - center[2]]
    const u = unit(d)
    if (!u) return point   // a point on the centre has no arm
    let best = null
    let bestAng = band
    const arming = (target) => {
        const t = [target[0] - center[0], target[1] - center[1], target[2] - center[2]]
        const tm = Math.hypot(t[0], t[1], t[2])
        if (!(tm > 1e-12)) return
        const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * t[0] + u[1] * t[1] + u[2] * t[2]) / tm)))
        if (ang < bestAng) { bestAng = ang; best = [t[0] / tm, t[1] / tm, t[2] / tm] }
    }
    if (paper && center[2] * center[2] <= radius * radius) {
        const rho = Math.sqrt(radius * radius - center[2] * center[2])
        const a = Math.atan2(point[1] - center[1], point[0] - center[0])
        arming([center[0] + rho * Math.cos(a), center[1] + rho * Math.sin(a), 0])
    }
    if (poles) {
        arming([center[0], center[1], center[2] + radius])
        arming([center[0], center[1], center[2] - radius])
    }
    if (!best) return point
    const inner = Math.min(Math.max(hold, 0), band * 0.999)
    const w = bestAng <= inner ? 1 : smoothstep((band - bestAng) / (band - inner))
    const bent = slerp(u, best, w)
    return [center[0] + radius * bent[0], center[1] + radius * bent[1], center[2] + radius * bent[2]]
}
