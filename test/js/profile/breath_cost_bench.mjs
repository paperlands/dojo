// What the breath costs — the preemption boundary's price, measured.
//
// Run:  node test/js/profile/breath_cost_bench.mjs
//
// The breath (D027 R3) yields a value carrying nothing every `breathEvery` node
// visits so the scheduler can read the clock. The fear it had to answer: R2
// measured OUTPUT yields at 6.7x wall time, so would a boundary every 512 visits
// cost the same? It does not — a breath carries no SE3 transform, no credit
// routing, no channel put.
//
// THIS LIVES IN THE PROFILE RIG, NOT THE SUITE. It began life as two asserting
// tests in quantum_spike_test.mjs and made the suite fail ~1 run in 5 under
// load: a wall-clock ratio measures the machine, not the code. A flaky fence is
// worse than no fence — it teaches people to ignore red. Correctness fences stay
// in `_test.mjs` (the breath does not move the figure — B3/S1/S2, deterministic);
// cost is a bench, and a bench reports.

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

// One unbroken stroke — the shape with the fewest natural boundaries, so the
// breath's cost is at its most visible relative to the work.
const continuousLine = (n) => `loop ${n} do\n  fw 1\n  rt 0.01\nend`

function run(src, { breathEvery }) {
    const scheduler = createScheduler(metaRoot(), {
        rootName: "world",
        createDeps: realDeps,
        execOpts: { color: "#e77808", breathEvery },
        onShout: () => {},
    })
    // No deadline armed: time the BREATH itself, never the parking it enables.
    scheduler.hotSwapChild("buf", {
        name: "main", code: { ast: parseProgram(src), functions: null },
        style: { color: "#e77808" }, env: null,
    })
    let segments = 0
    let guard = 200000
    while (guard-- > 0) {
        scheduler.tick(0)
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
    return { segments, commands: frame?.commandCount ?? 0, reductions: frame?.actorState?.reductions ?? 0 }
}

const N = 100000
const TRIALS = 7
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]

const src = continuousLine(N)

// Warm both paths before timing either: JIT tiering would otherwise rank them by
// declaration order rather than by cost.
run(src, { breathEvery: 0 })
run(src, { breathEvery: 512 })

console.log(`\nbreath cost — ${N} segments, one unbroken stroke, median of ${TRIALS}\n`)
console.log("  " + "quantum".padEnd(12) + "ms".padStart(9) + "  vs off" + "   breaths")
console.log("  " + "-".repeat(46))

// ROUND-ROBIN, not arm-at-a-time: a slow patch of the machine must hit every
// quantum equally or it becomes a ranking. The first cut of this bench ran each
// arm to completion in turn and reported K=512 as FASTER than off and K=2048 as
// 1.39x slower — pure drift, presented as a trend.
const QUANTA = [0, 128, 512, 2048]
const samples = new Map(QUANTA.map((K) => [K, []]))
const rows = new Map()

for (let i = 0; i < TRIALS; i++) {
    for (const K of QUANTA) {
        const t = performance.now()
        const r = run(src, { breathEvery: K })
        samples.get(K).push(performance.now() - t)
        if (i === 0) rows.set(K, r)
    }
}

const base = med(samples.get(0))
for (const K of QUANTA) {
    const xs = samples.get(K)
    const ms = med(xs)
    const label = K === 0 ? "off" : String(K)
    const breaths = K === 0 ? 0 : Math.round(rows.get(K).commands / K)
    console.log("  " + label.padEnd(12)
        + ms.toFixed(1).padStart(9)
        + (K === 0 ? "        —" : (ms / base).toFixed(2).padStart(8) + "x")
        + String(breaths).padStart(10)
        + `   [${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)}]`)
}

// The honest gate. If the baseline's own spread is wider than the gap between
// arms, this bench cannot resolve the breath's cost and must say so rather than
// rank noise. That is the useful answer either way: too small to measure here.
const offXs = samples.get(0)
const noise = (Math.max(...offXs) - Math.min(...offXs)) / base
const spread = (Math.max(...QUANTA.map((K) => med(samples.get(K))))
    - Math.min(...QUANTA.map((K) => med(samples.get(K))))) / base
console.log(`\n  baseline noise: ±${(noise * 100).toFixed(0)}%   between-quantum spread: ${(spread * 100).toFixed(0)}%`)
console.log(spread < noise
    ? "  → the breath's cost is BELOW this rig's noise floor. Unmeasurable = negligible."
    : "  → resolvable: the ranking above is signal, not drift.")

// The figure must be identical at every quantum — if this ever differs, the
// number above is meaningless and the correctness fences in
// test/js/runtime/quantum_spike_test.mjs are the thing to go read.
const segs = new Set([...rows.values()].map((r) => r.segments))
console.log("\n  segments at every quantum: " + [...segs].join(", ")
    + (segs.size === 1 ? "  (identical — the cost is pure overhead)" : "  ** FIGURE MOVED **"))
console.log("")

// ---------------------------------------------------------------------------
// Worst block under a real slice — what B1 used to fence as worstBlockMs < 40.
// Reports; does not assert. A wall threshold measures the machine (contention
// fails a green suite; alone it always passed). Correctness that the breath
// consulted the clock stays in quantum_spike_test.mjs B1.
// ---------------------------------------------------------------------------

const pureCompute = (n) => `loop ${n} do\n  rt 1\nend`
const strokeBroken = (n) => `loop ${n} do\n  fw 1\n  rt 0.01\n  beColour random\nend`

function runSliced(src, { sliceMs = 4, breathEvery = 512, maxTicks = 200000 } = {}) {
    let clockCalls = 0
    const clock = () => { clockCalls++; return performance.now() }
    const scheduler = createScheduler(metaRoot(), {
        rootName: "world", clock,
        createDeps: realDeps,
        execOpts: { color: "#e77808", breathEvery },
        onShout: () => {},
    })
    let sliceForCalls = 1
    scheduler.sliceFor(sliceMs)
    const seatStart = performance.now()
    scheduler.hotSwapChild("buf", {
        name: "main", code: { ast: parseProgram(src), functions: null },
        style: { color: "#e77808" }, env: null,
    })
    let worstBlockMs = performance.now() - seatStart
    let ticks = 0
    while (ticks < maxTicks) {
        ticks++
        sliceForCalls++
        scheduler.sliceFor(sliceMs)
        const t0 = performance.now()
        scheduler.tick(0)
        const blockMs = performance.now() - t0
        if (blockMs > worstBlockMs) worstBlockMs = blockMs
        let drained = 0
        for (const a of scheduler.registry.values()) {
            for (const _ of a.channel.drain()) drained++
        }
        if (scheduler.done && drained === 0) break
        if (!scheduler.building && !drained && !scheduler.done) break
    }
    return {
        worstBlockMs,
        deadlineChecks: clockCalls - sliceForCalls,
        ticks,
        done: scheduler.done,
    }
}

const SLICE_N = 100000
const SLICE_K = 1024
const SLICE_MS = 4
const SHAPES = [
    ["continuous", continuousLine(SLICE_N)],
    ["pureCompute", pureCompute(SLICE_N * 4)],
    ["strokeBroken", strokeBroken(SLICE_N)],
]

console.log(`worst block under ${SLICE_MS}ms slice — N=${SLICE_N}, K=${SLICE_K} (report only)\n`)
console.log("  " + "shape".padEnd(14) + "worstMs".padStart(10) + "  checks".padStart(9) + "  ticks".padStart(8) + "  done")
console.log("  " + "-".repeat(52))
for (const [label, src] of SHAPES) {
    const r = runSliced(src, { sliceMs: SLICE_MS, breathEvery: SLICE_K })
    console.log("  " + label.padEnd(14)
        + r.worstBlockMs.toFixed(1).padStart(10)
        + String(r.deadlineChecks).padStart(9)
        + String(r.ticks).padStart(8)
        + (r.done ? "    yes" : "     NO"))
}
console.log("\n  (no threshold: under load this climbs; alone a quiet machine is ~ms-scale)")
console.log("")
