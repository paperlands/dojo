// Message is text (id:kc-p-text). write once → string; name = hash(bytes).
// Catalog last so body cannot overwrite a frozen field (id:kb-2).

import { hash } from "./hash.js"
// floor.json — law as data; Dojo.Keep.shaped?/1 walks the same table (id:kb-5-floor).
import FLOOR from "./floor.json" with { type: "json" }

/** Version this build authors. */
export const V = 1

/**
 * The one place a value becomes text. Catalog written last.
 * Defaults null so five keys always stringify (id:kc-r-absence).
 * @param {string} kind
 * @param {object} body
 * @param {{ root?: string | null, target?: string | null, ts?: {t: number, n: number} | null }} ctx
 * @returns {string}
 */
export function write(kind, body, { root = null, target = null, ts = null }) {
    return JSON.stringify({ ...body, v: V, kind, root, ts, target })
}

/**
 * For display only — never re-kept (id:kb-4).
 * @param {string} bytes
 * @returns {object}
 */
export function read(bytes) {
    return JSON.parse(bytes)
}

/**
 * Name from bytes (id:kc-law 3).
 * @param {string} bytes
 * @returns {string} hex64
 */
export function name(bytes) {
    return hash(bytes)
}

// ── floor interpreter ────────────────────────────────────────────────

const MISSING = Symbol("missing")

/** @param {unknown} obj @param {string} path */
function fetchPath(obj, path) {
    let cur = obj
    for (const key of path.split(".")) {
        if (cur == null || typeof cur !== "object" || !(key in /** @type {object} */ (cur))) {
            return MISSING
        }
        cur = /** @type {object} */ (cur)[key]
    }
    return cur
}

/** @param {unknown} value @param {string} type */
function typeOk(value, type) {
    if (value === MISSING) return false
    switch (type) {
        case "string":
            return typeof value === "string"
        case "string|null":
            return typeof value === "string" || value === null
        case "nonneg_int":
            return Number.isInteger(value) && /** @type {number} */ (value) >= 0
        case "int>=1":
            return Number.isInteger(value) && /** @type {number} */ (value) >= 1
        default:
            throw new Error(`unknown floor type: ${type}`)
    }
}

/** Nested paths report top-level column (ts.t → ts). */
function whyOf(field) {
    const i = field.indexOf(".")
    return i === -1 ? field : field.slice(0, i)
}

/**
 * Projection floor (id:kb-5-floor). First failing field, else null.
 * Unshaped → durable and invisible (no index, no ship).
 * @param {object} value - entry.read(bytes)
 * @returns {string | null}
 */
export function unshaped(value) {
    if (value == null || typeof value !== "object") return "message"
    for (const { field, type } of FLOOR) {
        if (!typeOk(fetchPath(value, field), type)) return whyOf(field)
    }
    return null
}
