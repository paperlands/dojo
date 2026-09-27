// The work fold — self, one work (id:kr-fold · id:kr-mirror).
// Page honesty: the work among the newest n of the whole log (id:kb-8-page).

import { name, read } from "./entry.js"

/**
 * The page, named once (id:ka-passes). Measured: a river paint hashed 6.4 times.
 *
 * @param {string[]} versions - bytes[], newest-first
 * @returns {string[]} ids, parallel to versions
 */
export function namesOf(versions) {
    return versions.map(name)
}

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
        // Unreadable is not this work's (id:kb-8).
        return null
    }
}

/**
 * Author order (id:kb-8): newer ts wins; missing/unreadable loses.
 * Pure fold — the pull rung picks which picture to hold, never invents order.
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {string|null|undefined} the newer of the two, or the one that reads
 */
export function newerKeep(a, b) {
    if (!a) return b
    if (!b) return a
    try {
        const ta = read(a).ts
        const tb = read(b).ts
        if (!tb || typeof tb.t !== "number") return a
        if (!ta || typeof ta.t !== "number") return b
        if (tb.t > ta.t || (tb.t === ta.t && (tb.n ?? 0) > (ta.n ?? 0))) return b
        return a
    } catch {
        return a
    }
}

/**
 * The chain under a page of one work's keeps.
 *
 * Causal parent is `prev` when minted (id:kc-contracts); else next older by
 * author order. First fork can land on a still-linear river. A prev outside
 * the page is a foot.
 *
 * @param {string[]} versions - ofWork output, newest-first
 * @param {string[]} [ids] - the page's names, if the caller already holds them
 * @returns {{ids: string[], parent: Map<string,string|null>, byId: Map<string,string>, heads: string[]}}
 */
export function linesOf(versions, ids = namesOf(versions)) {
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
 * @param {string[]} [ids] - the page's names, if the caller already holds them
 * @returns {string[]} bytes[]
 */
export function lineOf(versions, headId, ids = namesOf(versions)) {
    const { parent, byId } = linesOf(versions, ids)
    return walk(parent, byId, headId).map((id) => byId.get(id))
}

// A cycle cannot arise from an honest mint; seen is the fence. Walks ids (id:ka-passes).
function walk(parent, byId, headId) {
    const out = []
    const seen = new Set()
    let at = headId
    while (at != null && byId.has(at) && !seen.has(at)) {
        seen.add(at)
        out.push(at)
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
    return meetOfIds(lineA.map(name), lineB.map(name))
}

// Same sentence over ids already named (id:ka-passes).
function meetOfIds(idsA, idsB) {
    const inB = new Set(idsB)
    for (const id of idsA) if (inB.has(id)) return id
    return null
}

/**
 * This shell's line, and the nearest sibling by meet (one speaker).
 * Ids ride out so columnsOf does not re-hash (id:ka-passes).
 *
 * @param {string[]} versions - ofWork output, newest-first
 * @param {string} [headId] - defaults to the newest keep: this shell's head
 * @param {string[]} [ids] - the page's names, if the caller already holds them
 * @returns {{head: string|null, line: string[], lineIds: string[], sibling: string[], siblingIds: string[], siblingHead: string|null, meet: string|null}}
 */
export function mirrorOf(versions, headId, ids = namesOf(versions)) {
    const { parent, byId, heads } = linesOf(versions, ids)
    const head = headId && byId.has(headId) ? headId : (ids[0] ?? null)
    if (head == null) {
        return EMPTY_MIRROR
    }

    const lineIds = walk(parent, byId, head)
    const lineIndex = new Map(lineIds.map((id, i) => [id, i]))

    let best = null
    for (const other of heads) {
        if (other === head) continue
        const sibIds = walk(parent, byId, other)
        const meet = meetOfIds(lineIds, sibIds)
        // Distance from the head, in seats. No meet sorts last.
        const depth = meet != null ? lineIndex.get(meet) : Infinity
        if (best == null || depth < best.depth) best = { other, sibIds, meet, depth }
    }

    const line = lineIds.map((id) => byId.get(id))
    if (!best) {
        return { head, line, lineIds, sibling: [], siblingIds: [], siblingHead: null, meet: null }
    }
    return {
        head,
        line,
        lineIds,
        sibling: best.sibIds.map((id) => byId.get(id)),
        siblingIds: best.sibIds,
        siblingHead: best.other,
        meet: best.meet,
    }
}

const EMPTY_MIRROR = Object.freeze({
    head: null,
    line: [],
    lineIds: [],
    sibling: [],
    siblingIds: [],
    siblingHead: null,
    meet: null,
})

/**
 * The river's columns, oldest-first (west → east).
 * Trunk keyed by keep id, divergent by distance past the meet — so a swap
 * holds the trunk still (id:kr-mirror).
 *
 * @param {string[]} line - newest-first
 * @param {string[]} sibling - newest-first (empty when the river is one line)
 * @param {string|null} meet
 * @param {{line?: string[], sibling?: string[]}} [ids] - mirrorOf's lineIds /
 *   siblingIds, when the caller already holds them (id:ka-passes)
 * @returns {{key: string, sky: string|null, water: string|null, trunk: boolean, meet: boolean}[]}
 */
export function columnsOf(line, sibling, meet, ids = {}) {
    const L = [...line].reverse()
    const S = [...sibling].reverse()
    // Ids ride the same reversal as the bytes.
    const LK = [...(ids.line ?? namesOf(line))].reverse()
    const SK = [...(ids.sibling ?? namesOf(sibling))].reverse()

    const oneLine = () =>
        L.map((bytes, i) => ({
            key: LK[i],
            sky: bytes,
            water: null,
            trunk: false,
            meet: false,
        }))

    if (!S.length || meet == null) return oneLine()

    const li = LK.indexOf(meet)
    const si = SK.indexOf(meet)
    if (li < 0 || si < 0) return oneLine()

    const columns = []
    // Pair backwards from the meet so unequal page depths stay aligned.
    const depth = Math.min(li, si)
    for (let k = depth; k >= 0; k--) {
        const sky = L[li - k]
        columns.push({
            key: LK[li - k],
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
