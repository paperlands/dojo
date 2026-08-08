// One watch/notify — the breath every half-adopted list reimplements.
//
// Anonymous watchers, so the Set IS the registry. Snapshot on notify for the
// one thing Set iteration does not give: a watcher registered mid-fan must not
// hear the breath it was born into. (Unwatching mid-fan needs no snapshot —
// deleting from a Set under iteration skips the deleted and no sibling.)
// Carries whatever notify is handed: the cell's breath carries nothing; a
// store carries the new signal.

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

// Atom — observable immutable reference. Closure over mutable binding; swap is
// atomic in single-threaded JS.
//
// A KEYED registry, not a facade over the anonymous one: the key IS the
// identity (the scheduler pins world-cache invalidation by child id), so
// re-watching a key must REPLACE in place — Map.set keeps its position, where
// an unwatch-then-rewatch would move that watcher to the back of the fan.
// Its own Map also keeps swap allocation-free: this is the per-frame path.

export function createAtom(initial) {
    let value = initial
    const watchers = new Map() // key → fn

    return {
        deref() {
            return value
        },

        swap(fn) {
            const old = value
            value = fn(old)
            for (const watcher of watchers.values()) watcher(old, value)
            return value
        },

        watch(key, fn) {
            watchers.set(key, fn)
        },

        unwatch(key) {
            watchers.delete(key)
        },
    }
}
