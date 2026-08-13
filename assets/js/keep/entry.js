// Message is text (id:kc-p-text). write once → string; name = hash(bytes).
// Catalog last so body cannot overwrite a frozen field (id:kb-2).

import { hash } from "./hash.js"
// The skeleton lives with the keep, not with a language (id:kb-5-skeleton).
import SKELETON from "../../../priv/keep/skeleton.json" with { type: "json" }

/** Version this build authors. */
export const V = 1

// Top-level catalog keys, write order. The set is the skeleton's; the order is
// the name (id:kb-2). A test refuses a key the skeleton does not name.
const CATALOG = ["v", "kind", "root", "ts", "target"]

/**
 * The one place a value becomes text. Catalog last.
 * Only a value is written. Null and omitted stay off the string, so they
 * cannot become two names for one keep (id:kc-r-absence).
 * @param {string} kind
 * @param {object} body
 * @param {{ root?: string, target?: string, ts?: {t: number, n: number} }} [ctx]
 * @returns {string}
 */
export function write(kind, body, { root, target, ts } = {}) {
    const rest = { ...body }
    for (const key of CATALOG) delete rest[key]
    const catalog = { v: V, kind }
    if (typeof root === "string") catalog.root = root
    if (stamp(ts)) catalog.ts = ts
    if (typeof target === "string") catalog.target = target
    return JSON.stringify({ ...rest, ...catalog })
}

function stamp(ts) {
    return (
        ts != null &&
        typeof ts.t === "number" &&
        typeof ts.n === "number"
    )
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

// ── skeleton interpreter ─────────────────────────────────────────────

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
        case "nonneg_int":
            return Number.isInteger(value) && /** @type {number} */ (value) >= 0
        case "int>=1":
            return Number.isInteger(value) && /** @type {number} */ (value) >= 1
        default:
            throw new Error(`unknown skeleton type: ${type}`)
    }
}

/** Nested paths report top-level column (ts.t → ts). */
function whyOf(field) {
    const i = field.indexOf(".")
    return i === -1 ? field : field.slice(0, i)
}

/**
 * Skeleton (id:kb-5-skeleton). First failing field, else null.
 * Unshaped → durable and invisible (no index, no ship).
 * @param {object} value - entry.read(bytes)
 * @returns {string | null}
 */
export function unshaped(value) {
    if (value == null || typeof value !== "object") return "message"
    for (const { field, type } of SKELETON) {
        if (!typeOk(fetchPath(value, field), type)) return whyOf(field)
    }
    return null
}
