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

    test("but a rehearsal still refuses a pose its own arithmetic invalidated", () => {
        // "No world to consult" and "the arithmetic overflowed" are different failures.
        const r = drainNamespace(parseProgram("loop 2 do\n fw 1e308\nend\nfn later 5"), deps())
        assert.match(r.error?.message ?? "", /non-finite/, "the overflowed step is refused even headless")
        assert.ok(![...r.userspace.keys()].some((k) => k.startsWith("later")),
            "the wound stops the walk, so `later` never registers")
    })

    test("a live walk still refuses a non-finite posed position", () => {
        // No scheduler → not a rehearsal → the publication guard still fires.
        assert.throws(
            () => drainEvents(parseProgram("fw 1e308\nfw 1e308"), deps()),
            /non-finite/,
        )
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
        assert.equal(ev("-1e-20 mod 1"), 0)
    })

    test("integer operands are exact", () => {
        assert.equal(ev("-7 mod 3"), 2)
        assert.equal(ev("9007199254740990 mod 9007199254740991"), 9007199254740990)
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
})
