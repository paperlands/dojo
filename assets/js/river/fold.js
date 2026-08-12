// River fold — pure geometry (id:kr-fold). Bytes live in keeps/, not here.

import { name } from "../keep/entry.js"
import { sharedIds } from "../keep/shared.js"
import { columnsOf, mirrorOf, namesOf } from "../keep/work.js"
import { DRAFT, PRESENT } from "./mode.js"

/** The one rest that is not a column key: the east-most keep of the line. */
export const HEAD = "head"

/**
 * Column geometry. East kinds are the key itself (PRESENT / DRAFT) — no
 * parallel boolean flags. face rides only on a draft column.
 *
 * @typedef {{
 *   key: string,
 *   sky: string|null,
 *   water: string|null,
 *   trunk: boolean,
 *   meet: boolean,
 *   face?: string|null,
 * }} Column
 */

/**
 * Fold one work's page into the river's standing geometry.
 *
 * @param {string[]} versions - ofWork output, newest-first
 * @param {string[]} held - local keeps among the page (door.local)
 * @param {{
 *   head?: string|null,
 *   draft?: {from?: string, face?: string|null}|null,
 *   faceOf?: (id: string) => string|null,
 *   keptLocal?: Set<string>,
 * }} [opts]
 * @returns {{
 *   sharedIds: Set<string>,
 *   kept: (id: string) => boolean,
 *   keptLocal: Set<string>,
 *   settling: boolean,
 *   columns: Column[],
 *   siblingHead: string|null,
 *   hasMirror: boolean,
 *   headKey: string,
 *   newestId: string|null,
 * }}
 */
export function fold(versions, held, {
    head = null,
    draft = null,
    faceOf = () => null,
    keptLocal: keptWas = new Set(),
} = {}) {
    // THE PAGE IS NAMED ONCE (id:ka-passes). Measured 6.4 hashing passes here
    // before this line existed — shared, its result, keptLocal, newestId and
    // both work folds each re-derived what the one before it already had.
    // kc-law 3 is unmoved: the reader still derives the id from the bytes.
    const ids = namesOf(versions)

    // Shared = list − local, never a field (id:kb-8).
    const answered = new Set(sharedIds(ids, new Set(held.map(name))))
    const kept = (id) => !answered.has(id)
    const keptLocal = new Set(ids.filter(kept))
    let settling = false
    for (const id of keptWas) {
        if (!keptLocal.has(id) && answered.has(id)) {
            settling = true
            break
        }
    }

    const { line, sibling, meet, siblingHead, lineIds, siblingIds } =
        mirrorOf(versions, head, ids)
    const columns = columnsOf(line, sibling, meet, { line: lineIds, sibling: siblingIds })
    const headKey = columns.length ? columns[columns.length - 1].key : PRESENT
    const newestId = ids[0] ?? null

    // East: key is the kind (id:kr-meridian).
    columns.push({
        key: PRESENT,
        sky: null,
        water: null,
        trunk: false,
        meet: false,
    })

    if (draft) {
        const face = draft.face ?? (draft.from ? faceOf(draft.from) : null) ?? null
        columns.push({
            key: DRAFT,
            sky: null,
            water: null,
            trunk: false,
            meet: false,
            face,
        })
    }

    return {
        sharedIds: answered,
        kept,
        keptLocal,
        settling,
        columns,
        siblingHead,
        hasMirror: sibling.length > 0,
        headKey,
        newestId,
    }
}

/**
 * Which column a breath's rest names — null means leave the wheel where the
 * child left it. A rest for a column that is not standing (a draft just
 * discarded) is no rest at all.
 *
 * @param {string|null} rest - HEAD, a column key, or null
 * @param {{columns: Column[], headKey: string}} folded
 * @returns {string|null}
 */
export function restKey(rest, { columns, headKey }) {
    const key = rest === HEAD ? headKey : rest
    return key && columns.some((c) => c.key === key) ? key : null
}

/**
 * Mint edge: this work has a head the seal did not. Share never changes head.
 * Land is fold-derived — seal alone is not a land (id:kr-land).
 *
 * @param {string|null|undefined} wasHead - newestId when seal began
 * @param {string|null|undefined} newestId - fold's newestId now
 * @returns {boolean}
 */
export function landed(wasHead, newestId) {
    return newestId != null && newestId !== wasHead
}
