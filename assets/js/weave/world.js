// The world cell — the empty center of the query surface
// (specs/compiler.org id:cmp-query-cell). ONE seam through which every
// surface — editor, HUD, portal, peer, someday her own programs — asks
// about the world. The cell has NO faces of its own: faces are the
// registrant's contract, and an unspoken face degrades by optional chain
// (`world()?.vitals?.(name) ?? null`) — the cell enumerates nothing.
//
// Rebuilt from its pinned contract (the portal-organs stash captured the
// consumers and tests but not this tracked file): world() answers null
// before registration; registerWorld returns an unregister only its owner
// may exercise (a later mount wins — the stage-cell idiom); registering
// and unregistering breathe; watchers unhear cleanly.
//
// The breath law: worldChanged() says only "ask again" — it never carries
// the world. Standing state is the truth, signals are the breath.
//
// Pure and import-light on purpose: headless surfaces and tests import
// this cell without dragging in the stage.

let current = null
const watchers = new Set()

// Register the one world. Faces are whatever the registrant contracts —
// the cell holds them opaque. Returns an owner-guarded unregister.
export function registerWorld(faces) {
    current = faces ?? null
    worldChanged()
    return () => {
        if (current === faces) {
            current = null
            worldChanged()
        }
    }
}

export function world() {
    return current
}

// Hear every breath. Returns unwatch.
export function watchWorld(fn) {
    watchers.add(fn)
    return () => watchers.delete(fn)
}

// The breath: something changed — ask again. Carries nothing.
export function worldChanged() {
    for (const fn of [...watchers]) fn()
}
