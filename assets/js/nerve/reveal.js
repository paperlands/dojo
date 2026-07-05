// Reveal an ambient by name — the shared navigation gesture (id:gw-grammar,
// id:nerve-intertwingularity). The same name in a shout, a `when`, and a prose
// [[portal]] points to the same thing; clicking any of them lands here: switch to
// the tab that DEFINES the ambient (top-level, or the tab whose code spawned
// `as name do …`), then focus it on the canvas. If the owning key isn't a local
// buffer (a remote peer's addr), the tab switch is skipped and we just focus.
//
// The defaults reach for the core shell's surfaces by DOM id — the same coupling
// hud.js has always carried; callers may scope navigation by passing their own.
export function revealAmbient(name) {
    const turtle = document.getElementById('core-canvas')?.__turtle
    if (!turtle) return
    const term = document.getElementById('your-buffer')?.__terminal
    const tabKey = turtle.tabKeyForAmbient?.(name)
    if (tabKey != null && term?.getBufferInfo?.(tabKey)) {
        term.opBufferHandler({ op: 'select', target: tabKey })
    }
    turtle.focusAmbient(name)
    turtle.requestRender?.()
}
