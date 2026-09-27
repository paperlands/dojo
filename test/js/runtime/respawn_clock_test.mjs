// A NEW RUN IS A NEW CLOCK (D011).
// Run: node --test test/js/runtime/respawn_clock_test.mjs
//
// A frame that finished and is spawned again is rewired in place: it keeps its
// id, its place in the tree and its origin, but its RUN starts over. Its clock
// must start over too.
//
// It did not. `resumeAt` is the frame's own logical time, and a wait is
// `resumeAt + duration`. Leaving the finished run's `resumeAt` standing put
// every wait of the new run in the past, so they were all already over: a
// half-second animation replayed in a single tick, and every re-spawn after the
// first looked like a jump cut. The bug hid because the FIGURE was right —
// only its timing was gone.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

// Walk a program on a 10ms tick, reporting when each run of `name` drew.
function strokesByRun(src, name, until = 4000, step = 10) {
    const s = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#e77808' } })
    s.hotSwapChild("buf", {
        name: "w", code: { ast: parseProgram(src), functions: null },
        style: { color: '#e77808' }, env: null,
    })
    const byRun = new Map()
    for (let t = 0; t <= until; t += step) {
        s.tick(t)
        for (const f of s.registry.values()) {
            for (const e of f.channel.drain()) {
                if (e.type !== 'path' || f.name !== name) continue
                if (!byRun.has(f.run)) byRun.set(f.run, [])
                byRun.get(f.run).push(t)
            }
        }
    }
    return [...byRun.values()]
}

const spread = (ts) => ts[ts.length - 1] - ts[0]

describe("a re-spawned frame keeps its own tempo", () => {
    // The parent re-spawns `kid` once a second. Each run is the same 5-stroke,
    // 400ms animation, so every run must have the same spread — only shifted.
    const src = `
loop 3 do
  as kid do
    loop 5 do
      wait 0.1
      fw 1
    end
  end
  wait 1
end`

    test("every run draws the same number of strokes", () => {
        const runs = strokesByRun(src, "kid")
        assert.equal(runs.length, 3, "three runs")
        for (const ts of runs) assert.equal(ts.length, 5)
    })

    test("every run takes the same TIME, not just the same shape", () => {
        const runs = strokesByRun(src, "kid")
        const first = spread(runs[0])
        assert.equal(first, 400, "a 5×100ms animation spans 400ms between first and last stroke")
        for (const ts of runs.slice(1)) {
            assert.equal(spread(ts), first,
                "a later run must not fast-forward — its waits are its own")
        }
    })

    test("each run starts one wait after its re-spawn", () => {
        const runs = strokesByRun(src, "kid")
        const starts = runs.map(ts => ts[0])
        assert.deepEqual(starts, [100, 1100, 2100],
            "re-spawned at 0 / 1000 / 2000, each drawing 100ms later")
    })

    test("runs do not overlap — a fast-forwarded run would land early", () => {
        const runs = strokesByRun(src, "kid")
        for (let i = 1; i < runs.length; i++) {
            assert.ok(runs[i][0] > runs[i - 1][runs[i - 1].length - 1],
                "each run finishes before the next begins")
        }
    })
})
