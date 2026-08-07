// Pacer — the rate knob, and the preemption quantum.
// Run: node --test test/js/runtime/pacer_test.mjs
//
// Two things are under test, and only the second one matters to the author:
//   1. The controller obeys AIMD and stays inside its clamps (pure, fake clock).
//   2. A pump given a slice LETS GO of the frame — a 24000-event wait-free world
//      builds across many frames, no single tick running long enough to hang a
//      tab, and the figure still arrives whole (the truth knob is untouched).

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createPacer } from "../../../assets/js/turtling/pacer.js"
import { worldProgress } from "../../../assets/js/turtling/vitals.js"
import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { execute, createActorState } from "../../../assets/js/turtling/executor.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const spiral = (N) => `loop ${N} do\n  fw 1\n  rt 2\n  dive 1\n  beColour random\nend`

describe("pacer — feedback, not device assumptions", () => {
    test("a frame that overruns cuts the budget fast", () => {
        const p = createPacer({ startMs: 8 })
        p.observe(40)                      // a bad frame
        assert.equal(p.budgetMs, 4)        // multiplicative decrease
        p.observe(40)
        assert.equal(p.budgetMs, 2)
    })

    test("headroom grows the budget slowly", () => {
        const p = createPacer({ startMs: 1 })
        p.observe(5); p.observe(5); p.observe(5)
        assert.equal(p.budgetMs, 2.5)      // additive increase, 3 × 0.5
    })

    test("down fast, up slow — the asymmetry is the point", () => {
        const p = createPacer({ startMs: 8 })
        p.observe(40)
        const afterOneBadFrame = p.budgetMs
        let calm = 0
        while (p.budgetMs < 8 && calm < 100) { p.observe(5); calm++ }
        assert.equal(afterOneBadFrame, 4, "one bad frame halves it")
        assert.equal(calm, 8, "eight good frames to earn it back")
    })

    test("holds in the hysteresis band — no oscillation at the boundary", () => {
        const p = createPacer({ startMs: 4, targetMs: 16 })
        p.observe(15)                      // under target, but not calm (<12.8)
        assert.equal(p.budgetMs, 4, "neither hurting nor idle: hold")
    })

    test("clamped both ends — never zero, never the whole frame", () => {
        const p = createPacer({ startMs: 4, minMs: 0.5, maxMs: 8 })
        for (let i = 0; i < 50; i++) p.observe(999)
        assert.equal(p.budgetMs, 0.5, "a starved pump would never finish")
        for (let i = 0; i < 200; i++) p.observe(1)
        assert.equal(p.budgetMs, 8, "render needs its half of the frame")
    })

    test("a skipped frame is not evidence about the device", () => {
        const p = createPacer({ startMs: 4 })
        p.skip()                           // tab wake / idle-out gap
        assert.equal(p.budgetMs, 4)
    })
})

describe("preemption — the world builds without hanging the tab", () => {
    // A fake clock so the assay is deterministic: every deadline check advances
    // time by 1ms, so a 4ms slice buys ~4 checks = ~1024 events per frame.
    function pacedRun(src, { sliceMs, tickCost = 1 }) {
        let t = 0
        const clock = () => (t += tickCost)
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", clock,
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        // Arm the slice BEFORE seating: hotSwapChild drains the new world inline,
        // and that is the path a big program would hang the tab on — at the
        // keystroke, before any frame exists.
        scheduler.sliceFor(sliceMs)
        scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(src), functions: null },
            style: { color: "#e77808" }, env: null,
        })

        const delivered = []
        const perFrame = []
        let frames = 0
        while (frames < 100000) {
            frames++
            scheduler.sliceFor(sliceMs)
            const t0 = t
            scheduler.tick(0)
            let drained = 0
            for (const a of scheduler.registry.values()) {
                for (const ev of a.channel.drain()) {
                    drained++
                    if (ev.type === "path") delivered.push(ev)
                }
            }
            perFrame.push(t - t0)
            if (scheduler.done && drained === 0) break
            if (!scheduler.building && !drained && !scheduler.done) break
        }
        return { delivered, frames, perFrame, scheduler }
    }

    const N = 24000
    const pureCount = (() => {
        const gen = execute(parseProgram(spiral(N)), realDeps(), { actorState: createActorState() })
        let n = 0
        for (let r = gen.next(); !r.done; r = gen.next()) if (r.value.type === "path") n++
        return n
    })()

    test("no single frame runs past its slice (the anti-hang property)", () => {
        const run = pacedRun(spiral(N), { sliceMs: 4 })
        const worst = Math.max(...run.perFrame)
        // One check granule (256 events) of slop past the deadline is the design:
        // the gauge is rough on purpose. What must never happen is one frame
        // swallowing the whole build.
        assert.ok(worst < 4 + 4, `a frame ran ${worst}ms against a 4ms slice`)
        assert.ok(run.frames > 10, `expected the build to span frames, took ${run.frames}`)
    })

    test("and the figure still arrives WHOLE (rate never touches truth)", () => {
        const run = pacedRun(spiral(N), { sliceMs: 4 })
        assert.equal(run.delivered.length, pureCount)
        assert.ok(run.scheduler.done)
    })

    test("a smaller slice spreads the same world over more frames", () => {
        const tight = pacedRun(spiral(4000), { sliceMs: 1 })
        const loose = pacedRun(spiral(4000), { sliceMs: 8 })
        assert.equal(tight.delivered.length, loose.delivered.length, "same figure")
        assert.ok(tight.frames > loose.frames,
            `tight ${tight.frames} should exceed loose ${loose.frames}`)
    })

    test("`building` tells the author the world is mid-build, then stops", () => {
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", clock: (() => { let t = 0; return () => (t += 1) })(),
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        scheduler.sliceFor(2)
        scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(spiral(4000)), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        scheduler.sliceFor(2)
        scheduler.tick(0)
        assert.equal(scheduler.building, true, "mid-build after letting go of a frame")

        let guard = 100000
        while (guard-- > 0 && !scheduler.done) {
            scheduler.sliceFor(2)
            scheduler.tick(0)
            for (const a of scheduler.registry.values()) a.channel.drain()
        }
        assert.equal(scheduler.building, false, "a settled world is not building")
    })

    test("unpaced (batch/headless) still completes in one call", () => {
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world",
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(spiral(300)), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        // No sliceFor: deadline stays null. One tick per credit refill, no clock.
        let guard = 10000
        while (guard-- > 0) {
            scheduler.tick(0)
            let drained = 0
            for (const a of scheduler.registry.values()) drained += a.channel.drain().length
            if (scheduler.done && drained === 0) break
        }
        assert.ok(scheduler.done)
        assert.equal(scheduler.building, false)
    })
})

describe("progress — what the author is told while a world builds", () => {
    test("phase walks settled → building → settled, and lines are a REAL cursor", () => {
        let t = 0
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", clock: () => (t += 1),
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        assert.equal(worldProgress(scheduler).phase, "settled")

        scheduler.sliceFor(2)
        scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(spiral(4000)), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        scheduler.sliceFor(2)
        scheduler.tick(0)

        const mid = worldProgress(scheduler)
        assert.equal(mid.phase, "building")
        assert.ok(mid.lines > 0 && mid.lines < 4000, `a partial count, got ${mid.lines}`)
        assert.equal(mid.ambients, 1)

        let guard = 100000
        while (guard-- > 0 && !scheduler.done) {
            scheduler.sliceFor(2)
            scheduler.tick(0)
            for (const a of scheduler.registry.values()) a.channel.drain()
        }
        const end = worldProgress(scheduler)
        assert.equal(end.phase, "settled")
        assert.equal(end.lines, 4000, "the cursor lands on the whole figure")
    })

    // A WOUND IS NOT WEATHER. worldProgress used to count frame.error and call
    // the phase 'fault' — the same ctx.error scheduler.errors already lists, read
    // a second time and UNKEYED, so a sibling tab's dead frame painted over the
    // current document. One fact, one reader: faults leave as addressed errors.
    test("a wounded world keeps its fault in errors, not in the phase", () => {
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", channelCapacity: 256,
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        const child = scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(spiral(500)), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        child.ink.resident = 1_000_000
        let guard = 10000
        while (guard-- > 0) {
            scheduler.tick(0)
            let drained = 0
            for (const a of scheduler.registry.values()) drained += a.channel.drain().length
            if (scheduler.done && drained === 0) break
            if (!drained && !scheduler.building) break
        }
        // The fault stands, addressed, exactly once.
        const errors = scheduler.errors
        assert.ok(errors.length > 0, "the wound is on the scheduler, keyed by address")
        assert.ok(errors.every((e) => e.address != null), "and every one names where it lives")

        // The weather says only how far the world got: an errored frame is
        // `done`, so it stops counting as a walker like any finished one.
        const p = worldProgress(scheduler)
        assert.equal(p.phase, "settled")
        assert.equal(p.faults, undefined, "no second, unkeyed reading of the same fact")
    })

    test("no invented denominator — a bar drawn from this is honest", () => {
        const p = worldProgress(null)
        assert.equal(p.total, undefined, "a program's size is not knowable before it runs")
        assert.equal(p.ratio, undefined)
    })
})
