// Reveal an ambient by name — the shared navigation gesture (id:gw-grammar,
// id:nerve-intertwingularity). The same name in a shout, a `when`, and a prose
// [[portal]] points to the same thing; clicking any of them lands here: switch to
// the tab that DEFINES the ambient (top-level, or the tab whose code spawned
// `as name do …`), then focus it on the canvas. If the owning key isn't a local
// buffer (a remote peer's addr), the tab switch is skipped and we just focus.
//
// Stage turtle and inner terminal both read cells (stage-cell, term-cell) —
// never dunders (id:gw-t-dom-registry).

import { getStage } from '../turtling/stage-cell.js'
import { resolveAddress } from '../turtling/focus.js'
import { createCell } from '../kernel/cell.js'
import { getInner } from '../hooks/shell/term-cell.js'

// The navigator cell — the document boundary's fourth residual (ref:{node},
// id:weave-navigate). When no ambient answers a name, the registered
// navigator (the weave's scope law) takes the word: fragment page, or a
// glowing word waiting to be born. One cell, same shape as the stage's.
const navigator = createCell()

export function registerNavigator(fn) {
    return navigator.register(fn)
}

export function revealAmbient(name) {
    const turtle = getStage()
    if (!turtle) return
    // One membership law: resolveAddress (turtling/focus.js) is the canonical
    // name→address reading — no second predicate beside it.
    if (resolveAddress(turtle.scheduler, name) == null) {
        // Not an ambient — the document boundary: the navigator resolves.
        navigator.get()?.(name)
        return
    }
    const term = getInner()
    const tabKey = turtle.tabKeyForAmbient?.(name)
    if (tabKey != null && term?.getBufferInfo?.(tabKey)) {
        term.opBufferHandler({ op: 'select', target: tabKey })
    }
    turtle.focusAmbient(name)
    turtle.requestRender?.()
}
