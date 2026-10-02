// mod / // — run with: node --test test/js/execute/mod_division_test.mjs
//
// mod(a, b): the remainder of floor division — the center's one arithmetic meaning,
//      the partner of `//`, not JavaScript's `%`. Its sign follows the divisor,
//      so it is never negative for a positive divisor.
// // : integer division, flooring toward minus infinity — `7 // 3` = 2.
// They satisfy the identity  (a // b) * b + mod(a, b) = a  for every nonzero b.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { SCALAR_BUILTINS } from "../../../assets/js/turtling/mafs/tower.js"

const ev = (expr) => new Evaluator().run(new Parser().parse(expr), {})

describe("mod(a, b) and //", () => {
    test("mod(7, 3) is the remainder; 7 // 3 is integer division", () => {
        assert.equal(ev("mod(7, 3)"), 1)
        assert.equal(ev("7 // 3"), 2)
    })

    test("mod follows the divisor (a ring remainder, not JavaScript's %)", () => {
        assert.equal(ev("mod(-7, 3)"), 2)
        assert.equal(ev("mod(7, -3)"), -2)
        assert.equal(ev("mod(-1, 4)"), 3)
        assert.equal(ev("mod(7, 4)"), 3)
    })

    test("// floors toward minus infinity", () => {
        assert.equal(ev("-7 // 3"), -3)
        assert.equal(ev("7 // -3"), -3)
    })

    test("the division identity holds for every sign combination", () => {
        for (const a of [7, -7, 0, 15]) {
            for (const b of [3, -3, 4]) {
                assert.equal(ev(`(${a} // ${b}) * ${b} + mod(${a}, ${b})`), a, `${a}, ${b}`)
            }
        }
    })

    test("mod is the center's builtin, not an operator with its own meaning", () => {
        const mod = SCALAR_BUILTINS.find((b) => b.name === "mod")
        assert.ok(mod, "the center owns mod")
        assert.equal(mod.arity, 2)
    })
})
