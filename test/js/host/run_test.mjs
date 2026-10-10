// Run truth for the hatch door. The source fence cannot see a late wound.
// Run with: node --test test/js/host/run_test.mjs
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot, sumCounts } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { completionOf, createRunWatch, halt, refuse } from "../../../assets/js/turtling/run.js"

function makeScheduler(execOpts = {}) {
    return createScheduler(metaRoot(), {
        createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }),
        execOpts: { color: "#e77808", ...execOpts },
    })
}

function seat(name, source) {
    return {
        name,
        code: { ast: parseProgram(source), functions: null },
        style: { color: "#e77808" },
        env: null,
    }
}

function finish(scheduler) {
    for (let i = 0; i < 8 && !scheduler.done; i++) scheduler.tick(1000 * (i + 1))
}

describe("a stopped walk is not a successful one", () => {
    test("a command after a wait rejects, and the count includes what ran", () => {
        const scheduler = makeScheduler()
        const frame = scheduler.hotSwapChild("host", seat("host", "fw 1\nwait 0.05\nnope"))
        assert.equal(frame.done, false, "the wait is still in front of the wound")
        finish(scheduler)
        const outcome = completionOf(scheduler, "host")
        assert.equal(outcome.done, true)
        assert.equal(outcome.wound?.kind, "walk")
        assert.match(outcome.wound.message, /nope/)
        assert.ok(outcome.commandCount >= 2, `count ${outcome.commandCount}`)
        assert.equal(outcome.commandCount, sumCounts(frame))
    })

    test("a delayed limitCommand cannot raise the host ceiling", () => {
        const scheduler = makeScheduler({ maxCommands: 4, commandCeiling: 4 })
        scheduler.hotSwapChild("host", seat("host", "fw 1\nwait 0.05\nlimitCommand 100\nfw 1\nfw 1\nfw 1"))
        finish(scheduler)
        const outcome = completionOf(scheduler, "host")
        assert.equal(outcome.done, true)
        assert.match(outcome.wound?.message ?? "", /Maximum command limit of 4/)
        assert.ok(outcome.commandCount <= 4, `count ${outcome.commandCount}`)
        assert.ok(outcome.commandCount >= 2, `count ${outcome.commandCount}`)
    })

    test("a recurse ceiling refuses a deeper call", () => {
        const scheduler = makeScheduler({ maxRecurseDepth: 2, recurseCeiling: 2 })
        scheduler.hotSwapChild("host", seat("host", "def boom do\n  boom\n  fw 1\nend\nboom"))
        finish(scheduler)
        const outcome = completionOf(scheduler, "host")
        assert.equal(outcome.done, true)
        assert.match(outcome.wound?.message ?? "", /Maximum recurse depth of 2/)
        assert.equal(outcome.wound?.span?.line > 0, true)
    })

    test("a delayed limitRecurse cannot raise the recurse ceiling", () => {
        const scheduler = makeScheduler({ maxRecurseDepth: 2, recurseCeiling: 2 })
        scheduler.hotSwapChild("host", seat("host", "fw 1\nwait 0.05\nlimitRecurse 100\ndef boom do\n  boom\n  fw 1\nend\nboom"))
        finish(scheduler)
        const outcome = completionOf(scheduler, "host")
        assert.equal(outcome.done, true)
        assert.match(outcome.wound?.message ?? "", /Maximum recurse depth of 2/)
        assert.ok(outcome.commandCount >= 1, `count ${outcome.commandCount}`)
    })

    test("a derived figure keeps the recurse ceiling", () => {
        const scheduler = makeScheduler({ maxRecurseDepth: 2, recurseCeiling: 2 })
        scheduler.hotSwapChild("host", seat("host", "def boom do\n  boom\n  fw 1\nend\nlet F = boom"))
        finish(scheduler)
        const outcome = completionOf(scheduler, "host")
        assert.equal(outcome.done, true)
        assert.match(outcome.wound?.message ?? "", /Maximum recurse depth of 2/)
    })

    test("a warning does not become fatal because a promise is waiting", () => {
        const scheduler = {
            done: true,
            errors: [{ kind: "nan", message: "no measure", address: "host", span: { line: 1 } }],
            root: { children: new Map([["host", { commandCount: 4, children: new Map() }]]) },
        }
        const outcome = completionOf(scheduler, "host")
        assert.equal(outcome.wound, null)
        assert.equal(outcome.commandCount, 4)
    })

    test("one watch settles only the current run", async () => {
        let snap = { done: false, commandCount: 0, wound: null }
        const watch = createRunWatch(() => snap)
        const open = () => {
            let resolve, reject
            const finished = new Promise((res, rej) => { resolve = res; reject = rej })
            const run = { settled: false, resolve, reject }
            watch.begin(run)
            return { finished, run }
        }
        const first = open()
        const second = open()
        snap = { done: true, commandCount: 3, wound: null }
        watch.look()
        assert.equal(first.run.settled, false)
        assert.deepEqual(await second.finished, { commandCount: 3 })
        // Twenty more plays still consult one reader, and a fatal wound rejects.
        let last
        for (let i = 0; i < 20; i++) last = open()
        snap = {
            done: true, commandCount: 2,
            wound: { kind: "walk", message: "Maximum command limit of 2 reached", span: { line: 4 } },
        }
        watch.look()
        await assert.rejects(last.finished, (err) => {
            assert.equal(err.reason, "fatal")
            assert.equal(err.message, "Maximum command limit of 2 reached")
            assert.equal(err.wound.span.line, 4)
            return true
        })
    })

    test("refuse does not append a location to the wound's message", () => {
        const wound = { kind: "walk", message: "nope", span: { line: 4 } }
        const err = refuse(wound)
        assert.equal(err.reason, "fatal")
        assert.equal(err.message, "nope")
        assert.equal(err.wound, wound)
        assert.equal(refuse(null).message, "program failed")
        assert.equal(refuse(null).reason, "fatal")
    })

    test("supersession and disposal are different reasons", () => {
        assert.equal(halt("superseded").reason, "superseded")
        assert.equal(halt("superseded").message, "superseded")
        const disposed = halt("disposed")
        assert.equal(disposed.reason, "disposed")
        assert.equal(disposed.message, "hatch disposed")
    })
})
