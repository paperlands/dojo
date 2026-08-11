// The address bar is a fact store, not an event (specs link-actions, id:la-law).
// Surfaces read their own word at mount and enact idempotently; carry keeps
// the address truthful when the state moves. One engine, two verbs, no third.

// createLink(search, write) → { read, carry }
export function createLink(search, write = () => {}) {
    const params = new URLSearchParams(search ?? "")

    // Never consumes — a remount re-reads, and idempotent enactment is the
    // law that replaces a claimed-set (id:la-law).
    function read(key) {
        return params.get(key)
    }

    // value null/undefined lifts the word out. Writes only on change, so
    // history is never fed its own reflection.
    function carry(key, value) {
        const held = params.get(key)
        if (value == null) {
            if (held == null) return
            params.delete(key)
        } else {
            if (held === String(value)) return
            params.set(key, value)
        }
        write(params.toString())
    }

    return { read, carry }
}
