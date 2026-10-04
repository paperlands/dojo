// probe-status: concluded
// The tiny-signal probe — where the approximation policy becomes visible.
// A diagnostic instrument, not an acceptance suite.
//
//   node probe/tower-rounding/probe.mjs            # human summary
//   node probe/tower-rounding/probe.mjs --jsonl    # one JSON object per line
//
// BEFORE / AFTER. `was` is what Phase 1's arithmetic gave, kept as the historical
// record (`observations.jsonl`, written when the gate was live: `+`, `-` and every
// builtin result snapped to 1e14). `landed` is measured NOW: arithmetic is the
// substrate's, and the display is where a learner's eye gets a clean answer.
// (id:tower-center-approximation-ruling — accepted and implemented; the display gate
// is numerics:format.)
//
// What the ruling changed, in one line: `0 + 1e-15` was 0 and `1000 * 1e-15` was
// 1e-12 — two spellings of one value, 100% apart. They agree now.

import { createTower, installScalarFloor } from '../../assets/js/turtling/mafs/tower.js'
import { drainEvents } from '../../assets/js/turtling/executor.js'
import { parseProgram } from '../../assets/js/turtling/parse.js'
import { Parser } from '../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../assets/js/turtling/mafs/evaluate.js'
import { format } from '../../assets/js/turtling/numerics.js'

const tower = installScalarFloor(createTower())
const add = (a, b) => tower.apply('+', a, b)
const mul = (a, b) => tower.apply('*', a, b)
const eq = (a, b) => tower.apply('==', a, b)

const rows = []
const note = (label, was, landed, comment) =>
    rows.push({ label, was: String(was), landed: String(landed), comment })

// ── Authored arithmetic: the gate separated sums from products ──────────────
note('0 + 1e-15', 0, add(0, 1e-15), 'a tiny signal survives the sum')
note('1e-15 + 1e-15', 0, add(1e-15, 1e-15), 'and two of them')
note('1e-15 * 1', 1e-15, mul(1e-15, 1), 'a product was never gated')
note('1e-15 + 0', 0, add(1e-15, 0), 'the additive identity holds — the same value')
note('1 + 1e-15', 1, add(1, 1e-15), 'the tail double precision can hold is KEPT')
note('(1 + 1e-15) - 1', 0, add(add(1, 1e-15), -1), 'cancellation finds it again')

// ── Authored accumulation vs a measured walk ────────────────────────────────
let sum = 0
for (let i = 0; i < 1000; i++) sum = add(sum, 1e-15)
const walk = (steps) => {
    const events = drainEvents(parseProgram(`loop ${steps} do\n  fw 1e-15\nend`),
        { mathParser: new Parser(), mathEvaluator: new Evaluator() })
    const points = events.filter((e) => e.type === 'path').flatMap((p) => p.points ?? [])
    return points[points.length - 1][0]
}
note('authored: 1e-15 added 1000 times', 0, sum, 'the model of accumulation')
note('authored: 1000 * 1e-15', 1e-12, mul(1000, 1e-15), 'the product')
note('measured: fw 1e-15 x 1000', 1.0000000000000052e-12, walk(1000),
    'the walk — ordinary addition, which never was gated')

// ── The cost, and where it went ────────────────────────────────────────────
// Restoring tiny signals cannot make trig exact. What a learner READS is clean,
// because reading is display and display is not arithmetic. (numerics:format)
const rawSin30 = Math.sin(30 * Math.PI / 180)
const rawSin180 = Math.sin(180 * Math.PI / 180)
note('sin(30)', 0.5, tower.apply('sin', 30), 'the arithmetic answer')
note('sin(30) == 0.5', 1, eq(tower.apply('sin', 30), 0.5), 'the familiar equality — CHANGED')
note('sin(180) == 0', 1, eq(tower.apply('sin', 180), 0), 'and this one — CHANGED')
note('abs(1e-15) == 1e-15', 0, eq(tower.apply('abs', 1e-15), 1e-15), 'restored')
note('display: sin(30)', '0.5', format(rawSin30), 'what the eye reads, and never computes with')
note('display: sin(180)', 0, format(rawSin180), 'the residue is SHOWN as it is — the display does not invent a zero')
note('the idiom: round(sin(180), 0.0001)', '0', format(mul(tower.apply('round', rawSin180, 0.0001), 1)),
    'snapping is asked for, never assumed')
note('display: 0.1 + 0.2', '0.30000000000000004', format(0.1 + 0.2), 'the residue stays OUT of the eye')

if (process.argv.includes('--jsonl')) {
    for (const row of rows) console.log(JSON.stringify(row))
} else {
    for (const row of rows) {
        console.log(`${row.label.padEnd(32)} was ${String(row.was).padEnd(22)} now ${String(row.landed).padEnd(22)} // ${row.comment}`)
    }
    console.log(`\n${rows.length} readings. --jsonl records them.`)
}
