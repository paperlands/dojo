// Explicit locality — the ONE conversion between a sampled storage basis and the
// world chart. A point, a displacement and a full pose convert here, so every
// consumer reuses the same operation instead of scattering origin arithmetic.
// Locality is an operation; a tuple carries no chart. (id:world-coordinate-foundation-phases)
import { SE3 } from './se3.js'


// A representation crossing, not a coordinate policy. Each operation owns one sampled basis.
// (id:world-coordinate-phase-2)
export function storageSpace(basisOf) {
    return {
        sample: () => {
            const basis = basisOf()
            return {
                toWorld: (local) => toWorldPose(basis, local),
                toWorldPoint: (point) => toWorldPoint(basis, point),
                toLocal: (world) => toLocalPose(basis, world),
                toLocalRotation: (rotation) => toLocalRotation(basis, rotation),
                toLocalPoint: (point) => toLocalPoint(basis, point),
            }
        },
    }
}
// A full pose: compose the basis (world = basis ∘ local).
export const toWorldPose = (basis, local) => SE3.compose(basis, local)
export const toLocalPose = (basis, world) => SE3.compose(SE3.invert(basis), world)

// A rotation alone: an orientation-only consumer must not re-derive the position.
export const toLocalRotation = (basis, world) => SE3.invert(basis).rotation.multiply(world)

// A point translates and rotates.
export const toWorldPoint = (basis, local) => SE3.apply(basis, local)
export const toLocalPoint = (basis, world) => SE3.unapply(basis, world)

// A displacement only rotates.
export const toWorldVector = (basis, local) => basis.rotation.rotateVec(local[0], local[1], local[2])
export const toLocalVector = (basis, world) => SE3.invert(basis).rotation.rotateVec(world[0], world[1], world[2])
