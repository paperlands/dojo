// The message is text (id:kc-p-text, id:kb-2).
//
// An entry is a string. It is never an object that gets serialized — write is
// the one place a value becomes text, and read is for display, never re-kept.
// The name is the hash of those bytes (id:kc-law 2,3).
//
// Catalog last: body cannot overwrite a frozen field. One line makes a silent
// corruption of root inexpressible rather than documented (id:kb-2).
//
// No key-order normalizer — nothing to force. Key order is the string's;
// one write per kind makes it stable by construction, not by rule (id:kc-p-text).

import { hash } from "./hash.js"

/** The version this build authors. Selects the fold's floor, never a parser. */
export const V = 1

/**
 * The one place a value becomes text.
 * Catalog fields are written last so a kind's body can never displace them.
 *
 * The catalog defaults to null so it is FIVE KEYS ALWAYS: JSON.stringify omits
 * an undefined value, and an omitted key is a different string, so a different
 * name for the same value (id:kc-r-absence — not whether it is there).
 *
 * @param {string} kind
 * @param {object} body - free fields for this kind (may carry unknowns)
 * @param {{ root?: string | null, target?: string | null, ts?: {t: number, n: number} | null }} ctx
 * @returns {string} the entry — the durable message
 */
export function write(kind, body, { root = null, target = null, ts = null }) {
    return JSON.stringify({ ...body, v: V, kind, root, ts, target })
}

/**
 * For display. Never re-serialized; never handed back to write as an entry.
 * A fold's output is not an entry (id:kb-4).
 *
 * @param {string} bytes
 * @returns {object}
 */
export function read(bytes) {
    return JSON.parse(bytes)
}

/**
 * The name of the entry, derived from the bytes that hold it (id:kc-law 3).
 *
 * @param {string} bytes
 * @returns {string} hex64
 */
export function name(bytes) {
    return hash(bytes)
}
