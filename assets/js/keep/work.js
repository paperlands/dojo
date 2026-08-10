// The work fold — self, one work (id:kr-fold).
//
//   ofWork(listed, work_id) = list(root, n) filter target === work_id
//
// Pure: bytes in, bytes out (id:kc-p-fold). Nothing here is ever written, and
// no verb is added — the river is a fold over the four reads the door already
// has (id:kb-8). Order is list's order, which is the author's ts.
//
// Page honesty (id:kb-8-page): this shows the work's keeps among the newest n
// of the WHOLE log. Older keeps of the same work are absent by construction —
// the surface paints that absence as night, never as an empty history.
//
// THE LINES (id:kr-mirror). A line is a fold: walk a head back through its
// causal parent. The meet of two lines — the latest common keep — is derived
// here at the reader, never stored. Ancestry never becomes an edge on the
// rail; it becomes which surface a keep rides (sky or water) plus one ripple.

import { name, read } from "./entry.js"

/**
 * The work's keeps among a page of the author's history.
 *
 * @param {string[]} listed - bytes[] from list(root, n), newest-first
 * @param {string} work_id - the terminal's currentWorkId (id:kb-work)
 * @returns {string[]} bytes[], order preserved
 */
export function ofWork(listed, work_id) {
    if (!work_id) return []
    return listed.filter((bytes) => targetOf(bytes) === work_id)
}

function targetOf(bytes) {
    try {
        return read(bytes).target ?? null
    } catch {
        // An unreadable message is not this fold's to repair; it simply is not
        // this work's. The reader verifies names elsewhere (id:kb-8).
        return null
    }
}

/**
 * The chain under a page of one work's keeps.
 *
 * The causal parent is `prev` in the body of the kinds that have one
 * (id:kc-contracts). A snap gains one only when the fork gesture mints it.
 * ONE SEAM CARRIES BOTH ERAS without a global switch:
 *
 *   explicit string prev  →  that parent (fork or continued line)
 *   absent                →  next older in author order (the un-forked chain)
 *
 * So the first fork can land on a still-linear river: the new keep names its
 * parent; the older keeps keep walking by time. A prev pointing outside the
 * page is a foot — its parent is under the horizon (page honesty).
 *
 * @param {string[]} versions - ofWork output, newest-first
 * @returns {{ids: string[], parent: Map<string,string|null>, byId: Map<string,string>, heads: string[]}}
 */
export function linesOf(versions) {
    const ids = versions.map(name)
    const byId = new Map()
    for (let i = 0; i < versions.length; i++) byId.set(ids[i], versions[i])

    const bodies = versions.map((bytes) => {
        try {
            return read(bytes)
        } catch {
            return {}
        }
    })

    const parent = new Map()
    for (let i = 0; i < ids.length; i++) {
        const named = bodies[i].prev
        const p = typeof named === "string" && named ? named : (ids[i + 1] ?? null)
        parent.set(ids[i], p != null && byId.has(p) ? p : null)
    }

    const claimed = new Set()
    for (const p of parent.values()) if (p) claimed.add(p)
    const heads = ids.filter((id) => !claimed.has(id))

    return { ids, parent, byId, heads }
}

/**
 * One line: a head walked back through its parents. Newest-first, head first.
 *
 * @param {string[]} versions - ofWork output
 * @param {string} headId
 * @returns {string[]} bytes[]
 */
export function lineOf(versions, headId) {
    const { parent, byId } = linesOf(versions)
    return walk(parent, byId, headId)
}

// A cycle cannot arise from an honest mint, and a reader that trusts that
// hangs the render thread. Seen is the whole fence.
function walk(parent, byId, headId) {
    const out = []
    const seen = new Set()
    let at = headId
    while (at != null && byId.has(at) && !seen.has(at)) {
        seen.add(at)
        out.push(byId.get(at))
        at = parent.get(at) ?? null
    }
    return out
}

/**
 * The meet — the latest keep two lines share. Derived, never stored.
 *
 * @param {string[]} lineA - newest-first
 * @param {string[]} lineB - newest-first
 * @returns {string|null} the meet's id
 */
export function meetOf(lineA, lineB) {
    const inB = new Set(lineB.map(name))
    for (const bytes of lineA) {
        const id = name(bytes)
        if (inB.has(id)) return id
    }
    return null
}

/**
 * The mirror fold: this shell's line, and the nearest sibling by meet.
 *
 * One mirror at a time (helios: one speaker). Nearest = the latest meet —
 * the sibling that walked with us longest. Further siblings wait beneath.
 *
 * @param {string[]} versions - ofWork output, newest-first
 * @param {string} [headId] - defaults to the newest keep: this shell's head
 * @returns {{head: string|null, line: string[], sibling: string[], siblingHead: string|null, meet: string|null}}
 */
export function mirrorOf(versions, headId) {
    const { parent, byId, heads, ids } = linesOf(versions)
    const head = headId && byId.has(headId) ? headId : (ids[0] ?? null)
    if (head == null) {
        return { head: null, line: [], sibling: [], siblingHead: null, meet: null }
    }

    const line = walk(parent, byId, head)
    const lineIndex = new Map(line.map((bytes, i) => [name(bytes), i]))

    let best = null
    for (const other of heads) {
        if (other === head) continue
        const sib = walk(parent, byId, other)
        const meet = meetOf(line, sib)
        // Distance from the head, in seats. No meet at all sorts last.
        const depth = meet != null ? lineIndex.get(meet) : Infinity
        if (best == null || depth < best.depth) best = { other, sib, meet, depth }
    }

    if (!best) return { head, line, sibling: [], siblingHead: null, meet: null }
    return { head, line, sibling: best.sib, siblingHead: best.other, meet: best.meet }
}

/**
 * The river's columns, oldest-first (west → east).
 *
 * Beneath the trunk the water is the sky exactly — same keeps, one river
 * twice-stepped. Past the meet each surface carries its own line's keeps.
 *
 * KEYS ARE THE SWAP'S WHOLE MECHANISM: a trunk column is keyed by its keep's
 * id, a divergent column by its distance past the meet. Trading the two lines
 * therefore re-paints only the divergent columns — the trunk holds still,
 * because the common past is common (id:kr-mirror).
 *
 * @param {string[]} line - newest-first
 * @param {string[]} sibling - newest-first (empty when the river is one line)
 * @param {string|null} meet
 * @returns {{key: string, sky: string|null, water: string|null, trunk: boolean, meet: boolean}[]}
 */
export function columnsOf(line, sibling, meet) {
    const L = [...line].reverse()
    const S = [...sibling].reverse()

    if (!S.length || meet == null) {
        return L.map((bytes) => ({
            key: name(bytes),
            sky: bytes,
            water: null,
            trunk: false,
            meet: false,
        }))
    }

    const li = L.findIndex((b) => name(b) === meet)
    const si = S.findIndex((b) => name(b) === meet)
    if (li < 0 || si < 0) {
        return L.map((bytes) => ({
            key: name(bytes),
            sky: bytes,
            water: null,
            trunk: false,
            meet: false,
        }))
    }

    const columns = []
    // Trunk, paired backwards from the meet so the two walks stay aligned
    // even where one line reaches further into the page than the other.
    const depth = Math.min(li, si)
    for (let k = depth; k >= 0; k--) {
        const sky = L[li - k]
        columns.push({
            key: name(sky),
            sky,
            water: S[si - k] ?? sky,
            trunk: true,
            meet: k === 0,
        })
    }

    const LT = L.slice(li + 1)
    const ST = S.slice(si + 1)
    for (let k = 0; k < Math.max(LT.length, ST.length); k++) {
        columns.push({
            key: `div:${k}`,
            sky: LT[k] ?? null,
            water: ST[k] ?? null,
            trunk: false,
            meet: false,
        })
    }
    return columns
}
