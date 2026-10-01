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
})

describe("2 · explicit admission — supported values, valid state", () => {
    test("a movement hole refuses a non-number", () => {
        assert.throws(() => drainEvents([call("fw", "'oops'")], deps()), /not a finite number/)
    })

    test("a movement hole refuses a non-finite number", () => {
        assert.throws(() => drainEvents([call("fw", "sqrt(-1)")], deps()), /not a finite number/)
        assert.throws(() => drainEvents([call("fw", "1/0")], deps()), /not a finite number/)
    })

    test("a finite step that overflows is rejected; the prior pose stands", () => {
        const fw = COMMANDS.get("fw")
        const rot = { rotateVec: (d) => [d, 0, 0] }
        const first = fw({ transform: { position: [0, 0, 0], rotation: rot }, style: { down: true } }, 1e308)
        assert.deepEqual(first.transform.position, [1e308, 0, 0])
        assert.throws(
            () => fw({ transform: { position: first.transform.position, rotation: rot }, style: { down: true } }, 1e308),
            /non-finite/,
        )
    })

    test("a finite loop that overflows is rejected; the preceding valid walk stands", () => {
        const seen = []
        const gen = execute(parseProgram("loop 2 do\n fw 1e308\nend"), deps(), { color: "#fff" })
        let wounded = null
        try { for (const e of gen) seen.push(e) } catch (e) { wounded = e }
        assert.match(wounded.message, /non-finite/)
        assert.equal(seen.filter((e) => e.type === "path").length, 1, "the valid first step survives")
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
