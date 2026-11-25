// Phase 1 — the joints the review found, each with a witness so the seam cannot
// reopen silently. Run: node --test test/js/notation/contracts_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { drainNamespace, drainEvents } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

describe("a rehearsal admits a missing-world pose, without a wound", () => {
    test("vocabulary after an absent-world goto still registers", () => {
        const r = drainNamespace(parseProgram("goto missing.x missing.y\nfn later 5"), deps())
        assert.equal(r.error, null, "the headless rehearsal never wounds on a nothing pose")
        assert.ok([...r.userspace.keys()].some((k) => k.startsWith("later")),
            "words past the absent-world step still register")
    })

    test("a rehearsal does not take a pose its own arithmetic invalidated", () => {
        // Absent stands still; arithmetic that overflows is a step that is NOT TAKEN.
        const r = drainNamespace(parseProgram("loop 2 do\n fw 1e308\nend\nfn later 5"), deps())
        assert.equal(r.error, null, "a step that is not taken is not a wound")
        assert.ok([...r.userspace.keys()].some((k) => k.startsWith("later")),
            "the walk carries on, so `later` still registers")
    })

    test("a live walk never poses a non-finite position", () => {
        // No scheduler → not a rehearsal → the pose guard still admits the result.
        const events = drainEvents(parseProgram("fw 1e308\nfw 1e308"), deps())
        const paths = events.filter((e) => e.type === "path")
        assert.equal(paths.length, 1)
        assert.ok(paths[0].points.every((p) => p.every(Number.isFinite)),
            "the overflowed step is not in the ink")
    })
})

describe("the contract follows the resolved callable, not the spelling", () => {
    test("a user definition named fw is not admitted by the builtin's movement contract", () => {
        const events = drainEvents(parseProgram("def fw v do\n label v\nend\nfw 'oops'"), deps())
        const label = events.find((e) => e.type === "label")
        assert.equal(label.text, "oops", "the user fn receives its argument; no measurement demand")
    })
})

describe("the integer repair does not change floating remainder", () => {
    test("floating operands keep the prior approximation", () => {
        assert.equal(ev("mod(-1e-20, 1)"), 0)
    })

    test("integer operands are exact", () => {
        assert.equal(ev("mod(-7, 3)"), 2)
        assert.equal(ev("mod(9007199254740990, 9007199254740991)"), 9007199254740990)
    })
})

describe("a quote is one primitive — a literal with interpolation slots", () => {
    test("a template interpolates identically as argument text and as a lowered value", () => {
        const direct = drainEvents(parseProgram("label '[pi]'"), deps()).find((e) => e.type === "label")
        const viaFn = drainEvents(parseProgram("fn greet '[pi]'\nlabel greet"), deps()).find((e) => e.type === "label")
        assert.equal(direct.text, viaFn.text, "no route-dependent interpolation")
        assert.match(viaFn.text, /^3\.14/)
    })

    test("a slotless literal stays the word", () => {
        const direct = drainEvents(parseProgram("label 'pi'"), deps()).find((e) => e.type === "label")
        assert.equal(direct.text, "pi")
    })

    test("display rounding cannot merge generated identities", () => {
        // A slot value may mint a name, so lowering keeps every bit: the display
        // gate is the consumer's, never the interpolator's.
        // (id:tower-center-approximation-ruling)
        const src = "as 'p[1.000000000000001]' do\nfw 1\nend\nas 'p[1]' do\nfw 2\nend"
        const events = drainEvents(parseProgram(src), deps())
        const names = events.filter((e) => e.type === "spawn").map((e) => e.name)
        assert.deepEqual([...names].sort(), ["p1", "p1.000000000000001"], "two values, two names")
    })
})
