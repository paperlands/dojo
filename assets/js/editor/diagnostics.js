// =============================================================================
// THE DIAGNOSTICS ADAPTER — a wound answer projected into editor ink
// (specs/compiler.org id:cmp-first-surface). Demand-driven: the surface's
// wounds organ breathes, this reads and renders the
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

// Words only. The breath and the ask both belong to the surface's wounds organ
// (weave/wounds.js), so neither the world's faces nor its clock are imported here.
import { describe, sourceOf } from "../weave/wound-view.js"
import { severityOf, everyWound } from "../weave/queries.js"
import { temporal } from "../utils/temporal.js"

// Pure mapping: query answers → CM6 Diagnostic spans, against a doc.
//   errors — [{ span: { line }, message, kind, source? }]; entries
//   without a span-true line (or with a line the doc no longer holds) are
//   SKIPPED — no true place, no ink.
export function toDiagnostics(doc, errors) {
    const out = []
    // FLATTENED: a dependent hangs under the death that caused it, but it
    // stands at a line of its own and a child must SEE where.
    for (const e of everyWound(errors)) {
        const line = e?.span?.line ?? null
        if (line == null || line < 1 || line > doc.lines) continue
        const docLine = doc.line(line)
        out.push({
            from: docLine.from,
            to: docLine.to,
            // The KIND decides, never a literal on the wound: they drifted once
            // and a name collision inked red on a document called well.
            severity: severityOf(e),
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

// WOULD THIS READ THE SAME? Over the DRAWN fields, not the wounds: a renamed
// cell changes `source` without moving a wound, and must still repaint.
const digestOf = (ds) =>
    ds.map((d) => `${d.from}:${d.to}:${d.severity}:${d.source}:${d.message}`).join("\n")

// Render diagnostics into a view — the whole set each time, LSP-style (an empty
// array clears). Safe against a torn-down view.
export function publishDiagnostics(cm6, view, ds) {
    if (!view?.state) return
    view.dispatch(cm6.setDiagnostics(view.state, ds))
}

// The standing ink infrastructure — mount once per editor (extensions.js).
// lintGutter renders the marker; the underline rides setDiagnostics itself.
export function createDiagnosticsExtension(cm6) {
    return [cm6.lintGutter()]
}

// THE ONE INK WRITER FOR AN EDITOR. Reads the surface's wounds (weave/wounds.js),
// which own the ask and the clock; this keeps neither. `view` is a thunk — the
// surface holds no body. No .refresh(): news goes through wounds.changed(), which
// reaches every reader, not just this one.
export function mountDiagnosticsInk(cm6, { view, wounds }) {
    // Keyed on what IT DRAWS, never on the answer given: the query answers a
    // fresh list every read, so array identity never hit and a clean document
    // repainted every breath. LSP's `previousResultId`, locally.
    const draw = temporal.gate((_key, ds) => publishDiagnostics(cm6, view(), ds))
    const paint = () => {
        const v = view()
        if (!v?.state) return          // nothing drawn, so nothing remembered
        const next = toDiagnostics(v.state.doc, wounds.read())
        draw(digestOf(next), next)
    }
    const unwatch = wounds.watch(paint)
    paint()
    return () => unwatch()
}
