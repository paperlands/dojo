// Phase 2 exit witness — the transformations that must preserve meaning across
// routes. Run: node --test test/js/notation/figures_test.mjs
//
//   · replace an operand with a grouped equivalent;
//   · move the same expression between fw, goto and fn;
//   · hold a command as a figure WITHOUT changing its argument reading;
//   · pass a computed string WITHOUT turning it into a name.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive } from "../laws/harness.mjs"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const run = (src) => drainEvents(parseProgram(src), deps())

// A world driven headlessly; the figure is the host's child, named F.
const world = (src) => {
    const scheduler = buildWorld({})
    scheduler.hotSwapChild("host", fork("host", src))
    return drive(scheduler)
}
const endsOf = (trace, name) =>
    (trace.get(name) ?? []).filter((e) => e.type === "path").map((p) => p.points.at(-1))
// A scheduler run; `.errors` carries the refusals a held figure surfaced.
const errorsOf = (src) => {
    const scheduler = buildWorld({})
    scheduler.hotSwapChild("host", fork("host", src))
    drive(scheduler)
    return scheduler.errors.map((e) => e.message ?? String(e))
}

describe("1 · substitute an operand with a grouped equivalent", () => {
    test("the same expression in fw, goto, and a definition", () => {
        assert.equal(ev("(1+1)"), 2)
        assert.deepEqual(run("fw (1+1)").filter((e) => e.type === "path").at(-1).points.at(-1), [2, 0, 0])
        assert.deepEqual(run("goto (0+1) (0+2)").filter((e) => e.type === "head").at(-1).position, [1, 2, 0])
    })

    test("a definition whose body is grouped reads the same", () => {
        const ends = run("fn inc[n] (n)+1\nfw inc(2)").filter((e) => e.type === "path").at(-1).points.at(-1)
        assert.deepEqual(ends, [3, 0, 0])
    })
})

describe("2 · hold a command as a figure — argument reading is preserved", () => {
    test("let F = fw 2 + 3 walks five, as fw 2 + 3 does", () => {
        assert.deepEqual(endsOf(world("let F = fw 2 + 3"), "F"), [[5, 0, 0]])
    })

    test("a recipe takes grouped and spaced inputs identically", () => {
        const def = "def r a b do\n fw a\nend\n"
        assert.deepEqual(endsOf(world(def + "let F = r (1 + 2) 4"), "F"), [[3, 0, 0]])
        assert.deepEqual(endsOf(world(def + "let F = r[(1 + 2),4]"), "F"), [[3, 0, 0]])
    })
})

describe("3 · a computed argument crosses as a VALUE, not as fresh source", () => {
    test("a captured string is not re-read as a name", () => {
        const label = (world("let F = label 'pi'").get("F") ?? []).find((e) => e.type === "label")
        assert.equal(label.text, "pi")
    })
})

describe("4 · representation invariance — meaning AND rejection survive", () => {
    test("a literal and a name reaching the same good value both admit", () => {
        assert.deepEqual(errorsOf("let F = rt 90"), [])
        assert.deepEqual(errorsOf("let d = 90\nlet F = rt d"), [])
    })

    test("a literal and a name reaching the same bad value both refuse", () => {
        assert.match(errorsOf("let F = rt 'oops'")[0] ?? "", /No measure/)
        assert.match(errorsOf("let d = 'oops'\nlet F = rt d")[0] ?? "", /No measure/)
    })

    test("a computed argument is admitted, not privileged", () => {
        assert.match(errorsOf("let F = faceto 'x' 0")[0] ?? "", /No measure/)
        assert.deepEqual(errorsOf("let F = label 'pi'"), [])
    })
})

// Rebuild: the same law across a question change. Pending — the figure lifecycle
// reds (7) cover the wake; this pins the obligation so it is not forgotten.
describe("5 · rebuild — later capture agrees with the first (pending)", () => {
    const find = (frame, name) => {
        if (frame.name === name) return frame
        for (const c of frame.children.values()) { const h = find(c, name); if (h) return h }
        return null
    }
    const drag = (s, frame, x) => s.requestMotion(frame,
        { rotation: frame.transform.deref().rotation, position: [x, 0, 0] }, s.motionRevision)

    test("a figure whose input turns invalid across a drag refuses at rebuild", { todo: true }, () => {
        const scheduler = buildWorld({})
        const host = scheduler.hotSwapChild("host", fork("host", "let X\nlet F = fw 1/(X.x-100)\nwait 1\n"))
        drive(scheduler)
        drag(scheduler, find(host, "X"), 100)
        drive(scheduler, { maxTicks: 40 })
        assert.match(scheduler.errors.map((e) => e.message).join("; "), /No measure/)
    })
})
