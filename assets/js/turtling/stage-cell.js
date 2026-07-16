// The one stage cell — the live canvas turtle, addressed by port not dunder
// (id:gw-t-dom-registry). Inner shell registers on mount; weave boot and
// revealAmbient read here. canvas.__turtle may still exist for legacy sites
// until they migrate; new reads never grow the dunder ledger.
//
// Pure and import-light on purpose (the focus.js/lifecycle.js extraction
// law): the heavy THREE stage lives in stage.js; anything headless — tests,
// the nerve, the weave — may import this cell without dragging in WebGL.

let liveStage = null

// Register the stage turtle. Returns an unregister fn for cleanup — only
// clears if this registrant still owns the cell (a later mount wins).
export function registerStage(turtle) {
    liveStage = turtle ?? null
    return () => {
        if (liveStage === turtle) liveStage = null
    }
}

export function getStage() {
    return liveStage
}
