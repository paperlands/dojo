// Shared is list minus local, by name(bytes) (id:kb-8 · id:kc-p-fold).
// Fold pages of the same depth — measured 455 ms for n=50 against 36k held (id:kb-8-page).

/**
 * List minus local, over names a fold already derived (id:ka-passes · id:kc-p-fold).
 * Same depth on both sides — a shallower `held` would lie.
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
 * Put, then share (id:kb-8). Source/proof ride; authoring intent never does.
 *
 * @param {{ put: Function, share: Function }} door
 * @param {string} bytes - the message, as it crossed the wire
 * @param {{ at: number, node: string } | null | undefined} fact - permanent answer, or none yet
 * @param {{ source?: string, proof?: object }} [extras] - archival data only
 * @returns {Promise<string>} the message id
 */
export async function accept(door, bytes, fact, extras = {}) {
    const { source, proof } = extras
    const id = await door.put(bytes, {
        ...(source !== undefined ? { source } : {}),
        ...(proof != null ? { proof } : {}),
    })
    if (fact != null) await door.share(id, fact)
    return id
}
