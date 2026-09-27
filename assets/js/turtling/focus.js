// THE LIGHT REGISTER — pure, THREE-free; testable like timeline.js.
//
// The problem: focus by display name meant same-named sibling tabs could steal
// each other, and re-eval / rename lost the light. So the register holds
// kindled ADDRESS + warm addresses, never the name (D006; light-ladders Cut 3).
//
// Pure register: hold facts. Do not choose who *should* be kindled, do not set
// opacity. Compositor projects; turtle.light is the one writer.

export function createFocus(scheduler = null) {
    let kindled = null          // address | null — the bright one
    let warm = new Set()        // addresses at warm degree

    return {
        // Rebind when turtle rebuilds the scheduler after an empty canvas.
        // kindled + warm survive; only the subtree read needs a live registry.
        bind(s) { scheduler = s },

        // THE WHOLE REGISTER, WRITTEN AT ONCE. The law answers `light` as one
        // total every transition — this is a cache of that projection.
        // Once: two names for kindled, four warm mutators of which one was
        // called, under a comment that said "one register, one write path."
        set light({ kindled: k = null, warm: w = null } = {}) {
            kindled = k
            warm = new Set(w ? [...w].filter((a) => a != null) : [])
        },
        get light() { return { kindled, warm: [...warm] } },

        get kindled() { return kindled },
        // A copy: handing out the live Set makes a read that can write.
        get warm() { return [...warm] },

        // Strict match — non-lens head tracks camera only when it IS kindled.
        isFocused(ambient) {
            return kindled != null && ambient.address === kindled
        },

        // Subtree match — nested Lens drives viewport when the tab that owns
        // it is kindled, not only when its own address matches.
        inFocusedSubtree(ambient) {
            if (!kindled || !scheduler) return false
            let f = ambient
            while (f && f !== scheduler.root) {
                if (f.address === kindled) return true
                f = f.parent
            }
            return false
        },
    }
}

// Resolve a caller's reference — registration key, nested address, or display
// name — to the canonical address. Names resolve THROUGH the address; unknown
// → null (nothing focused).
export function resolveAddress(scheduler, ref) {
    if (ref == null || !scheduler) return null
    if (scheduler.root.children.has(ref)) return ref
    for (const ambient of scheduler.registry.values()) {
        if (ambient.address === ref) return ref
    }
    for (const ambient of scheduler.registry.values()) {
        if (ambient !== scheduler.root && ambient.name === ref) return ambient.address
    }
    return null
}
