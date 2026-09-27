// One visible handle: a declared place you can touch. (id:laws-decl-handle)
//
// Screen → the frozen view plane → the actor's birth coordinates → requestMotion.
// Only accepted geometry is drawn: this never moves the actor itself, it submits
// a request and reports what came back.
//
// Pure — plain numbers and SE3. The browser side supplies the ray and the
// projection; nothing here touches DOM or THREE, so the mapping is testable.
import { SE3 } from "../se3.js"
import { exposed } from "./batch.js"

// The drag plane is the camera's plane through the point at pointer-down —
// parallel to the image plane: its normal is the camera's viewing direction, not
// the point's line of sight. Frozen until release. (id:laws-decl-anchor)
export function facingPlane(point, facing) {
    return { origin: [...point], normal: [...facing] }
}

// A ray that grazes the plane would "touch" it kilometres away. Refusing only an
// exactly parallel ray is not enough, so the guard is an angle — |cos θ| below
// this is not a touch, however far the intersection would land. The comparison is
// normalized by BOTH lengths, so scaling a ray cannot change its meaning; a
// zero-length direction or normal has no angle and is refused.
export const GRAZE = 1e-3

// Ray ∩ plane. Null when the ray grazes, is degenerate, or the plane is behind.
export function touchPlane(ray, plane) {
    const [ox, oy, oz] = ray.origin
    const [dx, dy, dz] = ray.direction
    const [px, py, pz] = plane.origin
    const [nx, ny, nz] = plane.normal
    const rayLength = Math.hypot(dx, dy, dz)
    const normalLength = Math.hypot(nx, ny, nz)
    if (rayLength === 0 || normalLength === 0) return null
    const along = dx * nx + dy * ny + dz * nz
    if (Math.abs(along) / (rayLength * normalLength) < GRAZE) return null
    const t = ((px - ox) * nx + (py - oy) * ny + (pz - oz) * nz) / along
    if (t <= 0) return null
    return [ox + dx * t, oy + dy * t, oz + dz * t]
}

// The outward direction a push is answered least on: the surface normal laid flat into
// the drag plane. Null when the normal is already ⟂ that plane (there is nothing to
// gear) or the point sits at the centre. (id:laws-decl-anchor)
export function outwardIn(center, point, planeNormal) {
    const f = Array.isArray(planeNormal) ? planeNormal : null
    const fn = f ? Math.hypot(f[0], f[1], f[2]) : 0
    if (!(fn > 1e-12)) return null
    const fh = [f[0] / fn, f[1] / fn, f[2] / fn]
    const n = [point[0] - center[0], point[1] - center[1], point[2] - center[2]]
    const r = Math.hypot(n[0], n[1], n[2])
    if (!(r > 1e-12)) return null
    const u = [n[0] / r, n[1] / r, n[2] / r]
    const k = u[0] * fh[0] + u[1] * fh[1] + u[2] * fh[2]
    const g = [u[0] - k * fh[0], u[1] - k * fh[1], u[2] - k * fh[2]]
    const gm = Math.hypot(g[0], g[1], g[2])
    return gm > 1e-9 ? g.map((v) => v / gm) : null
}

// The figure's own screen size, in pixels: the radius a sphere of `radius` centred at
// `center` draws as, seen along `sight`. The gear's knee is this and not a constant — a
// pull inside the figure must stay 1:1, or the hand loses the point before it has even
// left the ball. Null when the geometry cannot name a size. (id:laws-decl-anchor)
export function figureRadius(project, center, radius, sight) {
    const f = Array.isArray(sight) ? sight : null
    const fn = f ? Math.hypot(f[0], f[1], f[2]) : 0
    if (!project || !(radius > 0) || !(fn > 1e-12) || !Array.isArray(center)) return null
    const fh = [f[0] / fn, f[1] / fn, f[2] / fn]
    const a = Math.abs(fh[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const e = [fh[1] * a[2] - fh[2] * a[1], fh[2] * a[0] - fh[0] * a[2], fh[0] * a[1] - fh[1] * a[0]]
    const el = Math.hypot(e[0], e[1], e[2])
    if (!(el > 1e-12)) return null
    const u = e.map((v) => v / el)
    const rim = project([center[0] + radius * u[0], center[1] + radius * u[1], center[2] + radius * u[2]])
    const hub = project([center[0], center[1], center[2]])
    if (!rim || !hub) return null
    const px = Math.hypot(rim.x - hub.x, rim.y - hub.y)
    return px > 1 ? px : null
}
// The direction across the pole, laid flat into the drag plane. Together with the outward
// direction it splits a hand step into a dial and a reach. Null at the pole, where no
// azimuth exists. (id:laws-decl-anchor)
export function acrossIn(center, point, planeNormal) {
    const f = Array.isArray(planeNormal) ? planeNormal : null
    const fn = f ? Math.hypot(f[0], f[1], f[2]) : 0
    if (!(fn > 1e-12)) return null
    const fh = [f[0] / fn, f[1] / fn, f[2] / fn]
    const dx = point[0] - center[0], dy = point[1] - center[1]
    const rho = Math.hypot(dx, dy)
    if (!(rho > 1e-12)) return null
    const ac = [-dy / rho, dx / rho, 0]
    const k = ac[0] * fh[0] + ac[1] * fh[1] + ac[2] * fh[2]
    const g = [ac[0] - k * fh[0], ac[1] - k * fh[1], ac[2] - k * fh[2]]
    const gm = Math.hypot(g[0], g[1], g[2])
    return gm > 1e-9 ? g.map((v) => v / gm) : null
}

// The sphere's own coordinates, in the paper's frame: an azimuth around the +z pole
// through the centre, a latitude from its equator, and the horizontal radius that
// azimuth rides on. Null at the pole, where no azimuth exists. (id:laws-decl-anchor)
export function polarOf(center, point) {
    const d = [point[0] - center[0], point[1] - center[1], point[2] - center[2]]
    const r = Math.hypot(d[0], d[1], d[2])
    if (!(r > 1e-12)) return null
    return {
        az: Math.atan2(d[1], d[0]),
        lat: Math.asin(Math.max(-1, Math.min(1, d[2] / r))),
        rho: Math.hypot(d[0], d[1]),
    }
}

// A point of a sphere named by its own coordinates. (id:laws-decl-anchor)
export function polarPoint(center, radius, az, lat) {
    const c = Math.cos(lat)
    return [
        center[0] + radius * c * Math.cos(az),
        center[1] + radius * c * Math.sin(az),
        center[2] + radius * Math.sin(lat),
    ]
}


// A world point in the place's birth coordinates — the same frame the actor's
// accepted pose lives in, so the request needs no second meaning of "where".
export function birthLocal(worldPoint, worldTransform) {
    const there = { rotation: SE3.identity().rotation, position: [...worldPoint] }
    return [...SE3.compose(SE3.invert(worldTransform), there).position]
}

// A pointer moves position, not orientation: a positional truth does not
// constrain heading, so the accepted rotation rides through. (id:laws-decl-anchor)
export function requestedPose(accepted, localPoint) {
    return { rotation: accepted.rotation, position: [...localPoint] }
}

// A drag anchors its frozen plane at the accepted world position, so the pose
// must be KNOWN: malformed geometry cannot anchor a plane. No planar domain —
// a point off its birth plane is still a point. (id:laws-decl-plane)
export function knownPose(accepted) {
    const position = accepted?.position
    if (!Array.isArray(position) || position.length !== 3) return false
    return position.every(Number.isFinite)
}

// The one query the affordance and the hit test share. Participation alone is
// not eligibility: a retained frame can be detached from the play while its old
// parent still holds the declaration set, so liveness is asked separately and
// first. The gesture must release capture on a false answer — not merely print
// an outcome while still holding the pointer. (id:laws-decl-exposure)
export function eligibility({ frame, registered, accepted }) {
    if (!frame || !registered) return { ok: false, reason: OUTCOME.obsolete }
    if (!exposed(frame)) return { ok: false, reason: OUTCOME.unresolved }
    if (!knownPose(accepted)) return { ok: false, reason: OUTCOME.unsupported }
    return { ok: true, reason: null }
}

// The hit radius, in CSS pixels. ONE constant: the gesture tests with it and the
// pin draws its ring at it, so the drawn ring is the touchable disc.
// (id:laws-decl-handle)
export const HIT_RADIUS = 18

// The screen space the seam shares, by name: client/CSS pixels, viewport origin —
// what a pointer carries and a projection returns. One name because the projection
// and the layer over it must agree. (id:laws-decl-interface)
export const CLIENT_SPACE = 'client'

// The one world↔screen mapping: the compositor's reframe (eye and hand) folded
// with the stage's camera. `reframe` maps world → the scene the camera draws;
// null is identity. project applies it forward; ray and facing apply its inverse,
// so the drag plane and the pointer ray share one frame. (id:laws-decl-interface)
export function viewMapping(reframe, stage) {
    const toWorld = reframe ? SE3.invert(reframe) : null
    return {
        project: (world) => stage.project(reframe ? SE3.apply(reframe, world) : world),
        rayAt: (x, y) => {
            const ray = stage.unproject(x, y)
            if (!ray || !toWorld) return ray
            const d = toWorld.rotation.rotateVec(ray.direction[0], ray.direction[1], ray.direction[2])
            return { origin: SE3.apply(toWorld, ray.origin), direction: d }
        },
        facing: () => {
            const f = stage.facing()
            if (!toWorld) return f
            return toWorld.rotation.rotateVec(f[0], f[1], f[2])
        },
        eye: () => {
            const p = stage.camera.position
            const c = [p.x, p.y, p.z]
            return toWorld ? SE3.apply(toWorld, c) : c
        },
    }
}

// Screen-space hit test against the handle's projected point.
export function hitTest(pointer, projected, radius = HIT_RADIUS) {
    return Math.hypot(pointer.x - projected.x, pointer.y - projected.y) <= radius
}

// The smallest readout that can tell the three apart: busy is "another hand has
// it", unresolved is "the toy cannot do this yet", rejected is a truth verdict.
export const OUTCOME = {
    accepted: 'accepted',
    rejected: 'rejected',
    busy: 'busy',
    unresolved: 'unresolved',
    obsolete: 'obsolete',      // the identity is no longer in this play
    cancelled: 'cancelled',    // the gesture ended without a verdict
    fault: 'fault',
    // A pose that cannot anchor the drag plane — missing or malformed geometry,
    // never a planar domain. Distinct from busy (another hand has it) and from
    // rejected (a truth verdict).
    unsupported: 'unsupported',
}

// A verdict becomes an outcome in exactly one place, so no line can describe two
// contradictory answers. (id:laws-decl-handle)
export const OUTCOME_OF = {
    accept: OUTCOME.accepted,
    refuse: OUTCOME.rejected,
    busy: OUTCOME.busy,
    unresolved: OUTCOME.unresolved,
    stale: OUTCOME.obsolete,
    fault: OUTCOME.fault,
}

export function outcomeOf(verdict) {
    return OUTCOME_OF[verdict?.kind] ?? 'unknown'
}

// One outcome, supplied by the caller — it has already decided between a verdict,
// an unanchorable pose and a cancelled gesture.
export function readout({ point, accepted, requested, outcome }) {
    return {
        point,
        accepted: accepted ? [...accepted] : null,
        requested: requested ? [...requested] : null,
        outcome,
    }
}

// A refusal changes no geometry, so its text is the only trace: it fades after the
// hand lets go, while the affordance is at rest the moment the pointer lifts. A
// scalar over the readout, never a state transition. (id:laws-decl-interface)
export const VERDICT_DECAY_MS = 360

export function verdictFade(age, span = VERDICT_DECAY_MS) {
    if (!(age >= 0) || age >= span) return 0
    return 1 - age / span
}
