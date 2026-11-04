// Drag bench — the gesture the other benches do not cover.
//
//   node --expose-gc test/js/profile/drag_bench.mjs
//
// The rig covers steady animation, spawn/rewire churn, typing and the eye. None of
// them drags a point, which is the shape the user actually feels. This bench drives
// the real scheduler exactly as the rig's harness does (counting drain stub in place
// of the materializer), but each frame it first floods the hand with pointer events
// the way a browser does, then commits once.
//
// It answers three questions the model can answer:
//   1. how many rebuilds a pointer flood costs (must be ONE per frame, not one per event)
//   2. what a drag frame costs in ms and in retained bytes (the leak signal)
//   3. when the answer ARRIVES — the tick of the clear versus the tick of the ink
//
// What it CANNOT answer is the render layer: geometry/draw-call churn, GPU upload,
// material-cache growth. That pool needs a browser, and the instrument already exists:
//
//   /shell?perf=1                                     — the profiler panel
//   canvas.__turtle                                   — always exposed
//   import("/assets/js/turtling/profile/overlay.js")
//     .then(m => m.attachProfilerOverlay(canvas.__turtle))
//
// ACCEPTANCE, in-browser, while dragging the same program:
//   renderer.info.geometries and .render.calls stay FLAT   (not climb-and-fall per frame)
//   matCache does not grow per frame
//   the rendered path follows the pointer with no gaps    (see pointer coalescing)
//
// (id:laws-figures-phase34-inplace)

import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { snapshotRetained } from "./harness.mjs"

const gcNow = () => { if (typeof global.gc === "function") { global.gc(); global.gc() } }
const heap = () => process.memoryUsage().heapUsed
const kb = (n) => (n / 1024).toFixed(1) + "KB"

// Exactly the rig's scheduler: execOpts carries only colour, so breathEvery falls to
// the executor's DEFAULT (512) — the product's setting, not a test's. That matters:
// with breathEvery 1 (what the laws harness uses) a body is walked across ticks and
// looks "perpetually partial"; with 512 a small body completes inside its own frame.
function buildScheduler() {
    return createScheduler(metaRoot(), {
        rootName: "world",
        createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }),
        execOpts: { color: "#e77808" },
        onShout: () => {},
    })
}

function drainAll(scheduler, events) {
    let drained = 0
    for (const ambient of scheduler.registry.values()) {
        if (ambient === scheduler.root) continue
        for (const event of ambient.channel.drain()) { events.push({ frame: ambient, event }); drained++ }
    }
    return drained
}

// The user's program: one derived figure from a dragged input.
const SRC = `let X
let size = X.x + 20
def petal s do
  beColour red
  fw s
  lt 90
  fw s
end
let art = petal size
wait 400
`

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}

// A drag: `eventsPerFrame` pointer samples arrive between two commits, then one drain.
function drag({ frames = 240, eventsPerFrame = 8, frameMs = 16 } = {}) {
    const scheduler = buildScheduler()
    scheduler.hotSwapChild("buf", { name: "world", code: { ast: parseProgram(SRC), functions: null }, style: { color: "#e77808" }, env: null })

    const events = []
    let now = scheduler.lastTickTime || 0
    // settle the batch (the figure must exist before the drag begins)
    let guard = 4000
    while (guard-- > 0) {
        const progress = scheduler.tick(now)
        const drained = drainAll(scheduler, events)
        // The rig's stub drains CHANNELS but not the readout store. A derived value
        // recomputes here, so a derived figure only rebuilds if this is called — without
        // it a drag of `let art = petal size` reports ZERO rebuilds and looks free.
        // (the rig's own suite has no derived-figure program, so it never surfaced)
        scheduler.readouts.drain()
        if (scheduler.done || (!progress && drained === 0)) break
    }

    const host = scheduler.root.children.get("buf") ?? scheduler.root.children.get("world")
    const X = find(host, "X")
    const art = find(host, "art")
    if (!X || !art) throw new Error("the drag program did not seat X and art")

    gcNow()
    const heapBefore = heap()
    const retainedBefore = snapshotRetained(scheduler)
    const rebuilds0 = art.runIncarnation
    const gcs = []
    const onGc = (e) => gcs.push(e)
    // GC visibility (best effort: entries appear when the runtime emits them)
    let observer = null
    try {
        const { PerformanceObserver } = require("node:perf_hooks")
        observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) onGc(e) })
        observer.observe({ entryTypes: ["gc"] })
    } catch { /* optional */ }

    const ms = []
    let accepted = 0
    for (let f = 0; f < frames; f++) {
        const t0 = performance.now()
        // --- the pointer flood: every event is a statement, none of them is a frame
        for (let i = 0; i < eventsPerFrame; i++) {
            const x = (f + i / eventsPerFrame) * 0.5
            const verdict = scheduler.requestMotion(X, { rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [x, 0, 0] },
                scheduler.motionRevision, "world")
            if (verdict.kind === "accept") accepted++
        }
        now += frameMs
        scheduler.readouts.drain()
        scheduler.tick(now)
        drainAll(scheduler, events)
        ms.push(performance.now() - t0)
    }

    gcNow()
    const heapAfter = heap()
    const retainedAfter = snapshotRetained(scheduler)
    if (observer) observer.disconnect()

    ms.sort((a, b) => a - b)
    const pct = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))]
    return {
        frames, eventsPerFrame, accepted,
        rebuilds: art.runIncarnation - rebuilds0,
        msP50: pct(0.5), msP95: pct(0.95),
        heapPerFrame: (heapAfter - heapBefore) / frames,
        retained: { before: retainedBefore, after: retainedAfter },
        gcs: gcs.length,
        finish: art.done ? "settled" : "still running",
    }
}

// --- the answer's arrival: which frame carries the clear, which carries the ink
function arrival() {
    const scheduler = buildScheduler()
    scheduler.hotSwapChild("buf", { name: "world", code: { ast: parseProgram(SRC), functions: null }, style: { color: "#e77808" }, env: null })
    const events = []
    let now = scheduler.lastTickTime || 0, tick = 0
    const one = () => {
        scheduler.readouts.drain()
        scheduler.tick(now)
        now += 16; tick++
        const n = events.length
        const drained = drainAll(scheduler, events)
        for (let i = n; i < events.length; i++) events[i].tick = tick
        return drained
    }
    let guard = 4000
    while (guard-- > 0) { const p = one(); if (scheduler.done && p === 0) break }
    const host = scheduler.root.children.get("buf") ?? scheduler.root.children.get("world")
    const X = find(host, "X")
    const art = find(host, "art")
    const from = events.length
    scheduler.requestMotion(X, { rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [7, 0, 0] }, scheduler.motionRevision, "world")
    for (let i = 0; i < 4; i++) one()
    const after = events.slice(from).filter((r) => r.frame === art)
    const clearFrame = after.find((r) => r.event.type === "clear")?.tick ?? null
    const inkFrame = after.find((r) => r.event.type === "path")?.tick ?? null
    const gap = (clearFrame !== null && inkFrame !== null) ? inkFrame - clearFrame : null
    return { clearFrame, inkFrame, gap, sequence: after.map((r) => `${r.tick}:${r.event.type}`).join(" → ") }
}

const r = drag({})
console.log(`drag: ${r.frames} frames × ${r.eventsPerFrame} pointer events = ${r.accepted} accepted statements`)
console.log(`      ${r.rebuilds} rebuild(s)   → ${(r.accepted / Math.max(1, r.rebuilds)).toFixed(1)} statements per rebuild (coalescing)`)
console.log(`      ${r.msP50.toFixed(3)}ms p50   ${r.msP95.toFixed(3)}ms p95   ${r.heapPerFrame.toFixed(0)}B/frame retained   gc entries ${r.gcs}`)
console.log(`      retained: registry ${r.retained.before.registry}→${r.retained.after.registry}  frames ${r.retained.before.frames}→${r.retained.after.frames}  mailbox ${r.retained.before.mailbox}→${r.retained.after.mailbox}  childLinks ${r.retained.before.childLinks}→${r.retained.after.childLinks}`)
console.log(`      finish: ${r.finish}`)

const a = arrival()
console.log(`\none drag, by frame after the statement: ${a.sequence}`)
console.log(`clear on frame ${a.clearFrame}, first ink on frame ${a.inkFrame}  → ${a.gap} frame(s) of nothing`)
console.log(`\nthe model cannot see geometry churn. In-browser acceptance, while dragging:`)
console.log(`  renderer.info.geometries and .render.calls stay FLAT; matCache does not grow per frame.`)
