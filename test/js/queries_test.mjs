// The diagnostics query's memo law (weave/queries.js, id:cmp-memo-grain).
// Run with:
//   node --test test/js/queries_test.mjs
//
// What this pins: memoization at the REUSE-UNIT grain, where green-tree
// adoption preserves identity — the memo-hit proof is object identity of
// answers (an untouched unit answers the ===-same array across an edit; a
// fresh unit answers a new one); walk ailments are never memoized (a live
// read cannot go stale) and join the answer span-true; and ailmentsFor
// filters the one error scan to a buffer by its address top segment — the
// plain tab itself or its page cells, never a sibling tab's line 7.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, reparseProgram } from "../../assets/js/turtling/parse.js"
import { nodeDiagnostics, diagnostics, ailmentsFor } from "../../assets/js/weave/queries.js"

describe("the memo law — identity at the reuse grain", () => {
    test("asking twice answers the ===-same array (the memo-hit proof)", () => {
        const [unit] = parseProgram("for do")
        assert.equal(unit.type, "Error")
        const first = nodeDiagnostics(unit)
        assert.equal(nodeDiagnostics(unit), first, "literally the same object")
        assert.equal(first.length, 1)
    })

    test("an edit to unit k leaves units ≠ k answering their old arrays", () => {
        const before = "fw 10\nfor do\nrt 90"
        const prev = parseProgram(before)
        const answers = prev.map(nodeDiagnostics)

        const after = "fw 10\nfor do\nrt 45"
        const next = reparseProgram(after, before, prev)

        assert.equal(next[0], prev[0], "adoption carried the clean unit")
        assert.equal(next[1], prev[1], "adoption carried the broken unit")
        assert.equal(nodeDiagnostics(next[0]), answers[0])
        assert.equal(nodeDiagnostics(next[1]), answers[1])
        assert.notEqual(next[2], prev[2], "the edited unit is fresh")
        assert.notEqual(nodeDiagnostics(next[2]), answers[2],
            "a fresh unit computes anew — a missed reuse costs recompute, never a wrong answer")
    })

    test("the whole answer concatenates unit truths with live ailments, unmemoized", () => {
        const ast = parseProgram("fw 10\nfor do")
        const ailment = {
            message: "Undefined property: x",
            span: { line: 1, endLine: 1 },
            phase: "walk",
            name: "coil",
        }
        const answer = diagnostics(ast, [ailment])
        assert.equal(answer.length, 2)
        assert.equal(answer[0].phase, "parse")
        assert.deepEqual(answer[1], {
            message: "Undefined property: x",
            span: { line: 1, endLine: 1 },
            phase: "walk",
            source: "coil",
        })
        assert.notEqual(diagnostics(ast, [ailment])[1], answer[1],
            "ailments are read live each ask, never memoized")
    })
})

describe("ailmentsFor — a buffer's standing ailments by address", () => {
    const errors = [
        { address: "buf1", message: "a", span: { line: 2 } },
        { address: "buf1#cell2/coil", message: "b", span: { line: 7 } },
        { address: "buf2/coil", message: "c", span: { line: 7 } },
        { address: "buf10", message: "d", span: { line: 1 } },
    ]

    test("the plain tab and its page cells answer; siblings never leak their lines", () => {
        assert.deepEqual(ailmentsFor(errors, "buf1").map((e) => e.message), ["a", "b"])
        assert.deepEqual(ailmentsFor(errors, "buf2").map((e) => e.message), ["c"])
    })

    test("a key that is a prefix of another key stays its own buffer", () => {
        assert.deepEqual(ailmentsFor(errors, "buf10").map((e) => e.message), ["d"])
    })

    test("no scheduler, no key — the empty answer, never a throw", () => {
        assert.deepEqual(ailmentsFor(null, "buf1"), [])
        assert.deepEqual(ailmentsFor(errors, null), [])
    })
})
