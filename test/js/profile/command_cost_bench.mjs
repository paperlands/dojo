// Command-cost variance — the blocking measurement for D027 R3's quantum.
//
// Run:  node test/js/profile/command_cost_bench.mjs
//
// The breath charges one unit per node visited and lets the scheduler read the
// clock every K units. K is only meaningful if a unit is roughly a unit: the
// worst block is K × (cost of the most expensive thing a program can do between
// two boundaries). If `goto` costs 100× `rt`, then K tuned on `rt` is a 100×
// overrun waiting for the program that uses `goto`.
//
// This bench asks the world for the spread. It does NOT tune K by itself — the
// answer it gives is either "commands are uniform enough, pick K by cost" or
// "they are not, charge proportionally" (the BEAM's `bump_reductions`).
//
// ESTIMATOR: MIN of 5, with each row's own max/min jitter printed beside it. See the
// comment at the measurement loop — median-of-3 measured a 1.3x-2.3x same-tree spread
// on this workload and could not resolve a real change.

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { execute, createActorState } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

const N = 40000

// Each fixture is one loop body, measured as ns per COMMAND actually executed
// (commandCount), so bodies with different command counts stay comparable.
const FIXTURES = {
    "rt (pure rotation)":       `loop ${N} do\n  rt 1\nend`,
    "fw (transform + stroke)":  `loop ${N} do\n  fw 1\nend`,
    "fw + rt (the baseline)":   `loop ${N} do\n  fw 1\n  rt 0.01\nend`,
    "fw [expr]":                `loop ${N} do\n  fw (mod(count, 7) + 1)\nend`,
    "goto (world resolve)":     `loop ${N} do\n  goto 1 2 3\nend`,
    "faceto (world resolve)":   `loop ${N} do\n  faceto 1 2 3\nend`,
    "jmp (stroke break)":       `loop ${N} do\n  jmp 1\nend`,
    "beColour random":          `loop ${N} do\n  beColour random\nend`,
    "beColour hex":             `loop ${N} do\n  beColour ff2d55\nend`,
    "label (effect + text)":    `loop ${N} do\n  label 42\nend`,
    "hide/show (style only)":   `loop ${N} do\n  hd\nend`,
    // The tail. An expression's cost is bounded by the PROGRAM TEXT, not by the
    // command — which is the unbudgeted-BIF problem one level down. These probe
    // how fast the tail grows, because if it grows without bound then no choice
    // of K is safe and the charge must become proportional.
    "fw [nested x3]":           `loop ${N} do\n  fw (((count+1)*(count+2))+1)\nend`,
    "fw [nested x6]":           `loop ${N} do\n  fw (((((count+1)*(count+2))+(count+3))*(count+4))+1)\nend`,
}

function measure(src) {
    const st = createActorState()
    const gen = execute(parseProgram(src), deps(), { actorState: st })
    const t0 = process.hrtime.bigint()
    let values = 0
    for (let r = gen.next(); !r.done; r = gen.next()) values++
    const ns = Number(process.hrtime.bigint() - t0)
    return { ns, commands: st.commandCount, values, nsPerCommand: ns / st.commandCount }
}

// Warm every path before timing any (JIT tiering would otherwise rank the
// fixtures by declaration order, not by cost — a confound this rig has been
// bitten by before).
for (const src of Object.values(FIXTURES)) measure(src.replace(String(N), "2000"))

// MIN of REPS, and each row carries its own jitter.
//
// Measured 2026-10-02, same tree, three runs of THIS bench: per-fixture spread was
// 1.3x-2.3x. So median-of-3 could not resolve anything under ~2x, and an A/B of a real
// change read as ±30% of pure noise — a GC pause inside the timed region only ever ADDS
// time, and a long fixture catches one sooner or later. The minimum is the
// least-disturbed run: it approximates the COST rather than the machine's mood. The
// max/min ratio is reported beside every row so a reader sees how much the row is worth.
const REPS = 5
const rows = []
for (const [label, src] of Object.entries(FIXTURES)) {
    const trials = Array.from({ length: REPS }, () => measure(src))
    const best = trials.reduce((a, b) => (b.nsPerCommand < a.nsPerCommand ? b : a))
    const worst = trials.reduce((a, b) => (b.nsPerCommand > a.nsPerCommand ? b : a))
    rows.push({ label, ...best, jitter: worst.nsPerCommand / best.nsPerCommand })
}

const cheapest = Math.min(...rows.map((r) => r.nsPerCommand))
rows.sort((a, b) => a.nsPerCommand - b.nsPerCommand)

console.log("\ncommand cost — ns per command executed, MIN of " + REPS + ", N=" + N + "\n")
console.log("  " + "command".padEnd(26) + "ns/cmd".padStart(9) + "×cheapest".padStart(11) + "jitter".padStart(8) + "  commands")
console.log("  " + "-".repeat(68))
for (const r of rows) {
    console.log("  " + r.label.padEnd(26)
        + r.nsPerCommand.toFixed(0).padStart(9)
        + (r.nsPerCommand / cheapest).toFixed(1).padStart(10) + "x"
        + (r.jitter.toFixed(2) + "x").padStart(8)
        + String(r.commands).padStart(11))
}

const spread = Math.max(...rows.map((r) => r.nsPerCommand)) / cheapest
const worst = rows[rows.length - 1]
console.log("\n  spread: " + spread.toFixed(1) + "x  (worst: " + worst.label + ")")

// What the spread means for K, stated as the block it implies at a 4ms slice.
console.log("\n  implied worst block at K commands (4ms slice, worst-case body):")
for (const K of [256, 512, 1024, 2048]) {
    const blockMs = (K * worst.nsPerCommand) / 1e6
    const verdict = blockMs < 1 ? "well inside" : blockMs < 4 ? "inside" : "OVERRUNS"
    console.log("    K=" + String(K).padStart(5) + "  " + blockMs.toFixed(2).padStart(7) + " ms   " + verdict)
}
console.log("")
