// Headless profiling harness — parse → execute → scheduler (no THREE).
//
// Drives the real scheduler exactly as turtle.js does, but drains each
// ambient channel through a counting stub instead of the WebGL materializer.
// This isolates executor/scheduler allocation churn and reference retention
// from rendering cost.
//
// Run with:  node --expose-gc test/js/profile/run.mjs
//
// The leak signal is `heapDeltaPerTick` over a long steady run: it should be
// flat (~0) for a clean program. Growth means per-tick allocation is being
// retained somewhere (channels, mailboxes, atom watchers, registry).

import { createScheduler, metaRoot, visitPostOrder } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

// --- Counting drain stub (stands in for compositor + materializer) ---
// Drains every non-root ambient channel and tallies event types.
// Returns the number of events drained this tick.
function drainAll(scheduler, tally) {
    let drained = 0
    for (const ambient of scheduler.registry.values()) {
        if (ambient === scheduler.root) continue
        const events = ambient.channel.drain()
        for (let i = 0; i < events.length; i++) {
            const t = events[i].type
            tally[t] = (tally[t] || 0) + 1
            drained++
        }
    }
    return drained
}

// --- Retained-reference snapshot (the leak instrument) ---
// Walks the live frame tree + flat registry. A leak shows up as any of these
// counts climbing across a steady-state run that should be in equilibrium.
export function snapshotRetained(scheduler) {
    let frames = 0
    let mailbox = 0
    let childLinks = 0
    let openChannels = 0
    visitPostOrder(scheduler.root, (f) => {
        frames++
        mailbox += f.mailbox ? f.mailbox.length : 0
        childLinks += f.children ? f.children.size : 0
        if (f.channel && !f.channel.closed) openChannels++
    })
    return {
        registry: scheduler.registry.size,
        frames,
        mailbox,
        childLinks,
        openChannels,
    }
}

function percentile(sorted, p) {
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    return sorted[idx]
}

const gc = () => { if (global.gc) { global.gc(); global.gc() } }
const heap = () => process.memoryUsage().heapUsed

// Build a scheduler wired exactly like turtle._ensureScheduler, then run one
// child program (the common single-tab case). Multi-ambient behavior is
// exercised by the program itself via `as`.
function buildScheduler() {
    return createScheduler(metaRoot(), {
        rootName: "__meta__",
        createDeps: () => ({
            mathParser: new Parser(),
            mathEvaluator: new Evaluator(),
        }),
        execOpts: { color: "#e77808" },
        onShout: () => {},
    })
}

// profileProgram — drive `src` for a batch flush followed by `ticks` animation
// frames at `frameMs` cadence, measuring time and heap.
//
// opts = { ticks = 600, frameMs = 16, key = "buf", name = "main", warmup = true }
export function profileProgram(src, opts = {}) {
    const ticks = opts.ticks ?? 600
    const frameMs = opts.frameMs ?? 16
    const key = opts.key ?? "buf"
    const name = opts.name ?? "main"

    const ast = parseProgram(src)
    const scheduler = buildScheduler()

    const tally = {}
    const tickMs = []

    // --- Batch flush phase (mirrors compositor.flush) ---
    scheduler.hotSwapChild(key, {
        name,
        code: { ast, functions: null },
        style: { color: "#e77808" },
        env: null,
    })

    let flushTicks = 0
    const flushT0 = performance.now()
    {
        const flushTime = scheduler.lastTickTime || 0
        let guard = 10000
        while (guard-- > 0) {
            const progress = scheduler.tick(flushTime)
            drainAll(scheduler, tally)
            flushTicks++
            if (scheduler.done || !progress) break
        }
    }
    const flushMs = performance.now() - flushT0

    // --- Steady animation phase (mirrors compositor.advance per RAF) ---
    gc()
    const retainedBefore = snapshotRetained(scheduler)
    const heapBefore = heap()

    let now = scheduler.lastTickTime || 0
    let animatedTicks = 0
    for (let f = 0; f < ticks; f++) {
        now += frameMs
        const t0 = performance.now()
        const progress = scheduler.tick(now)
        if (progress) drainAll(scheduler, tally)
        tickMs.push(performance.now() - t0)
        animatedTicks++
        if (scheduler.done) break  // batch program finished — no steady state to measure
    }

    gc()
    const heapAfter = heap()
    const retainedAfter = snapshotRetained(scheduler)

    tickMs.sort((a, b) => a - b)
    const heapDelta = heapAfter - heapBefore
    const measuredTicks = animatedTicks || 1

    return {
        src: src.length > 48 ? src.slice(0, 45) + "..." : src,
        flushTicks,
        flushMs,
        animatedTicks,
        done: scheduler.done,
        errors: scheduler.errors,
        msP50: percentile(tickMs, 50),
        msP95: percentile(tickMs, 95),
        heapBeforeMB: heapBefore / 1048576,
        heapAfterMB: heapAfter / 1048576,
        heapDeltaKB: heapDelta / 1024,
        heapDeltaPerTickB: heapDelta / measuredTicks,
        retainedBefore,
        retainedAfter,
        tally,
    }
}
