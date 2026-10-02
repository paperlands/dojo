// TODO 4.1 witness — the common vector value and the KIND it carries.
// (id:notation-vector-value, id:notation-coordinate-vector)
// Run: node --test test/js/notation/vector_value_test.mjs
//
// Independent expectations: every answer below is the mathematical one, written
// down without reading the registrations under test. The alternate-coefficient
// witness proves the components reach the center; the kind witness proves a value
// carries what it IS — a point or a vector — so a declaration reads the value.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import {
    createTower,
    installVectorFloor,
    DomainRefusal,
    TowerRefusal,
} from "../../../assets/js/turtling/mafs/tower.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { format } from "../../../assets/js/turtling/numerics.js"

const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

describe("the vector literal — a bracket constructs", () => {
    test("a bracket constructs; a paren groups; a suffix bracket still calls", () => {
        assert.deepEqual(ev("[1,2,3]"), [1, 2, 3])
        assert.deepEqual(ev("[1, 2]"), [1, 2])
        assert.deepEqual(ev("[1]"), [1])            // singleton, by the bracket
        assert.deepEqual(ev("[1+2, 4]"), [3, 4])
        assert.deepEqual(ev("[2 * 0.5]"), [1])
        assert.deepEqual(ev("2*[3]"), [6])          // construct, then scale
        assert.equal(ev("(2)"), 2)                  // a paren groups
        assert.equal(ev("mod((3 + 1), 4)"), 0)
        assert.equal(ev("sin[30]"), ev("sin(30)"))  // suffix application, untouched
    })

    test("nesting is structural; an empty literal is a named refusal", () => {
        assert.deepEqual(ev("[[1,2],[3,4]]"), [[1, 2], [3, 4]])
        assert.throws(() => ev("[]"), /empty vector literal/)
        assert.deepEqual(ev("[1,2,]"), [1, 2])   // a terminal comma is a separator
    })
})

describe("scaling and addition — ordered pairs through the one door", () => {
    test("a number scales a vector on either side, spelled three ways", () => {
        assert.deepEqual(ev("2*[1,2,3]"), [2, 4, 6])
        assert.deepEqual(ev("[1,2,3]*2"), [2, 4, 6])
        assert.deepEqual(ev("2[1,2,3]"), [2, 4, 6])   // implicit multiplication
    })

    test("two vectors add pointwise, and compose", () => {
        assert.deepEqual(ev("[1,2,3]+[4,5,6]"), [5, 7, 9])
        assert.deepEqual(ev("2*[1,2]+[0,1]"), [2, 5])
    })

    test("shape domains refuse structurally, missing meanings honestly", () => {
        assert.throws(() => ev("[1,2]+[1,2,3]"),
            (e) => e instanceof DomainRefusal && /equal lengths/.test(e.message))
        assert.throws(() => ev("2*[[1,2],[3,4]]"),
            (e) => e instanceof DomainRefusal && /rank-one/.test(e.message))
        // A pair with no registered meaning names its kinds; it is not a domain answer.
        assert.throws(() => ev("2+[1,2]"),
            (e) => e instanceof TowerRefusal && !(e instanceof DomainRefusal)
                && e.types.join(":") === "number:vector")
    })
})

describe("the floor is generic — an alternate coefficient kind answers itself", () => {
    test("component addition re-enters the center, never JavaScript", () => {
        class Coeff {
            constructor(expr) { this.expr = expr }
            [Symbol.toPrimitive]() { throw new Error(`raw JavaScript coercion of ${this.expr}`) }
        }
        const tower = installVectorFloor(createTower())
        tower.kind("coefficient", (v) => v instanceof Coeff)
        tower.define("+", ["coefficient", "coefficient"], (a, b) => new Coeff(`${a.expr} + ${b.expr}`))

        const sum = tower.apply("+",
            [new Coeff("x"), new Coeff("y")],
            [new Coeff("u"), new Coeff("v")])
        assert.deepEqual(sum.map((c) => c.expr), ["x + u", "y + v"])
    })
})

describe("the kind rides the value", () => {
    test("a computed vector is read by its kind: an OBJECT and a VALUE", () => {
        // `2*[1,2,3]` is a vector, so its declaration is the literal's: a line object
        // and a held displacement — not a place. (id:notation-coordinate-vector)
        const events = drainEvents(parseProgram("let s = 2*[1,2,3]"), deps())
        assert.ok(events.some((e) => e.type === "scalar" && e.vector), "the vector is bound as an object")
        assert.ok(events.some((e) => e.type === "scalar"), "the name holds the displacement")
        assert.ok(!events.some((e) => e.type === "birth"), "no place is born")
    })

    test("the tag is not enumerable: a plain-array reader is untouched", () => {
        const point = ev("(1,2,3)")
        assert.deepEqual(point, [1, 2, 3])
        assert.equal(Object.keys(point).join(","), "0,1,2", "the kind does not enumerate")
    })

    test("a vector survives a function return and a captured call", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("pair", "[1,2]", {})
        parser.defineFunction("held", "v", { v: [3, 4, 0] })
        evaluator.userFunctions = parser.userspace
        assert.deepEqual(evaluator.run(parser.parse("pair"), {}), [1, 2])
        assert.deepEqual(evaluator.run(parser.parse("held"), {}), [3, 4, 0])
    })
})

// The refinement documented under [[id:notation-array-growth]]: the bracket admits the
// singleton, and a scalar consumer adapts without the value joining it.
describe("singleton admission — the bracket, and a narrow scalar consumer", () => {
    test("the bracket makes the singleton; the comma is a separator; empty slots refuse", () => {
        assert.deepEqual(ev("[7]"), [7])         // no comma needed now
        assert.deepEqual(ev("[7,]"), [7])        // a terminal comma is tolerated
        assert.deepEqual(ev("[1,2,]"), [1, 2])
        for (const bad of ["[7,,8]", "[7,,]", "[,]", "[,7]"]) {
            assert.throws(() => ev(bad), /Unexpected token: ,/, bad)
        }
    })

    test("structure survives arithmetic and nesting; a singleton is not unwrapped", () => {
        assert.deepEqual(ev("3*[7,]"), [21])
        assert.deepEqual(ev("[7,]+[1,]"), [8])
        assert.deepEqual(ev("[[7,],]"), [[7]])
        assert.ok(Array.isArray(ev("[7,]")))
    })

    test("a scalar command admits a singleton by its sole component, not its magnitude", () => {
        const points = (src) =>
            drainEvents(parseProgram(src), deps()).find((e) => e.type === "path")?.points ?? null
        // The sole component IS the argument: identical to the plain scalar route.
        assert.deepEqual(points("fw [7,]"), points("fw 7"))
        assert.deepEqual(points("fw [-7,]"), points("fw -7"))   // sign survives; no magnitude
        assert.deepEqual(points("goto [1,] [2,] [3,]"), points("goto 1 2 3"))
        // A longer vector is not a scalar, and is not spread.
        assert.equal(points("fw [7,8]"), null)
        assert.equal(points("goto [1,2,3]"), null)
    })

    test("a malformed vector refuses as the vector — never as an unanswered scalar", () => {
        const withDefs = (defs, src) => {
            const mathParser = new Parser()
            for (const [name, expr, ctx] of defs) mathParser.defineFunction(name, expr, ctx)
            return drainEvents(parseProgram(src), { mathParser, mathEvaluator: new Evaluator() })
        }
        const walk = (events) => events.some((e) => e.type === "path")
        const notice = (events) => events.find((e) => e.kind)?.message ?? ""
        // An absent slot is a HOLE, not a scalar awaiting a default.
        const hole = withDefs([["h", "v", { v: Array(1) }]], "fw h")
        assert.equal(walk(hole), false)
        assert.match(notice(hole), /needs a number/)
        // `[null]` is a present component that is not a number — the same refusal,
        // and the notice names the vector by its structure, not by lossy String.
        const nil = withDefs([["n", "v", { v: [null] }]], "fw n")
        assert.equal(walk(nil), false)
        assert.match(notice(nil), /\[null,\]/, "the refusal names the vector, structurally")
        // Nonfinite, longer and rank-two components all refuse the same way.
        assert.equal(walk(drainEvents(parseProgram("fw [sqrt(-1),]"), deps())), false)
        assert.equal(walk(drainEvents(parseProgram("fw [7,8]"), deps())), false)
        assert.equal(walk(drainEvents(parseProgram("fw [[7,],]"), deps())), false)
        // The well-formed singleton still walks.
        assert.equal(walk(drainEvents(parseProgram("fw [7,]"), deps())), true)
    })

    test("formatting preserves structure — a display, not a serialization", () => {
        assert.equal(format(ev("[7,]")), "[7,]")          // the singleton marker survives
        assert.equal(format(ev("[1,2,3]")), "[1, 2, 3]")
        assert.equal(format(ev("[[7,],]")), "[[7,],]")    // nesting survives
        // A hole stays visible as a hole; an explicit nothing is named.
        assert.equal(format(Array(1)), "[,]")
        assert.equal(format([null]), "[null,]")
        // It is NOT value equality: a word vector prints unquoted, so reading the
        // display back asks a DIFFERENT question — here, a name that means nothing.
        assert.deepEqual(ev("['a',]"), ["a"])
        assert.equal(format(ev("['a',]")), "[a,]")
        assert.throws(() => ev(format(ev("['a',]"))), /Undefined variable/)
    })

    test("a singleton survives a held return", () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        parser.defineFunction("one", "[7,]", {})
        evaluator.userFunctions = parser.userspace
        assert.deepEqual(evaluator.run(parser.parse("one"), {}), [7])
    })
})
