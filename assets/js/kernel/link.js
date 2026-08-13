// The address bar is a fact store, not an event (specs link-actions, id:la-law).
// Surfaces read their own word at mount and enact idempotently; carry keeps
// the address truthful when the state moves. One engine, two verbs, no third.
//
// Read always prefers the live address bar when one stands — a closed-over
// snapshot goes stale under soft nav (live_patch, back/forward) and the next
// carry would clobber the real query (id:la-law watched clause, now built).

// A word the server owns (handle_params). Server words are the page's
// identity, so they ride into a minted address; client words are this
// session's state and never travel (id:la-mint).
export const SERVER = "server"

// createLink(search, write, {words, base}) → { read, carry, address }
// search is the seed when no location exists (node tests, SSR).
// words is the vocabulary table (id:la-vocabulary) — the only thing the
// engine reads from it is who owns each word. base overrides origin+pathname
// off-document.
export function createLink(search, write = () => {}, { words = {}, base = null } = {}) {
    // Off-document seed — carry keeps it in step so tests (no location) still
    // round-trip. On the page, location wins on every read.
    let seed = search ?? ""

    function params() {
        if (typeof location !== "undefined" && location.search != null) {
            return new URLSearchParams(location.search)
        }
        return new URLSearchParams(seed.startsWith("?") ? seed.slice(1) : seed)
    }

    // Never consumes — a remount re-reads, and idempotent enactment is the
    // law that replaces a claimed-set (id:la-law).
    function read(key) {
        return params().get(key)
    }

    // value null/undefined lifts the word out. Writes only on change, so
    // history is never fed its own reflection. Re-reads location first so a
    // soft-nav rewrite is not clobbered by a stale held copy.
    function carry(key, value) {
        const p = params()
        const held = p.get(key)
        if (value == null) {
            if (held == null) return
            p.delete(key)
        } else {
            if (held === String(value)) return
            p.set(key, value)
        }
        const qs = p.toString()
        seed = qs ? `?${qs}` : ""
        write(qs)
    }

    // Where this page stands, read fresh — pathname moves under soft nav.
    function here() {
        if (base != null) return base
        if (typeof location === "undefined") return ""
        return `${location.origin}${location.pathname}`
    }

    // Mint the address someone else opens (id:la-mint). Server words carry
    // over because they name the page; every client word is dropped, and the
    // overrides say what this link is FOR. Never writes — minting is a read.
    function address(overrides = {}) {
        const held = params()
        const out = new URLSearchParams()
        for (const word of Object.keys(words)) {
            if (words[word] !== SERVER) continue
            const value = held.get(word)
            if (value != null) out.set(word, value)
        }
        for (const [word, value] of Object.entries(overrides)) {
            if (value != null) out.set(word, String(value))
        }
        const qs = out.toString()
        return `${here()}${qs ? `?${qs}` : ""}`
    }

    return { read, carry, address }
}
