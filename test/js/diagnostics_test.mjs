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

import { toDiagnostics } from "../../assets/js/editor/diagnostics.js"

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
