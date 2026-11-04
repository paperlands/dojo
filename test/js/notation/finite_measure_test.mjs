// The three doors at a movement measure — the answer is by what the value IS.
// (ruling: absent-is-zero)
//   ABSENT     — no answer at all: the callable's own default, which is the identity.
//   NON-FINITE — arithmetic ran out of road: the step is NOT TAKEN, quietly.
//   NOT A NUMBER — a word where a measure belongs: reported where it is located.
// A refusal drops the ONE statement, never the figure. (D020)
// Run: node --test test/js/notation/finite_measure_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { ASTNode } from "../../../assets/js/turtling/ast.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { severityOf } from "../../../assets/js/weave/queries.js"

const call = (name, ...args) =>
    new ASTNode("Call", name, args.map((a) => new ASTNode("Argument", String(a))))
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const paths = (events) => events.filter((e) => e.type === "path")

describe("movement measures — three doors, one figure", () => {
    test("an absent measure takes the identity, so something still renders", () => {
        const events = drainEvents([call("fw"), call("fw", 5)], deps())
        assert.equal(paths(events).length, 1, "the bare step did not stop the walk")
        assert.deepEqual(paths(events)[0].points.at(-1), [5, 0, 0])
        assert.ok(!events.some((e) => e.type === "notice"), "nothing is not the author's mistake")
    })

    test("a non-finite measure is not a step: the walk is shorter, not broken", () => {
        const events = drainEvents(
            [call("fw", "sqrt(-1)"), call("fw", "1/0"), call("fw", 3)], deps())
        // The step is not taken AND the author is told: a silence nobody can act on is the
        // defect the notice exists to remove. (numerics: POLICY.walk)
        const told = events.filter((e) => e.type === "notice")
        assert.equal(told.length, 2, "one per refused step, each located")
        assert.deepEqual(told.map((n) => n.kind), ["nan", "infinite"])
        // A notice carries no severity of its own: the kind's severity is ONE home
        // (weave/queries.js). A non-answer is a warning — the figure still draws.
        assert.deepEqual(told.map(severityOf), ["warning", "warning"])
        assert.ok(told.every((n) => /No measure/.test(n.message)))
        assert.deepEqual(paths(events)[0].points.at(-1), [3, 0, 0])
        assert.ok(paths(events).every((p) => p.points.every((pt) => pt.every(Number.isFinite))),
            "no non-finite coordinate entered the ink")
    })

    test("a word where a measure belongs is reported, and the siblings still run", () => {
        const events = drainEvents([call("fw", "'oops'"), call("fw", 3)], deps())
        const told = events.find((e) => e.type === "notice")
        assert.equal(told.kind, "not-a-number")
        assert.match(told.message, /No measure/)
        assert.deepEqual(paths(events)[0].points.at(-1), [3, 0, 0], "the sibling still ran")
    })

    test("a program whose input cannot answer still draws, and its budget stops it", () => {
        // The reported shape: `rt 360/n` with the first call's `n` = 0. The step is not
        // taken, the five forward steps still draw, and the DEPTH BUDGET — not a number —
        // is what ends the runaway recursion. A program fact, not a number fact.
        const src = "def spiral n do\n loop 5 do\n fw 100\n rt 360/n\n end\n spiral n+1\nend\nspiral\n"
        const events = drainEvents(parseProgram(src), deps(), { maxCommands: 200, maxRecurseDepth: 3 })
        assert.ok(paths(events).length > 0, "something rendered")
        // 360/n at n = 0 is Infinity: the steps are not taken, and each one says so.
        assert.ok(events.some((e) => e.type === "notice" && e.kind === "infinite"),
            "the arithmetic ran out of road, and the author hears it")
        assert.ok(paths(events).every((p) => p.points.every((pt) => pt.every(Number.isFinite))))
    })
})
