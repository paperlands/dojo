// The trivia instrument — comments and blanks are TRIVIA: non-semantic text
// that must survive parse → print untouched (id:pa-ghc-exactprint — fidelity
// lives IN the tree). This file is the arbiter for the "collapse trivia" work:
// one uniform concept, one emit path, swept adversarially across every position
// a comment can ride — a call margin, a block's `do` and `end` lines, a line of
// its own, nested, and carrying keywords/whitespace that used to break it.
//
//   node --test test/js/document/trivia_test.mjs
//
// The universal net is STABILITY (exact, no fuzzy normalize): once printed, a
// tree re-parses and re-prints to the SAME text — trivia included. Curated
// items also assert byte-exact round-trip where no normalization is expected.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, printAST } from "../../../assets/js/turtling/parse.js"

const roundtrip = (src) => printAST(parseProgram(src))
const stable    = (src) => roundtrip(roundtrip(src))

// Every position a comment can ride. `exact` items round-trip byte-for-byte;
// the rest only promise stability (a normalization — `for`→`loop`, spacing —
// may fire on the first pass, never after).
const CORPUS = [
    { src: "fw 10 # a step", exact: true },
    { src: "# a lone comment", exact: true },
    { src: "#", exact: true },                                   // bare hash
    { src: "fw 10 #    aligned tail", exact: true },             // inner whitespace kept
    { src: "fw 1\n\n# spaced note\nrt 90", exact: true },        // blank + standalone
    { src: "fw 1\n\n\nfw 2", exact: true },                      // blank-line parity
    { src: "loop 3 do # head\n  fw 10\nend # tail", exact: true },
    { src: "def sq s do # define\n  fw s\nend # done", exact: true },
    { src: "as sky do # ambient\n  rt 90\nend # close", exact: true },
    { src: "when x do # cond\n  fw 1\nend", exact: true },
    { src: "when 'ping' do\n  fw 1\nend # after event", exact: true },
    { src: "loop 2 do # outer\n  loop 3 do # inner\n    fw 1\n  end # inner end\nend # outer end", exact: true },
    { src: "fw 10 # mind the end of the do block", exact: true }, // keywords inside a comment
    { src: "###\nprose here\n###\nfw 10 # after the meadow", exact: true },
    { src: "for 3 do # counts\n  fw 1\nend # spun" },             // for→loop normalizes
]

describe("trivia — stability is universal (print, re-parse, re-print is fixed)", () => {
    for (const { src } of CORPUS) {
        test(`stable: ${JSON.stringify(src).slice(0, 48)}`, () => {
            assert.equal(stable(src), roundtrip(src))
        })
    }
})

describe("trivia — byte-exact round-trip where no normalization is due", () => {
    for (const { src, exact } of CORPUS) {
        if (!exact) continue
        test(`exact: ${JSON.stringify(src).slice(0, 48)}`, () => {
            assert.equal(roundtrip(src), src)
        })
    }
})

describe("trivia — a comment never migrates lines", () => {
    test("a comment on `end` stays on the end line, spawns no node below", () => {
        assert.equal(parseProgram("loop 3 do\n  fw 10\nend # done").length, 1)
    })

    test("a comment on `do` is not swallowed", () => {
        assert.match(roundtrip("loop 3 do # note\n  fw 1\nend"), /do # note/)
    })

    test("a standalone comment is not indented into a margin", () => {
        // `#…` at column 0 re-emits at column 0 — no phantom leading space.
        assert.equal(roundtrip("# top"), "# top")
    })
})
