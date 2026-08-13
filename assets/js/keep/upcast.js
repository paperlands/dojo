// Truth is a log; everything else is a fold (id:kc-p-fold, id:kb-4).
//
// Upcast is a projection, not a migration. Nothing on disk is ever rewritten.
// Its output is a *view*: it has no id and is never written. Without that fence,
// a reader upcasts, forks from the upcast, and mints an entry nobody authored.
//
// v selects a fold suffix; it never selects a parser (id:kc-adapt). Under weak
// schema a reader does not need v to parse. Its two jobs are the fold's skeleton
// and honest degradation: /this was written by something newer than me/.
//
// Built empty on purpose: the first shape change is then a one-line append
// instead of a retrofit across every read (id:kc-build).

import { V } from "./entry.js"

/**
 * STEPS[n] raises a value from v=n to v=n+1.
 * Each step knows only its successor. Missing steps throw — every entry we
 * author starts at V; a hole is a bug, not a degrade path (id:kb-4 NOT).
 * @type {Array<(e: object) => object>}
 */
export const STEPS = []

/**
 * Fold a stored value up to this build's V. Returns a *view* — never write it,
 * never name it, never hand it to put (id:kb-4).
 *
 * @param {object} value - the free read of an entry (entry.read(bytes))
 * @returns {object} view
 */
export function upcast(value) {
    let e = value
    // Newer than us: render what we know, say plainly there is more, never guess.
    // ahead is a view field — it can exist because a view is never kept.
    if (e.v > V) return { ...e, ahead: true }
    while (e.v < V) e = STEPS[e.v](e)
    return e
}
