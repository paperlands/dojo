// In-memory mirror of the server's selector descriptor: four whitelisted
// selector keys plus optional last-known chrome. Never a document. No storage.

const SELECTOR = ["addr", "view", "draft_live", "follow_peer"]
const CHROME = ["name", "root"]
const VIEWS = new Set(["watch", "draft", "recall"])
function snapshot(intent) {
    const closed = intent?.addr === null
    if (!intent || (!closed && (typeof intent.addr !== "string" || intent.addr === ""))) return null
    if (!VIEWS.has(intent.view)) return null
    if (typeof intent.draft_live !== "boolean" || typeof intent.follow_peer !== "boolean") return null

    const out = {}
    for (const key of SELECTOR) out[key] = intent[key]
    for (const key of CHROME) {
        if (typeof intent[key] === "string" && intent[key] !== "") out[key] = intent[key]
    }
    return Object.freeze(out)
}

/** Valid selector descriptor for this exact installation, or null. */
export function selectorFor(intent, expectedAddr) {
    const next = snapshot(intent)
    if (!next || next.addr !== expectedAddr) return null
    return next
}

/**
 * @param {{ send: (intent: object) => void }} o
 * @returns {{ mirror: (intent: object|null) => boolean, restore: (facts?: object) => boolean, clear: () => void, release: () => void }}
 */
export function createOuterRecovery({ send }) {
    let latest = null
    let released = false

    return {
        // Clone + freeze at the boundary; caller edits cannot reach the mirror.
        mirror(intent) {
            if (released) return false
            // Explicit close (null or addr:null) differs from a malformed
            // descriptor: only the former clears a valid selection.
            if (intent == null || (typeof intent === "object" && "addr" in intent && intent.addr === null)) {
                latest = null
                return true
            }
            const next = snapshot(intent)
            if (!next) return false
            latest = next
            return true
        },
        // Explicit facts, not a generic patch. Draft overlay only for the peer
        // actually visible now; chrome only for that same peer.
        restore(facts = {}) {
            if (released || !latest) return false
            const out = { ...latest }
            if (latest.addr === facts.visibleAddr) {
                if (typeof facts.name === "string" && facts.name !== "") out.name = facts.name
                if (typeof facts.root === "string" && facts.root !== "") out.root = facts.root
                if (facts.drafting) {
                    out.view = "draft"
                    out.draft_live = !!facts.draftLive
                }
            }
            send(out)
            return true
        },
        // Close: the mirror may be replaced by a later selection.
        clear() {
            latest = null
        },
        // Teardown: permanent; no later mirror/restore may resurrect it.
        release() {
            released = true
            latest = null
        },
    }
}
