// Phase 1 witness — lossless reading: no character may vanish, and delimiters
// keep their kind. Expected answers are language rules, not implementation output.
// Run: node --test test/js/notation/reader_fidelity_test.mjs
//
// Preserved (green) witnesses guard the corpus: `[ ]` still groups and still
// calls, `2(x)`/`2[x]` still multiply, dotted names stay whole. The strong split
// (indexing, vector literals) is a later rung — deliberately NOT asserted here.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Lexer } from "../../../assets/js/turtling/mafs/lexer.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const lex = (s) => new Lexer().tokenize(s)
const types = (s) => lex(s).map((t) => t.type)
const ev = (s) => new Evaluator().run(new Parser().parse(s), {})

describe("lossless reading — an unsupported glyph is refused where it occurs", () => {
    test("unsupported ink does not silently vanish", () => {
        assert.throws(() => lex("2$+3"), /Unknown token: \$ at position 1/)
        assert.throws(() => lex(".5+1"), /Unknown token: \. at position 0/)
        assert.throws(() => lex("."), /Unknown token: \. at position 0/)
        assert.throws(() => lex("2?"), /Unknown token: \? at position 1/)
    })

    test("the old silent answers are gone", () => {
        assert.throws(() => ev("2$+3"))
        assert.throws(() => ev(".5+1"))
    })

    test("well-formed ink is untouched", () => {
        assert.deepEqual(types("9.7e-7"), ["NUMBER"])
        assert.deepEqual(types("mice1.x"), ["IDENTIFIER"])
        assert.deepEqual(types("7 mod 3"), ["NUMBER", "OPERATOR", "NUMBER"])
        assert.deepEqual(types("2x"), ["NUMBER", "OPERATOR", "IDENTIFIER"])
    })
})

describe("delimiters keep their kind — a pair must match", () => {
    test("a mismatched pair is refused, naming both glyphs", () => {
        assert.throws(() => ev("(2]"), /Mismatched delimiters/)
        assert.throws(() => ev("[2)"), /Mismatched delimiters/)
        assert.throws(() => ev("(2+3]"), /Mismatched delimiters/)
    })

    test("an unclosed group is a located refusal", () => {
        assert.throws(() => ev("(2"), /Missing closing/)
        assert.throws(() => ev("[2"), /Missing closing/)
    })

    test("a matched pair reads, either kind", () => {
        assert.equal(ev("(2)"), 2)
        assert.equal(ev("[2]"), 2)
        assert.equal(ev("(2+3)"), 5)
        assert.equal(ev("[2+3]"), 5)
        assert.equal(ev("[[1+1] mod 2]"), 0)
    })
})

describe("the codex corpus still reads (preserved, green)", () => {
    test("brackets still group and still call", () => {
        assert.equal(ev("sin[30]"), 0.5)      // waves.org uses sin[x]
        assert.equal(ev("sin(30)"), 0.5)
        assert.equal(ev("[[3 + 1] mod 4]"), 0) // the whirlpool's rule shape
    })

    test("juxtaposition still multiplies", () => {
        assert.equal(ev("2*[3]"), 6)
        assert.equal(ev("(2)(3)"), 6)
    })

    test("no vector syntax was added", () => {
        assert.throws(() => ev("[1,2]"))
    })
})
