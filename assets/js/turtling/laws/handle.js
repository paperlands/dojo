// One visible handle: a declared place you can touch. (id:laws-decl-handle)
//
// Screen → the declared plane → the actor's birth coordinates → requestMotion.
// Only accepted geometry is drawn: this never moves the actor itself, it submits
// a request and reports what came back.
//
// Pure — plain numbers and SE3. The browser side supplies the ray and the
// projection; nothing here touches DOM or THREE, so the mapping is testable.
import { SE3 } from "../se3.js"

// The declared plane is the place's own birth plane: its world origin and the
// world direction of its local z. The camera never chooses it. (id:laws-decl-anchor)
export function birthPlane(worldTransform) {
    const [nx, ny, nz] = worldTransform.rotation.rotateVec(0, 0, 1)
    return { origin: [...worldTransform.position], normal: [nx, ny, nz] }
}

// Ray ∩ plane. Null when the ray runs parallel, or the plane is behind the eye.
export function touchPlane(ray, plane) {
    const [ox, oy, oz] = ray.origin
    const [dx, dy, dz] = ray.direction
    const [px, py, pz] = plane.origin
    const [nx, ny, nz] = plane.normal
    const denom = dx * nx + dy * ny + dz * nz
    if (Math.abs(denom) < 1e-9) return null
    const t = ((px - ox) * nx + (py - oy) * ny + (pz - oz) * nz) / denom
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

// Screen-space hit test against the handle's projected point.
export function hitTest(pointer, projected, radius = 18) {
    return Math.hypot(pointer.x - projected.x, pointer.y - projected.y) <= radius
}

// The smallest readout that can tell the three apart: busy is "another hand has
// it", unresolved is "the toy cannot do this yet", rejected is a truth verdict.
export const OUTCOME = {
    accept: 'accepted',
    refuse: 'rejected',
    busy: 'busy',
    unresolved: 'unresolved',
    stale: 'obsolete',
    fault: 'fault',
}

export function readout({ point, accepted, requested, verdict }) {
    return {
        point,
        accepted: accepted ? [...accepted] : null,
        requested: requested ? [...requested] : null,
        outcome: OUTCOME[verdict?.kind] ?? 'unknown',
    }
}
