// Word vs measure domain at bare-ident leaves — run with:
//   node --test test/js/execute/word_measure_domain_test.mjs
//
// Regression for the live-shell mesh bomb: typing `jmp ran` (unfinished
// `random`) used to string-fallback, poison SE(3) to NaN, break stroke-run
// joining under beColour, and mint one geometry per iteration.
//
// Law: bare unknown idents are measure-strict by default. Word residual only
// at name-costume holes (ink, label text, ambient/shout names) — per-hole,
// not per-verb blanket (label is word then measure).

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { ASTNode } from "../../../assets/js/turtling/ast.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"

const call = (name, ...args) =>
    new ASTNode("Call", name, args.map((a) => new ASTNode("Argument", String(a))))
const loop = (n, body) => new ASTNode("Loop", String(n), body)

function realDeps() {
    return { mathParser: new Parser(), mathEvaluator: new Evaluator() }
}

function eventsOfType(events, type) {
    return events.filter((e) => e.type === type)
}

describe("measure domain (strict bare idents)", () => {
    test("jmp ran wounds — does not run a following colour loop", () => {
        const ast = [
            call("jmp", "ran"),
            loop(50, [call("fw", 1), call("beColour", "random")]),
        ]
        assert.throws(
            () => drainEvents(ast, realDeps()),
            /Undefined variable: ran/,
        )
    })

    test("fw ran wounds", () => {
        assert.throws(
            () => drainEvents([call("fw", "ran")], realDeps()),
            /Undefined variable: ran/,
        )
    })

    test("jmp random still works (deferred constant)", () => {
        const events = drainEvents(
            [call("jmp", "random"), call("fw", 10)],
            realDeps(),
        )
        const paths = eventsOfType(events, "path")
        assert.equal(paths.length, 1)
        assert.ok(Number.isFinite(paths[0].points[1][0]))
    })

    test("jmp 0/0 still runs (NaN from arithmetic — separate belt)", () => {
        // Domain gate only covers bare unknown names, not non-finite math.
        // Non-finite deposit hygiene is not this change's job.
        const events = drainEvents(
            [call("jmp", "0/0"), call("fw", 1)],
            realDeps(),
        )
        assert.ok(events.some((e) => e.type === "head" || e.type === "path"))
    })

    test("program text: jmp ran then loop does not mint path storm", () => {
        const code = `jmp ran
loop 100 do
  fw 1
  beColour random
end
`
        const ast = parseProgram(code)
        assert.throws(
            () => drainEvents(ast, realDeps()),
            /Undefined variable: ran/,
        )
    })
})

describe("word domain (ink / label)", () => {
    test("beColour silver accepts bare colour name", () => {
        const events = drainEvents(
            [call("fw", 10), call("beColour", "silver"), call("fw", 10)],
            realDeps(),
        )
        const paths = eventsOfType(events, "path")
        assert.equal(paths.length, 2)
        assert.equal(paths[1].color, "silver")
    })

    test("beColour ff2d55 accepts bare hex", () => {
        const events = drainEvents(
            [call("beColour", "ff2d55"), call("fw", 5)],
            realDeps(),
        )
        const paths = eventsOfType(events, "path")
        assert.equal(paths.length, 1)
        assert.equal(paths[0].color, "#ff2d55")
    })

    test("beColour random still works", () => {
        const events = drainEvents(
            [call("beColour", "random"), call("fw", 5)],
            realDeps(),
        )
        const paths = eventsOfType(events, "path")
        assert.equal(paths.length, 1)
        assert.match(paths[0].color, /^hsla\(/)
    })

    test("label hello accepts bare word", () => {
        const events = drainEvents([call("label", "hello")], realDeps())
        const labels = eventsOfType(events, "label")
        assert.equal(labels.length, 1)
        assert.equal(labels[0].text, "hello")
    })

    test("label hello nosuch wounds on measure size — not textSize NaN", () => {
        // Per-hole: arg0 word, arg1 measure. Verb-set word would silence nosuch.
        assert.throws(
            () => drainEvents([call("label", "hello", "nosuch")], realDeps()),
            /Undefined variable: nosuch/,
        )
    })

    test("label hello 2 still accepts word text + measure size", () => {
        const events = drainEvents([call("label", "hello", "2")], realDeps())
        const labels = eventsOfType(events, "label")
        assert.equal(labels.length, 1)
        assert.equal(labels[0].text, "hello")
        assert.equal(labels[0].textSize, 10)
    })
})

describe("shout holes (name word, payload measure)", () => {
    test("shout hello 1 accepts bare name word", () => {
        const events = drainEvents([call("shout", "hello", "1")], realDeps())
        const shouts = eventsOfType(events, "shout")
        assert.equal(shouts.length, 1)
        assert.equal(shouts[0].name, "hello")
        assert.equal(shouts[0].payload, 1)
    })

    test("shout hello nosuch wounds on measure payload", () => {
        assert.throws(
            () => drainEvents([call("shout", "hello", "nosuch")], realDeps()),
            /Undefined variable: nosuch/,
        )
    })
})

describe("typed program: progressive random prefixes", () => {
    // Flat programs — drainEvents does not advance spawned ambients; the gate
    // is on the measure leaf, which these exercise without the scheduler.
    test("prefixes of random wound on jmp; full random succeeds", () => {
        for (const prefix of ["r", "ra", "ran", "rand", "rando"]) {
            const code = `jmp ${prefix}
loop 20 do
  fw 1
  beColour random
end
`
            assert.throws(
                () => drainEvents(parseProgram(code), realDeps()),
                new RegExp(`Undefined variable: ${prefix}`),
                `expected wound for jmp ${prefix}`,
            )
        }

        const ok = `jmp random
loop 20 do
  fw 1
  beColour random
end
`
        const events = drainEvents(parseProgram(ok), realDeps())
        const paths = eventsOfType(events, "path")
        assert.ok(paths.length > 0)
        for (const p of paths) {
            for (const pt of p.points) {
                assert.ok(
                    Number.isFinite(pt[0]) && Number.isFinite(pt[1]) && Number.isFinite(pt[2]),
                    `expected finite pose, got ${pt}`,
                )
            }
        }
    })

    test("ambient body: jmp ran wounds the child (scheduler)", async () => {
        const { createScheduler } = await import("../../../assets/js/turtling/scheduler.js")
        const { execute } = await import("../../../assets/js/turtling/executor.js")
        const code = `as n do
  jmp ran
  loop 50 do
    fw 1
    beColour random
  end
end
`
        const deps = realDeps()
        const ast = parseProgram(code)
        const scheduler = createScheduler(execute(ast, deps), {
            createDeps: () => realDeps(),
            execOpts: {},
        })
        // Drive to rest.
        let n = 1000
        while (!scheduler.done && n-- > 0) scheduler.tick(0)

        const errs = scheduler.errors
        assert.ok(errs.length >= 1, "expected walk wound on ambient")
        assert.match(errs[0].message, /Undefined variable: ran/)
        // Child died at jmp — no path storm from the colour loop.
        const drained = []
        for (const [, frame] of scheduler.registry) {
            drained.push(...frame.channel.drain())
        }
        const paths = drained.filter((e) => e.type === "path")
        assert.equal(paths.length, 0, `expected no paths after jmp ran, got ${paths.length}`)
    })
})
