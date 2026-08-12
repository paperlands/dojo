// Local work memory — heads + drafts; never the journal.

import { createStorage } from "../terminal/storage.js"

/**
 * A per-work bag. `canon` is the whole law — it says what a row may be, the
 * same way in as out, so a written row always reads back whole. An unreadable
 * row is refused, never a clear: only null clears.
 *
 * @template T
 * @param {string} namespace
 * @param {(raw: unknown) => T | null} canon
 */
function perWork(namespace, canon) {
    const store = createStorage(namespace)
    const bag = () => {
        const raw = store.load()
        return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
    }

    return {
        /** @param {string | null | undefined} workId @returns {T | null} */
        read: (workId) => (workId ? canon(bag()[workId]) : null),

        /** @param {string | null | undefined} workId @param {T | null} value */
        write: (workId, value) => {
            if (!workId) return
            const next = value == null ? null : canon(value)
            if (next == null && value != null) return
            const b = bag()
            if (next != null) b[workId] = next
            else if (workId in b) delete b[workId]
            else return
            store.save(b)
        },
    }
}

/** The unkept present is text, or it is nothing. */
const asText = (raw) => (typeof raw === "string" ? raw : null)

/** A draft is a parent and a text. Title is optional; face is never kept. */
const asDraft = (raw) =>
    typeof raw?.from === "string" && raw.from && typeof raw.text === "string"
        ? {
            from: raw.from,
            text: raw.text,
            title: typeof raw.title === "string" ? raw.title : "",
            face: null,
        }
        : null

export const { read: readHead, write: writeHead } =
    perWork("@paperlands.river.heads", asText)

export const { read: readDraft, write: writeDraft } =
    perWork("@paperlands.river.drafts", asDraft)
