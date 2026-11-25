// Numeric constants folded inside recursive functions must stay numeric.
// Run with: node --test test/js/execute/recursive_numeric_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

describe("recursive numeric evaluation", () => {
    test("accepts exponent notation", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        const tree = parser.parse("9.75576923761293e-7")

        assert.equal(parser.isNumeric("9.75576923761293e-7"), true)
        assert.equal(evaluator.run(tree, {}), 9.75576923761293e-7)
    })

    test("does not send folded numbers to ambient name resolution", () => {
        const source = `def gasket depth r do
  fn mul r*0.215
  fw r+mul
  gasket depth-1 mul
end

gasket 3 100`
        const scheduler = createScheduler(metaRoot(), {
            createDeps: realDeps,
            execOpts: { maxRecurseDepth: 20 },
        })

        const child = scheduler.hotSwapChild("gasket", {
            name: "main",
            code: { ast: parseProgram(source), functions: null },
        })

        assert.equal(child.error, null)
        assert.equal(scheduler.errors.length, 0)
    })
})
