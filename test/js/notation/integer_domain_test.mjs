// Phase 1 witness — the integer domain: `//` and `mod` hold their identity,
// including the measured safe-integer boundary. Run:
//   node --test test/js/notation/integer_domain_test.mjs
//
// a = (a // b) * b + mod(a, b)  holds across the STATED domain: safe integers whose
// intermediates (notably b * (a // b)) stay safe. Outside it, the reconstruction's
// `+` is corrupted by the scalar rounding policy — a Phase-3 concern, not this one.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const ev = (s) => new Evaluator().run(new Parser().parse(s), {})

describe("integer division and remainder", () => {
    test("the measured boundary case no longer overflows", () => {
        assert.equal(ev("mod(9007199254740990, 9007199254740991)"), 9007199254740990)
    })

    test("the remainder follows the divisor (a ring remainder)", () => {
        assert.equal(ev("mod(-7, 3)"), 2)
        assert.equal(ev("mod(7, -3)"), -2)
        assert.equal(ev("mod(-1, 4)"), 3)
        assert.equal(ev("mod(7, 4)"), 3)
    })

    test("division floors toward minus infinity", () => {
        assert.equal(ev("7 // 3"), 2)
        assert.equal(ev("-7 // 3"), -3)
        assert.equal(ev("7 // -3"), -3)
    })

    test("the identity holds across the safe domain", () => {
        for (const a of [-5000, -1000, -7, -1, 0, 1, 7, 999, 5000]) {
            for (const b of [-9, -3, 4, 7]) {
                assert.equal(ev(`(${a} // ${b}) * ${b} + mod(${a}, ${b})`), a, `${a} // ${b}`)
            }
        }
    })

    test("the identity holds at the boundary pair (zero quotient)", () => {
        assert.equal(ev("9007199254740990 // 9007199254740991 * 9007199254740991 + mod(9007199254740990, 9007199254740991)"), 9007199254740990)
    })

    // An oracle OUTSIDE our arithmetic: BigInt is exact, so quotient and remainder
    // are checked independently rather than through a reconstruction that could
    // share a mistake with the operation under test.
    test("quotient and remainder match an exact BigInt oracle across the boundary", () => {
        const floorDiv = (a, b) => {
            const A = BigInt(a), B = BigInt(b)
            let q = A / B
            if (A % B !== 0n && (A < 0n) !== (B < 0n)) q -= 1n
            return Number(q)
        }
        const floorMod = (a, b) => {
            const A = BigInt(a), B = BigInt(b)
            let m = A % B
            if (m !== 0n && (m < 0n) !== (B < 0n)) m += B
            return Number(m)
        }
        const values = [0, 1, -1, 7, -7, 4503599627370495, 9007199254740990, 9007199254740991, -9007199254740990, -9007199254740991]
        const divisors = [1, -1, 2, -2, 3, -3, 7, -7, 9007199254740991, -9007199254740991]
        for (const a of values) {
            for (const b of divisors) {
                assert.equal(ev(`${a} // ${b}`), floorDiv(a, b), `${a} // ${b}`)
                assert.equal(ev(`mod(${a}, ${b})`), floorMod(a, b), `mod(${a}, ${b})`)
            }
        }
    })
})
