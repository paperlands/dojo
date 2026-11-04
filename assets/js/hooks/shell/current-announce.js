// One demand for the owner's CURRENT document: sync reads it, wake is the
// local hydration edge, release severs both. No queue, clock, or saved envelope.

/**
 * @param {{ read: () => object|null, send: (current: object) => void }} o
 * @returns {{ sync: (flush?: () => void) => void, wake: () => void, release: () => void }}
 */
export function createCurrentAnnounce({ read, send }) {
    let wanted = false
    let holding = false
    let dead = false
    // A read is a departure; a newer request (or release) retires it, so an
    // older answer can never publish over a fresher one (O1/O3, no queue).
    let epoch = 0

    const announce = () => {
        if (dead) return
        const mine = ++epoch
        const current = read()
        if (dead || mine !== epoch) return
        if (!current) {
            wanted = true
            return
        }
        wanted = false
        send(current)
    }

    // The quiet callback wakes a demand; holding is an explicit sync in
    // progress and must not double-send through the same flush.
    const wake = () => {
        if (dead || holding || !wanted) return
        announce()
    }

    const sync = (flush) => {
        if (dead) return
        holding = true
        try {
            flush?.()
        } finally {
            holding = false
        }
        announce()
    }

    const release = () => {
        dead = true
        wanted = false
        epoch += 1
    }

    return { sync, wake, release }
}
