// Phase 0/1 witness — three primitives, attacked as transformations and boundaries
// rather than isolated examples. Run:
//   node --test test/js/notation/primitives_test.mjs
//
//   1 Faithful representation — a literal is not a reference; source survives.
//   2 Explicit admission      — a consumer accepts supported values; state stays valid.
//   3 Coherent meaning        — every route obeys one lexical / numerical contract.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { execute, drainEvents } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { COMMANDS } from "../../../assets/js/turtling/commands.js"
import { ASTNode } from "../../../assets/js/turtling/ast.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { TowerRefusal } from "../../../assets/js/turtling/mafs/tower.js"

const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const call = (name, ...args) =>
    new ASTNode("Call", name, args.map((a) => new ASTNode("Argument", String(a))))
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

describe("1 · faithful representation — literal versus reference", () => {
    test("a quoted word is a literal; a bare name is a reference", () => {
        assert.equal(ev("'pi'"), "pi")
        assert.equal(ev("pi"), Math.PI)
    })

    test("a recipe whose body is a quoted word keeps the word, not the constant", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("greet", "'pi'", {})
        evaluator.userFunctions = parser.userspace
        assert.equal(evaluator.run(parser.parse("greet"), {}), "pi")
    })

    test("the same word, spelled as a literal and as a name, never collide", () => {
        assert.notEqual(ev("'pi'"), ev("pi"))
    })

    test("the literal survives to the canvas (label reads the word, not the constant)", () => {
        const events = drainEvents(parseProgram("fn greet 'pi'\nlabel greet"), deps())
        const label = events.find((e) => e.type === "label")
        assert.equal(label.text, "pi")
    })

    test("a held value is a literal, not a name: a captured vector survives the call", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("held", "v", { v: [3, 4, 0] })
        evaluator.userFunctions = parser.userspace
        assert.deepEqual(evaluator.run(parser.parse("held"), {}), [3, 4, 0])
    })

    test("a captured number is kept as a number by its node, not by a type test", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("held", "v", { v: 42 })
        evaluator.userFunctions = parser.userspace
        assert.equal(evaluator.run(parser.parse("held"), {}), 42)
    })

    test("a held value is a snapshot: a later write to the source cannot reach it", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        const live = [3, 4, 0]
        parser.defineFunction("held", "v", { v: live })
        live[0] = 99
        assert.deepEqual(evaluator.run(parser.parse("held"), {}), [3, 4, 0],
            "a capture holds the figure it was taken from, not a live pose")
    })

    test("a held word stays text: holding it does not reveal the constant pi", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("held", "v", { v: "pi" })
        evaluator.userFunctions = parser.userspace
        assert.equal(evaluator.run(parser.parse("held"), {}), "pi")
    })

    test("a held value gets only registered meanings; the tower refuses the rest", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("held", "p", { p: [3, 4, 0] })
        evaluator.userFunctions = parser.userspace
        assert.equal(evaluator.run(parser.parse("held"), {}).length, 3, "a value, not text")
        assert.throws(() => evaluator.run(parser.parse("held + 1"), {}), TowerRefusal,
            "no accidental meaning arrives from the substrate")
    })
})

describe("2 · explicit admission — supported values, valid state", () => {
    test("a movement hole reports a non-number where it is, and the walk carries on", () => {
        const events = drainEvents([call("fw", "'oops'"), call("fw", 3)], deps())
        assert.match(events.find((e) => e.type === "notice")?.message ?? "", /No measure/)
        assert.deepEqual(events.filter((e) => e.type === "path").at(-1).points.at(-1), [3, 0, 0])
    })

    test("a movement hole does not take a step with a non-finite number", () => {
        const events = drainEvents([call("fw", "sqrt(-1)"), call("fw", "1/0"), call("fw", 3)], deps())
        assert.deepEqual(events.filter((e) => e.type === "notice").map((n) => n.kind), ["nan", "infinite"])
        assert.deepEqual(events.filter((e) => e.type === "path").at(-1).points.at(-1), [3, 0, 0])
    })

    test("a finite step that overflows is not taken; the prior pose stands", () => {
        const fw = COMMANDS.get("fw")
        const rot = { rotateVec: (d) => [d, 0, 0] }
        const first = fw({ transform: { position: [0, 0, 0], rotation: rot }, style: { down: true } }, 1e308)
        assert.deepEqual(first.transform.position, [1e308, 0, 0])
        assert.throws(() => fw(
            { transform: { position: first.transform.position, rotation: rot }, style: { down: true } }, 1e308),
            error => error.refusal?.condition === "infinite", "the executor can report and drop this statement")
    })

    test("a finite loop that overflows draws what it could, and the walk ends", () => {
        const seen = drainEvents(parseProgram("loop 2 do\n fw 1e308\nend"), deps(), { color: "#fff" })
        const paths = seen.filter((e) => e.type === "path")
        assert.equal(paths.length, 1, "the valid first step survives")
        assert.equal(paths[0].points.length, 2, "the second step is not in the ink")
    })
})

describe("3 · coherent meaning — one contract on every route", () => {
    test("the numeric shortcut and the lexer share one grammar (1. is refused on both)", () => {
        const parser = new Parser()
        assert.equal(parser.isNumeric("1.5"), true)
        assert.equal(parser.isNumeric("1."), false)   // was true through the shortcut alone
        assert.throws(() => parser.parse("1."))
        assert.throws(() => drainEvents([call("fw", "1.")], deps()))
        assert.throws(() => drainEvents([call("fw", "1.+0")], deps()))
    })
})
