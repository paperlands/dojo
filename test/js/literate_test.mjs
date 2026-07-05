// The Literate Atom — Phase 6 of the tilling (specs/groundwork.org id:gw-development,
// id:gw-grammar). Run with: node --test test/js/literate_test.mjs
//
// meta.lit is the ONE prose store, holding raw text only — structure is derived
// at render, never stored. Two doors open into that store:
//   - the MARGIN:  `fw 50 # the step`  — prose OF a line, rides its code node
//   - the MEADOW:  `###` … `###`       — prose AROUND code, one node, multiline lit
// Headlines (`* name`) and portals (`[[name]]`) live as raw text inside the lit;
// printAST must re-emit every lit line verbatim, fences included.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, printAST } from "../../assets/js/turtling/parse.js"

// The round-trip is idempotent: once normalised, parse→print→parse→print is fixed.
const roundtrip = (src) => printAST(parseProgram(src))
const stable    = (src) => roundtrip(roundtrip(src))

describe("the margin — prose riding a code line", () => {
    test("a margin comment survives on its node", () => {
        const [node] = parseProgram("fw 50 # the step")
        assert.equal(node.type, "Call")
        assert.equal(node.value, "fw")
        assert.equal(node.meta.lit, "the step")
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
        assert.equal(ast[0].meta.lit, "a bold step")
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
