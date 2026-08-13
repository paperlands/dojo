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
    "fw [expr]":                `loop ${N} do\n  fw [count % 7 + 1]\nend`,
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
    "fw [nested x3]":           `loop ${N} do\n  fw [[[count+1]*[count+2]]+1]\nend`,
    "fw [nested x6]":           `loop ${N} do\n  fw [[[[[count+1]*[count+2]]+[count+3]]*[count+4]]+1]\nend`,
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

const rows = []
for (const [label, src] of Object.entries(FIXTURES)) {
    // Median of 3 — one outlier from a GC pause should not set the spread.
    const trials = [measure(src), measure(src), measure(src)]
        .sort((a, b) => a.nsPerCommand - b.nsPerCommand)
    rows.push({ label, ...trials[1] })
}

const cheapest = Math.min(...rows.map((r) => r.nsPerCommand))
rows.sort((a, b) => a.nsPerCommand - b.nsPerCommand)

console.log("\ncommand cost — ns per command executed, median of 3, N=" + N + "\n")
console.log("  " + "command".padEnd(26) + "ns/cmd".padStart(9) + "×cheapest".padStart(11) + "  commands")
console.log("  " + "-".repeat(60))
for (const r of rows) {
    console.log("  " + r.label.padEnd(26)
        + r.nsPerCommand.toFixed(0).padStart(9)
        + (r.nsPerCommand / cheapest).toFixed(1).padStart(10) + "x"
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
