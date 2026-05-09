// Atom — observable immutable reference.
// Closure over mutable binding. Swap is trivially atomic in single-threaded JS.

export function createAtom(initial) {
    let value = initial
    const watchers = new Map()

    return {
        deref() {
            return value
        },

        swap(fn) {
            const old = value
            value = fn(old)
            for (const [, watcher] of watchers) {
                watcher(old, value)
            }
            return value
        },

        watch(key, fn) {
            watchers.set(key, fn)
        },

        unwatch(key) {
            watchers.delete(key)
        }
    }
}
