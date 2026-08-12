// Shared is not a field the surface reads — it is the difference between two
// folds (id:kb-8, id:kc-p-fold).
//
//   shared(root)  =  list(root)  minus  local(root)   — by name(bytes), at the reader
//
// Law 3 performed rather than remembered: the id is derived from the bytes the
// reader holds, never trusted from a row. The verbs keep returning bytes[] —
// the shape that made them cheap. A list that returned rows would leak the
// projection through the one door built to contain it.
//
// FOLD A PAGE AGAINST A PAGE OF THE SAME DEPTH (id:kb-8-page). The cost is one
// hash per byte-string on both sides, so an unbounded `held` is an unbounded
// fold: measured 455 ms for a 50-row page against 36,000 kept-local — on the
// render thread, which is the one thing the worker exists to prevent.
//
// local(root, n) is EXACTLY enough to fold list(root, n): a kept-local entry
// inside the newest n of the whole log has at most n-1 entries above it, so at
// most n-1 kept-local entries are above it — it is among the newest n
// kept-local. Same n on both reads; 1.1 ms; no ninth verb, no cached verdict.
// The wire ships that same n (keep/page.js PAGE) — one generic, two seats.

import { name } from "./entry.js"

/**
 * The shared messages among an author's history — list minus local.
 * Order is the author's (list's order). Ids are derived at the reader.
 *
 * Pass the two reads at the SAME depth: shared(list(root, n), local(root, n)).
 * A deeper `held` only costs hashes; a shallower one would lie.
 *
 * @param {string[]} listed - bytes[] from list(root, n)
 * @param {string[]} held   - bytes[] from local(root, n), the same n
 * @returns {string[]} bytes of messages the clan has permanently answered
 */
export function shared(listed, held) {
    const localIds = new Set(held.map(name))
    return listed.filter((bytes) => !localIds.has(name(bytes)))
}

/**
 * The same sentence, over names a fold has already derived (id:ka-passes).
 *
 * TWO FACES, ONE LAW — and the case that made it two: a caller that already
 * holds the page's ids must not hash it again to ask this question. `shared`
 * is the bytes face; this is the id face; both are `listed − held`, and a test
 * asserts they never disagree. Adding a third face would be the drift.
 *
 * @param {string[]} ids - names of the listed page, in the author's order
 * @param {Set<string>} heldIds - names of the kept-local page, same depth
 * @returns {string[]} the ids the clan has permanently answered
 */
export function sharedIds(ids, heldIds) {
    return ids.filter((id) => !heldIds.has(id))
}

/**
 * Accept a message that arrived with a permanent clan answer.
 *
 * Order is put, then share — always. Clan history lands as local:1; the fact
 * rides the reply and is applied beside the value. Named so step 13 never
 * grows put(bytes, {shared}) to dodge one re-ship (id:kb-8).
 *
 * Own entries coming back re-ship once before settling — idempotent, harmless.
 * A second put of the same name preserves shared/local; a second share keeps
 * the first fact.
 *
 * THE SOURCE RIDES (id:kb-source-absence). Source is small and re-derivable
 * from *nothing*, so it fans with the message and is never evicted. A message
 * accepted without it is a tombstone — a name, a time, a target, nothing to
 * show. The image does NOT ride: it is heavy and re-derivable, and arrives on
 * the walk.
 *
 * @param {{ put: Function, share: Function }} door
 * @param {string} bytes - the message, as it crossed the wire
 * @param {{ at: number, node: string } | null | undefined} fact - permanent answer, or none yet
 * @param {{ source?: string }} [extras] - the source text that fanned beside it
 * @returns {Promise<string>} the message id
 */
export async function accept(door, bytes, fact, extras = {}) {
    const id = await door.put(bytes, extras)
    if (fact != null) await door.share(id, fact)
    return id
}
