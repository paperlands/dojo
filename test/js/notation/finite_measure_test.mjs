// Phase 1 witness — finite movement measures: a non-finite number is never a
// measure, so it must wound at the demand rather than enter geometry.
// Run: node --test test/js/notation/finite_measure_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { ASTNode } from "../../../assets/js/turtling/ast.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const call = (name, ...args) =>
    new ASTNode("Call", name, args.map((a) => new ASTNode("Argument", String(a))))
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

describe("finite movement measures", () => {
    test("fw sqrt(-1) wounds instead of drawing a NaN coordinate", () => {
        assert.throws(() => drainEvents([call("fw", "sqrt(-1)")], deps()), /not a finite number/)
    })

    test("fw 1/0 wounds instead of drawing an infinite coordinate", () => {
        assert.throws(() => drainEvents([call("fw", "1/0")], deps()), /not a finite number/)
    })

    test("a finite walk still walks", () => {
        const events = drainEvents([call("fw", "3")], deps())
        assert.ok(events.length > 0, "fw 3 produced no events")
    })
})
