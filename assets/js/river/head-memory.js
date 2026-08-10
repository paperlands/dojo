// Head memory — the unkept present, local only.
//
// When the child stands on an older keep, the editor projects that keep's
// source. The head buffer must not die: it is written here the moment they
// leave the present, and healed back into the buffer on reload. Losing it
// is fatal.

import { createStorage } from "../terminal/storage.js"

const storage = createStorage("@paperlands.river.heads")

/**
 * @param {string | null | undefined} workId
 * @returns {string | null}
 */
export function readHead(workId) {
    if (!workId) return null
    const bag = load()
    const text = bag[workId]
    return typeof text === "string" ? text : null
}

/**
 * @param {string | null | undefined} workId
 * @param {string | null | undefined} text - null clears
 */
export function writeHead(workId, text) {
    if (!workId) return
    const bag = load()
    if (text == null) {
        if (!(workId in bag)) return
        delete bag[workId]
        storage.save(bag)
        return
    }
    if (typeof text !== "string") return
    bag[workId] = text
    storage.save(bag)
}

function load() {
    const raw = storage.load()
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
}
