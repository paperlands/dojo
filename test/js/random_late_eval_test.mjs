// Late-evaluation of `random` in fn bodies — run with:
//   node --test test/js/random_late_eval_test.mjs
//
// Regression guard for the scmutils-style numerical-tower distinction:
// `random` is a DEFERRED constant — it must re-sample at each point of use, never be
// folded into an fn body at definition time. Contextual snapshots (count, x, y, z, time)
// stay frozen at definition time.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { drainEvents } from "../../assets/js/turtling/executor.js"
import { ASTNode } from "../../assets/js/turtling/ast.js"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"

// AST helpers (mirror executor_test.mjs)
const call = (name, ...args) =>
    new ASTNode('Call', name, args.map(a => new ASTNode('Argument', String(a))))
const loop = (n, body) => new ASTNode('Loop', String(n), body)

function realDeps() {
    return { mathParser: new Parser(), mathEvaluator: new Evaluator() }
}

// Evaluate a 0-arity user constant by name through the real parse→run pipeline.
const draw = (deps, name) =>
    deps.mathEvaluator.run(deps.mathParser.parse(name), {})

describe("deferred constants (numerical tower)", () => {
    test("`random` re-samples per leaf — fn normal yields a real distribution, not ~0", () => {
        const deps = realDeps()
        const ast = [
            call("fn", "normal",
                "random+random+random+random+random+random+random+random-8*random")
        ]
        // Define `normal` (drains the fn definition; links userspace + constants).
        drainEvents(ast, deps)

        const N = 2000
        const samples = []
        for (let i = 0; i < N; i++) samples.push(draw(deps, "normal"))

        const mean = samples.reduce((a, b) => a + b, 0) / N
        const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / N
        const distinct = new Set(samples.map(s => s.toFixed(6))).size

        // The bug froze all 8 leaves to one draw → 8r - 8r = 0 (zero variance, 1 value).
        assert.ok(variance > 1, `expected non-zero variance (~6), got ${variance}`)
        assert.ok(Math.abs(mean) < 0.5, `expected mean near 0, got ${mean}`)
        assert.ok(distinct > N / 2, `expected many distinct draws, got ${distinct}`)
    })

    test("snapshot constants (count) stay frozen at definition time", () => {
        const deps = realDeps()
        // Inside a loop, define `frozen = count` on the last iteration (count = 2),
        // then read it back. It must hold the definition-time value, not re-evaluate.
        const ast = [
            loop(3, [call("fn", "frozen", "count")])
        ]
        drainEvents(ast, deps)

        // count was 2 at the final definition; freezing means every read returns 2.
        assert.equal(draw(deps, "frozen"), 2)
    })
})
