// mod / // operators — run with: node --test test/js/execute/mod_division_test.mjs
//
// mod: the remainder, spelled as a word — `7 mod 3` = 1 (ring operator: sign of divisor,
//      so it is never negative for a positive divisor).
// // : integer division, flooring toward minus infinity — `7 // 3` = 2.
// They satisfy the identity  a//b * b + a mod b = a  for every nonzero b.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Lexer, OPERATORS } from "../../../assets/js/turtling/mafs/lexer.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const ev = (expr) => new Evaluator().run(new Parser().parse(expr), {})

describe("mod and // operators", () => {
    test("7 mod 3 is the remainder; 7 // 3 is integer division", () => {
        assert.equal(ev("7 mod 3"), 1)
        assert.equal(ev("7 // 3"), 2)
    })

    test("mod is a ring operator — never negative for a positive divisor", () => {
        assert.equal(ev("-7 mod 3"), 2)
        assert.equal(ev("-1 mod 4"), 3)
    })

    test("// floors toward minus infinity", () => {
        assert.equal(ev("-7 // 3"), -3)
        assert.equal(ev("7 // -3"), -3)
    })

    test("the division identity holds for every sign combination", () => {
        for (const a of [7, -7, 0, 15]) {
            for (const b of [3, -3, 4]) {
                assert.equal(ev(`${a} // ${b} * ${b} + ${a} mod ${b}`), a, `${a}, ${b}`)
            }
        }
    })

    test("precedence: mod/… bind tighter than +, and share * / level (left-assoc)", () => {
        assert.equal(ev("1 + 7 mod 3"), 2)      // 1 + (7 mod 3)
        assert.equal(ev("2 * 7 mod 3"), 2)      // (2 * 7) mod 3
        assert.equal(ev("2 ^ 3 mod 3"), 2)      // (2 ^ 3) mod 3
    })
})

describe("mod is a word-operator the whole grammar agrees on", () => {
    test("the math lexer types `mod` as an OPERATOR, not an identifier", () => {
        const toks = new Lexer().tokenize("7 mod 3")
        assert.deepEqual(toks.map((t) => t.type), ["NUMBER", "OPERATOR", "NUMBER"])
        assert.equal(toks[1].value, "mod")
    })

    test("no spaces needed when a digit follows — 7mod3 is 7 mod 3", () => {
        const toks = new Lexer().tokenize("7mod3")
        assert.deepEqual(toks.map((t) => t.type), ["NUMBER", "OPERATOR", "NUMBER"])
        assert.equal(toks[1].value, "mod")
        assert.equal(ev("7mod3"), 1)
    })

    test("a longer identifier is untouched (model, mode, mod_x stay names)", () => {
        for (const word of ["model", "mode", "mod_x"]) {
            assert.equal(new Lexer().tokenize(word)[0].type, "IDENTIFIER", word)
        }
    })

    test("the separator vocabulary carries mod, so the PaperLang splitter joins it", () => {
        assert.ok(OPERATORS.includes("mod"))
    })
})
