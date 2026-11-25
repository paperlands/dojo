// Candidate primitives: one world binding, one position-only pose rule, one movement fact.
// Nothing here admits a candidate — a policy proposes, the gate measures, publishers install.
// (id:laws-free-relations-contract, id:laws-build-solve-seam, id:laws-activation-order)
import { bindWorld } from "./authored.js"
import { freePoint } from "./batch.js"
import { heldFrame } from "./constraints.js"
import { toLocalPoint } from "../localize.js"

// The one world the AUTHORED rows read through: the live pose (with an optional candidate
// override map) and the stable placement. Injected, so the rows stay pure.
// (id:laws-decl-interface)
export function lawContext(registry, overrides, world, extras = {}) {
    return bindWorld((id) => registry.get(id), {
        live: (f) => world.read(f, overrides),
        placement: (f) => world.transform(f),
        ...extras,
    })
}

// A position-only proposal carries the frame's stored rotation by reference, so a position
// answer is never a heading answer. Which rotation a follower KEEPS is still open (D063).
// (id:laws-free-relations-n-node-review, id:world-coordinate-foundation-phases)
export const positionPose = (world, frame, at) => ({
    rotation: frame.transform.deref().rotation,
    position: toLocalPoint(world.transform(frame), at) })

// The position law that fixes a frame, or null. Its predicate is authored in the law's
// own frame, so the caller must interpret it there. (id:laws-decl-frame)
export function pinnedLaw(laws, frameId) {
    for (const law of Array.isArray(laws) ? laws : laws.active()) {
        if (law.feature === 'position' && law.endpoints[0] === frameId) return law
    }
    return null
}

// The movement FACT for one member: a free point that is neither pinned nor held. Not a
// publication right and not the operation's mover set. (id:laws-freedom)
export const canMove = (frame, laws) =>
    freePoint(frame) && pinnedLaw(laws, frame.id) == null && !heldFrame(frame)
