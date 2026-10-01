// Phase 2 witness — the command boundary: ONE expression-binding rule, with an
// explicit boundary contract. Run: node --test test/js/notation/boundary_test.mjs
//
// The contract (id:gw-grammar):
//   · whitespace separates command arguments, EXCEPT where an operator binds
//     across the gap — a chunk whose trailing edge ends with an operator, or
//     whose leading edge starts with one;
//   · a group is a single chunk, so a group and a following operator join;
//   · a `+`/`-` glued to a numeric literal is a SIGN (a new argument); a
//     standalone `+`/`-` is a binary operator that binds. This is the one
//     unavoidable choice: it is why `2 +3` differs from `2 + 3`.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const argsOf = (src) => {
    const ast = parseProgram(src)
    const call = ast.find((n) => n && n.type === "Call")
    return call ? call.children.map((c) => c.value) : []
}
const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

describe("1 · spaces around a symbolic operator do not change the value", () => {
    test("2+3, 2 + 3 and 2+ 3 are one argument, all five", () => {
        for (const src of ["fw 2+3", "fw 2 + 3", "fw 2+ 3"]) {
            const args = argsOf(src)
            assert.equal(args.length, 1, `${src} → ${JSON.stringify(args)}`)
            assert.equal(ev(args[0]), 5, src)
        }
    })

    test("a sign glued to a number is a sign — the named exception", () => {
        assert.deepEqual(argsOf("fw 2 +3"), ["2", "+3"])
        assert.deepEqual(argsOf("fw 2 -3"), ["2", "-3"])
    })
})

describe("2 · a group and a following operator join into one argument", () => {
    test("fw (2+3) * 2 is one argument, and reads as the expression (2+3) * 2", () => {
        assert.deepEqual(argsOf("fw (2+3) * 2"), ["(2+3) * 2"])
        assert.equal(ev("(2+3) * 2"), 10)
    })

    test("order does not matter — fw 2 * (3+4) is also one argument", () => {
        assert.deepEqual(argsOf("fw 2 * (3+4)"), ["2 * (3+4)"])
        assert.equal(ev("2 * (3+4)"), 14)
    })
})

describe("3 · plain neighbours stay separate arguments", () => {
    test("goto 1 2 is two coordinates", () => {
        assert.deepEqual(argsOf("goto 1 2"), ["1", "2"])
    })

    test("negative coordinates follow the one rule", () => {
        assert.deepEqual(argsOf("goto -1 -2"), ["-1", "-2"])   // glued signs: two
        assert.deepEqual(argsOf("goto 1 - 2"), ["1 - 2"])       // standalone minus: one
    })
})

describe("4 · juxtaposition and call spacing, explicit", () => {
    test("juxtaposition binds within one chunk, not across a gap", () => {
        assert.deepEqual(argsOf("fw 2x"), ["2x"])       // glued: one argument
        assert.deepEqual(argsOf("fw 2 x"), ["2", "x"])  // gap, no operator: two
    })

    test("a call is glued; a name and a group across a gap are two arguments", () => {
        assert.deepEqual(argsOf("fw sin(30)"), ["sin(30)"])
        assert.deepEqual(argsOf("fw sin (30)"), ["sin", "(30)"])
    })
})

describe("5 · grouped substitutions, templates, and definitions", () => {
    test("a definition's expression is one argument", () => {
        assert.deepEqual(argsOf("fn step[n] n+1"), ["step[n]", "n+1"])
    })

    test("a template and a literal are single arguments", () => {
        assert.deepEqual(argsOf("label 'pi'"), ["'pi'"])
        assert.deepEqual(argsOf("label '[pi]'"), ["'[pi]'"])
        assert.deepEqual(argsOf("faceto \"mice[follow]\".x \"mice[follow]\".y"),
            ["\"mice[follow]\".x", "\"mice[follow]\".y"])
    })
})

describe("6 · a malformed argument keeps its intact text, so a diagnostic can point", () => {
    test("an unclosed group stays one argument and is refused downstream", () => {
        assert.deepEqual(argsOf("fw (2+3"), ["(2+3"])
        assert.throws(() => ev("(2+3"), /closing|delimiter/i)
    })

    test("unsupported ink is refused at its position, not silently split", () => {
        assert.deepEqual(argsOf("fw 2$+3"), ["2$+3"])
        assert.throws(() => ev("2$+3"), /Unknown token: \$ at position 1/)
    })
})

describe("7 · surplus arguments are refused, not dropped", () => {
    test("a command never silently ignores extra ink", () => {
        assert.throws(() => drainEvents(parseProgram("fw 2 +3"), deps()), /takes 1 argument/)
        assert.throws(() => drainEvents(parseProgram("fn step[n] n +1"), deps()), /signature and a body/)
    })

    test("within-contract arguments still run", () => {
        assert.ok(drainEvents(parseProgram("fn step[n] n+1\nfw step(2)"), deps()).length)
    })
})

describe("8 · a sign belongs to an expression, not a spelling", () => {
    test("glued signs start a new argument, whatever the magnitude", () => {
        assert.deepEqual(argsOf("goto 1 -2"), ["1", "-2"])
        assert.deepEqual(argsOf("goto 1 -(2)"), ["1", "-(2)"])
        assert.deepEqual(argsOf("goto 1 -pi"), ["1", "-pi"])
        assert.deepEqual(argsOf("goto 1 (-pi)"), ["1", "(-pi)"])
    })
})

describe("9 · word operators bridge at a chunk edge", () => {
    test("the table's recognition, not a guess", () => {
        assert.deepEqual(argsOf("fw 7mod 3"), ["7mod 3"])
        assert.deepEqual(argsOf("fw 7 mod3"), ["7 mod3"])
        assert.deepEqual(argsOf("fw 7mod3"), ["7mod3"])
        assert.deepEqual(argsOf("fw 7 mod 3"), ["7 mod 3"])
    })
    test("a name that merely starts with mod is untouched", () => {
        assert.deepEqual(argsOf("label model"), ["model"])
    })
})

describe("10 · nested quotation keeps its context", () => {
    test("a closing bracket inside a quoted string is not structural", () => {
        assert.deepEqual(argsOf("label ('a) b')"), ["('a) b')"])
    })
})

describe("11 · the argument keeps its original source span", () => {
    test("internal spacing is preserved, so diagnostic offsets are true", () => {
        assert.deepEqual(argsOf("fw 2  +  3"), ["2  +  3"])
    })
})

describe("12 · equivalent-expression substitution preserves the construction", () => {
    test("a quantity may be replaced by a grouped or named equivalent", () => {
        assert.deepEqual(argsOf("fw (1+1)"), ["(1+1)"])
        assert.deepEqual(argsOf("goto (0+1) (0+2)"), ["(0+1)", "(0+2)"])
        assert.equal(ev(argsOf("fw (1+1)")[0]), 2)
    })
})
