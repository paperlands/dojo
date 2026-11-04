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

    // Drain children (newest first), then own cleanups LIFO. Each release is
    // isolated and the lists are emptied first: one failure never strands a
    // sibling, and a cleanup cannot re-enter the drain it came from.
    function drain() {
        const kids = children.slice().reverse()
        const own = cleanups.slice().reverse()
        children.length = 0
        cleanups.length = 0
        let failure = null
        for (const child of kids) {
            try { child.destroy() } catch (err) { failure ??= err }
        }
        for (const cleanup of own) {
            try { cleanup() } catch (err) { failure ??= err }
        }
        if (failure) console.warn("arena: a cleanup failed", failure)
    }

    function clear() {
        guard()
        drain()
    }

    function destroy() {
        if (!alive) return // idempotent
        // Death FIRST: a throwing cleanup must leave the arena dead, never
        // half-cleaned and still taking work (zombie-mount).
        alive = false
        drain()
    }

    return {
        on, timer, interval, raf, observe, add, child, clear, destroy,
        get alive() { return alive },
    }
}
