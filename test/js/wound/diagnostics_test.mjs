// The diagnostics adapter's laws (editor/diagnostics.js, id:cmp-first-surface).
// Adapted from the portal-organs stash for the ask direction: the error-text
// → line regex (parseErrorLine) is dead and does not ride back in — errors
// arrive born structured, and the WHERE-to-lint law reads the TRUE span. Run:
//   node --test test/js/wound/diagnostics_test.mjs
//
// What this pins: a diagnostic inks a line only when it carries a true span;
// no span — or a line the doc no longer holds — never inks (the HUD carries
// it whole; guessing a place would be a second grammar); an empty answer is
// the clear signal.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { toDiagnostics, mountDiagnosticsInk } from "../../../assets/js/editor/diagnostics.js"
import { readWounds } from "../../../assets/js/weave/wounds.js"
import { worldChanged } from "../../../assets/js/weave/world.js"

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

// THE ONE INK WRITER FOR AN EDITOR. It is a READER now: the surface's wounds
// organ (weave/wounds.js) owns the ask and the one breath, and the ink is handed
// both. WHOSE WOUNDS THESE ARE is answered one level up, so the ink and the
// voice cannot be showing different runtimes. What stays the ink's own is its
// early cutoff — keyed on what IT emits — and the skip law.
describe("the ink organ — read, breathe, paint", () => {
    const doc = mkDoc("fw 10\nrt 90\nfw 20")
    // A CM6 stand-in that records what was published.
    const rig = () => {
        const painted = []
        const view = { state: { doc }, dispatch: (tr) => painted.push(tr) }
        const cm6 = { setDiagnostics: (_state, ds) => ds }
        return { painted, view, cm6 }
    }
    const hurt = (line) => [{ span: { line }, message: "boom" }]

    test("it reads once at mount, so a remounted editor is whole", () => {
        const { painted, view, cm6 } = rig()
        let asked = 0
        const wounds = readWounds({ ask: () => { asked++; return hurt(1) } })
        mountDiagnosticsInk(cm6, { view: () => view, wounds })
        assert.equal(asked, 1)
        assert.equal(painted.length, 1)
        assert.equal(painted[0][0].span?.line ?? painted[0][0].from, doc.line(1).from)
        wounds.release()
    })

    test("every breath is a read — nothing is ever pushed INTO the editor", () => {
        const { painted, view, cm6 } = rig()
        let line = 1
        const wounds = readWounds({ ask: () => hurt(line) })
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, wounds })
        line = 2
        worldChanged()
        assert.equal(painted.length, 2, "the breath said only 'read again'")
        assert.equal(painted[1][0].from, doc.line(2).from, "and the answer was the new one")
        unmount(); wounds.release()
    })

    test("ONE breath, ONE paint — the ink keeps no clock of its own", () => {
        const { painted, view, cm6 } = rig()
        let line = 1
        const wounds = readWounds({ ask: () => hurt(line) })
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, wounds })
        // A surface that also watched the world used to make this paint twice.
        line = 2
        worldChanged()
        assert.equal(painted.length, 2, "mount + one breath, never mount + two")
        unmount(); wounds.release()
    })

    test("an unchanged answer is not repainted — a quiet surface stays quiet", () => {
        const { painted, view, cm6 } = rig()
        const held = hurt(1)                      // the wire's answer, held by reference
        const wounds = readWounds({ ask: () => held })
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, wounds })
        worldChanged()
        worldChanged()
        assert.equal(painted.length, 1, "a repeat is not news")
        unmount(); wounds.release()
    })

    // THE CUTOFF IS KEYED ON WHAT THE INK EMITS, not on the answer it was given.
    // The query builds a fresh list every read, so an identity check never hit:
    // a clean document dispatched into CM6 on every breath, forever, at 20 ms.
    test("a FRESH list that reads the same is not repainted", () => {
        const { painted, view, cm6 } = rig()
        const wounds = readWounds({ ask: () => hurt(1) })   // new array every read
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, wounds })
        worldChanged()
        worldChanged()
        worldChanged()
        assert.equal(painted.length, 1, "same wounds, freshly allocated, is still not news")
        unmount(); wounds.release()
    })

    test("a healthy document paints once and then stays silent", () => {
        const { painted, view, cm6 } = rig()
        const wounds = readWounds({ ask: () => [] })        // fresh empty, the common case
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, wounds })
        worldChanged()
        worldChanged()
        assert.equal(painted.length, 1, "nothing to say, said once")
        unmount(); wounds.release()
    })

    // A digest over the WOUNDS alone would miss this: same kind, same address,
    // same line, but the gutter's attribution changed, so the reader would keep
    // showing the old cell's name.
    test("a renamed cell repaints, though no wound moved", () => {
        const { painted, view, cm6 } = rig()
        let cellName = "pond"
        const wounds = readWounds({
            ask: () => [{ span: { line: 1 }, message: "boom", cellName }],
        })
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, wounds })
        cellName = "puddle"
        worldChanged()
        assert.equal(painted.length, 2, "the attribution is part of what is drawn")
        assert.equal(painted[1][0].source, "puddle")
        unmount(); wounds.release()
    })

    // Severity rides the KIND now, so a kind change is a severity change.
    test("severity alone changing is news", () => {
        const { painted, view, cm6 } = rig()
        let kind = "walk"
        const wounds = readWounds({ ask: () => [{ span: { line: 1 }, message: "boom", kind }] })
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, wounds })
        assert.equal(painted[0][0].severity, "error")
        kind = "name"
        worldChanged()
        assert.equal(painted.length, 2)
        assert.equal(painted[1][0].severity, "warning")
        unmount(); wounds.release()
    })

    test("wounds.changed() paints without a world breath — a push arriving", () => {
        const { painted, view, cm6 } = rig()
        let answer = hurt(1)
        const wounds = readWounds({ ask: () => answer })
        mountDiagnosticsInk(cm6, { view: () => view, wounds })
        answer = hurt(3)
        wounds.changed()
        assert.equal(painted.length, 2)
        assert.equal(painted[1][0].from, doc.line(3).from)
        wounds.release()
    })

    test("a torn-down view paints nothing and remembers nothing", () => {
        const { painted, cm6 } = rig()
        let live = null
        const held = hurt(1)
        const wounds = readWounds({ ask: () => held })
        mountDiagnosticsInk(cm6, { view: () => live, wounds })
        assert.equal(painted.length, 0, "no view, no ink")
        live = { state: { doc }, dispatch: (tr) => painted.push(tr) }
        worldChanged()
        assert.equal(painted.length, 1,
            "and the answer it could not paint is not mistaken for one it did")
        wounds.release()
    })

    test("unmount unhears the breath", () => {
        const { painted, view, cm6 } = rig()
        let n = 0
        const wounds = readWounds({ ask: () => hurt(++n % 3 + 1) })
        const unmount = mountDiagnosticsInk(cm6, { view: () => view, wounds })
        unmount()
        worldChanged()
        assert.equal(painted.length, 1, "only the mount read")
        wounds.release()
    })
})

// THE INK FLATTENS WHAT THE VOICE FOLDS. A dependent hangs under the death that
// caused it — that is how it stops inflating the count — but it stands at a line
// of its own, and a child must SEE where. One shape, each reader projecting it
// its own way.
describe("children are inked at their own lines", () => {
    const doc = mkDoc("a\nb\nc\nd")
    const tree = [{
        kind: "walk", message: "boom", span: { line: 1 },
        children: [
            { kind: "dependent", standsOn: "base", span: { line: 3 } },
            { kind: "dependent", standsOn: "base", span: { line: 4 } },
        ],
    }]

    test("the parent and every child get their own mark", () => {
        const ds = toDiagnostics(doc, tree)
        assert.equal(ds.length, 3, "one death, two dominoes — three marks")
        assert.deepEqual(ds.map((d) => d.from), [doc.line(1).from, doc.line(3).from, doc.line(4).from])
    })

    test("and each keeps its own weight — the death errors, the dominoes warn", () => {
        const ds = toDiagnostics(doc, tree)
        assert.deepEqual(ds.map((d) => d.severity), ["error", "warning", "warning"])
    })

    test("a child with no true span still never inks", () => {
        const ds = toDiagnostics(doc, [{ kind: "walk", message: "boom", span: { line: 1 },
                                          children: [{ kind: "dependent", span: null }] }])
        assert.equal(ds.length, 1, "the skip law reaches children too")
    })
})
