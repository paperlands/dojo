// =============================================================================
// THE DIAGNOSTICS ADAPTER — the query's answer projected into editor ink
// (specs/compiler.org id:cmp-first-surface). Demand-driven: the surface
// ASKS the world cell's diagnostics face on each breath (watchWorld) and
// once at mount, then renders the whole answer through @codemirror/lint's
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

import { world, watchWorld } from "../weave/world.js"

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
            source: e.source ?? "the stage",
            message: String(e.message ?? ""),
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

// The ask surface: subscribe the breath, ask the diagnostics face, publish
// the whole answer — and ask once at mount, so a remounted editor is whole.
// `view` and `key` are thunks: the surface holds no body, it asks its owner
// each breath (the address law at the query seam). An empty cell answers
// through the optional chain — ink clears on the next ask. Returns unmount.
export function mountDiagnosticsInk(cm6, { view, key }) {
    const ask = () => {
        publishDiagnostics(cm6, view(), world()?.diagnostics?.(key()) ?? [])
    }
    const unwatch = watchWorld(ask)
    ask()
    return unwatch
}
