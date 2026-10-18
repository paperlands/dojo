// Actor selection policy over the pure following kernel; reach and hand keep their own policy.
// Private proposals only: the scheduler independently checks and publishes.
// (id:laws-free-relations-f4-actor)
import { boundParticipants, boundReferences, indexByIdentities, pointQuery } from "./authored.js"
import { componentOf } from "./component.js"
import { treeShape, treeFold, bondOf, nearestChild } from "./following.js"
import { canMove, lawContext, pinnedLaw, positionPose } from "./candidate.js"
import { heldFrame, lawViolation } from "./verdict.js"
import { directionBetween, INVALID, finite3 } from "./vec3.js"
import { freePoint } from "./batch.js"
import { meetAll, nearest as meetNearest } from "./meet.js"

// --- Program following: the actor's own instant ---
// The offered pose is kept; only followers are grown. `root` is the GEOMETRIC root:
// the writer, or an installation's retained receiver. Decline (null) leaves the offer.
// (id:laws-free-relations-f4-actor)

export function programFollowing(verdict, root, registry, laws, world) {
    if (!laws || !world || !root || verdict.kind !== 'accept') return null
    if ((verdict.component?.length ?? 0) > 0) return null
    const activeLaws = laws.active()
    const scope = componentOf(activeLaws, [root.id])
    // TRAVERSAL ONLY: live-live distance coupling orders the placement. A unary distance (to a
    // literal) is a constraint the frontier meets, never a tree edge; coordinate rows order
    // nothing. (id:laws-free-relations-f4-actor)
    const coupling = scope.laws.filter((law) => law.feature === "distance" &&
        (law.endpoints ?? []).length === 2 && law.endpoints.every((id) => scope.frames.has(id)))
    // A pinned anchor bounds the free branch only when it is otherwise a free point:
    // held, wounded or non-free frames stay in the expansion and decline whole below.
    const anchors = new Set([...scope.frames].filter((id) => {
        if (id === root.id) return false
        const frame = registry.get(id)
        return frame != null && frame.id === id && registry.get(frame.id) === frame &&
            pinnedLaw(activeLaws, id) != null && freePoint(frame) && !heldFrame(frame)
    }))
    // APPLICABILITY, not admission: the given root with unchanged anchors must satisfy
    // its own incident anchor distance. The original whole-law gate still decides alone.
    const rootAnchorLaws = coupling.filter((law) => {
        const [a, b] = law.endpoints ?? []
        return (a === root.id && anchors.has(b)) || (b === root.id && anchors.has(a))
    })
    if (rootAnchorLaws.length > 0) {
        const premise = new Map([[root, verdict.pose]])
        if (lawViolation(rootAnchorLaws, premise, registry, world).status !== 'valid') return null
    }
    // Reachability is the ORIGINAL participant graph with pinned anchors removed:
    // a hyperedge keeps every remaining free endpoint. With no anchors this is the
    // old scope exactly; non-distance participants are never silently dropped.
    const free = anchors.size === 0 ? scope.frames : componentOf(scope.laws.map((law) => ({
        endpoints: (law.endpoints ?? []).filter((id) => !anchors.has(id)),
    })), [root.id]).frames
    const treeCoupling = coupling.filter((law) => (law.endpoints ?? []).every((id) => free.has(id)))
    const shape = treeShape(treeCoupling, free, root.id)
    if (!shape || shape.order.length === 0) return null
    for (const id of shape.members) {
        if (id === root.id) continue
        const member = registry.get(id)
        if (!member || member.parent !== root.parent || !canMove(member, activeLaws)) return null
    }
    const readyIncidence = indexByIdentities(scope.laws, boundParticipants)
    const reference = new Map()
    const at = (frame) => {
        if (!reference.has(frame.id)) reference.set(frame.id, world.read(frame, null).position)
        return reference.get(frame.id)
    }
    const edges = []
    for (const { parent, child, radius, law } of shape.order) {
        const above = registry.get(parent), below = registry.get(child), declaring = registry.get(law.frame)
        if (!above || !below || !declaring) return null
        const here = at(below)
        if (!finite3(here)) return null
        const held = directionBetween(at(above), here)
        if (held === INVALID) return null
        const bond = held ?? bondOf({ parentId: parent, childId: child,
            axis: world.transform(declaring).rotation.rotateVec(1, 0, 0) })
        if (!bond) return null
        edges.push({ parent, child, radius, at: here, bond })
    }
    const wish = world.read(root, new Map([[root, verdict.pose]]))
    if (!finite3(wish.position)) return null
    // GIVEN root and provisional FREE positions share work; accepted references do not.
    // Placement reads remain HELD for an unassigned follower. (id:laws-free-relations-review)
    const work = new Map([[root, verdict.pose]])
    const readyFor = (id) => {
        const positionKnown = (refId) => refId === id || !shape.members.has(refId) || work.has(registry.get(refId))
        return (readyIncidence.get(id) ?? []).filter((law) => {
            const parts = boundParticipants(law)
            return parts.includes(id) && parts.every(positionKnown) &&
                boundReferences(law).every(({ id: refId, aspect }) => aspect !== "position" || positionKnown(refId))
        })
    }
    const placed = treeFold({ rootId: root.id, root: wish.position, edges,
        place: ({ centre, edge }) => {
            const member = registry.get(edge.child)
            const radial = nearestChild({ ...edge, centre })
            if (!radial) return null
            const ready = readyFor(edge.child)
            work.set(member, positionPose(world, member, radial))
            // Keep the radial answer when the ready originals already hold.
            if (lawViolation(ready, work, registry, world).status === 'valid') return radial
            const ctx = lawContext(registry, work, world, { writerId: member.id })
            const q = pointQuery(edge.child, ready, ctx)
            if (q.unavailable.length > 0 || q.sets.length === 0 || q.sets.some((set) => !set)) return null
            const near = meetNearest(meetAll(q.sets), edge.at, { keep: edge.at })
            if (!near.ok) return null
            work.set(member, positionPose(world, member, near.at))
            return near.at
        } })
    if (!placed || work.size !== shape.members.size) return null
    const members = shape.order.map(({ child }) => registry.get(child))
    return { ...verdict, component: members.map((m) => ({ frame: m, pose: work.get(m) })) }
}
