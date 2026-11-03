// A NaN comparison is not a finite 1/0. The existing demand door recovers it.
// Infinity comparisons are unchanged: that policy is not ruled here.
// Run: node --test test/js/notation/numeric_fault_test.mjs
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
        notices: events.filter((e) => e.type === "notice").map((e) => e.message),
        head: events.filter((e) => e.type === "head").at(-1)?.position ?? null,
        labels: events.filter((e) => e.type === "label").map((e) => e.text),
    }
}

test("a NaN comparison is NaN, and a finite comparison is unchanged", () => {
    for (const source of ["0/0 == 0/0", "0/0 != 0/0", "0/0 < 1", "0/0 <= 1", "0/0 > 1", "0/0 >= 1",
        "0/0 === 0/0", "0/0 !== 0/0", "sqrt(-1) < 0"]) {
        assert.ok(Number.isNaN(ev(source)), source)
    }
    assert.equal(ev("1 == 1"), 1)
    assert.equal(ev("1 == 2"), 0)
    assert.equal(ev("1 < 2"), 1)
    assert.equal(new Evaluator().tower.apply("==", true, 1), 1)
    assert.equal(ev("'a' < 'b'"), 1)
    assert.equal(ev("[1,2] < [1,3]"), 1)
    assert.equal(ev("[3,0] <= [0,3]"), 1)
})

test("infinity comparisons stay as they are — not a ruling", () => {
    assert.equal(ev("1/0 == 1/0"), 1)
    assert.equal(ev("1/0 > 1"), 1)
    assert.equal(ev("1/0 < 1"), 0)
    assert.equal(ev("0^0"), 1)
})

test("a compared NaN does not take a branch, and the prefix continues", () => {
    for (const source of [
        "when (0/0) do\n fw 2\nend\nfw 3",
        "when (0/0 != 0/0) do\n fw 2\nend\nfw 3",
        "when (0/0 < 1) do\n fw 2\nend\nfw 3",
        "when (0/0 >= 1) do\n fw 2\nend\nfw 3",
    ]) {
        const run = walk(source)
        assert.equal(run.parseErrors, 0, source)
        assert.equal(run.notices.length, 1, source)
        assert.deepEqual(run.head, [3, 0, 0], source)
    }
    const taken = walk("when (1 < 2) do\n fw 2\nend\nfw 3")
    assert.equal(taken.notices.length, 0)
    assert.deepEqual(taken.head, [5, 0, 0])
})

test("a label of a NaN comparison notices, and a direct non-finite still does", () => {
    const compared = walk("label (0/0 != 0/0)")
    assert.equal(compared.notices.length, 1)
    assert.equal(compared.labels[0], "not a number")
    const direct = walk("label 0/0")
    assert.equal(direct.notices.length, 1)
    const infinite = walk("when (1/0 == 1/0) do\n fw 2\nend\nfw 3")
    assert.equal(infinite.notices.length, 0)
    assert.deepEqual(infinite.head, [5, 0, 0])
})

test("a NaN operand is preserved by bitwise, power and tested-left selection", () => {
    for (const source of ["(0/0) & 1", "(0/0) | 1", "(0/0) ^ 0", "1 ^ (0/0)", "(0/0) || 1"]) {
        assert.ok(Number.isNaN(ev(source)), source)
    }
    // A finite operand selected without testing the bad value is not a laundering.
    assert.equal(ev("0 && (0/0)"), 0)
    assert.equal(ev("1 || (0/0)"), 1)
    // Infinity is not this rule; it remains unruled.
    assert.equal(ev("1/0 == 1/0"), 1)
    assert.equal(ev("1/0 & 1"), 0)
    assert.equal(ev("(1/0) ^ 0"), 1)
})

test("a vector label names and notices a non-finite component", () => {
    const nan = walk("label [0/0]")
    assert.equal(nan.notices.length, 1)
    assert.equal(nan.labels[0], "[not a number,]")
    const infinite = walk("label [1/0, 1]")
    assert.equal(infinite.notices.length, 1)
    assert.equal(infinite.labels[0], "[infinity, 1]")
    const finite = walk("label [1, 2]")
    assert.equal(finite.notices.length, 0)
    assert.equal(finite.labels[0], "[1, 2]")
})
