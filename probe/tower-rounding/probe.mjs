// The tiny-signal probe — where the approximation policy becomes visible. A
// diagnostic instrument, not an acceptance suite: it records what the system does
// today, and what the proposed ruling would change, so the decision is made on
// evidence. (id:tower-center-approximation)
//
//   node probe/tower-rounding/probe.mjs            # human summary
//   node probe/tower-rounding/probe.mjs --jsonl    # one JSON object per line
//
// "current" is the center's answer (implicit 1e14 rounding on +, -, and builtin
// results). "unquantized" is what removal of that rounding would give — plain
// JavaScript, standing in for the proposed arithmetic.

import { createTower, installScalarFloor } from '../../assets/js/turtling/mafs/tower.js'
import { drainEvents } from '../../assets/js/turtling/executor.js'
import { parseProgram } from '../../assets/js/turtling/parse.js'
import { Parser } from '../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../assets/js/turtling/mafs/evaluate.js'

const tower = installScalarFloor(createTower())
const add = (a, b) => tower.apply('+', a, b)
const mul = (a, b) => tower.apply('*', a, b)
const eq = (a, b) => tower.apply('==', a, b)

const rows = []
const note = (label, value, comment) => rows.push({ label, value: String(value), comment })

// ── Authored arithmetic: the center gates sums but not products ─────────────
note('0 + 1e-15', add(0, 1e-15), 'below the floor: snaps to zero')
note('0 + 1e-15 (plain JS)', 0 + 1e-15, 'JavaScript keeps it — the gap is policy')
note('0 + 1e-14', add(0, 1e-14), 'at the floor')
note('1e-15 + 1e-15', add(1e-15, 1e-15), 'two tiny terms still vanish')

// The strong form: an existing value changes merely by adding zero.
note('1e-15 * 1', mul(1e-15, 1), 'an existing value, product: ungated')
note('1e-15 + 0', add(1e-15, 0), 'the same value, sum: gated — additive identity fails')

// ── Authored accumulation is a MODEL, not a walk ────────────────────────────
let sum = 0
for (let i = 0; i < 1000; i++) sum = add(sum, 1e-15)
note('authored: 1e-15 added 1000 times', sum, 'model of accumulation, not a measured walk')
note('authored: 1000 * 1e-15', mul(1000, 1e-15), 'the product is not gated')

// ── The measured walk: `fw` accumulates unquantized, so it DOES move ─────────
const walk = (steps) => {
    const events = drainEvents(parseProgram(`loop ${steps} do\n  fw 1e-15\nend`),
        { mathParser: new Parser(), mathEvaluator: new Evaluator() })
    const points = events.filter((e) => e.type === 'path').flatMap((p) => p.points ?? [])
    return points[points.length - 1][0]
}
note('measured: fw 1e-15 x 1000', walk(1000), 'ordinary addition — the walk moves')
note('the seam', 'authored + is gated; geometric accumulation is not',
    'two approximation policies, one language')

// ── The cost of removing builtin rounding: familiar equalities change ───────
// Restoring tiny signals is not free — some equalities a learner already relies
// on stop holding. (id:tower-center-approximation-ruling)
const rawSin30 = Math.sin(30 * Math.PI / 180)
const rawSin180 = Math.sin(180 * Math.PI / 180)
const rawAbs = Math.abs(1e-15)

note('sin(30) current', tower.apply('sin', 30), 'rounded to 0.5')
note('sin(30) unquantized', rawSin30, 'exactly Math.sin(pi/6)')
note('sin(30) == 0.5 current', eq(tower.apply('sin', 30), 0.5), 'familiar equality holds')
note('sin(30) == 0.5 unquantized', rawSin30 === 0.5 ? 1 : 0, 'equality would CHANGE')
note('sin(180) == 0 current', eq(tower.apply('sin', 180), 0), 'holds')
note('sin(180) == 0 unquantized', rawSin180 === 0 ? 1 : 0, 'equality would CHANGE')
note('abs(1e-15) == 1e-15 current', eq(tower.apply('abs', 1e-15), 1e-15), 'destroyed by rounding')
note('abs(1e-15) == 1e-15 unquantized', rawAbs === 1e-15 ? 1 : 0, 'restored')

if (process.argv.includes('--jsonl')) {
    for (const row of rows) console.log(JSON.stringify(row))
} else {
    for (const row of rows) {
        console.log(`${row.label.padEnd(32)} = ${row.value.padEnd(24)} // ${row.comment}`)
    }
}
