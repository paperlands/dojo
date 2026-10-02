// Numeric-unit cost — the instrument that can see what the command bench cannot.
//
// Run:  node test/js/profile/numeric_cost_bench.mjs
//
// WHY A SEPARATE BENCH. `command_cost_bench.mjs` measures whole commands, and this
// workload is allocation-dominated: measured 2026-10-02, its same-tree spread was
// 1.3x-2.3x per fixture, and even after moving to MIN-of-5 with a per-row jitter
// report, an A/B of a real change read as ±10-15%. So a unit that costs 162 ns inside a
// 3 000 ns command is *inside the machine's resolution* there — and invisible in a CPU
// profile too, because `yield*` delegation is charged to the CALLER's self time.
//
// WHAT THIS MEASURES INSTEAD. Pure units, one process, min-of-N:
//   · a unit cost is deterministic per call, so the minimum converges;
//   · the JIT is warmed before timing, and every row reports its own max/min jitter,
//     so a reader sees how much the row is worth;
//   · it reports; it does not assert. Correctness fences live in *_test.mjs.
//
// It reports ns/call. Multiply by the calls per command to price a change in a command:
// a `label` pays one `format`, a `fw` pays one door, every computed value pays one
// `conditionOf`.

import { demand, conditionOf, format } from "../../../assets/js/turtling/numerics.js"

const REPS = 13
const ITERS = 300000

let sink = 0   // defeats dead-code elimination without changing the measurement
const bench = (fn, iters = ITERS) => {
    for (let i = 0; i < iters; i++) sink += fn(i) ? 1 : 0                 // warm the tier
    let best = Infinity, worst = 0
    for (let r = 0; r < REPS; r++) {
        const t0 = process.hrtime.bigint()
        for (let i = 0; i < iters; i++) sink += fn(i) ? 1 : 0
        const ns = Number(process.hrtime.bigint() - t0) / iters
        if (ns < best) best = ns
        if (ns > worst) worst = ns
    }
    return { ns: best, jitter: worst / best }
}

const rows = []
const row = (label, fn, iters) => rows.push({ label, ...bench(fn, iters) })

// ── The door on the common path ─────────────────────────────────────────────
// `admit` (executor.js) returns before any object exists when the value is finite:
// this is the whole check it performs per argument.
row("conditionOf (a finite measure)", (i) => conditionOf(i % 1000) === "finite")
row("demand, verdict taken", (i) => demand(i % 1000, { as: "walk" }).verdict === "take")
row("demand, a refusal (it allocates)", (i) => demand(NaN, { as: "walk", expr: "x" }).verdict === "refuse")

// ── The display gate, by what the value looks like ──────────────────────────
// A round value is the cheap path (the spelling already fits the budget); a residue is
// the expensive one (one toPrecision and a parse back). The gate this replaced was a
// SEARCH, so its cost scaled with the number — 59 ns on 42 and 3665 ns on 1/3.
const CLASSES = [
    ["a round integer", 42],
    ["a round fraction", 0.5],
    ["a residue (0.1+0.2)", 0.1 + 0.2],
    ["a repeating third", 1 / 3],
    ["pi", Math.PI],
    ["a tiny exponential", 1e-15],
    ["a large magnitude", 1e9 + 1e-8],
    ["a non-number", NaN],
]
for (const [label, value] of CLASSES) row(`format: ${label}`, () => format(value).length > 0, 200000)
row("String(value) for reference", (i) => String(1 / 3).length > 0, 200000)

const widest = Math.max(...rows.map((r) => r.ns))
console.log(`\nnumeric units — ns per call, MIN of ${REPS}, jitter = max/min\n`)
console.log("  " + "unit".padEnd(38) + "ns/call".padStart(9) + "jitter".padStart(8))
console.log("  " + "-".repeat(56))
for (const r of rows) {
    console.log("  " + r.label.padEnd(38)
        + r.ns.toFixed(1).padStart(9)
        + (r.jitter.toFixed(2) + "x").padStart(8))
}
console.log(`\n  widest: ${widest.toFixed(1)} ns — a command budget is in the thousands, so read this`)
console.log("  per call and multiply, never as a whole-command difference. (sink " + (sink % 1000) + ")\n")
