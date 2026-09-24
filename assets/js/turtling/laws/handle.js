// One visible handle: a declared place you can touch. (id:laws-decl-handle)
//
// Screen → the declared plane → the actor's birth coordinates → requestMotion.
// Only accepted geometry is drawn: this never moves the actor itself, it submits
// a request and reports what came back.
//
// Pure — plain numbers and SE3. The browser side supplies the ray and the
// projection; nothing here touches DOM or THREE, so the mapping is testable.
import { SE3 } from "../se3.js"
import { exposed } from "./batch.js"

// The declared plane is the place's own birth plane: its world origin and the
// world direction of its local z. The camera never chooses it. (id:laws-decl-anchor)
export function birthPlane(worldTransform) {
    const [nx, ny, nz] = worldTransform.rotation.rotateVec(0, 0, 1)
    return { origin: [...worldTransform.position], normal: [nx, ny, nz] }
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

// The toy's *supported manipulation domain* — not an enforced planar invariant.
// Program motion can still leave the plane; refusing to drag that result is
// honest, claiming all accepted geometry is planar would not be.
//
// A supported pose is a KNOWN pose: absent or malformed geometry is not the
// domain origin, so a lifecycle gap cannot become a drag-eligibility decision.
// (id:laws-decl-plane)
export function inPlane(accepted, tolerance = 1e-9) {
    const position = accepted?.position
    if (!Array.isArray(position) || position.length !== 3) return false
    if (!position.every(Number.isFinite)) return false
    return Math.abs(position[2]) <= tolerance
}

// The one query the affordance and the hit test share. Participation alone is
// not eligibility: a retained frame can be detached from the play while its old
// parent still holds the declaration set, so liveness is asked separately and
// first. The gesture must release capture on a false answer — not merely print
// an outcome while still holding the pointer. (id:laws-decl-exposure)
export function eligibility({ frame, registered, accepted }) {
    if (!frame || !registered) return { ok: false, reason: OUTCOME.obsolete }
    if (!exposed(frame)) return { ok: false, reason: OUTCOME.unresolved }
    if (!inPlane(accepted)) return { ok: false, reason: OUTCOME.unsupported }
    return { ok: true, reason: null }
}

// The hit radius, in CSS pixels. ONE constant: the gesture tests with it and the
// pin draws its ring at it, so the drawn ring is the touchable disc.
// (id:laws-decl-handle)
export const HIT_RADIUS = 18

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
    // Outside the toy's supported manipulation domain — distinct from busy
    // (another hand has it) and from rejected (a truth verdict).
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
// an unsupported domain and a cancelled gesture.
export function readout({ point, accepted, requested, outcome }) {
    return {
        point,
        accepted: accepted ? [...accepted] : null,
        requested: requested ? [...requested] : null,
        outcome,
    }
}
