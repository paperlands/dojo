// atan2 builtin + authorable names — run with:
//   node --test test/js/execute/math_builtins_test.mjs
//
// atan2(y, x) → the angle of the vector (x, y), in degrees (matching asin/acos/atan).
// floor/ceil are NOT builtins: the child may author them like any other fn.
// round/mod ARE builtins, but shadowable: a child fn at the same arity owns the name.

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
})

describe("round and mod are shadowable (the child's word wins)", () => {
    test("a child may define round; their fn owns that arity", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("round(x)", "x + 100", {})
        evaluator.userFunctions = parser.userspace

        assert.equal(evaluator.run(parser.parse("round(1)"), {}), 101)
        // the builtin's other arity is still reachable
        assert.equal(evaluator.run(parser.parse("round(27, 5)"), {}), 25)
    })

    test("a child may define mod; the builtin yields", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("mod(a, b)", "a", {})
        evaluator.userFunctions = parser.userspace

        assert.equal(evaluator.run(parser.parse("mod(7, 3)"), {}), 7)
    })

    test("shadowing is per arity — the builtin answers the arities not defined", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("mod(a, b, c)", "c", {})
        evaluator.userFunctions = parser.userspace

        assert.equal(evaluator.run(parser.parse("mod(7, 3)"), {}), 1)     // builtin, arity 2
        assert.equal(evaluator.run(parser.parse("mod(7, 3, 5)"), {}), 5)  // child, arity 3
    })
})

describe("a reserved builtin still refuses to be redefined", () => {
    test("sin and atan2 stay the surface's", () => {
        const parser = new Parser()
        assert.throws(
            () => parser.defineFunction("sin(x)", "x", {}),
            /Cannot override built-in function sin/,
        )
        assert.throws(
            () => parser.defineFunction("atan2(y, x)", "y", {}),
            /Cannot override built-in function atan2/,
        )
    })

    test("the evaluator keeps the center's meaning without a user fn", () => {
        assert.equal(ev("mod(7, 3)"), 1)
        assert.equal(ev("round(2.5)"), 3)
    })
})
