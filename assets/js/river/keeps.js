// River keep index: Map<id, { bytes, source?, face? }> (id:kr-fold).

import { name } from "../keep/entry.js"

/**
 * @typedef {{ bytes: string, source?: string, face?: string }} KeepRow
 */

/**
 * Upsert page versions into the index. Preserves source/face on a standing row.
 * @param {Map<string, KeepRow>} keeps
 * @param {string[]} versions - newest-first
 */
export function ingest(keeps, versions) {
    for (const bytes of versions) {
        const id = name(bytes)
        const row = keeps.get(id)
        if (row) row.bytes = bytes
        else keeps.set(id, { bytes })
    }
}

/**
 * Drop rows not in want; revoke face blob URLs.
 * @param {Map<string, KeepRow>} keeps
 * @param {Set<string>} want
 */
export function prune(keeps, want) {
    for (const [id, row] of keeps) {
        if (want.has(id)) continue
        if (row.face) URL.revokeObjectURL(row.face)
        keeps.delete(id)
    }
}

/**
 * Clear the whole index (work switch).
 * @param {Map<string, KeepRow>} keeps
 */
export function clear(keeps) {
    for (const row of keeps.values()) {
        if (row.face) URL.revokeObjectURL(row.face)
    }
    keeps.clear()
}

/** @param {Map<string, KeepRow>} keeps @param {string} id */
export function faceOf(keeps, id) {
    return keeps.get(id)?.face ?? null
}

/** @param {Map<string, KeepRow>} keeps @param {string} id */
export function bytesOf(keeps, id) {
    return keeps.get(id)?.bytes ?? null
}
