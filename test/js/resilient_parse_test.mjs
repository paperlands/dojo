// The resilient parse — Phase 1 of the intelligent compiler
// (specs/compiler.org id:cmp-resilient; D020 the healthy parts live). Run with:
//   node --test test/js/resilient_parse_test.mjs
//
// What this pins: the parse is TOTAL (never throws); malformed input becomes
// error nodes under the CONTAINMENT law (one line for a head error, head-to-
// EOF for an unterminated block, parsed children riding INSIDE — never
// silently reparented); every statement node carries a span of TRUE original
// buffer lines (blanks dropped, glued `end` split, meadows folded — the
// birth line survives all reshaping); printAST round-trips the brokenness
// without inventing an `end`; and the executor rests error nodes while the
// healthy parts run.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, printAST, collectErrors, blockDelta, isMeadowFence, isCellOpen, isCellClose } from "../../assets/js/turtling/parse.js"

describe("the parse is total — error nodes, never throws", () => {
    test("a broken head is one line; siblings live", () => {
        const ast = parseProgram("fw 10\nfor do\nrt 90")
        assert.deepEqual(ast.map(n => n.type), ["Call", "Error", "Call"])
        assert.deepEqual(ast[1].span, { line: 2, endLine: 2 })
        assert.equal(ast[1].value, "for do")            // her text, verbatim
        assert.match(ast[1].meta.expected, /number of loops/)
    })

    test("a block head missing `do` is one line; no body is consumed", () => {
        const ast = parseProgram("as sky\nfw 100")
        assert.equal(ast[0].type, "Error")
        assert.equal(ast[1].type, "Call")               // fw runs — never swallowed
        assert.equal(ast[1].value, "fw")
    })

    test("the adversary's missing `end`: the body rides INSIDE the error, inert", () => {
        const ast = parseProgram("for 3 do\nfw 10\nrt 90")
        assert.equal(ast.length, 1)
        assert.equal(ast[0].type, "Error")
        assert.match(ast[0].meta.expected, /'end' to close 'for'/)
        assert.deepEqual(ast[0].span, { line: 1, endLine: 3 })   // head to EOF
        // Structure preserved: the parsed body is contained, not reparented.
        assert.deepEqual(ast[0].children.map(n => n.value), ["fw", "rt"])
    })

    test("healthy code BEFORE an unterminated block still stands beside it", () => {
        const ast = parseProgram("fw 5\nas sky do\nfw 10")
        assert.deepEqual(ast.map(n => n.type), ["Call", "Error"])
    })

    test("nested unterminated blocks contain outward, never reparent", () => {
        const ast = parseProgram("for 3 do\nfor 2 do\nfw 1")
        assert.equal(ast.length, 1)
        assert.equal(ast[0].type, "Error")               // outer contains…
        assert.equal(ast[0].children[0].type, "Error")   // …the inner error…
        assert.equal(ast[0].children[0].children[0].value, "fw")  // …which holds the body
    })

    test("containment reaches a folded meadow's far edge, not its opening line", () => {
        const ast = parseProgram("for 3 do\nfw 10\n###\nprose\nmore prose")
        assert.equal(ast[0].type, "Error")
        assert.deepEqual(ast[0].span, { line: 1, endLine: 5 },
            "the meadow record's endLine is the true EOF edge")
    })

    test("a stray `end` with no block open rests as an error node", () => {
        const ast = parseProgram("fw 10\nend")
        assert.deepEqual(ast.map(n => n.type), ["Call", "Error"])
        assert.match(ast[1].meta.found, /'end'/)
    })
})

describe("spans — true birth lines survive the reshaping", () => {
    test("blank lines and comments don't shift the count", () => {
        const ast = parseProgram("fw 10\n\n# a note\nrt 90")
        const calls = ast.filter(n => n.type === "Call")
        assert.deepEqual(calls[0].span, { line: 1, endLine: 1 })
        assert.deepEqual(calls[1].span, { line: 4, endLine: 4 })
    })

    test("a blank line rides through as an Empty on its own birth line", () => {
        // Line-number parity: every source line has a node, so printAST
        // re-emits the buffer byte-for-byte and a bare Enter is a real edit.
        const src = "fw 10\n\n\nrt 90"
        const ast = parseProgram(src)
        assert.deepEqual(ast.map(n => n.type), ["Call", "Empty", "Empty", "Call"])
        assert.deepEqual(ast[1].span, { line: 2, endLine: 2 })
        assert.deepEqual(ast[2].span, { line: 3, endLine: 3 })
        assert.equal(printAST(ast), src)
    })

    test("a glued `end rt 90` splits into records sharing the birth line", () => {
        const ast = parseProgram("for 2 do\nfw 10\nend rt 90")
        assert.equal(ast[0].type, "Loop")
        assert.deepEqual(ast[0].span, { line: 1, endLine: 3 })   // end lives on line 3
        assert.equal(ast[1].type, "Call")                        // rt, split off the end
        assert.deepEqual(ast[1].span, { line: 3, endLine: 3 })
    })

    test("a block spans head to its `end`", () => {
        const ast = parseProgram("as sky do\nfw 10\nrt 90\nend\nfw 1")
        assert.deepEqual(ast[0].span, { line: 1, endLine: 4 })
        assert.deepEqual(ast[1].span, { line: 5, endLine: 5 })
    })

    test("code inside a meadow's ``` cell keeps buffer-true lines", () => {
        const ast = parseProgram("###\nprose here\n```\nfw 10\n```\n###")
        const call = ast.find(n => n.type === "Call")
        assert.deepEqual(call.span, { line: 4, endLine: 4 })
    })
})

describe("the round-trip — brokenness preserved, never healed by print", () => {
    test("printAST re-emits the broken head verbatim, inventing no `end`", () => {
        const src = "fw 10\nfor do\nrt 90"
        assert.equal(printAST(parseProgram(src)), src)
    })

    test("an unterminated block re-parses to the same shape", () => {
        const src = "for 3 do\nfw 10\nrt 90"
        const once = parseProgram(src)
        const twice = parseProgram(printAST(once))
        assert.equal(twice.length, 1)
        assert.equal(twice[0].type, "Error")
        assert.deepEqual(twice[0].children.map(n => n.value), ["fw", "rt"])
    })
})

describe("collectErrors — the diagnostics seed (Phase 2's first query)", () => {
    test("errors surface in document order with structured spans", () => {
        const errs = collectErrors(parseProgram("for do\nfw 10\nas sky do\nrt 90"))
        assert.equal(errs.length, 2)
        assert.equal(errs[0].span.line, 1)
        assert.equal(errs[1].span.line, 3)
        assert.equal(errs[1].kind, "parse")
        assert.match(errs[1].message, /'end' to close 'as'/)
    })

    test("a healthy program answers empty — no ink, no noise", () => {
        assert.deepEqual(collectErrors(parseProgram("fw 10\nrt 90")), [])
    })

    test("errors nested inside healthy blocks are still found", () => {
        const errs = collectErrors(parseProgram("as sky do\nfor do\nend"))
        assert.equal(errs.length, 1)
        assert.equal(errs[0].span.line, 2)
    })
})

describe("the one grammar — fence predicates and blockDelta", () => {
    test("meadow and cell fences agree with outline's law", () => {
        assert.equal(isMeadowFence("###"), true)
        assert.equal(isMeadowFence("  ###  "), true)
        assert.equal(isMeadowFence("### more"), false)
        assert.equal(isCellOpen("```"), true)
        assert.equal(isCellOpen("```paperlang"), true)
        assert.equal(isCellOpen("  ``` name"), true)
        assert.equal(isCellClose("```"), true)
        assert.equal(isCellClose("```name"), false)
    })

    test("blockDelta: do opens, end closes; a mid-line do is not an opener", () => {
        assert.equal(blockDelta("for 4 do"), 1)
        assert.equal(blockDelta("  end"), -1)
        assert.equal(blockDelta("end # trailing margin"), -1)
        assert.equal(blockDelta("fw 10"), 0)
        // The bug do-end-matching used to have: /\bdo\b/ matches inside a string.
        assert.equal(blockDelta("label 'do it' 10"), 0)
        assert.equal(blockDelta("# for 4 do"), 0)   // whole line is margin — no code
    })
})
