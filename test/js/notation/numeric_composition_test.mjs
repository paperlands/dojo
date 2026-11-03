// Compositional consequences of D065/D066: a finite result may execute from an
// infinite operand, a bare infinity is still not a measure, and NaN stays a
// non-answer. Run: node --test test/js/notation/numeric_composition_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram, collectErrors } from "../../../assets/js/turtling/parse.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"

const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const walk = (source) => {
    const ast = parseProgram(source)
    const events = drainEvents(ast, deps())
    return {
        parseErrors: collectErrors(ast).length,
        notices: events.filter((e) => e.type === "notice"),
        head: events.filter((e) => e.type === "head").at(-1)?.position ?? null,
        labels: events.filter((e) => e.type === "label").map((e) => e.text),
    }
}
const isNaN = (x) => Number.isNaN(x)

test("truth: infinity is false under !; NaN is still a non-answer", () => {
    assert.equal(ev("!(1/0)"), false)
    assert.equal(ev("!(-1/0)"), false)
    assert.ok(isNaN(ev("!(0/0)")))
    const infinite = walk("when !(1/0) do\n fw 2\nend\nfw 3")
    assert.equal(infinite.parseErrors, 0)
    assert.equal(infinite.notices.length, 0)
    assert.deepEqual(infinite.head, [3, 0, 0])
    const nan = walk("when !(0/0) do\n fw 2\nend\nfw 3")
    assert.equal(nan.notices.length, 1)
    assert.deepEqual(nan.head, [3, 0, 0])
})

test("selection: a tested infinity is truthy; a tested NaN is a non-answer", () => {
    assert.equal(ev("(1/0) && 1"), 1)
    assert.equal(ev("(1/0) || 1"), Infinity)
    assert.ok(isNaN(ev("(0/0) || 1")))
    assert.equal(ev("1 || (0/0)"), 1)
    assert.equal(ev("0 && (0/0)"), 0)
    assert.ok(isNaN(ev("1 && (0/0)")))
    const selected = walk("when ((1/0) && 1) do\n fw 2\nend\nfw 3")
    assert.equal(selected.notices.length, 0)
    assert.deepEqual(selected.head, [5, 0, 0])
    const nonAnswer = walk("when ((0/0) || 1) do\n fw 2\nend\nfw 3")
    assert.equal(nonAnswer.notices.length, 1)
    assert.deepEqual(nonAnswer.head, [3, 0, 0])
})

test("admission: a finite result from infinity may execute; provenance is not tracked", () => {
    const finite = [
        ["1/(1/0)", 0],
        ["atan2(1/0, 1)", 90],
        ["(1/0) & 1", 0],
        ["(1/0) ^ 0", 1],
    ]
    for (const [source, expected] of finite) {
        assert.equal(ev(source), expected, source)
        const run = walk(`when ((${source}) == ${expected}) do\n fw 2\nend\nfw 3`)
        assert.equal(run.notices.length, 0, source)
        assert.deepEqual(run.head, [5, 0, 0], source)
    }
})

test("indeterminate: infinity still has undefined operations", () => {
    for (const source of ["(1/0) - (1/0)", "0 * (1/0)", "(1/0) / (1/0)", "mod(1/0, 4)"]) {
        assert.ok(isNaN(ev(source)), source)
        const run = walk(`when (${source}) do\n fw 2\nend\nfw 3`)
        assert.equal(run.notices.length, 1, source)
        assert.deepEqual(run.head, [3, 0, 0], source)
    }
})

test("display: false is a finite answer; a NaN still speaks", () => {
    const falseLabel = walk("label !(1/0)")
    assert.equal(falseLabel.notices.length, 0)
    assert.equal(falseLabel.labels[0], "false")
    const nanLabel = walk("label !(0/0)")
    assert.equal(nanLabel.notices.length, 1)
    assert.equal(nanLabel.labels[0], "not a number")
})
