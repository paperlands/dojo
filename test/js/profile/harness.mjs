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
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { eyeCameraPose, recenterPose } from "../../../assets/js/turtling/view.js"

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

// --- Eye reframe profiler (the model-layer camera path) ---
//
// updateGroupPositions reframes the world for a focused eye by premultiplying
// every non-eye layer by E⁻¹ (E = eyeCameraPose(eye worldPose)). The scheduler
// harness above can't see this (it drains channels, doesn't run the compositor),
// so this isolates the exact per-frame math: eyeCameraPose → SE3.invert →
// SE3.compose × layers. `mode`: "empty" (identity-skip path) or "moving".
// (specs/eye-ambient.org id:eye-perf)
const _AXIS_X = { x: 1, y: 0, z: 0 }
const _AXIS_Z = { x: 0, y: 0, z: 1 }
function isIdentitySE3(t) {
    const r = t.rotation, p = t.position
    return Math.abs(r.w - 1) < 1e-9 &&
        Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2]) < 1e-9
}
export function profileReframe({ layers = 20, frames = 20000, mode = "moving" } = {}) {
    // Eye world pose: empty (recenter seed → identity reframe) or rolled+yawed.
    const eyeWorld = mode === "empty"
        ? recenterPose()
        : SE3.rotateLocal(SE3.rotateLocal(recenterPose(), _AXIS_X, 45), _AXIS_Z, -30)
    const scene = []
    for (let i = 0; i < layers; i++) {
        scene.push({ rotation: Versor.fromAxisAngle(_AXIS_Z, i * 7), position: [i * 10, i * 3, 0] })
    }

    // One frame of the reframe path, with the identity-skip the compositor uses.
    function frame() {
        const eyeInv = SE3.invert(eyeCameraPose(eyeWorld))
        const skip = isIdentitySE3(eyeInv)
        for (const L of scene) {
            const wt = skip ? L : SE3.compose(eyeInv, L)
            const p = wt.position, q = wt.rotation  // mirror the .set() reads
            void p; void q
        }
    }

    for (let i = 0; i < 2000; i++) frame()  // warmup
    gc()
    const heapBefore = heap()
    const tickMs = []
    for (let f = 0; f < frames; f++) {
        const t0 = performance.now()
        frame()
        tickMs.push(performance.now() - t0)
    }
    gc()
    const heapDelta = heap() - heapBefore
    tickMs.sort((a, b) => a - b)

    // Analytic allocation/frame: eyeCameraPose(1 Versor) + invert(1 Versor + 2 arrays)
    // + per-layer compose (1 Versor + 2 arrays) when not skipped.
    const composes = mode === "empty" ? 0 : layers
    const versors = 2 + composes
    const arrays = 2 + 2 * composes

    return {
        mode, layers, frames,
        usPerFrame: percentile(tickMs, 50) * 1000,
        usP95: percentile(tickMs, 95) * 1000,
        heapDeltaPerFrameB: heapDelta / frames,
        allocVersors: versors,
        allocArrays: arrays,
        allocBytesApprox: (versors + arrays) * 48,
    }
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
