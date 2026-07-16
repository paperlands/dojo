// Reveal an ambient by name — the shared navigation gesture (id:gw-grammar,
// id:nerve-intertwingularity). The same name in a shout, a `when`, and a prose
// [[portal]] points to the same thing; clicking any of them lands here: switch to
// the tab that DEFINES the ambient (top-level, or the tab whose code spawned
// `as name do …`), then focus it on the canvas. If the owning key isn't a local
// buffer (a remote peer's addr), the tab switch is skipped and we just focus.
//
// Stage turtle reads the one cell (turtling/stage-cell.js) — not canvas.__turtle.
// The terminal still resolves via DOM id until that register migrates too
// (gw-t-dom-registry: count only ever decreases; this read already left).

import { getStage } from '../turtling/stage-cell.js'
import { resolveAddress } from '../turtling/focus.js'

// The navigator cell — the document boundary's fourth residual (ref:{node},
// id:weave-navigate). When no ambient answers a name, the registered
// navigator (the weave's scope law) takes the word: fragment page, or a
// glowing word waiting to be born. One cell, same shape as the stage's.
let navigator = null

export function registerNavigator(fn) {
    navigator = fn
    return () => {
        if (navigator === fn) navigator = null
    }
}

export function revealAmbient(name) {
    const turtle = getStage()
    if (!turtle) return
    // One membership law: resolveAddress (turtling/focus.js) is the canonical
    // name→address reading — no second predicate beside it.
    if (resolveAddress(turtle.scheduler, name) == null) {
        // Not an ambient — the document boundary: the navigator resolves.
        navigator?.(name)
        return
    }
    const term = document.getElementById('your-buffer')?.__terminal
    const tabKey = turtle.tabKeyForAmbient?.(name)
    if (tabKey != null && term?.getBufferInfo?.(tabKey)) {
        term.opBufferHandler({ op: 'select', target: tabKey })
    }
    turtle.focusAmbient(name)
    turtle.requestRender?.()
}
