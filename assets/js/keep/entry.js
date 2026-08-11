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

const whole = (x) => Number.isInteger(x) && x >= 0

/**
 * THE PROJECTION FLOOR — one law, both sides of the wire (id:kb-5-floor).
 *
 * Every column an index or a row holds must project, or the keep is durable
 * and INVISIBLE: in no index, unlistable, unshippable. It lives here because
 * the floor is a fact about the five frozen fields, not about a store.
 *
 * Dojo.Keep.shaped?/1 is the Elixir mirror; the two say the same thing clause
 * for clause. They diverged once — client finite, server non-negative integer —
 * and a client could mint what the clan refuses forever (id:kb-vet5 42).
 *
 * @param {object} value - entry.read(bytes)
 * @returns {string | null} the first field that will never project, else null
 */
export function unshaped(value) {
    if (value == null || typeof value !== "object") return "message"
    if (typeof value.root !== "string") return "root"
    if (typeof value.kind !== "string") return "kind"
    if (typeof value.target !== "string" && value.target !== null) return "target"
    if (value.ts == null || !whole(value.ts.t) || !whole(value.ts.n)) return "ts"
    if (!whole(value.v) || value.v < 1) return "v"
    return null
}
