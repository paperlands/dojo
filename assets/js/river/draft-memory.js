// Draft memory — potential heads, local only (never the journal).
//
// One draft per work. Survives reload and work-switch. Face is not stored:
// blob URLs die with the page; the river re-wears the parent's picture.

import { createStorage } from "../terminal/storage.js"

const storage = createStorage("@paperlands.river.drafts")

/**
 * @param {string | null | undefined} workId
 * @returns {{ from: string, text: string, title: string, face: null } | null}
 */
export function readDraft(workId) {
    if (!workId) return null
    const bag = load()
    const raw = bag[workId]
    if (!raw || typeof raw !== "object") return null
    if (typeof raw.from !== "string" || !raw.from) return null
    if (typeof raw.text !== "string") return null
    return {
        from: raw.from,
        text: raw.text,
        title: typeof raw.title === "string" ? raw.title : "",
        face: null,
    }
}

/**
 * Write or clear this work's potential head.
 * @param {string | null | undefined} workId
 * @param {{ from: string, text: string, title?: string } | null} draft
 */
export function writeDraft(workId, draft) {
    if (!workId) return
    const bag = load()
    if (!draft) {
        if (!(workId in bag)) return
        delete bag[workId]
        storage.save(bag)
        return
    }
    if (typeof draft.from !== "string" || !draft.from) return
    bag[workId] = {
        from: draft.from,
        text: typeof draft.text === "string" ? draft.text : "",
        title: typeof draft.title === "string" ? draft.title : "",
    }
    storage.save(bag)
}

function load() {
    const raw = storage.load()
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
}
