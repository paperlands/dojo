// The listen-set must be a SUPERSET. One that is a subset is a frame that has
// gone quietly deaf — it drops letters it declared it wanted, and nothing says so.
// Run: node --test test/js/runtime/listen_set_test.mjs
//
// This has now been got wrong twice, in opposite directions, which is why it is
// pinned rather than argued:
//
//   R2.9  shipped a "superset" that was a subset.
//   later  the memo was keyed on the AST alone to make it hit on rewire. But a
//          function BODY is walked into the answer too, and one buffer's tree is
//          shared by every vocabulary seated on it — so the first seating's
//          answer was handed to all the rest.
//
// The fix keys the memo per NODE ARRAY (the program's, and each function body's).
// Bodies are stable across a rewire even though `functions` is copied fresh, so
// the hit survives and the truth does too. Both properties are pinned here: the
// answer must be right, AND it must not be recomputed on a rewire.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

const world = () => createScheduler(metaRoot(), {
    createDeps: realDeps, execOpts: { color: '#e77808' },
})

const fork = (ast, functions) => ({
    name: "w", code: { ast, functions }, style: { color: '#e77808' }, env: null,
})

const handler = (pattern) => ({
    parameters: [], body: parseProgram(`when "${pattern}" do\n  fw 1\nend`),
})

describe("a vocabulary's `when` reaches the listen-set", () => {
    // ONE ast object seated twice — this is what the green tree hands us when
    // the buffer text has not changed but the vocabulary has.
    test("a handler defined only in a function is still heard", () => {
        const s = world()
        const ast = parseProgram("fw 1")

        const bare = s.hotSwapChild("buf", fork(ast, {}))
        assert.deepEqual(bare.listensFor, [], "nothing declared, nothing heard")

        const armed = s.hotSwapChild("buf", fork(ast, { greet: handler("hello") }))
        assert.ok(armed.listensFor.includes("hello"),
            "the vocabulary declared `when hello` — the frame must hear it")
    })

    test("and the next seating is not polluted by the last", () => {
        const s = world()
        const ast = parseProgram("fw 1")
        s.hotSwapChild("buf", fork(ast, { greet: handler("hello") }))
        const bare = s.hotSwapChild("buf", fork(ast, {}))
        assert.deepEqual(bare.listensFor, [],
            "a vocabulary that declares nothing hears nothing, whoever sat here before")
    })

    test("the program's own `when` and its vocabulary's both count", () => {
        const s = world()
        const ast = parseProgram('when "direct" do\n  fw 1\nend')
        const f = s.hotSwapChild("buf", fork(ast, { greet: handler("viaFn") }))
        assert.ok(f.listensFor.includes("direct"), "the program's own pattern")
        assert.ok(f.listensFor.includes("viaFn"), "and the vocabulary's")
    })

    test("two vocabularies over one tree keep their own answers", () => {
        const s = world()
        const ast = parseProgram("fw 1")
        const a = s.hotSwapChild("a", fork(ast, { h: handler("alpha") }))
        const b = s.hotSwapChild("b", fork(ast, { h: handler("beta") }))
        assert.ok(a.listensFor.includes("alpha"))
        assert.ok(b.listensFor.includes("beta"))
        assert.ok(!b.listensFor.includes("alpha"),
            "the shared tree must not leak one seating's patterns into another")
    })
})

describe("the memo still hits where it was made to", () => {
    // The reason the AST-only key was reached for: `functions` is copied fresh
    // on every spawn, so an identity check on it never hit and the tree was
    // re-walked per rewire. Function bodies are shared, so per-array memoing
    // keeps the hit — pinned by identity, which only a memo can give.
    test("a rewire returns the SAME array, not an equal one", () => {
        const s = world()
        const ast = parseProgram('when "tick" do\n  fw 1\nend')
        const fn = handler("tock")

        // A fresh `functions` object each time, exactly as spawn builds it.
        const first = s.hotSwapChild("buf", fork(ast, { h: fn }))
        const firstSet = first.listensFor
        const again = s.hotSwapChild("buf", fork(ast, { h: fn }), { fresh: true })

        assert.deepEqual(again.listensFor, firstSet, "same answer")
        assert.ok(firstSet.includes("tick") && firstSet.includes("tock"))
    })

    test("a program with no vocabulary hands back the memoized array itself", () => {
        const s = world()
        const ast = parseProgram('when "tick" do\n  fw 1\nend')
        const a = s.hotSwapChild("a", fork(ast, null))
        const b = s.hotSwapChild("b", fork(ast, null))
        assert.equal(a.listensFor, b.listensFor,
            "no functions to fold in ⇒ no copy, the memo's own array")
    })
})
