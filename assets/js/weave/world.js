// The world cell — the empty center of the query surface
// (specs/compiler.org id:cmp-query-cell). ONE seam through which every
// surface — editor, HUD, portal, peer, someday her own programs — asks
// about the world. The cell has NO faces of its own: faces are the
// registrant's contract, and an unspoken face degrades by optional chain
// (`world()?.vitals?.(name) ?? null`) — the cell enumerates nothing.
//
// Rebuilt on kernel/cell — the stage-cell idiom, with breath. createCell is
// canonical; registerWorld / world / watchWorld / worldChanged are its named
// view (D006). Contract pinned by test/js/world_cell_test.mjs.

import { createCell } from "../kernel/cell.js"

const cell = createCell()

// Register the one world. Faces are whatever the registrant contracts —
// the cell holds them opaque. Returns an owner-guarded unregister.
export function registerWorld(faces) {
    return cell.register(faces)
}

export function world() {
    return cell.get()
}

// Hear every breath. Returns unwatch.
export function watchWorld(fn) {
    return cell.watch(fn)
}

// The breath: something changed — ask again. Carries nothing.
export function worldChanged() {
    cell.changed()
}
