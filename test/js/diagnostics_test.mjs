// The diagnostics adapter's laws (editor/diagnostics.js, id:cmp-first-surface).
// Adapted from the portal-organs stash for the ask direction: the error-text
// → line regex (parseErrorLine) is dead and does not ride back in — errors
// arrive born structured, and the WHERE-to-lint law reads the TRUE span. Run:
//   node --test test/js/diagnostics_test.mjs
//
// What this pins: a diagnostic inks a line only when it carries a true span;
// no span — or a line the doc no longer holds — never inks (the HUD carries
// it whole; guessing a place would be a second grammar); an empty answer is
// the clear signal.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { toDiagnostics, mountDiagnosticsInk } from "../../assets/js/editor/diagnostics.js"
import { worldChanged } from "../../assets/js/weave/world.js"

// A DOM-free CM6 `state.doc` stand-in (the lit_tokenizer_test shape).
function mkDoc(src) {
    const texts = src.split("\n")
    let pos = 0
    const objs = texts.map((text, i) => {
        const from = pos, to = pos + text.length
        pos = to + 1
        return { text, number: i + 1, from, to }
    })
    return { lines: objs.length, length: pos, line: (n) => objs[n - 1] }
}

describe("where to lint — only where the span is true", () => {
    const doc = mkDoc("fw 10\nrt 90\nfw 20")

    test("a spanned error inks its whole line, severity error", () => {
        const [d] = toDiagnostics(doc, [
            { span: { line: 2, endLine: 2 }, message: "looking for 'end', found the end of the page" },
        ])
        assert.equal(d.from, doc.line(2).from)
        assert.equal(d.to, doc.line(2).to)
        assert.equal(d.severity, "error")
        assert.equal(d.source, "the stage")
    })

    test("a walk ailment carries its frame as source", () => {
        const [d] = toDiagnostics(doc, [
            { span: { line: 1 }, message: "Undefined property: x", source: "coil" },
        ])
        assert.equal(d.source, "coil")
    })

    // "the stage" is the machine's name for itself, told to a reader who knows
    // where she is by her own outline. It is the last resort now, not the default.
    test("an unattributed wound is attributed to her cell, then to its phase", () => {
        const [cell] = toDiagnostics(doc, [
            { span: { line: 1 }, message: "boom", cellName: "wow", phase: ["Arrowhead"] },
        ])
        assert.equal(cell.source, "wow")

        const [phase] = toDiagnostics(doc, [
            { span: { line: 1 }, message: "boom", cellName: null, phase: ["Arrowhead", "top"] },
        ])
        assert.equal(phase.source, "top")
    })

    test("bare code with no outline still falls back to the stage", () => {
        const [d] = toDiagnostics(doc, [{ span: { line: 1 }, message: "boom", phase: [] }])
        assert.equal(d.source, "the stage")
    })

    test("no span, no ink — the HUD carries it whole", () => {
        assert.deepEqual(toDiagnostics(doc, [{ span: null, message: "boom" }]), [])
        assert.deepEqual(toDiagnostics(doc, [{ message: "boom" }]), [])
    })

    test("a line the doc no longer holds never inks", () => {
        assert.deepEqual(toDiagnostics(doc, [{ span: { line: 9 }, message: "stale" }]), [])
        assert.deepEqual(toDiagnostics(doc, [{ span: { line: 0 }, message: "stale" }]), [])
    })

    test("an empty set is an empty set — the clear signal", () => {
        assert.deepEqual(toDiagnostics(doc, []), [])
        assert.deepEqual(toDiagnostics(doc, null), [])
    })
})

// THE ONE INK WRITER FOR AN EDITOR, and its whole contract: `ask` answers WHOSE
// WOUNDS THESE ARE, and the organ never decides. The child's own editor asks the
// world cell for its buffer; the review panel asks the wire while watching and
// the world cell while drafting live — one surface, two runtimes. Making that
// choice the caller's is what let the review surface have an ink writer at all;
// keyed on a buffer it could only ever have inked the local runtime.
describe("the ink organ — ask, breathe, paint", () => {
    const doc = mkDoc("fw 10\nrt 90\nfw 20")
    // A CM6 stand-in that records what was published.
    const rig = () => {
        const painted = []
        const view = { state: { doc }, dispatch: (tr) => painted.push(tr) }
        const cm6 = { setDiagnostics: (_state, ds) => ds }
        return { painted, view, cm6 }
    }
    const hurt = (line) => [{ span: { line }, message: "boom" }]

    test("it asks once at mount, so a remounted editor is whole", () => {
        const { painted, view, cm6 } = rig()
        let asked = 0
        mountDiagnosticsInk(cm6, { view: () => view, ask: () => { asked++; return hurt(1) } })
        assert.equal(asked, 1)
        assert.equal(painted.length, 1)
        assert.equal(painted[0][0].span?.line ?? painted[0][0].from, doc.line(1).from)
    })

    test("every breath is an ask — nothing is ever pushed INTO the editor", () => {
        const { painted, view, cm6 } = rig()
        let line = 1
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, ask: () => hurt(line) })
        line = 2
        worldChanged()
        assert.equal(painted.length, 2, "the breath said only 'ask again'")
        assert.equal(painted[1][0].from, doc.line(2).from, "and the answer was the new one")
        unmount()
    })

    test("an unchanged answer is not repainted — a quiet surface stays quiet", () => {
        const { painted, view, cm6 } = rig()
        const held = hurt(1)                      // the wire's answer, held by reference
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, ask: () => held })
        worldChanged()
        worldChanged()
        assert.equal(painted.length, 1, "identity, not depth — a repeat is not news")
        unmount()
    })

    test("refresh() paints without a breath — a push arriving, a mode flipping", () => {
        const { painted, view, cm6 } = rig()
        let answer = hurt(1)
        const ink = mountDiagnosticsInk(cm6, { view: () => view, ask: () => answer })
        answer = hurt(3)
        ink.refresh()
        assert.equal(painted.length, 2)
        assert.equal(painted[1][0].from, doc.line(3).from)
    })

    test("a torn-down view paints nothing and remembers nothing", () => {
        const { painted, cm6 } = rig()
        let live = null
        const held = hurt(1)
        mountDiagnosticsInk(cm6, { view: () => live, ask: () => held })
        assert.equal(painted.length, 0, "no view, no ink")
        live = { state: { doc }, dispatch: (tr) => painted.push(tr) }
        worldChanged()
        assert.equal(painted.length, 1,
            "and the answer it could not paint is not mistaken for one it did")
    })

    test("unmount unhears the breath", () => {
        const { painted, view, cm6 } = rig()
        let n = 0
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, ask: () => hurt(++n % 3 + 1) })
        unmount()
        worldChanged()
        assert.equal(painted.length, 1, "only the mount ask")
    })
})
