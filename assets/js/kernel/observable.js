// Each watch is its own installation. Delivery checks live membership; new installs wait.
// No fault policy here: subscriber exceptions propagate unless the caller supplies a boundary.
// (id:ownership-o2, id:cell-publication)

export function createObservable() {
    // Registration is an INCARNATION: a token, not the function's identity.
    let next = 0
    const watchers = new Map()   // token → fn

    return {
        watch(fn) {
            const token = ++next
            watchers.set(token, fn)
            return () => { watchers.delete(token) }
        },

        notify(...args) {
            for (const [token, fn] of [...watchers]) {
                if (watchers.has(token)) fn(...args)
            }
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
            const next = fn(old)
            value = next
            if (!Object.is(old, next)) {
                for (const watcher of watchers.values()) watcher(old, next)
            }
            return next
        },
        // Install now; let the caller notify only after related atoms are installed.
        // Identity is not news: a stated pose keeps motion and must not fan.
        swapDeferred(fn) {
            const old = value
            const next = fn(old)
            value = next
            if (Object.is(old, next)) return () => {}
            return () => { for (const watcher of watchers.values()) watcher(old, next) }
        },

        watch(key, fn) {
            watchers.set(key, fn)
        },

        unwatch(key) {
            watchers.delete(key)
        },
    }
}
