// probe-status: concluded
// The composition probe — tiny signals and REPEATED COMPOSITION, where the
// approximation policy stops being a taste and becomes visible. A diagnostic
// instrument, not an acceptance suite: it records what the system does so a ruling
// can be made on evidence. Companion to probe.mjs (the tiny-signal probe).
//
//   node probe/tower-rounding/composition.mjs            # human summary
//   node probe/tower-rounding/composition.mjs --jsonl    # one JSON object per line
//
// The question this instrument answers: a program is a COMPOSITION, so a rounding
// rule invisible once ("0 + 1e-15 = 0") is not invisible in a loop, in a chain, or at
// a figure's own scale. Every row carries WHAT THE SYSTEM SAID about the value — read
// back out of the events, not asserted by hand, because a silent difference is the
// whole problem. (id:tower-center-approximation-ruling)
//
// Re-read 2026-11-03: the comparison door now preserves a NaN (section 5b);
// Infinity remains unruled, and interpolated display is still a separate gap.

import { createTower, installScalarFloor } from '../../assets/js/turtling/mafs/tower.js'
import { drainEvents } from '../../assets/js/turtling/executor.js'
import { parseProgram } from '../../assets/js/turtling/parse.js'
import { Parser } from '../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../assets/js/turtling/mafs/evaluate.js'
import { format } from '../../assets/js/turtling/numerics.js'
import { unit, sub } from '../../assets/js/turtling/laws/vec3.js'

// The two tolerance shapes this probe was written against lived in numerics.js
// until c80b184; the record keeps them locally rather than importing a policy
// that has since moved to the law pipeline.
const tol = (eps, of) => Object.freeze({ eps, of })
const within = (a, b, tolerance) => Math.abs(a - b) <= tolerance.eps * Math.abs(tolerance.of)

const tower = installScalarFloor(createTower())
const add = (a, b) => tower.apply('+', a, b)
const mul = (a, b) => tower.apply('*', a, b)

const rows = []
const note = (label, value, said, comment) =>
    rows.push({ label, value: String(value), said, comment })

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const run = (src, opts) => drainEvents(parseProgram(src), deps(), { maxCommands: 200000, ...opts })
const pathsOf = (events) => events.filter((e) => e.type === 'path')
const endOf = (events) => pathsOf(events).at(-1)?.points.at(-1) ?? null
const labelOf = (events) => events.find((e) => e.type === 'label')?.text ?? null

// What the system SAID, read back from the events. This is the instrument's point.
const said = (events) => {
    const notices = events.filter((e) => e.type === 'notice')
    if (notices.length > 0) return `${notices.length}x ${notices.map((n) => n.kind).join(',')}`
    const text = labelOf(events)
    if (text !== null && /infinity|not a number/.test(text)) return 'named in the label'
    return 'nothing'
}
const noteOf = (label, events, comment) => note(label, events === null ? null : '', said(events ?? []), comment)

// ── 1. One quantity, three routes ───────────────────────────────────────────
// The same mathematical value by authored addition, authored product, and a walk.
// All three must agree: one arithmetic, one answer. (ruling 1)
let sum = 0
for (let i = 0; i < 1000; i++) sum = add(sum, 1e-15)
note('route: sum 1e-15 a thousand times', sum, 'nothing', 'authored addition')
note('route: 1000 * 1e-15', mul(1000, 1e-15), 'nothing', 'authored product')
note('route: fw 1e-15 a thousand times', endOf(run('loop 1000 do\n  fw 1e-15\nend'))?.[0],
    'nothing', 'command geometry')
note('the three routes agree?', (Math.abs(sum - mul(1000, 1e-15)) <= Math.abs(sum) * 1e-13 &&
    Math.abs(sum - (endOf(run('loop 1000 do\n  fw 1e-15\nend'))?.[0] ?? 0)) <= Math.abs(sum) * 1e-13) ? 1 : 0,
    'nothing', 'one arithmetic means these are the same walk')

// ── 2. A figure reads its own ink ───────────────────────────────────────────
// `x` is how a place reads its own coordinate. The reading must agree with the ink.
for (const [step, count] of [[1e-14, 100], [1e-14, 1000], [1e-14, 100000], [1e-9, 1000]]) {
    const walk = run(`loop ${count} do\n  fw ${step}\nend\nlabel x\n`)
    const moved = endOf(walk)?.[0] ?? 0
    const read = labelOf(walk)
    const agrees = read !== null && Math.abs(Number(read) - moved) <= Math.abs(moved) * 5e-13
    note(`walk ${count} x fw ${step}: the ink`, moved, said(walk), 'the geometry kept it')
    note(`walk ${count} x fw ${step}: the reading of x`, read, said(walk), 'exactly the coordinate')
    note(`walk ${count} x fw ${step}: reading agrees with ink?`, agrees ? 'yes' : 'no', 'nothing',
        'a figure can see the ink it laid down')
}

// ── 3. Additive identity — on every representable value ─────────────────────
note('1e-15 * 1', mul(1e-15, 1), 'nothing', 'product')
note('1e-15 + 0', add(1e-15, 0), 'nothing', 'sum — the same value')
note('0 + 1e-15', add(0, 1e-15), 'nothing', 'order does not matter')
note('(1e-15 + 0) == 1e-15', tower.apply('==', add(1e-15, 0), 1e-15), 'nothing',
    'x + 0 == x, which a learner would trust')
note('1 + 1e-15 (IEEE keeps the tail)', add(1, 1e-15), 'nothing', 'the tail survives the sum')
note('(1 + 1e-15) - 1', add(add(1, 1e-15), -1), 'nothing', 'cancellation finds it again')

// ── 4. Two spellings of one value, one branch ───────────────────────────────
// The visible difference the policy made. Same number, different operator, same walk.
const branch = (expr, op = '>') => {
    const events = run(`when ${expr} ${op} 0 do\n  fw 10\nend\n`)
    const landed = pathsOf(events).length > 0 && Math.abs(endOf(events)[0]) >= 10
    return { landed: landed ? 'lands' : 'skipped', said: said(events) }
}
for (const expr of ['(1e-15 * 1)', '(1e-15 + 0)', '(1000 * 1e-15)', Array(1000).fill('1e-15').join(' + ')]) {
    const answer = branch(expr)
    note(`when ${expr.slice(0, 34)} > 0`, answer.landed, answer.said,
        'one value, one branch, however it is spelled')
}

// ── 5. Non-finite reach: what is said, and where ────────────────────────────
// The change this instrument exists to check: a non-number is NAMED, in the label and
// in the walk, instead of being printed or ordered as if it were a number.
noteOf('label (1e308 * 10)', run('label (1e308 * 10)\n'), 'the display names it, and tells the author')
noteOf('label sqrt(-1)', run('label sqrt(-1)\n'), 'the display names it')
note('label (1e308 * 10) prints', labelOf(run('label (1e308 * 10)\n')), 'named in the label',
    'never a numeral')
note('when (1e308 * 10) > 0', branch('(1e308 * 10)').landed, branch('(1e308 * 10)').said,
    'infinity no longer orders silently as a number')
note('when (0/0) > 0', branch('(0/0)').landed, branch('(0/0)').said, 'a NaN is not a decision')
note('when (0/0) < 0', branch('(0/0)', '<').landed, branch('(0/0)', '<').said, 'and not the other way either')
note('when (0/0) == (0/0)', branch('(0/0)', '==').landed, branch('(0/0)', '==').said,
    'a NaN is not equal to itself, and it says so')
noteOf('fw (1e308 * 10)', run('fw (1e308 * 10)\n  fw 1\n'), 'the step is not taken')
noteOf('loop (1e308 * 10) do fw 1 end', run('loop (1e308 * 10) do\n  fw 1\nend\n'),
    'the loop is not taken')
noteOf('nothing in a hole (goto A.x)', run('goto nothing.x nothing.y\n  fw 1\n'),
    'the identity, quietly — nothing is an answer')
noteOf("a word in a hole (fw 'oops')", run("fw 'oops'\n  fw 1\n"), 'the author is told')

// ── 5b. The comparison door — NaN recovered; Infinity still open ────────────
// The landed rule: a comparison with a NaN operand is NaN, so the condition
// consumer notices and takes no branch. Infinity is a separate, unruled species;
// its IEEE answers still become a finite boolean. (id:tower-center-approximation)
note('0/0 > 0', tower.apply('>', 0 / 0, 0), 'nothing', 'the comparison preserves NaN')
note('0/0 == 0/0', tower.apply('==', 0 / 0, 0 / 0), 'nothing', 'and again')
note('1/0 == 1/0', tower.apply('==', 1 / 0, 1 / 0), 'nothing', 'infinity still answers a finite 1')
noteOf('when (0/0 > 0) do', run('when (0/0 > 0) do\n  fw 10\nend\n'),
    'a COMPARED NaN is now told: no branch, and why')
noteOf('when (1/0 > 0) do', run('when (1/0 > 0) do\n  fw 10\nend\n'),
    'a compared infinity still draws: the open species')
noteOf('when (0/0) do', run('when (0/0) do\n  fw 10\nend\n'),
    'a BARE non-answer in a condition is told: no branch, and why')

// ── 6. The display gate — where the eye gets its answer ─────────────────────
for (const [label, value] of [['0.1 + 0.2', 0.1 + 0.2], ['sin(30)', Math.sin(30 * Math.PI / 180)],
    ['1 + 1e-15', 1 + 1e-15], ['1e-15', 1e-15], ['1/3', 1 / 3]]) {
    note(`display ${label}`, format(value), 'nothing', 'reads clean; the value keeps its bits')
}

// ── 7. What tolerances remain, and whether they carry a scale ───────────────
const GATES = [
    { name: 'Versor.EPSILON (rotor hygiene)', eps: Number.EPSILON, scaled: false },
    { name: 'vec3 EPS (direction degeneracy)', eps: 1e-12, scaled: false },   // absolute on purpose: §8
    { name: 'aim AIM_TOL (faceto degeneracy)', eps: 1e-12, scaled: true },
    { name: 'GRAZE (a normalized cosine already)', eps: 1e-3, scaled: true },
    { name: 'REALIZE_TOL / REL_TOL (proposal)', eps: 1e-9, scaled: false },
    { name: 'ACCEPT_TOL (a law is satisfied)', eps: 1e-6, scaled: false },
]
for (const gate of GATES) {
    note(`tolerance: ${gate.name}`, `${gate.eps}`, gate.scaled ? 'scaled' : 'absolute',
        gate.scaled ? 'dimensionless, judged against the magnitude in hand' : 'open: awaiting its scale')
}

// ── 8. THE LESSON: the scale must come from the INPUTS ──────────────────────
// A tolerance needs a scale, and a function that sees only its RESULT cannot know it.
// =faceto= holds both coordinates, so `eps × |coords|` is theirs to judge. =unit(v)=
// holds a difference, and nothing about the two points it came from — so a relative
// rule there names a direction out of rounding noise. Measured, and left ABSOLUTE:
note('unit of a difference 1e-14 apart', unit(sub([1 + 1e-14, 0, 0], [1, 0, 0])), 'nothing',
    'the RESULT cannot know it is noise; null lets the caller’s own guard speak')
note('unit of a real tiny direction', unit([1e-20, 2e-20, 0]), 'nothing',
    'refused below an absolute floor — the cost of an epsilon without a scale')
note('unit of a denormal', unit([1e-320, 0, 0]), 'nothing',
    'the ADMITTED RESULT guard refuses it (the old code answered [Infinity, 0, 0])')
note('faceto aim, inputs in hand', within(0, 1e-14, tol(1e-12, 1)) ? 'degenerate' : 'a direction', 'nothing',
    'the one site that CAN carry a scale — it holds both operands')

if (process.argv.includes('--jsonl')) {
    for (const row of rows) console.log(JSON.stringify(row))
} else {
    for (const row of rows) {
        console.log(`${row.said.padEnd(14)} | ${row.label.padEnd(46)} = ${String(row.value).padEnd(22)} // ${row.comment}`)
    }
    console.log(`\n${rows.length} readings. --jsonl records them.`)
}
