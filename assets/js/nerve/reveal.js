// Reveal an ambient by name — the shared navigation gesture
// (id:gw-grammar, id:nerve-intertwingularity).
//
// The problem: the same name in a shout, a `when`, and a prose [[portal]]
// must point to the same thing. Clicking any of them lands here: switch to
// the tab that DEFINES the ambient (top-level, or the tab whose code spawned
// `as name do …`), then kindle it on the canvas. If the owning key is not a
// local buffer (a remote peer's addr), skip the tab switch and just focus.
//
// Stage turtle and inner terminal both read cells (stage-cell, term-cell) —
// never dunders (id:gw-t-dom-registry). Light goes through turtle.light(),
// the one writer — register and paint together.

import { getStage } from '../turtling/stage-cell.js'
import { resolveAddress } from '../turtling/focus.js'
import { createCell } from '../kernel/cell.js'
import { get } from '../hooks/shell/term-cell.js'

// The navigator cell — document boundary's fourth residual (ref:{node},
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
    // One membership law: resolveAddress is the canonical name→address
    // reading — no second predicate beside it.
    if (resolveAddress(turtle.scheduler, name) == null) {
        // Not an ambient — the document boundary: the navigator resolves.
        navigator.get()?.(name)
        return
    }
    const term = get("coreshell")
    const tabKey = turtle.tabKeyForAmbient?.(name)
    if (tabKey != null && term?.getBufferInfo?.(tabKey)) {
        term.opBufferHandler({ op: 'select', target: tabKey })
    }
    // Through the one light writer — register and paint move together.
    // Tab select above already breathed the law's total; a nested `as name
    // do …` has no tab of its own, and kindling it points the camera at its lens.
    turtle.light({ kindled: turtle.addressOf(name), warm: turtle.focus.warm })
}
