// =============================================================================
// THE DIAGNOSTICS ADAPTER — a wound answer projected into editor ink
// (specs/compiler.org id:cmp-first-surface). Demand-driven: the surface
// ASKS on each breath (watchWorld) and once at mount, then renders the
// whole answer through @codemirror/lint's
// setDiagnostics — positions map through edits, the gutter and underline
// come standing, severity is ready for the day we speak more than `error`.
// Nothing is ever pushed INTO the editor except the breath that says "ask
// again"; a remounted editor asks and is whole.
//
// The one law this module owns — WHERE to lint: a diagnostic inks a line
// only when the error carries a TRUE span (born structured on the node,
// id:cmp-runtime-provenance). An answer without a span never inks — the
// HUD carries it whole; guessing a position would be a second grammar.
// =============================================================================

// The breath only — "ask again". WHAT to ask is the surface's, never this
// organ's, so the world's faces are not imported here.
import { watchWorld } from "../weave/world.js"
import { describe, sourceOf } from "../weave/wound-view.js"

// Pure mapping: query answers → CM6 Diagnostic spans, against a doc.
//   errors — [{ span: { line }, message, source?, severity? }]; entries
//   without a span-true line (or with a line the doc no longer holds) are
//   SKIPPED — no true place, no ink.
export function toDiagnostics(doc, errors) {
    const out = []
    for (const e of errors ?? []) {
        const line = e?.span?.line ?? null
        if (line == null || line < 1 || line > doc.lines) continue
        const docLine = doc.line(line)
        out.push({
            from: docLine.from,
            to: docLine.to,
            severity: e.severity ?? "error",
            // Through the view again: a reader knows where they are by their own
            // outline, so the attribution is the cell's name or its phase. "the
            // stage" is the last resort, not the default — bare code has no outline.
            source: sourceOf(e) ?? "the stage",
            // Through the view: a name collision and a dependent carry FACTS,
            // not a sentence — the query authors no prose. `describe` quotes a
            // message the wound was given and composes one where it was not.
            message: describe(e),
        })
    }
    return out
}

// Render the current answer into a view — the whole set each ask,
// LSP-style (an empty array clears). Safe against a torn-down view.
export function publishDiagnostics(cm6, view, errors) {
    if (!view?.state) return
    view.dispatch(cm6.setDiagnostics(view.state, toDiagnostics(view.state.doc, errors)))
}

// The standing ink infrastructure — mount once per editor (extensions.js).
// lintGutter renders the marker; the underline rides setDiagnostics itself.
export function createDiagnosticsExtension(cm6) {
    return [cm6.lintGutter()]
}

// THE ONE INK WRITER FOR AN EDITOR. Subscribe the breath, ask, publish the whole
// answer — and ask once at mount, so a remounted editor is whole.
//
// `ask` is the entire contract: WHOSE WOUNDS ARE THESE? The organ never decides.
// The child's own editor asks the world cell for its buffer; the review surface
// asks the wire while watching and the world cell while drafting — one surface,
// two runtimes, and the choice belongs to the surface that knows which it shows.
//
// `view` is a thunk for the same reason: the surface holds no body, it asks its
// owner each breath. Returns unmount, with .refresh() for a surface whose answer
// can change without a breath (a push arriving, a mode flipping).
export function mountDiagnosticsInk(cm6, { view, ask }) {
    // Identity, not depth: an answer built fresh each ask is always new and
    // always repaints, while a held array (the wire's) repaints only when the
    // surface swaps it. Cheap where it helps, harmless where it does not.
    let last
    const paint = () => {
        const v = view()
        if (!v?.state) return          // nothing painted, so nothing remembered
        const answer = ask() ?? []
        if (answer === last) return
        last = answer
        publishDiagnostics(cm6, v, answer)
    }
    const unwatch = watchWorld(paint)
    paint()
    return Object.assign(() => unwatch(), { refresh: paint })
}
