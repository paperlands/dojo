// The Lens basis — the single place turtle-space meets camera-space.
//
// A turtle frame is +X forward / +Y left / +Z up (se3.js). A THREE.js
// PerspectiveCamera looks down its local −Z, with +X right and +Y up. The eye is
// an ORDINARY ambient whose pose REFRAMES THE WORLD at the model layer: the
// compositor premultiplies every non-eye layer by E⁻¹, where E = the eye's world
// pose in camera convention (worldPose ∘ TURTLE_TO_CAMERA). The rendered result is
// the live orbit camera C riding inside the eye's frame — effective camera = E·C.
// So fw/rt/dive/roll are the turtle's own SE(3) verbs, and the manual mouse-orbit
// composes on top untouched (no controls fight). The orbit radius is the lever:
// dollied in, rt pans in place; out at radius, rt orbits the subject. roll banks
// the horizon (real for the first time). (specs/eye-ambient.org id:eye-coordinates)
//
// The eye's spawn frame is seeded to recenterPose() (rotation = CAMERA_TO_TURTLE,
// no translation), so an EMPTY `as eye do` reframes to identity ⇒ effective camera
// = C = today's exact default view, with live orbit. The 500 standoff is the orbit
// camera's own radius, not a baked offset — so nested eyes ride the parent chain
// (mounted/chase cam) for free, and re-eval is idempotent (pure fn of world pose).
//
// Validated by the rotation algebra and a headless numeric probe: with the seed,
// empty → pos [0,0,500] fwd [0,0,−1]; fw 100 → [0,0,400] (dolly); rt 90 → orbit to
// [−500,0,0] looking +X; roll 90 → banks; dive 90 → cranes overhead.

import { Versor } from "./mafs/versors.js"

// Constant camera-local → turtle-local basis change. The camera's world
// orientation is Q_camera = R_turtle ∘ TURTLE_TO_CAMERA, derived from:
//   camera −Z (forward) → turtle +X,  camera +Y (up) → turtle +Z,
//   camera +X (right)   → turtle −Y.
export const TURTLE_TO_CAMERA = Versor.raw(0.5, 0.5, -0.5, -0.5)

// The inverse basis change (camera-local → turtle-local), i.e. the conjugate of
// TURTLE_TO_CAMERA (unit quaternion). Seeds the eye's recenter pose.
export const CAMERA_TO_TURTLE = Versor.raw(0.5, -0.5, 0.5, 0.5)

// World-space look (forward) and up directions for a turtle-frame rotation.
// forward = local +X, up = local +Z. Both are unit vectors as [x, y, z] tuples.
export function viewVectors(rotation) {
    return {
        forward: rotation.rotateVec(1, 0, 0),
        up: rotation.rotateVec(0, 0, 1)
    }
}

// The eye's world pose expressed in camera convention: E = worldPose ∘ basis.
// The compositor reframes the world by E⁻¹, so the live orbit camera C renders as
// effective camera E·C. `worldPose` is a turtle SE3 { position, rotation:Versor };
// returns an SE3 in camera convention. Pure — no THREE. (id:eye-coordinates)
export function eyeCameraPose(worldPose) {
    return {
        rotation: worldPose.rotation.multiply(TURTLE_TO_CAMERA),
        position: [worldPose.position[0], worldPose.position[1], worldPose.position[2]]
    }
}

// The eye's default spawn LOCAL transform. Rotation = CAMERA_TO_TURTLE so that
// eyeCameraPose(identity ∘ seed) = identity orientation; with no translation the
// reframe E⁻¹ is identity for an empty eye ⇒ the live orbit camera renders
// unchanged (today's default view). The 500 standoff is the orbit camera's own
// radius, not baked here — so the seed composes through the parent chain (a nested
// eye becomes a chase cam) and re-eval is idempotent. (id:eye-view-pipeline)
export function recenterPose() {
    return { rotation: CAMERA_TO_TURTLE, position: [0, 0, 0] }
}
