// Caption chrome — word, share link, mode paint, keep→land beats (id:kr-vis).

import { read } from "../keep/entry.js"
import { link, shareForkRef } from "../link.js"
import { applyMode, isOpen, modeOf, seatOf } from "./mode.js"
import { bytesOf } from "./keeps.js"

/** keep → land durations, one place. */
export const BEAT = Object.freeze({
    IGNITE_MS: 700,
    KEEP_GUARD_MS: 2400,
    HOLD_MIN_MS: 320,
    LAND_MS: 800,
    COPIED_MS: 1100,
})

/**
 * @param {string} bytes
 * @returns {string|null}
 */
export function titleOf(bytes) {
    try {
        const title = read(bytes).title
        return typeof title === "string" ? title : null
    } catch {
        return null
    }
}

/**
 * Share URL for a shared standing keep, else null (id:la-fork-pull).
 * @param {{ at: {key: string, id: string|null}, sharedIds: Set<string>, keeps: Map<string, {bytes: string}>, newestId: string|null, work: string|null }} args
 * @param {{address: (o: object) => string}} [door]
 * @returns {string|null}
 */
export function shareLinkOf({ at, sharedIds, keeps, newestId, work }, door = link) {
    if (!at.id || !sharedIds.has(at.id)) return null
    let workId = work
    const bytes = bytesOf(keeps, at.id)
    if (bytes) {
        try {
            const target = read(bytes).target
            if (typeof target === "string" && target) workId = target
        } catch {
            /* keep id still answers */
        }
    }
    const ref = shareForkRef(at.id, { workId, headId: newestId })
    if (!ref) return null
    return door.address({ fork: ref })
}

/**
 * Caption facts for the standing seat — pure; the painter writes them.
 *
 * @param {{
 *   at: {key: string, id: string|null},
 *   sealing: string|null,
 *   draft: {from?: string, title?: string}|null,
 *   keeps: Map<string, {bytes: string}>,
 *   empty: boolean,
 * }} args
 */
export function captionOf({ at, sealing, draft, keeps, empty }) {
    if (sealing != null) {
        return { word: sealing, placeholder: null, message: null, clearMessage: false }
    }
    // One open caption: draft only adds parent word + title carry.
    const seat = seatOf(at)
    if (isOpen(seat)) {
        if (seat === "draft") {
            const from = draft?.from && bytesOf(keeps, draft.from)
            const parent = (from && titleOf(from)) || null
            return {
                word: null,
                placeholder: parent ? `from ${parent}` : "YOUR MESSAGE",
                message: typeof draft?.title === "string" ? draft.title : "",
                clearMessage: false,
            }
        }
        return {
            word: null,
            placeholder: empty ? "YOUR TITLE" : "YOUR MESSAGE",
            message: null,
            clearMessage: false,
        }
    }
    const bytes = at.id && bytesOf(keeps, at.id)
    return {
        word: (bytes && titleOf(bytes)) || "—",
        placeholder: null,
        message: null,
        clearMessage: true,
    }
}

/**
 * Paint caption + mode onto the sky. One call.
 *
 * @param {{
 *   root: Element,
 *   word: HTMLElement,
 *   message: HTMLInputElement,
 *   at: {key: string, id: string|null},
 *   sharedIds: Set<string>,
 *   sealing: string|null,
 *   draft: {from?: string, title?: string}|null,
 *   keeps: Map<string, {bytes: string}>,
 *   empty: boolean,
 * }} args
 */
export function paintChrome({
    root,
    word,
    message,
    at,
    sharedIds,
    sealing,
    draft,
    keeps,
    empty,
}) {
    const cap = captionOf({ at, sealing, draft, keeps, empty })
    if (cap.word != null) word.textContent = cap.word
    if (cap.placeholder != null) message.placeholder = cap.placeholder
    if (cap.message != null && document.activeElement !== message) {
        message.value = cap.message
    }
    if (cap.clearMessage && message.value && document.activeElement !== message) {
        message.value = ""
    }
    applyMode(root, modeOf({
        at,
        sharedIds,
        sealing,
        caption: message.value,
    }))
}
