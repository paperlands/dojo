// Pure distance placement: held centre, accepted seed, radius and an explicit singular tie.
// Reach initialization and actor following share the kernel, not their selection policy.
// (id:laws-free-relations-review)
import { add, scale, directionBetween, INVALID, finite3 } from "./vec3.js"
import { boundTerm } from "./authored.js"

// A singular bond is a finite direction, normalized exactly before carrying a radius.
// (id:laws-free-relations-n-node-review)
const unitDirection = (dir) => {
    if (!finite3(dir)) return null
    const len = Math.hypot(dir[0], dir[1], dir[2])
    if (!Number.isFinite(len) || len === 0) return null
    return len === 1 ? dir : dir.map((n) => n / len)
}

export function nearestChild({ centre, at, radius, bond }) {
    if (!finite3(centre) || !finite3(at) || !Number.isFinite(radius) || radius < 0) return null
    if (radius === 0) return [...centre]
    const axis = directionBetween(centre, at)
    if (axis === INVALID) return null
    const dir = unitDirection(axis ?? bond)
    if (!dir) return null
    const placed = add(centre, scale(dir, radius))
    return finite3(placed) ? placed : null
}

// Singular pairs use the declaring frame's x, sided by identity order.
// (id:laws-free-relations-f4-actor)
export const bondOf = ({ parentId, childId, axis }) => {
    if (!finite3(axis)) return null
    return parentId <= childId ? axis : axis.map((n) => -n)
}

// The rooted COUPLING view this traversal answers: live-live distance edges only, one radius
// per pair, acyclic, reaching every member. The caller keeps every other original and
// conditions its point views; this domain is the view's, not truth admissibility.
export function treeShape(laws, frames, rootId) {
    if (!frames.has(rootId)) return null        // the root must belong to the component it roots
    const adjacency = new Map()
    for (const law of laws) {
        if (law.feature !== "distance") return null
        const [a, b] = law.endpoints ?? []
        if (a === undefined || b === undefined || !frames.has(a) || !frames.has(b)) return null
        const radius = boundTerm(law)?.radius
        if (!Number.isFinite(radius) || radius < 0) return null
        if (a === b) { if (radius !== 0) return null; continue }   // a self-zero is neutral
        for (const [from, to] of [[a, b], [b, a]]) {
            const edges = adjacency.get(from) ?? new Map()
            const seen = edges.get(to)
            if (seen && seen.radius !== radius) return null         // same pair, two radii
            edges.set(to, { radius, law })
            adjacency.set(from, edges)
        }
    }
    const order = []
    const visited = new Set([rootId])
    const parentOf = new Map([[rootId, null]])
    const queue = [rootId]
    while (queue.length > 0) {
        const id = queue.shift()
        for (const [to, edge] of adjacency.get(id) ?? []) {
            if (to === parentOf.get(id)) continue                   // the edge we arrived on
            if (visited.has(to)) return null                        // a real cycle
            visited.add(to)
            parentOf.set(to, id)
            order.push({ parent: id, child: to, radius: edge.radius, law: edge.law })
            queue.push(to)
        }
    }
    if (visited.size !== frames.size) return null
    return { order, members: visited }
}

// PURE fold: one placement per edge, in traversal order, ID -> WORLD out. `place` may answer
// differently for a conditioned prefix; it READS `placed` and returns one finite point or
// null — it never mutates it (the caller's pose map is its own business).
export function treeFold({ rootId, root, edges, place = ({ centre, edge }) => nearestChild({ ...edge, centre }) }) {
    if (!finite3(root)) return null             // an unreadable wish has no placement
    const placed = new Map([[rootId, [...root]]])
    for (const edge of edges) {
        const centre = placed.get(edge.parent)
        if (!centre) return null
        const at = place({ centre, edge, placed })
        if (!at || !finite3(at)) return null
        placed.set(edge.child, at)
    }
    return placed
}
