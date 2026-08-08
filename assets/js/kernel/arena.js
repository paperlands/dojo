// Arena — one lifetime for many resources. No individual free.
//
// Priors held intact (plan M1b): Tofte–Talpin regions, APR pools, Zig arenas.
//   1. One lifetime — there is no remove(x); release is the region's.
//   2. Nesting — child() arenas; parent destroys children BEFORE own cleanups.
//   3. Cleanups run LIFO (reverse registration order).
//   4. A destroyed arena is dead — registering on it throws (zombie-mount).
//   5. clear() resets for reuse; destroy() ends the arena for good.
//
// destroy is idempotent. clear / register after destroy throw.

export function createArena() {
    let alive = true
    const cleanups = [] // registration order; drain reverse
    const children = [] // destroy before own cleanups

    function guard() {
        if (!alive) throw new Error("arena: use after destroy")
    }

    function add(cleanup) {
        guard()
        if (typeof cleanup !== "function") {
            throw new Error("arena.add: cleanup must be a function")
        }
        cleanups.push(cleanup)
    }

    function on(el, type, fn, opts) {
        guard()
        el.addEventListener(type, fn, opts)
        add(() => el.removeEventListener(type, fn, opts))
    }

    function timer(fn, ms) {
        guard()
        const id = setTimeout(fn, ms)
        add(() => clearTimeout(id))
        return id
    }

    function interval(fn, ms) {
        guard()
        const id = setInterval(fn, ms)
        add(() => clearInterval(id))
        return id
    }

    function raf(fn) {
        guard()
        const id = requestAnimationFrame(fn)
        add(() => cancelAnimationFrame(id))
        return id
    }

    // Hand an Observer (Intersection / Resize / Mutation); disconnect on release.
    function observe(observer) {
        guard()
        add(() => observer.disconnect())
        return observer
    }

    function child() {
        guard()
        const c = createArena()
        children.push(c)
        return c
    }

    // Drain children (newest first), then own cleanups LIFO. Does not kill alive.
    function drain() {
        for (let i = children.length - 1; i >= 0; i--) {
            children[i].destroy()
        }
        children.length = 0
        for (let i = cleanups.length - 1; i >= 0; i--) {
            cleanups[i]()
        }
        cleanups.length = 0
    }

    function clear() {
        guard()
        drain()
    }

    function destroy() {
        if (!alive) return // idempotent
        drain()
        alive = false
    }

    return {
        on, timer, interval, raf, observe, add, child, clear, destroy,
        get alive() { return alive },
    }
}
