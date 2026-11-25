// round() builtin — run with: node --test test/js/execute/round_test.mjs
//
// round(x)        → nearest integer (the 2nd argument defaults to 1)
// round(x, step)  → nearest multiple of step
// Half-away cases follow Math.round: ties go toward +Infinity.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { format } from "../../../assets/js/turtling/numerics.js"

const ev = (expr) => new Evaluator().run(new Parser().parse(expr), {})

describe("round builtin", () => {
    test("one argument rounds to the nearest integer", () => {
        assert.equal(ev("round(3.14159)"), 3)
        assert.equal(ev("round(2.5)"), 3)
        assert.equal(ev("round(-2.5)"), -2)
    })

    test("two arguments round to the nearest multiple of the step", () => {
        assert.equal(ev("round(27, 5)"), 25)
        assert.equal(ev("round(490, 100)"), 500)
        assert.equal(ev("round(2.3, 0.5)"), 2.5)
    })

    test("round snaps when asked, and the display is what cleans the residue", () => {
        // `round` is the intentional snapping, not a way to make a number pretty: the
        // step is a multiple of the substrate's own 0.1.
        assert.ok(Math.abs(ev("round(0.3, 0.1)") - 0.3) < 1e-15)
        // What a learner READS is 0.3, and reading it changes nothing. (numerics:format)
        assert.equal(format(ev("round(0.3, 0.1)")), "0.3")
        assert.equal(format(ev("0.1 + 0.2")), "0.3")
    })

    test("composes with other builtins and expressions", () => {
        assert.equal(ev("round(1 + 2, 2)"), 4)
        assert.equal(ev("round(sqrt(2), 2)"), 2)
    })

    test("arity is validated — a third argument is rejected at parse", () => {
        assert.throws(() => ev("round(1, 2, 3)"), /Unknown function: round with 3 arguments/)
    })
})
