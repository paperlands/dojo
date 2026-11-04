// A LIVE walk, not a batch: the three doors as the host meets them. A measure is
// answered by what the value IS, and a refusal drops the ONE statement — the report
// rides the frame's channel beside the ink that did happen, never the figure. (D020)
// (ruling: absent-is-zero)
// Run: node --test test/js/notation/three_doors_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive, ends, deps } from "../laws/harness.mjs"
import { drainNamespace } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { severityOf } from "../../../assets/js/weave/queries.js"

const world = (src) => {
    const scheduler = buildWorld({})
    scheduler.hotSwapChild("host", fork("host", src))
    return { scheduler, trace: drive(scheduler) }
}
const of = (trace, type) => (trace.get("host") ?? []).filter((e) => e.type === type)

describe("a live walk — three doors, one figure", () => {
    test("a word where a measure belongs is reported, and the ink after it lands", () => {
        const { scheduler, trace } = world("rt 'oops'\nfw 30\n")
        const told = of(trace, "notice")
        assert.equal(told.length, 1, "exactly one located report")
        assert.equal(told[0].kind, "not-a-number")
        assert.match(told[0].message, /No measure/)
        // It stands among the seat's ailments — one list, not a second pipe — and the
        // frame is NOT done: the figure drew on. (id:cmp-resilient)
        assert.equal(scheduler.errors.length, 1, "the report stands where a reader asks")
        assert.equal(scheduler.errors[0].kind, "not-a-number")
        // A wrong word is the SOURCE's fault: the document is not well. One home says
        // so (weave/queries.js), and the figure still drew. (numerics: POLICY.walk)
        assert.deepEqual(ends(trace, "host").at(-1), [30, 0, 0], "the sibling step still landed")
    })

    test("a non-finite measure is not a step — and the author is told", () => {
        const { scheduler, trace } = world("rt 1/0\nfw 30\n")
        const told = of(trace, "notice")
        assert.equal(told.length, 1, "the arithmetic ran out of road, and it says so")
        assert.equal(told[0].kind, "infinite")
        assert.equal(severityOf(told[0]), "warning", "the data's fault, and the figure drew")
        assert.equal(scheduler.errors.length, 1, "the notice stands; the frame still draws")
        assert.deepEqual(ends(trace, "host").at(-1), [30, 0, 0])
    })

    test("an absent measure takes the identity, and the walk carries on", () => {
        const { scheduler, trace } = world("rt\nfw 30\n")
        assert.equal(of(trace, "notice").length, 0, "nothing is not the author's mistake")
        assert.equal(scheduler.errors.length, 0)
        assert.deepEqual(ends(trace, "host").at(-1), [30, 0, 0])
    })

    test("the vocabulary pass names it, so the seat can show it", () => {
        // The live walk draws past it; the headless pass is where the AUTHOR is told,
        // and it stops there, so words after the wound never register. (D020)
        const r = drainNamespace(parseProgram("rt 'oops'\nfn later 5"), deps())
        assert.match(r.error?.message ?? "", /No measure/)
        assert.ok(![...r.userspace.keys()].some((k) => k.startsWith("later")),
            "a wound stops the vocabulary pass")
    })
})
