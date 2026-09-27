// Spike: the residency guard tries to fix a STOCK by killing a FLOW.
// Run: node --test test/js/runtime/residency_spike_test.mjs
//
// D027 R2.4 split the ink ceiling in two: MAX_RUN_SEGMENTS bounds one run's
// figure, MAX_STAGE_SEGMENTS bounds the device. The second is enforced by
// `enforceResidency` (ledger.js), which wounds "the greediest ambient" while
// the total is still rising — the comment there already concedes that killing
// it "reclaims nothing".
//
// Predictions recorded BEFORE measurement:
//   R1  `worst` is chosen among `!f.done`, so ambients that have FINISHED — the
//       actual owners of the resident geometry — are excluded. The rule
//       degenerates to "whoever is still breathing".
//   R2  Therefore a 1-segment animation beside finished hogs takes the wound.
//   R3  Killing reclaims nothing: the total after the wound equals the total
//       before, because a dead frame's `_inkSegs` stays summed.
//   R4  Because the total never falls back under the bound, EVERY subsequent
//       growth wounds somebody. One live animation makes the cascade permanent.
//   R5  S8b passes today only because nothing grows in it — add one live
//       animation and the same fixture cascades.
//   R6  `erase` zeroes `_inkSegs` (correct for resident bytes), so an animation
//       that clears each frame has no run ceiling at all: it can draw
//       unboundedly more than MAX_RUN_SEGMENTS and never be wounded, while an
//       honest single run at the same total is wounded exactly at the bound.
//
// The hypothesis under all six: `_inkSegs` is being asked to be a STOCK (what
// is resident on the GPU right now, which `erase` truly frees) and a FLOW (how
// much this run has drawn, which is what runaway detection needs). One number
// cannot be both. This is the same split R2.4 already performed once, along an
// axis it did not have.
//
// ALL SIX MEASURED TRUE, then FIXED (D027 R3.5). What landed:
//   * `_inkSegs` split into `ink.resident` (erase zeroes it; the memory bound)
//     and `ink.drawn` (monotone; the flow reading). `drawn` was CULLED
//     2026-08-06 — charged every event, read nowhere, and a rate needs a
//     sampler it never had. It returns with one when R3.10 opens.
//   * The stage bound REFUSES instead of killing. `routeOutput` already holds
//     the asker, so "the world is full" has an addressee after all — a kill
//     needs a culprit, a refusal needs only whoever is knocking.
//   * A refusal that never clears wounds the frame that WAITED (R4b), which is
//     attribution by waiting rather than by guilt. That wait is TIME
//     (MAX_RESIDENCY_STALL_MS), not ticks: the pump runs up to 64 ticks per
//     frame, so the original tick counter fired in ~2 frames, not ~2s.
// R1/R2 and R4 below are rewritten to assert the new law; the measured old
// behaviour is kept in their comments, since that is the evidence R3 rests on.
//
// One thing this file also caught, mid-implementation: gating MAX_RUN_SEGMENTS
// on `ink.drawn` (the first attempt) kills legitimate animations — `loop forever
// do ... erase end` holds 40k segments but its cumulative total crosses 1e6.
// The ceiling guards MEMORY, so it gates `ink.resident`.
//
// SPIKE instrument. Pins measured behaviour; the ruling lives in D027.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import {
    enforceResidency, MAX_STAGE_SEGMENTS, MAX_RESIDENCY_STALL_MS, createInk,
    createStock, setResident, resetInk, chargeInk,
} from "../../../assets/js/turtling/ledger.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

// A registry of stand-in frames plus one stage stock. (id:carving-todo-ledger-stock)
function fakeFrame(name, segs, done, stock) {
    const f = {
        name, ink: createInk(), done, error: null, generator: {},
        park: null, channel: { put() {} },
    }
    setResident(f, stock, segs)
    return f
}

// A frame knocking at a full stage: refused for residency, holding what it owes.
function knocking(frame) {
    frame.park = { cause: 'residency', owed: { type: 'path' }, since: null }
    return frame
}

// Stall timing is in TIME, not ticks — the guard takes a clock. (id:output-ledger-r3-addressee)
function fakeClock() {
    const c = () => c.t
    c.t = 0
    return c
}

// specs: [name, segs, done] — stock is the stage cell the frames charge into.
function stage(specs) {
    const stock = createStock()
    const reg = new Map()
    specs.forEach(([name, segs, done], i) => reg.set(i, fakeFrame(name, segs, done, stock)))
    return { reg, stock }
}

const wounded = (reg) => [...reg.values()].filter((f) => f.error).map((f) => f.name)
const totalOf = (reg) => [...reg.values()].reduce((n, f) => n + f.ink.resident, 0)

describe("SPIKE: the residency guard picks the last one standing", () => {
    // Four real hogs that have FINISHED, plus one tiny thing still animating.
    const fixture = () => stage([
        ["big1", 900000, true],
        ["big2", 900000, true],
        ["big3", 900000, true],
        ["big4", 303105, true],
        ["tiny", 1, false],
    ])

    // MEASURED BEFORE THE FIX: `["tiny"]` — the guard wounded the 1-segment
    // animation while three FINISHED 900k producers lived, because `worst` was
    // chosen among `!f.done`. FIXED (D027 R3.5): the stage refuses instead of
    // killing, so there is no victim to choose badly.
    test("R1/R2 no bystander is wounded — the bound refuses, it does not kill", () => {
        const { reg, stock } = fixture()
        const before = totalOf(reg)
        assert.ok(before > MAX_STAGE_SEGMENTS, `fixture must exceed the bound: ${before}`)
        assert.equal(stock.resident, before, "stock cell matches the sum")
        enforceResidency(reg, fakeClock(), stock)
        assert.deepEqual(wounded(reg), [],
            "over the bound and nobody dies for it")
        // Full is one cell, not N mirrors. (id:carving-todo-ledger-stock)
        assert.equal(stock.full, true, "the stage cell says full")
    })

    test("R1b the refusal targets FLOWS: a finished frame is never asked to stop", () => {
        const { reg, stock } = fixture()
        enforceResidency(reg, fakeClock(), stock)
        // The three 900k hogs are `done`. They hold the stock but are not
        // producing, so they will never reach routeOutput and never be refused.
        // Only `tiny`, still walking, is in a position to be told no — which is
        // correct, because it is the only one still adding to the stock.
        const stillAsking = [...reg.values()].filter((f) => !f.done).map((f) => f.name)
        assert.deepEqual(stillAsking, ["tiny"],
            "exactly the frames still producing are the ones refusal can reach")
    })

    test("R3 killing reclaims nothing", () => {
        const { reg, stock } = fixture()
        const before = totalOf(reg)
        enforceResidency(reg, fakeClock(), stock)
        assert.equal(totalOf(reg), before,
            "a dead frame's ink stays summed — the stock did not move")
        assert.equal(stock.resident, before)
    })

    // MEASURED BEFORE THE FIX: victims were ["anim1", "anim2", "anim3"] — one
    // bystander per tick, until the stage was dead. The kill freed nothing, so
    // the total never fell back under the bound and every subsequent growth
    // claimed another. FIXED: refusal has no cascade because it has no victim.
    test("R4 no cascade, however long the world keeps growing", () => {
        const { reg, stock } = stage([
            ["big1", 900000, true],
            ["big2", 900000, true],
            ["big3", 900000, true],
            ["big4", 303105, true],
            ["anim1", 20, false],
            ["anim2", 20, false],
            ["anim3", 20, false],
        ])
        for (let tick = 0; tick < 20; tick++) {
            for (const f of reg.values()) {
                if (!f.done && !f.error) {
                    f.ink.resident += 1
                    stock.charge(1)
                }
            }
            enforceResidency(reg, fakeClock(), stock)
        }
        assert.deepEqual(wounded(reg), [],
            "twenty ticks over the bound and the stage is still whole")
    })

    test("R4b a frame refused too long IS wounded — attribution by waiting", () => {
        // The one case that does need a name: if the stage never frees up, a
        // live frame is refused forever, which is a silent hang. The wound goes
        // to the frame that WAITED, not to whoever is biggest.
        const { reg, stock } = stage([
            ["hog", 3_000_001, true],
            ["waiter", 20, false],
        ])
        const waiter = knocking([...reg.values()].find((f) => f.name === "waiter"))
        const clock = fakeClock()

        // Ticks alone never wound: the pump runs up to 64 of them per frame, so
        // a tick count would fire in ~2 frames. Only elapsed TIME counts.
        for (let tick = 0; tick < 500; tick++) enforceResidency(reg, clock, stock)
        assert.equal(waiter.park.since, 0, "the wait is stamped once, at its start")
        assert.equal(waiter.error, null, "500 ticks inside the window is not a fault")

        clock.t = MAX_RESIDENCY_STALL_MS
        enforceResidency(reg, clock, stock)
        assert.equal(waiter.error, null, "at the bound exactly, still waiting")

        // Now stand it in the doorway long enough to count as stuck.
        clock.t = MAX_RESIDENCY_STALL_MS + 1
        enforceResidency(reg, clock, stock)
        assert.equal(waiter.error?.kind, "ink", "the frame that waited is told")
        assert.match(waiter.error.message, /has been waiting/)
        const hog = [...reg.values()].find((f) => f.name === "hog")
        assert.equal(hog.error, null, "and the finished hog is still not blamed")
    })

    test("R5 the guard is silent when nothing grows — which is why S8b passes", () => {
        const { reg, stock } = fixture()
        // lastTotal === total ⇒ not rising ⇒ no wound, even though we are over.
        enforceResidency(reg, fakeClock(), stock)
        assert.deepEqual(wounded(reg), [],
            "over the bound but flat: the guard says nothing")
    })
})

// Stage stock is a cell, not a sum of mirrors. Fails if full is only N flags.
// (id:carving-todo-ledger-stock)
describe("ledger stock boundary", () => {
    test("stock is pure numbers — charge/release without a frame", () => {
        const stock = createStock()
        assert.equal(stock.full, false)
        stock.charge(MAX_STAGE_SEGMENTS)
        assert.equal(stock.full, false, "equal is not over")
        stock.charge(1)
        assert.equal(stock.full, true)
        stock.release(2)
        assert.equal(stock.full, false)
        assert.equal(stock.resident, MAX_STAGE_SEGMENTS - 1)
    })

    test("resetInk frees the stage stock immediately — no next-sum wait", () => {
        const stock = createStock()
        const frame = { ink: createInk() }
        setResident(frame, stock, 50_000)
        assert.equal(stock.resident, 50_000)
        resetInk(frame, stock)
        assert.equal(stock.resident, 0, "erase frees it now")
        assert.equal(frame.ink.resident, 0)
    })

    test("chargeInk clear releases stage stock", () => {
        const stock = createStock()
        const ctx = { ink: createInk(), done: false, generator: {}, error: null,
            channel: { put() {} }, id: 1 }
        setResident(ctx, stock, 12_000)
        assert.equal(chargeInk(ctx, { type: 'clear' }, stock), true)
        assert.equal(ctx.ink.resident, 0)
        assert.equal(stock.resident, 0)
    })

    test("full is the cell, not a sum of frame.ink.stageFull", () => {
        // Without a stock boundary, poking only frame.ink.resident left the
        // stage "not full" until the next two-pass sum. With stock, setResident
        // updates the cell at once.
        const stock = createStock()
        const frame = { ink: createInk() }
        setResident(frame, stock, MAX_STAGE_SEGMENTS + 1)
        assert.equal(stock.full, true)
        assert.equal(frame.ink.stageFull, undefined, "no per-frame mirror")
    })
})

describe("SPIKE: erase makes the run ceiling blind to the unbounded shape", () => {
    // The honest single run and the animation draw the SAME number of segments.
    // One is wounded at exactly the bound; the other is never wounded at all.
    function drawn(src, { maxTicks = 400 } = {}) {
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", createDeps: realDeps,
            execOpts: { color: "#e77808" }, onShout: () => {},
        })
        scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(src), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        let segments = 0
        let ticks = 0
        while (ticks++ < maxTicks) {
            scheduler.tick(ticks * 16)
            let drained = 0
            for (const f of scheduler.registry.values()) {
                for (const ev of f.channel.drain()) {
                    drained++
                    if (ev.type === "path") segments += ev.points.length - 1
                }
            }
            if (scheduler.done && drained === 0) break
        }
        const frame = [...scheduler.registry.values()].find((f) => f !== scheduler.root)
        return {
            segments, ticks,
            bill: frame?.ink.resident ?? 0,
            error: frame?.error?.message ?? null,
            kind: frame?.error?.kind ?? null,
        }
    }

    test("R6 an erasing animation draws far past the run ceiling, bill 0, no wound", () => {
        // 30 passes of 40000 segments = 1.2M drawn, but each `erase` zeroes the
        // bill, so the ceiling never sees more than one pass.
        const anim = `loop 30 do
  loop 40000 do
    fw 1
    rt 0.01
  end
  erase
end`
        const r = drawn(anim)
        console.log("  animation:", JSON.stringify({
            drawn: r.segments, bill: r.bill, error: r.error,
        }))
        assert.ok(r.segments > 1_000_000,
            `expected to draw past the run ceiling, drew ${r.segments}`)
        assert.equal(r.error, null, "and was never wounded for it")
        assert.ok(r.bill < 100000, `the bill forgot what was drawn: ${r.bill}`)
    })

    test("R6b the honest single run at a comparable total IS wounded", () => {
        // No erase — one continuous run past MAX_RUN_SEGMENTS (1e6).
        const honest = `loop 1200000 do
  fw 1
  rt 0.001
end`
        const r = drawn(honest, { maxTicks: 50 })
        console.log("  single run:", JSON.stringify({
            bill: r.bill, kind: r.kind, error: r.error,
        }))
        assert.equal(r.kind, "ink", "the same total, drawn honestly, is wounded")
    })
})

// ---------------------------------------------------------------------------
// The ceiling is charged after the array exists — and the breath does NOT fix it
// ---------------------------------------------------------------------------
//
// Two separate defects wear one coat. The breath (quantum_spike_test.mjs) gives
// the scheduler a boundary in work, so the tab stays alive. It does NOT bound
// the size of one path event, because `stroke.extend` accumulates regardless.
// So the run ceiling stays a bill presented after the fact, and credit still
// sees one unbounded unit. That needs its own move: a stroke that breaks itself.
//
// Predictions BEFORE measurement:
//   C1  With the breath ON and strokeMax OFF, the overshoot is unchanged — the
//       bill still lands far past MAX_RUN_SEGMENTS in one charge.
//   C2  With strokeMax ON, the bill lands within one stroke of the ceiling: the
//       ceiling becomes a budget instead of a post-mortem.
//   C3  Geometry is preserved exactly: same segment count, same final pose.
//       A break duplicates its seam vertex, so points rise by ~1 per break and
//       segments do not move at all.
//   C4  Credit engages: one 300k figure stops being one event.

describe("SPIKE: the run ceiling is a bill, not a budget", () => {
    function ceilingRun(src, { breathEvery = 0, strokeMax = 0, maxTicks = 400 } = {}) {
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", createDeps: realDeps,
            execOpts: { color: "#e77808", breathEvery, strokeMax },
            onShout: () => {},
        })
        scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(src), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        let segments = 0, points = 0, paths = 0, ticks = 0
        while (ticks++ < maxTicks) {
            scheduler.tick(ticks * 16)
            let drained = 0
            for (const f of scheduler.registry.values()) {
                for (const ev of f.channel.drain()) {
                    drained++
                    if (ev.type === "path") {
                        paths++
                        points += ev.points.length
                        segments += ev.points.length - 1
                    }
                }
            }
            if (scheduler.done && drained === 0) break
        }
        const frame = [...scheduler.registry.values()].find((f) => f !== scheduler.root)
        return {
            segments, points, paths, ticks,
            bill: frame?.ink.resident ?? 0,
            kind: frame?.error?.kind ?? null,
        }
    }

    const bigRun = `loop 1200000 do
  fw 1
  rt 0.001
end`

    test("C1 the breath alone does not bound the overshoot", () => {
        const r = ceilingRun(bigRun, { breathEvery: 1024, maxTicks: 60 })
        console.log("  breath only:", JSON.stringify({ bill: r.bill, paths: r.paths, kind: r.kind }))
        assert.equal(r.kind, "ink")
        assert.ok(r.bill > 1_100_000,
            `the bill still overshoots in one charge: ${r.bill}`)
    })

    test("C2 a self-breaking stroke makes the ceiling a real budget", () => {
        const r = ceilingRun(bigRun, { breathEvery: 1024, strokeMax: 512, maxTicks: 400 })
        console.log("  self-breaking:", JSON.stringify({ bill: r.bill, paths: r.paths, kind: r.kind }))
        assert.equal(r.kind, "ink", "still wounded — the bound is still a bound")
        assert.ok(r.bill <= 1_000_000 + 512,
            `expected the bill within one stroke of the ceiling, got ${r.bill}`)
    })

    test("C3 the figure is identical — only the batching moved", () => {
        const src = `loop 40000 do
  fw 1
  rt 0.01
end`
        const whole = ceilingRun(src)
        const split = ceilingRun(src, { strokeMax: 512 })
        console.log("  batching:", JSON.stringify({
            pathsWhole: whole.paths, pathsSplit: split.paths,
            segWhole: whole.segments, segSplit: split.segments,
            ptsWhole: whole.points, ptsSplit: split.points,
        }))
        assert.equal(split.segments, whole.segments, "segments must not move")
        assert.ok(split.paths > whole.paths, "and it really did split")
        // One duplicated vertex per break, and nothing else.
        assert.equal(split.points - whole.points, split.paths - whole.paths,
            "exactly one extra vertex per break")
    })

    test("C4 credit sees many units where it used to see one", () => {
        const src = `loop 300000 do
  fw 1
  rt 0.001
end`
        const whole = ceilingRun(src, { maxTicks: 60 })
        const split = ceilingRun(src, { strokeMax: 512, maxTicks: 4000 })
        console.log("  credit:", JSON.stringify({
            eventsWhole: whole.paths, eventsSplit: split.paths,
        }))
        assert.equal(whole.paths, 1, "today the whole figure is one credit unit")
        assert.ok(split.paths > 500, `now it is ${split.paths} units the sink can pace`)
    })
})
