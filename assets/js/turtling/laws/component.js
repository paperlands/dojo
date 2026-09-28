// The affected component and a bounded analytic realization for a tree of
// distances. (id:laws-build-p3, id:laws-build-solve-seam)
//
// Pure: bound laws and world positions in, world positions out. No scheduler, no
// frame mutation, no numerical iteration. A cycle, a non-distance law or a missing
// anchor is reported as unsupported rather than approximated.
//
// The first increment is deliberately narrow: a connected set of distance laws
// with one held anchor is realized by radial propagation, each node placed at its
// law's radius from its parent along the current direction. That is enough to make
// two connected distances respond to one requested change, analytically.

import { sub, len, unit, finite3 } from "./vec3.js"


// The connected component of `laws` that shares a frame with any seed identity.
// Nodes are frame ids, edges are law endpoints. (id:laws-build-p3)
export function componentOf(laws, seedIds) {
    const byFrame = new Map()
    for (const law of laws) {
        for (const id of law.endpoints ?? []) {
            if (!byFrame.has(id)) byFrame.set(id, [])
            byFrame.get(id).push(law)
        }
    }
    const frames = new Set()
    const found = new Set()
    const queue = [...(seedIds ?? [])]
    while (queue.length > 0) {
        const id = queue.pop()
        if (frames.has(id)) continue
        frames.add(id)
        for (const law of byFrame.get(id) ?? []) {
            found.add(law)
            for (const other of law.endpoints) if (!frames.has(other)) queue.push(other)
        }
    }
    return { frames, laws: [...found] }
}

// Realize a tree of distance laws from one anchor by radial propagation. Returns
// a Map of frame id → world position, or null when the topology is outside the
// analytic case (a cycle, a non-distance law, a missing anchor, bad geometry).
// (id:laws-build-p3)
export function realizeDistanceTree(laws, anchorId, world, radiusOf) {
    if (!laws.length) return null
    const adj = new Map()
    for (const law of laws) {
        if (law.feature !== 'distance') return null
        const [a, b] = law.endpoints ?? []
        if (a === undefined || b === undefined) return null
        if (!adj.has(a)) adj.set(a, [])
        if (!adj.has(b)) adj.set(b, [])
        adj.get(a).push({ other: b, law })
        adj.get(b).push({ other: a, law })
    }
    if (!adj.has(anchorId)) return null
    const anchor = world(anchorId)
    if (!finite3(anchor)) return null

    const visited = new Set([anchorId])
    const parentOf = new Map([[anchorId, null]])
    // Keep each edge's ORIGINAL direction (parent-before → child-before) and only
    // change its length. Using the parent's new position would flip a child behind
    // a parent that moved past it.
    const origins = new Map([[anchorId, [...anchor]]])
    const positions = new Map([[anchorId, [...anchor]]])
    const queue = [anchorId]
    while (queue.length > 0) {
        const parent = queue.shift()
        for (const { other, law } of adj.get(parent)) {
            if (other === parentOf.get(parent)) continue   // the edge we arrived on
            if (visited.has(other)) return null              // a real cycle: not this case
            visited.add(other)
            parentOf.set(other, parent)
            const from = positions.get(parent)
            const parentOrigin = origins.get(parent)
            const childOrigin = world(other)
            // A coincident pair takes the +x policy, disclosed as policy.
            const dir = (finite3(childOrigin) ? unit(sub(childOrigin, parentOrigin)) : null) ?? [1, 0, 0]
            const r = radiusOf(law)
            if (!Number.isFinite(r) || r < 0) return null
            positions.set(other, [from[0] + dir[0] * r, from[1] + dir[1] * r, from[2] + dir[2] * r])
            origins.set(other, childOrigin)
            queue.push(other)
        }
    }
    return positions
}
