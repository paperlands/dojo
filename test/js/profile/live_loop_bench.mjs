// Live-loop bench — the loops a livecoder actually lives in, measured end-to-end
// and expressed against the user's budget.
//
//   node test/js/profile/live_loop_bench.mjs
//
// Four loops, each a user action and the pipeline it drives:
//
//   keystroke   type a character → reparse → contentKey → pageLaw.observe   budget: 1 frame (16.6 ms)
//   run         press Run        → parse → execute → first ink             budget: "instant" (100 ms)
//   edit-live   edit while running → reparse → re-execute                  budget: 1 frame (16.6 ms)
//   held-figure declare `let F = …` → read args → spawn                   budget: part of the flush
//
// Two statistics, because they answer different questions:
//   typical (p50) — what the user feels. GC pauses show up here.
//   floor  (best) — the CODE's intrinsic cost. A loaded machine lifts the mean, not
//                   the floor, so the FENCE sits on the floor and stays stable.
// Reporting only the floor would hide a GC-bound path; fencing on the typical would
// fail on a busy machine. Both, labelled. Drag/pointer rebuild lives in drag_bench.mjs.

import { reparseProgram, parseProgram } from "../../../assets/js/turtling/parse.js"
import { execute, createActorState } from "../../../assets/js/turtling/executor.js"
import { pageLaw } from "../../../assets/js/weave/page.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const FRAME_MS = 1000 / 60          // 16.6 ms — the reactivity budget
const INSTANT_MS = 100              // first ink should feel immediate

const pad = (s, n) => String(s).padEnd(n)
const ms = (v) => v.toFixed(3)
const pct = (v, budget) => (100 * v / budget).toFixed(1) + "%"
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

let failures = 0
const guard = (label, ok, msg) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : "  —  " + msg}`)
    if (!ok) failures++
}

function stats(n, fn) {
    const xs = []
    for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(i); xs.push(performance.now() - t0) }
    xs.sort((a, b) => a - b)
    return { p50: xs[Math.floor(n * 0.5)], p95: xs[Math.min(n - 1, Math.floor(n * 0.95))], floor: xs[0] }
}
const row = (label, st, budget) =>
    `  ${pad(label, 14)} ${pad("typical " + ms(st.p50) + " ms", 22)} ${pad(pct(st.p50, budget) + " of budget", 17)} ${pad("p95 " + ms(st.p95) + " ms", 18)} ${pad("floor " + ms(st.floor) + " ms", 18)}`

console.log("\n=== live-loop bench ===  node " + process.version + "\n")
console.log(`budgets: frame ${FRAME_MS.toFixed(1)} ms · "instant" first ink ${INSTANT_MS} ms\n`)

// ── Doc generator (a cell per chapter — what the editor holds) ──────────────
function unitBlock(i) {
    return ["###", `* Chapter ${i}`, "prose text", "```", `def fig${i} n do`, "  fw n", "  rt 90",
        "  for 4 do", "    fw 20", "    rt 90", "  end", "  wait 100", "end", "```", "###", ""].join("\n")
}
const makeSrc = (n) => Array.from({ length: n }, (_, i) => unitBlock(i)).join("\n")
const OVERLAY = new Set(["span", "comment", "endComment", "lit"])
const contentKey = (node) => JSON.stringify(node, (k, v) => (OVERLAY.has(k) ? undefined : v))

// ── 1. KEYSTROKE — the typing loop ──────────────────────────────────────────
// Each keystroke: reparse (parse + adopt) → contentKey → pageLaw.observe.
console.log("KEYSTROKE — one character typed")
for (const cells of [8, 40, 80]) {
    const src = makeSrc(cells)
    const editAt = src.split("\n").findIndex((l) => l.includes("fw 20"))
    const law = pageLaw({ localKeys: () => [] })
    law.observe("b", { name: "b", doc: src, own: true, attention: { line: 5 } })
    let prev = parseProgram(src), text = src, val = 20
    const st = stats(200, () => {
        // Always a REAL change: a no-op edit makes reparseProgram return early and
        // poisons the `floor` with a fake-fast sample (measured 1.8 ms floor vs 9 ms p50).
        val = 20 + (val - 20 + 1) % 30
        const ls = text.split("\n")
        ls[editAt] = `    fw ${val}`
        const next = ls.join("\n")
        const ast = reparseProgram(next, text, prev)
        for (const n of ast) contentKey(n)
        law.observe("b", { name: "b", doc: next, own: true, attention: { line: editAt + 1 } })
        prev = ast; text = next
    })
    console.log(row(`${cells} cells`, st, FRAME_MS))
    guard(`keystroke ${cells} cells floor ≤ 2 frames`, st.floor < 2 * FRAME_MS,
        `${ms(st.floor)} ms floor > ${(2 * FRAME_MS).toFixed(1)} ms — typing would stutter`)
}
console.log("  (compute-bound: contentKey — JSON.stringify+replacer — profiled at ~64% of this path; observe re-parses the doc)")
console.log("")

// ── 2. RUN — parse → execute → first ink ────────────────────────────────────
// A program that draws immediately but runs long: first ink is what the user sees
// first; the full flush is the whole run. Both timed from Run.
const RUN = "loop 20000 do\n fw 1\n rt 1\nend\n"
const runTimed = (firstInkOnly) => {
    const t0 = performance.now()
    const gen = execute(parseProgram(RUN), deps(), { actorState: createActorState() })
    if (firstInkOnly) {
        for (let r = gen.next(); !r.done; r = gen.next()) if (r.value && r.value.type === "path") break
    } else { for (const _ of gen) { } }
    return performance.now() - t0
}
const ink = stats(200, () => runTimed(true))
const full = stats(50, () => runTimed(false))
console.log("RUN — press Run")
console.log(row("first ink", ink, INSTANT_MS))
console.log(row("full flush", full, FRAME_MS) + "   (20k commands, batched — the breath preempts)")
guard("first ink feels instant", ink.p50 < INSTANT_MS, `${ms(ink.p50)} ms > ${INSTANT_MS} ms budget`)
console.log("")

// ── 3. EDIT-LIVE — edit while running → reparse → re-execute ────────────────
// The hot-swap cost: an edit re-parses and re-runs. This is the reactivity of a
// livecoding session — the smaller it is, the more the user can edit mid-flow.
const LIVE = makeSrc(20)
const liveEdit = () => {
    const ls = LIVE.split("\n")
    const at = ls.findIndex((l) => l.includes("fw 20"))
    ls[at] = "    fw 21"
    const next = ls.join("\n")
    const ast = reparseProgram(next, LIVE, parseProgram(LIVE))
    for (const _ of execute(ast, deps(), { actorState: createActorState() })) { }
}
const live = stats(50, liveEdit)
console.log("EDIT-LIVE — edit a running program")
console.log(row("20-cell edit", live, FRAME_MS))
guard("a live edit floors under 4 frames", live.floor < 4 * FRAME_MS,
    `${ms(live.floor)} ms > ${(4 * FRAME_MS).toFixed(0)} ms — editing mid-run would stutter`)
console.log("")

// ── 4. HELD-FIGURE — `let F = …` → read args → spawn ────────────────────────
// The reader runs during the flush. Its cost is the cost of "one contract": the
// splitter it replaced was ~10× cheaper but could not read `fw 2 + 3` as one arg.
const held = (n) => Array.from({ length: n }, (_, i) => `let F${i} = fw ${i + 2} + ${i}`).join("\n")
const plain = (n) => Array.from({ length: n }, (_, i) => `fw ${i + 2} + ${i}`).join("\n")
const flush = (src) => { for (const _ of execute(parseProgram(src), deps(), { actorState: createActorState() })) { } }
const N = 50
const heldSt = stats(100, () => flush(held(N)))
const plainSt = stats(100, () => flush(plain(N)))
console.log(`HELD-FIGURE — ${N} × \`let F = …\``)
console.log(row("held", heldSt, FRAME_MS))
console.log(row("plain", plainSt, FRAME_MS))
console.log(`  reader share: ${ms(heldSt.p50 - plainSt.p50)} ms (${(100 * (heldSt.p50 - plainSt.p50) / heldSt.p50).toFixed(0)}% of a figure-heavy flush)`)
guard(`${N} held figures floor ≤ 2 frames`, heldSt.floor < 2 * FRAME_MS,
    `${ms(heldSt.floor)} ms > ${(2 * FRAME_MS).toFixed(0)} ms — the reader path is weighing on the flush`)
console.log("")

if (failures > 0) { console.error(`${failures} budget failure(s).`); process.exit(1) }
console.log("All live-loop budgets held.\n")
