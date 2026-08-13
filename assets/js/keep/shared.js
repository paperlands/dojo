// Shared is list minus local, by name(bytes) (id:kb-8 · id:kc-p-fold).
// Fold pages of the same depth — measured 455 ms for n=50 against 36k held (id:kb-8-page).

import { name } from "./entry.js"

/**
 * List minus local. Same depth on both sides — a shallower `held` would lie.
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
 * The same sentence, over names a fold already derived (id:ka-passes).
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
 * Order is put, then share (id:kb-8). Source rides; image does not (id:kb-source-absence).
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
