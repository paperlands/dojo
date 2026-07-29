// The wound VIEW (weave/wound-view.js) — the sentence a diagnostic says. Run:
//   node --test test/js/wound_view_test.mjs
//
// What this pins: the seam between facts and words. The query authors no prose
// — a wound either carries a message it was GIVEN (the parser's, the canvas's)
// which is quoted and never rewritten, or it carries the FACTS for one and this
// layer says it. Nothing here decides anything; if it had to choose which wound
// matters, it would belong in the query.

import { test, describe as suite } from "node:test"
import assert from "node:assert/strict"

import { placeOf, describe, sayWound, sourceOf } from "../../assets/js/weave/wound-view.js"

suite("placeOf — where it hurts, in the author's own outline", () => {
    test("phase chain, her word for the cell, then the line", () => {
        assert.equal(
            placeOf({ phase: ["Arrowhead", "wow"], cellName: "wow", span: { line: 7 } }),
            "Arrowhead › wow › wow · line 7")
    })

    test("an unnamed cell simply says its phase — no machine index ever shows", () => {
        assert.equal(placeOf({ phase: ["top"], cellName: null, span: { line: 4 } }),
                     "top · line 4")
    })

    test("bare code has no outline, so the line stands alone", () => {
        assert.equal(placeOf({ phase: [], cellName: null, span: { line: 2 } }), "line 2")
    })

    test("no span, no place — never a guessed one", () => {
        assert.equal(placeOf({ phase: [], cellName: null, span: null }), "")
    })
})

// The gutter used to attribute an unattributed wound to "the stage" — the
// machine's name for itself, told to a reader who knows where she is by her own
// outline. A dependent warning hit it every time: it carries no frame, but
// locating gave it her word for the cell and the phase it stands in.
suite("sourceOf — who is speaking, in her outline", () => {
    test("the frame that died says its own name", () => {
        assert.equal(sourceOf({ source: "coil", cellName: "wow", phase: ["top"] }), "coil")
    })

    test("with no frame, her word for the cell", () => {
        assert.equal(sourceOf({ source: null, cellName: "wow", phase: ["Arrowhead", "top"] }), "wow")
    })

    test("an unnamed cell answers with the phase it stands in — the innermost", () => {
        assert.equal(sourceOf({ cellName: null, phase: ["Arrowhead", "top"] }), "top")
    })

    test("bare code has no outline, and says so by saying nothing", () => {
        assert.equal(sourceOf({ cellName: null, phase: [] }), null)
        assert.equal(sourceOf({}), null)
        assert.equal(sourceOf(null), null)
    })

    test("a dependent warning is attributed like any other wound", () => {
        assert.equal(
            sourceOf({ kind: "dependent", standsOn: "base", source: null,
                       cellName: "child", phase: ["top"] }),
            "child")
    })
})

suite("describe — quoted where given, composed where not", () => {
    test("a message the wound was GIVEN is quoted verbatim", () => {
        assert.equal(describe({ kind: "walk", message: "Function f not defined" }),
                     "Function f not defined")
    })

    test("a duplicate name is composed from its facts", () => {
        const said = describe({ kind: "name", why: "duplicate", word: "spiral", answersTo: "1.2" })
        assert.match(said, /spiral/)
        assert.match(said, /1\.2/)
    })

    test("a name spelled as a place says so differently", () => {
        assert.match(describe({ kind: "name", why: "place", word: "1.2", answersTo: "1" }),
                     /is a place, not a name/)
    })

    test("a dependent names what it stands on", () => {
        assert.equal(describe({ kind: "dependent", standsOn: "base" }),
                     "depends on base, which did not run")
    })

    test("an unknown kind with no message says nothing rather than inventing", () => {
        assert.equal(describe({ kind: "something-new" }), "")
    })
})

suite("sayWound — the one sentence every surface pushes", () => {
    test("where it hurts, then what hurt", () => {
        assert.equal(
            sayWound({ kind: "walk", message: "boom", phase: ["top"], cellName: "base",
                       span: { line: 4 } }),
            "top › base · line 4 — boom")
    })

    test("a placeless wound is still said, without a dangling separator", () => {
        assert.equal(sayWound({ kind: "walk", message: "boom", phase: [], span: null }), "boom")
    })

    test("a composed wound gets its place too — facts in, one sentence out", () => {
        assert.equal(
            sayWound({ kind: "dependent", standsOn: "base", phase: ["top", "under"],
                       cellName: "child", span: { line: 7 } }),
            "top › under › child · line 7 — depends on base, which did not run")
    })
})
