// The address bar is a fact store, not an event (specs link-actions, id:la-law).
// Surfaces read their own word at mount and enact idempotently; carry keeps
// the address truthful when the state moves. One engine, two verbs, no third.
//
// Read always prefers the live address bar when one stands — a closed-over
// snapshot goes stale under soft nav (live_patch, back/forward) and the next
// carry would clobber the real query (id:la-law watched clause, now built).

// createLink(search, write) → { read, carry }
// search is the seed when no location exists (node tests, SSR).
export function createLink(search, write = () => {}) {
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

    return { read, carry }
}
