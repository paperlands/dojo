// The Literate Atom — Phase 6 of the tilling (specs/groundwork.org id:gw-development,
// id:gw-grammar). Run with: node --test test/js/literate_test.mjs
//
// Prose lives in the tree as raw text, structure derived at render (never
// stored). Two doors, now cleanly split (the "collapse trivia" pass):
//   - the MARGIN:  `fw 50 # the step`  — a COMMENT, trivia riding meta.comment
//                  (its `end`-line twin is meta.endComment); see trivia_test.mjs
//   - the MEADOW:  `###` … `###`       — prose AROUND code, CONTENT in meta.lit,
//                  one node, multiline. Headlines (`* name`) and portals
//                  (`[[name]]`) ride raw inside it; printAST re-emits verbatim.
// meta.lit is now ONLY meadow content — trivia (comments) never conflates with it.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, printAST, phaseCells, stripCells } from "../../assets/js/turtling/parse.js"

// The round-trip is idempotent: once normalised, parse→print→parse→print is fixed.
const roundtrip = (src) => printAST(parseProgram(src))
const stable    = (src) => roundtrip(roundtrip(src))

describe("the margin — prose riding a code line", () => {
    test("a margin comment survives on its node, whitespace verbatim", () => {
        const [node] = parseProgram("fw 50 # the step")
        assert.equal(node.type, "Call")
        assert.equal(node.value, "fw")
        // The text after `#` rides raw on meta.comment — the author's space is
        // theirs to keep, and printAST re-emits `#` + this run exactly.
        assert.equal(node.meta.comment, " the step")
    })

    test("a margin comment round-trips its inner whitespace unstripped", () => {
        assert.equal(roundtrip("fw 10 #   spaced note"), "fw 10 #   spaced note")
        assert.equal(roundtrip("# a top comment"), "# a top comment")
    })

    test("a portal in the margin round-trips as raw text", () => {
        const out = roundtrip("fw 50 # see [[sky]]")
        assert.match(out, /\[\[sky\]\]/)
        assert.equal(stable("fw 50 # see [[sky]]"), out)
    })
})

describe("the meadow — prose around code", () => {
    test("a clearing becomes one node with a multiline lit", () => {
        const ast = parseProgram("###\nfirst line\nsecond line\n###")
        assert.equal(ast.length, 1)
        assert.equal(ast[0].type, "Empty")          // a no-op for the executor
        assert.equal(ast[0].meta.meadow, true)
        assert.equal(ast[0].meta.lit, "first line\nsecond line")
    })

    test("printAST re-emits the fences", () => {
        const out = roundtrip("###\nhello\nworld\n###")
        assert.equal(out, "###\nhello\nworld\n###")
    })

    test("headlines inside the clearing are preserved verbatim", () => {
        const src = "###\n* Chapter One\nthe tale begins\n** a turn\n###"
        const out = roundtrip(src)
        assert.match(out, /^\* Chapter One$/m)
        assert.match(out, /^\*\* a turn$/m)
        assert.equal(stable(src), out)
    })

    test("portals inside the clearing glow home unbroken", () => {
        const src = "###\ntouch [[marco]] to be elsewhere\n###"
        assert.match(roundtrip(src), /\[\[marco\]\]/)
    })

    test("blank lines in prose are kept — a meadow is a place, not a prefix", () => {
        const src = "###\npara one\n\npara two\n###"
        assert.equal(parseProgram(src)[0].meta.lit, "para one\n\npara two")
        assert.equal(roundtrip(src), src)
    })

    test("an empty clearing round-trips", () => {
        assert.equal(roundtrip("###\n###"), "###\n###")
    })
})

describe("interleaving — code rests while you speak", () => {
    test("code, meadow, code keep their order and each carry their prose home", () => {
        const src = [
            "fw 100 # a bold step",
            "###",
            "* Interlude",
            "now we turn",
            "###",
            "rt 90",
        ].join("\n")

        const ast = parseProgram(src)
        assert.equal(ast.length, 3)
        assert.equal(ast[0].type, "Call")
        assert.equal(ast[0].meta.comment, " a bold step")
        assert.equal(ast[1].meta.meadow, true)
        assert.equal(ast[1].meta.lit, "* Interlude\nnow we turn")
        assert.equal(ast[2].value, "rt")

        assert.equal(stable(src), roundtrip(src))
    })

    test("a meadow inside a do/end block lands in the store", () => {
        const src = "loop 3 do\n###\nrepeat, gently\n###\nfw 10\nend"
        const ast = parseProgram(src)
        assert.equal(ast[0].type, "Loop")
        const meadow = ast[0].children.find((c) => c.meta.meadow)
        assert.ok(meadow, "the clearing should survive inside the loop body")
        assert.equal(meadow.meta.lit, "repeat, gently")
    })
})

describe("the margin on a control clause — do/end lines carry prose too", () => {
    test("a comment on the `do` line survives instead of being swallowed", () => {
        const [loop] = parseProgram("loop 3 do # around we go\n  fw 10\nend")
        assert.equal(loop.type, "Loop")
        assert.equal(loop.meta.comment, " around we go")   // head comment, verbatim
        assert.equal(roundtrip("loop 3 do # around we go\n  fw 10\nend"),
                     "loop 3 do # around we go\n  fw 10\nend")
    })

    test("a comment after `end` rides the end line, never wraps below it", () => {
        const [loop] = parseProgram("loop 3 do\n  fw 10\nend # and done")
        assert.equal(loop.type, "Loop")
        assert.equal(loop.meta.endComment, " and done")
        // The whole tree is the one block — the comment did NOT spawn a
        // trailing Empty node (the wrap bug).
        assert.equal(parseProgram("loop 3 do\n  fw 10\nend # and done").length, 1)
        assert.equal(roundtrip("loop 3 do\n  fw 10\nend # and done"),
                     "loop 3 do\n  fw 10\nend # and done")
    })

    test("both ends of an ambient carry their prose across the round-trip", () => {
        const src = "as sky do # the lens opens\n  rt 90\nend # and closes"
        assert.equal(roundtrip(src), src)
        assert.equal(stable(src), roundtrip(src))
    })
})

describe("the cell — code re-entering code-space inside the meadow (id:gw-cell)", () => {
    const PAGE = "###\n* Title\n```\nfw 50\nrt 90\nfw 50 #follow where each step leaves you\n```\n###"

    test("cell code is code being code: the executor walks it", () => {
        const ast = parseProgram(PAGE)
        const calls = ast.filter((n) => n.type === "Call")
        assert.equal(calls.length, 3)
        assert.equal(calls[0].value, "fw")
        assert.equal(calls[2].meta.comment, "follow where each step leaves you")
    })

    test("the meadow around the cell stays prose, split at the fences", () => {
        const ast = parseProgram(PAGE)
        const meadows = ast.filter((n) => n.meta.meadow)
        assert.equal(meadows.length, 1)
        assert.equal(meadows[0].meta.lit, "* Title")
    })

    test("printAST re-emits the whole group exactly — one clearing, cell inside", () => {
        assert.equal(roundtrip(PAGE), PAGE)
        assert.equal(stable(PAGE), roundtrip(PAGE))
    })

    test("a def inside a cell registers and its walk survives the round-trip", () => {
        const src = "###\nthe spiral\n```\ndef coil x do\n  fw x\n  rt 90\n  coil x+1\nend\ncoil 0\n```\n###"
        const ast = parseProgram(src)
        assert.ok(ast.some((n) => n.type === "Define" && n.value === "coil"))
        const out = roundtrip(src)
        assert.match(out, /^```$/m)
        assert.match(out, /def coil x do/)
    })

    test("prose on both sides of the cell keeps the group's edges", () => {
        const src = "###\nbefore\n```\nfw 10\n```\nafter\n###"
        assert.equal(roundtrip(src), src)
    })

    test("an unterminated cell auto-closes at the meadow's edge without throwing", () => {
        const src = "###\nprose\n```\nfw 10\n###"
        let ast
        assert.doesNotThrow(() => { ast = parseProgram(src) })
        assert.ok(ast.some((n) => n.type === "Call" && n.value === "fw"))
    })

    test("the priority law: stripCells keeps the program, phaseCells the previews", () => {
        // Bare code outside the fences takes priority — it is the program;
        // the cell is a preview that runs only on reach, never twice.
        const src = "fw 5\n###\nprose\n```\nfw 100\n```\n###\nrt 90"
        const ast = parseProgram(src)
        assert.deepEqual(phaseCells(ast).map((c) => c.code), ["fw 100"])
        const program = printAST(stripCells(ast))
        assert.ok(!program.includes("fw 100"), "a preview never rides the program")
        assert.match(program, /fw 5/)
        assert.match(program, /rt 90/)
        // the fences stay balanced: the stripped program re-parses clean,
        // its cell now empty — prose never swallowed, nothing double-run
        let reparsed
        assert.doesNotThrow(() => { reparsed = parseProgram(program) })
        assert.deepEqual(phaseCells(reparsed).map((c) => c.code), [""])
    })
})

describe("the auto-close — the rest of the buffer is prose, never a swallowed program", () => {
    test("an unclosed fence runs to end-of-file without throwing", () => {
        const src = "fw 10\n###\nand then everything is a tale\nfw 20 rt 90 end"
        let ast
        assert.doesNotThrow(() => { ast = parseProgram(src) })
        const meadow = ast.find((n) => n.meta.meadow)
        assert.ok(meadow)
        // the code-looking lines after the open fence are prose, not statements
        assert.match(meadow.meta.lit, /everything is a tale/)
        assert.match(meadow.meta.lit, /fw 20 rt 90 end/)
    })
})
