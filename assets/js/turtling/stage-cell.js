// The one stage cell — the live canvas turtle, addressed by port not dunder
// (id:gw-t-dom-registry). Inner shell registers on mount; weave boot and
// revealAmbient read here. No canvas.__turtle.
//
// Pure and import-light on purpose (the focus.js/lifecycle.js extraction
// law): the heavy THREE stage lives in stage.js; anything headless — tests,
// the nerve, the weave — may import this cell without dragging in WebGL.

import { createCell } from "../kernel/cell.js"

const stage = createCell()

// Register the stage turtle. Returns an unregister fn for cleanup — only
// clears if this registrant still owns the cell (a later mount wins).
export function registerStage(turtle) {
    return stage.register(turtle)
}

export function getStage() {
    return stage.get()
}
