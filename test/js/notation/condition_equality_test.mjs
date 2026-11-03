// A boolean may decide a branch. Vector equality is the coordinates, not the length.
// Run: node --test test/js/notation/condition_equality_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { asKind, DomainRefusal, TowerRefusal } from "../../../assets/js/turtling/mafs/tower.js"
import { demand } from "../../../assets/js/turtling/numerics.js"
import { parseProgram, collectErrors } from "../../../assets/js/turtling/parse.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"

const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const apply = (op, a, b) => new Evaluator().tower.apply(op, a, b)
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const walk = (source) => {
    const ast = parseProgram(source)
    const events = drainEvents(ast, deps())
    return {
        parseErrors: collectErrors(ast).length,
        notices: events.filter((e) => e.type === "notice"),
        head: events.filter((e) => e.type === "head").at(-1)?.position ?? null,
    }
}
const domain = (fn) => assert.throws(fn, (e) => e instanceof DomainRefusal)
const missing = (fn) => assert.throws(fn, (e) => e instanceof TowerRefusal)
const GLYPHS = ["==", "!=", "===", "!=="]

test("a boolean decides a branch and is not a notice", () => {
    const yes = walk("when !0 do\n fw 2\nend\nfw 3")
    assert.equal(yes.parseErrors, 0)
    assert.equal(yes.notices.length, 0)
    assert.deepEqual(yes.head, [5, 0, 0])
    const no = walk("when !1 do\n fw 2\nend\nfw 3")
    assert.equal(no.notices.length, 0)
    assert.deepEqual(no.head, [3, 0, 0])
    assert.deepEqual(walk("when 1 do\n fw 2\nend\nfw 3").head, [5, 0, 0])
    assert.deepEqual(walk("when 2 do\n fw 2\nend\nfw 3").head, [5, 0, 0])
    assert.deepEqual(walk("when 0 do\n fw 2\nend\nfw 3").head, [3, 0, 0])
    assert.equal(demand(true, { as: "condition" }).value, 1)
    assert.equal(demand(false, { as: "condition" }).notice, null)
    assert.equal(demand(true, { as: "condition" }).condition, "finite")
    assert.equal(demand(false, { as: "condition" }).condition, "finite")
    assert.equal(demand(false, { as: "condition" }).value, 0)
})

test("boolean admission is the condition door only", () => {
    for (const as of ["walk", "count", "vocabulary", "construction"]) {
        const asked = demand(true, { as })
        assert.equal(asked.verdict, "refuse", as)
        assert.notEqual(asked.condition, "finite", as)
    }
    assert.equal(demand(true, { as: "display" }).verdict, "take")
    const nan = walk("when (0/0) do\n fw 2\nend\nfw 3")
    assert.equal(nan.notices.length, 1)
    assert.deepEqual(nan.head, [3, 0, 0])
    const vector = walk("when [1,2] do\n fw 2\nend\nfw 3")
    assert.equal(vector.notices.length, 1)
    assert.deepEqual(vector.head, [3, 0, 0])
    assert.equal(demand("a", { as: "condition" }).verdict, "refuse")
})

test("a NaN survives !, so the branch is refused, not taken", () => {
    for (const source of ["when !(0/0) do\n fw 2\nend\nfw 3", "when !(0/0 < 1) do\n fw 2\nend\nfw 3"]) {
        const run = walk(source)
        assert.equal(run.notices.length, 1, source)
        assert.deepEqual(run.head, [3, 0, 0], source)
    }
    assert.equal(ev("!0"), true)
    assert.equal(ev("!1"), false)
    assert.equal(ev("!'a'"), false)
})

test("infinity is truthy, so ! is a finite false", () => {
    assert.equal(ev("!(1/0)"), false)
    assert.equal(ev("!(-1/0)"), false)
    const run = walk("when !(1/0) do\n fw 2\nend\nfw 3")
    assert.equal(run.notices.length, 0)
    assert.deepEqual(run.head, [3, 0, 0])
})

test("vector equality is the coordinates, and a length tie is not identity", () => {
    assert.equal(ev("[1,2] == [1,2]"), 1)
    assert.equal(ev("[1,2] != [1,2]"), 0)
    assert.equal(ev("[1,2] === [1,2]"), 1)
    assert.equal(ev("[1,2] !== [1,2]"), 0)
    assert.equal(ev("[3,0] == [0,3]"), 0)
    assert.equal(ev("[3,0] != [0,3]"), 1)
    assert.equal(ev("[3,0] <= [0,3]"), 1)
    assert.equal(ev("[0.1+0.2] == [0.3]"), 0)
    assert.equal(ev("[-0,0] == [0,-0]"), 1)
    assert.equal(ev("[1,2] == [1]"), 0)
    assert.equal(ev("[1,2] != [1]"), 1)
    assert.equal(ev("[1] === [1,2]"), 0)
    assert.equal(ev("[1] !== [1,2]"), 1)
    const taken = walk("when ([1,2] == [1,2]) do\n fw 2\nend\nfw 3")
    assert.equal(taken.notices.length, 0)
    assert.deepEqual(taken.head, [5, 0, 0])
    const different = walk("when ([3,0] == [0,3]) do\n fw 2\nend\nfw 3")
    assert.equal(different.notices.length, 0)
    assert.deepEqual(different.head, [3, 0, 0])
})

test("invalid vectors refuse before an answer, on every equality glyph", () => {
    const bad = [[], [1,, 0], [[1], 0], ["3", 0], [null, 0], [true, 0], [NaN, 0], [Infinity, 0]]
    for (const op of GLYPHS) {
        for (const left of bad) domain(() => apply(op, left, [0, 0]))
        missing(() => apply(op, asKind([1, 0], "point"), [1, 0]))
        domain(() => apply(op, [10, NaN], [20, 0]))
        domain(() => apply(op, [1], [1, NaN]))
    }
    missing(() => ev("(1,0) == (1,0)"))
    missing(() => ev("[1,0] == (1,0)"))
})

test("a component is read once, and a later invalid write is not a cached answer", () => {
    let reads = 0
    const a = [1, 0]
    Object.defineProperty(a, 0, { get() { reads++; return 1 } })
    assert.equal(apply("==", a, [1, 0]), 1)
    assert.equal(reads, 1)
    const live = [1, 2]
    assert.equal(apply("==", live, [1, 2]), 1)
    live[1] = "0"
    domain(() => apply("==", live, [1, 2]))
})
