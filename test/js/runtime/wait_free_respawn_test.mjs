// Wait-free re-spawn — a loop that re-encounters the same ambient each iteration
// must run it every iteration whether or not the loop body yields (`wait`).
// Run with: node --test test/js/runtime/wait_free_respawn_test.mjs
//
// Background: a program with no `wait` drains to completion synchronously at load
// time via the INLINE path (hotSwapChild → advanceChild → drainUntilPause), never
// touching the tick loop. That inline path once rewired a re-encountered done child
// but forgot to re-advance it (unlike the tick path), so `as name … do` inside a
// wait-free loop executed only on the first iteration. This locks in the collapse.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

function makeScheduler() {
    return createScheduler(metaRoot(), {
        createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }),
        execOpts: { color: '#e77808' }
    })
}

function loadAndRun(code) {
    const s = makeScheduler()
    s.hotSwapChild("buf-1", {
        name: "prog",
        code: { ast: parseProgram(code), functions: null },
        style: { color: '#e77808' },
        env: null
    })
    // Drive to completion — waited version needs multiple ticks; wait-free is
    // already done at load, but ticking is harmless and self-terminating.
    let now = 0
    for (let i = 0; i < 200 && !s.done; i++) { s.tick(now); now += 16 }
    const prog = s.root.children.get("buf-1")
    return { s, prog, child: prog.children.get("tangent") }
}

const N = 12
const waitFree = `loop ${N} do
  fw 50
  rt 10
  as tangent world do
    fw 100
    fw -200
  end
end`
const waited = `loop ${N} do
  wait 0
  fw 50
  rt 10
  as tangent world do
    fw 100
    fw -200
  end
end`

describe("wait-free re-spawn re-runs the ambient every iteration", () => {
    test("wait-free loop runs the re-encountered ambient N times", () => {
        const { child } = loadAndRun(waitFree)
        // fw 100 + fw -200 = 2 commands per run; N runs.
        assert.equal(child.commandCount, 2 * N)
    })

    test("wait-free and waited loops run the ambient the same number of times", () => {
        const free = loadAndRun(waitFree)
        const wait = loadAndRun(waited)
        assert.equal(free.child.commandCount, wait.child.commandCount)
    })

    test("the ambient ends done after the loop completes", () => {
        const { child } = loadAndRun(waitFree)
        assert.equal(child.done, true)
    })
})
