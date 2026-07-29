// One watch/notify — the breath every half-adopted list reimplements.
//
// Snapshot on notify so a watcher may unwatch mid-fan without skipping a
// sibling. Carries whatever notify is handed: the cell's breath carries
// nothing; an atom carries (old, value); a store carries the new signal.

export function createObservable() {
    const watchers = new Set()

    return {
        watch(fn) {
            watchers.add(fn)
            return () => { watchers.delete(fn) }
        },

        notify(...args) {
            for (const fn of [...watchers]) fn(...args)
        },
    }
}

// Atom — observable immutable reference.
// Closure over mutable binding. Swap is atomic in single-threaded JS.
// Keyed watch is a thin facade over the one observable (scheduler pins
// world-cache invalidation by child id).

export function createAtom(initial) {
    let value = initial
    const obs = createObservable()
    const byKey = new Map() // key → unwatch

    return {
        deref() {
            return value
        },

        swap(fn) {
            const old = value
            value = fn(old)
            obs.notify(old, value)
            return value
        },

        watch(key, fn) {
            const prev = byKey.get(key)
            if (prev) prev()
            byKey.set(key, obs.watch(fn))
        },

        unwatch(key) {
            const un = byKey.get(key)
            if (un) {
                un()
                byKey.delete(key)
            }
        },
    }
}
