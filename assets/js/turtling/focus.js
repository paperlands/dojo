// Focus — the one cross-eval focus register (pure, THREE-free; testable like
// timeline.js). Holds a frame's stable ADDRESS (frameAddress: registration key
// + name path), never the display name — so focus survives re-eval and rename,
// and same-named sibling tabs cannot steal it. The name is a derived view.
// (specs/groundwork.org Phase 1 — one register + a name view.)

export function createFocus(scheduler) {
    let address = null

    return {
        get address() { return address },
        set address(v) { address = v },

        // The name view — display projection of the focused address. Read-only:
        // writers go through address (one register, one write path).
        get name() {
            if (!address) return null
            for (const ambient of scheduler.registry.values()) {
                if (ambient.address === address) return ambient.name
            }
            return null
        },

        // Strict match — a non-lens head tracks the camera only when it IS the
        // focused frame.
        isFocused(ambient) {
            return address != null && ambient.address === address
        },

        // Subtree match — a nested Lens drives the viewport when the tab that
        // owns it is focused, not only when its own address matches.
        inFocusedSubtree(ambient) {
            if (!address) return false
            let f = ambient
            while (f && f !== scheduler.root) {
                if (f.address === address) return true
                f = f.parent
            }
            return false
        },
    }
}

// Resolve a caller's reference — a registration key, a nested address, or a
// display name — to the canonical address. Names resolve THROUGH the address;
// an unknown reference resolves to null (nothing focused).
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
