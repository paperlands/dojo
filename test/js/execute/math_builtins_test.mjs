// atan2 builtin + floor/ceil authorability — run with:
//   node --test test/js/execute/math_builtins_test.mjs
//
// atan2(y, x) → the angle of the vector (x, y), in degrees (matching asin/acos/atan).
// floor/ceil are NOT builtins: the child may author them like any other fn.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const ev = (expr) => new Evaluator().run(new Parser().parse(expr), {})

describe("atan2 builtin", () => {
    test("returns the direction in degrees, cardinals exact", () => {
        assert.equal(ev("atan2(0, 1)"), 0)
        assert.equal(ev("atan2(1, 1)"), 45)
        assert.equal(ev("atan2(1, 0)"), 90)
        assert.equal(ev("atan2(0, -1)"), 180)
        assert.equal(ev("atan2(-1, 0)"), -90)
    })

    test("agrees with atan in the first quadrant (both degrees)", () => {
        assert.ok(Math.abs(ev("atan2(1, 2)") - ev("atan(1/2)")) < 1e-12)
    })

    test("composes with expressions", () => {
        assert.ok(Math.abs(ev("atan2(3, 4)") - 36.86989764584402) < 1e-12)
    })

    test("arity is validated — one or three args rejected at parse", () => {
        assert.throws(() => ev("atan2(1)"), /Unknown function: atan2 with 1 arguments/)
        assert.throws(() => ev("atan2(1, 2, 3)"), /Unknown function: atan2 with 3 arguments/)
    })
})

describe("floor and ceil are authorable (not reserved)", () => {
    test("a child may define floor; the evaluator uses it", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("floor(x)", "round(x - 0.5, 1)", {})
        evaluator.userFunctions = parser.userspace

        assert.equal(evaluator.run(parser.parse("floor(2.9)"), {}), 2)
        assert.equal(evaluator.run(parser.parse("floor(-2.1)"), {}), -3)
    })

    test("ceil is authorable too", () => {
        const parser = new Parser()
        parser.defineFunction("floor(x)", "round(x - 0.5, 1)", {})
        assert.doesNotThrow(() => parser.defineFunction("ceil(x)", "0 - floor(0 - x)", {}))
    })

    test("a true builtin stays reserved", () => {
        const parser = new Parser()
        assert.throws(
            () => parser.defineFunction("round(x)", "x", {}),
            /Cannot override built-in function round/,
        )
    })
})
