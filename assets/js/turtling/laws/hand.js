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
import { dot } from "./vec3.js"
import { CONE_RATE, CONE_EASE, DETENT_BAND, DETENT_HOLD } from "./feel.js"

const wrapPi = (t) => Math.atan2(Math.sin(t), Math.cos(t))
const unit3 = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n] }

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
    const r = Math.hypot(d[0], d[1], d[2])
    if (!(r > 1e-12)) return point
    const u = [d[0] / r, d[1] / r, d[2] / r]
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
