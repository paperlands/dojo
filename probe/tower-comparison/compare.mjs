// probe-status: active
// Run: node probe/tower-comparison/compare.mjs [--jsonl]
//
// Order is exact squared length. Equality is coordinate identity, not the
// provisional whole-value refinement and not a length tie. `!` of a non-finite
// number keeps it. Bitwise, power and tested-left selection now preserve NaN;
// infinity comparisons and interpolated display remain open. The `magnitude` column
// is the naive hypot contrast, not the contract. (id:tower-center-approximation-ruling)
//
// WIDENED 2026-11-03. The first rig asked only comparison rows. This one also asks
// the four order glyphs, `!=`, the equal-length tie in both directions, the product
// spellings (`*` cross, `^` wedge, `.` dot), mixed scalar:vector scaling, and the
// executor's invalid-condition route. Every row names the ROUTE of its answer
// (value / tower refusal / domain refusal / parse fault / surface unknown / arity
// fault), because a
// refusal at the parser is not a semantic ruling at the tower.
//
// Observation only: it registers nothing and changes no production meaning.
import assert from "node:assert/strict"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"
import { TowerRefusal, DomainRefusal } from "../../assets/js/turtling/mafs/tower.js"
import { parseProgram, collectErrors } from "../../assets/js/turtling/parse.js"
import { drainEvents } from "../../assets/js/turtling/executor.js"

const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const num = (x) => Number.isFinite(x) ? x : String(x)
const safeNorm = (v) => Math.hypot(...v)
// Deliberately the naive spellings, so the domain rows can show why they fail.
const naiveNorm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
const scale = (s, v) => v.map((x) => s * x)
const cross3 = (a, b) => a.length === 3 && b.length === 3
    ? [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    : null

// Candidate policies named by the owning doc — not proposals, just projections.
const policies = {
    // Naive hypot projection, kept as a contrast. It is not the landed contract:
    // hypot(1e16,1) === hypot(1e16,0), and hypot overflows where squares still order.
    magnitude: (op, a, b) => {
        const na = safeNorm(a), nb = safeNorm(b)
        const answer = op === '==' ? (na === nb ? 1 : 0)
            : op === '!=' ? (na !== nb ? 1 : 0)
            : op === '<' ? (na < nb ? 1 : 0)
            : op === '<=' ? (na <= nb ? 1 : 0)
            : op === '>' ? (na > nb ? 1 : 0)
            : (na >= nb ? 1 : 0)
        // A non-finite hypot is the projection failing, not an open policy. The
        // landed order answers by exact squares and does not consult this column.
        return Number.isFinite(na) && Number.isFinite(nb) ? answer : 'hypot cannot decide'
    },
    // Provisional equality only; orderings do not depend on the identity choice.
    wholeValue: (op, a, b) => op === '==' ? (same(a, b) ? 1 : 0)
        : op === '!=' ? (same(a, b) ? 0 : 1) : null,
}

const isVector = (x) => Array.isArray(x)
const COMPARISONS = new Set(['<', '<=', '>', '>=', '==', '!='])
const projectComparison = (op, a, b) =>
    COMPARISONS.has(op) && isVector(a) && isVector(b)
        ? { magnitude: policies.magnitude(op, a, b), wholeValue: policies.wholeValue(op, a, b) }
        : null

// What the accepted/held meanings say the product spellings should do, per D018 and
// [[id:tower-tension-additive]]. `held` is a label, not a proposal.
function projectProduct(op, a, b) {
    const av = isVector(a), bv = isVector(b)
    if (op === '.') {
        if (av && bv) return { dot: dot(a, b), note: 'grade 0' }
        if (av !== bv) return { scale: scale(av ? b : a, av ? a : b), note: 'mixed scalar:vector scales (D018)' }
    }
    if (op === '*') {
        if (av && bv) return cross3(a, b)
            ? { cross: cross3(a, b), note: '3D Euclidean, proper rotation domain' }
            : { refuse: 'cross is not defined outside explicit 3D' }
        if (av !== bv) return { scale: scale(av ? b : a, av ? a : b), note: 'mixed scalar:vector scales (D018)' }
    }
    if (op === '^') {
        if (av && bv) return { grade: 2, note: 'bivector; NOT an ordinary 3-vector (no dual alias)' }
        if (av !== bv) return { scale: scale(av ? b : a, av ? a : b), note: 'mixed scalar:vector scales (D018)' }
    }
    if (op === '+') {
        if (av && bv) return { zip: a.map((x, i) => x + b[i]), note: 'zip equal lengths' }
        if (av !== bv) return { broadcast: scale(1, av ? a : b).map((x) => x + (av ? b : a)),
            note: 'HELD per [[id:tower-tension-additive]], not an unqualified accepted rule' }
    }
    return null
}

function attempt(source) {
    try {
        return { current: ev(source), answer: 'value' }
    } catch (error) {
        if (error instanceof TowerRefusal) return { answer: 'tower-refusal', refusal: error.message }
        if (error instanceof DomainRefusal) return { answer: 'domain-refusal', refusal: error.message }
        if (/Unknown token/.test(error.message)) return { answer: 'parse-fault', refusal: error.message }
        if (/Unknown function/.test(error.message)) return { answer: 'surface-unknown', refusal: error.message }
        if (/takes \d+ arguments?/.test(error.message)) return { answer: 'arity-fault', refusal: error.message }
        // An unclassified error is not a route. Fail the rig; do not dress a bug as evidence.
        throw error
    }
}

const comparisonCases = [
    ["order, shorter vs longer", '[1,2] < [1,3]', [1, 2], [1, 3], '<'],
    ["order, shorter vs longer (<=)", '[1,2] <= [1,3]', [1, 2], [1, 3], '<='],
    ["order, shorter vs longer (>)", '[1,2] > [1,3]', [1, 2], [1, 3], '>'],
    ["order, shorter vs longer (>=)", '[1,2] >= [1,3]', [1, 2], [1, 3], '>='],
    ["equal length, < (tie)", '[3,0] < [0,3]', [3, 0], [0, 3], '<'],
    ["equal length, <= forward", '[3,0] <= [0,3]', [3, 0], [0, 3], '<='],
    ["equal length, <= reverse", '[0,3] <= [3,0]', [0, 3], [3, 0], '<='],
    ["equal length, > (tie)", '[3,0] > [0,3]', [3, 0], [0, 3], '>'],
    ["equal length, >= forward", '[3,0] >= [0,3]', [3, 0], [0, 3], '>='],
    ["equal length, >= reverse", '[0,3] >= [3,0]', [0, 3], [3, 0], '>='],
    ["identity, same arrow", '[1,2] == [1,2]', [1, 2], [1, 2], '=='],
    ["identity, same arrow (!=)", '[1,2] != [1,2]', [1, 2], [1, 2], '!='],
    ["identity, same length differs", '[3,0] == [0,3]', [3, 0], [0, 3], '=='],
    ["identity, same length differs (!=)", '[3,0] != [0,3]', [3, 0], [0, 3], '!='],
    ["unequal lengths", '[1,2,3] < [1,2]', [1, 2, 3], [1, 2], '<'],
    ["overflowing magnitude", '[1e308,1e308] < [1.5e308,1.5e308]', [1e308, 1e308], [1.5e308, 1.5e308], '<'],
    ["hypot collision", '[1e16,1] > [1e16,0]', [1e16, 1], [1e16, 0], '>'],
    ["underflowing naive magnitude", '[1e-200,0] < [2e-200,0]', [1e-200, 0], [2e-200, 0], '<'],
    ["NaN component", '[0/0,0] == [0/0,0]', [NaN, 0], [NaN, 0], '=='],
    ["NaN component, order", '[0/0,0] < [1,0]', [NaN, 0], [1, 0], '<'],
    ["scalar order control", '1 < 2', 1, 2, '<'],
    ["text order control", "'a' < 'b'", 'a', 'b', '<'],
    ["vector arithmetic control", '[1,2] + [3,4]', [1, 2], [3, 4], '+'],
]

// Infinity is a second non-finite species. The current runtime inherits IEEE:
// a comparison with +/-Infinity answers a finite 1/0. The candidate columns name
// the dispositions a ruling could pick; none is asserted here.
const firstNonFinite = (...args) =>
    args.find((x) => typeof x === 'number' && !Number.isFinite(x)) ?? null
const infinityCases = [
    ["infinity equality", '1/0 == 1/0', 1 / 0, 1 / 0, '=='],
    ["opposite infinities", '1/0 == -1/0', 1 / 0, -1 / 0, '=='],
    ["infinity order", '1/0 > 1', 1 / 0, 1, '>'],
    ["negative infinity order", '-1/0 < 1', -1 / 0, 1, '<'],
    ["infinity bitwise", '(1/0) & 1', 1 / 0, 1, '&'],
    ["infinity power", '(1/0) ^ 0', 1 / 0, 0, '^'],
]

const productCases = [
    ["dot, vector:vector", '[1,2,3] . [3,4,5]', [1, 2, 3], [3, 4, 5], '.'],
    ["dot, mixed scalar:vector", '2 . [1,2,3]', 2, [1, 2, 3], '.'],
    ["dot, mixed vector:scalar", '[1,2,3] . 2', [1, 2, 3], 2, '.'],
    ["cross, 3D", '[1,0,0] * [0,1,0]', [1, 0, 0], [0, 1, 0], '*'],
    ["cross, 2D domain", '[1,0] * [0,1]', [1, 0], [0, 1], '*'],
    ["scale, scalar:vector", '2 * [1,2,3]', 2, [1, 2, 3], '*'],
    ["scale, vector:scalar", '[1,2,3] * 2', [1, 2, 3], 2, '*'],
    ["wedge, vector:vector", '[1,0,0] ^ [0,1,0]', [1, 0, 0], [0, 1, 0], '^'],
    ["wedge/scale, scalar:vector", '2 ^ [1,2,3]', 2, [1, 2, 3], '^'],
    ["wedge/scale, vector:scalar", '[1,2,3] ^ 2', [1, 2, 3], 2, '^'],
    ["broadcast, scalar:vector (held)", '2 + [1,2,3]', 2, [1, 2, 3], '+'],
    ["broadcast, vector:scalar (held)", '[1,2,3] + 2', [1, 2, 3], 2, '+'],
]

const rows = []
for (const [label, source, a, b, op] of comparisonCases) {
    const { current, answer, refusal } = attempt(source)
    const vectors = isVector(a) && isVector(b)
    rows.push({
        route: 'tower', kind: 'comparison', case: label, source, op,
        current: answer === 'value' ? current : `${answer}: ${refusal}`,
        answer, refusal,
        magnitude: projectComparison(op, a, b)?.magnitude ?? null,
        wholeValue: projectComparison(op, a, b)?.wholeValue ?? null,
        norms: vectors ? {
            aSafe: num(safeNorm(a)), bSafe: num(safeNorm(b)),
            aNaive: num(naiveNorm(a)), bNaive: num(naiveNorm(b)),
        } : null,
        note: label.includes('overflow') ? 'naive hypot overflows; exact squares still order'
            : label.includes('collision') ? 'naive hypot ties; exact squares see the longer arrow'
            : label.includes('underflow') ? 'naive sqrt(dot) loses both arrows; hypot is scaled'
            : label.includes('unequal') ? 'landed domain refuses unequal lengths; magnitudes of different dimensions are not compared'
            : label.includes('NaN component, order') ? 'non-finite component is a domain refusal, not an IEEE boolean'
            : label === 'NaN component' ? 'a non-finite component is a domain refusal before any coordinate answer'
            : null,
    })
}
for (const [label, source, a, b, op] of productCases) {
    const { current, answer, refusal } = attempt(source)
    rows.push({
        route: 'tower', kind: 'product', case: label, source, op,
        current: answer === 'value' ? current : `${answer}: ${refusal}`,
        answer, refusal,
        projection: projectProduct(op, a, b),
    })
}

for (const [label, source, a, b, op] of infinityCases) {
    const { current, answer, refusal } = attempt(source)
    rows.push({
        route: 'tower', kind: 'infinity', case: label, source, op,
        current: answer === 'value' ? current : `${answer}: ${refusal}`,
        answer, refusal,
        ieee: answer === 'value' ? current : null,
        preserve: firstNonFinite(a, b),
        nan: NaN,
        note: 'Infinity is unruled; preserve returns the offending operand so the consumer notices',
    })
}

// Scalar controls recorded by the numeric owner. Observation rows, not acceptance:
// they make the corrected examples reproducible through the same door without making
// the current unquantized answer a ruling.
const scalarCases = [
    ["scalar equality: thirds sum", "(1/3)+(1/3)+(1/3) == 1", 1],
    ["scalar equality: decimal residue", "0.1+0.2 == 0.3", 0],
    ["scalar equality: additive identity", "1e-15+0 == 1e-15", 1],
    ["scalar equality: trig residue", "sin(30) == 0.5", 0],
]
for (const [label, source, expected] of scalarCases) {
    const { current, answer, refusal } = attempt(source)
    rows.push({
        route: 'tower', kind: 'scalar', case: label, source, op: '==',
        current: answer === 'value' ? current : `${answer}: ${refusal}`,
        answer, refusal, expected,
        matchesExpected: answer === 'value' && current === expected,
        note: 'recorded expectation under unquantized arithmetic; observation only',
    })
}

// Surface spellings are not tower verdicts; one row keeps the `norm` claim honest.
const surfaceCases = [
    ["norm, vector magnitude spelling", "norm([3,4])", "no surface builtin today; not a tower verdict"],
]
for (const [label, source, note] of surfaceCases) {
    const { current, answer, refusal } = attempt(source)
    rows.push({
        route: 'surface', kind: 'surface', case: label, source, op: null,
        current: answer === 'value' ? current : `${answer}: ${refusal}`,
        answer, refusal, note,
    })
}

// ── Second route: the executor's condition admission ────────────────────────
// The tower can answer a comparison with a finite boolean before any consumer sees
// the non-finite operand. These rows ask the executor's own door, with real
// multiline programs parsed by parseProgram (not hand-built ASTs).
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const condition = (source) => {
    const ast = parseProgram(source)
    const parseErrors = collectErrors(ast).map((e) => ({ message: e.message, line: e.span?.line ?? null }))
    let events = [], fault = null
    try { events = drainEvents(ast, deps()) } catch (error) {
        // Only classified walk/domain faults are evidence. An arbitrary error fails the rig.
        if (!(error instanceof TowerRefusal) && !(error instanceof DomainRefusal) && error.kind !== 'walk') {
            throw error
        }
        fault = { name: error.name, message: error.message, kind: error.kind ?? null,
            line: error.span?.line ?? null }
    }
    return {
        route: 'executor-condition',
        source,
        answer: fault ? 'walk-fault' : 'value',
        parseErrors,
        fault,
        notices: events.filter((e) => e.type === 'notice').map((e) => e.message),
        labels: events.filter((e) => e.type === 'label').map((e) => e.text ?? e.message ?? null),
        lastHead: events.filter((e) => e.type === 'head').at(-1)?.position ?? null,
    }
}

const conditionCases = [
    ["recovered: bitwise preserves NaN", "when (((0/0)&1)==0) do\n fw 2\nend\nfw 3"],
    ["recovered: power preserves NaN", "when ((0/0)^0) do\n fw 2\nend\nfw 3"],
    ["recovered: ! keeps NaN, so equality does not see true", "when ((!(0/0))==(!0)) do\n fw 2\nend\nfw 3"],
    ["recovered: tested NaN is preserved", "when (0/0 || 1) do\n fw 2\nend\nfw 3"],
    ["control: finite left selected by or", "when (1 || (0/0)) do\n fw 2\nend\nfw 3"],
    ["control: finite left selected by and", "when (0 && (0/0)) do\n fw 2\nend\nfw 3"],
    ["first match wins, a later branch is never asked",
        "when 1 do\n fw 1\nend\nwhen missing do\n fw 2\nend\nfw 3"],
    ["direct non-finite condition",
        "when 0 do\n fw 1\nend\nwhen (0/0) do\n fw 2\nend\nfw 3"],
    ["recovered: (0/0 != 0/0) does not draw",
        "when 0 do\n fw 1\nend\nwhen (0/0 != 0/0) do\n fw 2\nend\nfw 3"],
    ["recovered: (0/0 < 1) does not draw",
        "when 0 do\n fw 1\nend\nwhen (0/0 < 1) do\n fw 2\nend\nfw 3"],
    ["recovered: (0/0 >= 1) does not draw",
        "when 0 do\n fw 1\nend\nwhen (0/0 >= 1) do\n fw 2\nend\nfw 3"],
    ["recovered: ! keeps a compared NaN",
        "when 0 do\n fw 1\nend\nwhen !(0/0 < 1) do\n fw 2\nend\nfw 3"],
    ["boolean condition (!0) takes the branch",
        "when 0 do\n fw 1\nend\nwhen !0 do\n fw 2\nend\nfw 3"],
    ["laundered infinity equality",
        "when 0 do\n fw 1\nend\nwhen (1/0 == 1/0) do\n fw 2\nend\nfw 3"],
    ["open: infinity bitwise still draws",
        "when 0 do\n fw 1\nend\nwhen (((1/0)&1)==0) do\n fw 2\nend\nfw 3"],
    ["open: infinity power still draws",
        "when 0 do\n fw 1\nend\nwhen ((1/0)^0) do\n fw 2\nend\nfw 3"],
    ["direct indeterminate (1/0 - 1/0)",
        "when 0 do\n fw 1\nend\nwhen (1/0 - 1/0) do\n fw 2\nend\nfw 3"],
    ["display: bare non-finite label", "label 0/0"],
    ["recovered: vector label names and notices", "label [0/0]"],
    ["recovered: vector infinity names and notices", "label [1/0]"],
    ["display: interpolated non-finite", "label 'x[0/0]'"],
    ["display: recovered comparison (!=)", "label (0/0 != 0/0)"],
    ["display: recovered comparison (==)", "label (0/0 == 0/0)"],
    ["display: open truth conversion after comparison", "label !(0/0 < 1)"],
    ["display: non-finite infinity", "label (1/0)"],
    ["display: laundered infinity equality", "label (1/0 == 1/0)"],
    ["display: laundered infinity order", "label (1/0 > 1)"],
]
const conditionRows = conditionCases.map(([label, source]) => ({
    case: label, ...condition(source),
}))

if (process.argv.includes('--jsonl')) {
    for (const row of rows) console.log(JSON.stringify(row))
    for (const row of conditionRows) console.log(JSON.stringify(row))
} else {
    for (const row of rows) {
        console.log(`${row.kind.padEnd(10)} ${row.case.padEnd(34)} `
            + `${String(row.current).padEnd(58)} `
            + `${row.kind === 'comparison'
                ? `hypot=${row.magnitude} whole=${row.wholeValue}`
                : row.kind === 'scalar' ? `expected=${row.expected} matches=${row.matchesExpected}`
                : row.kind === 'infinity' ? `ieee=${row.ieee} preserve=${row.preserve} nan=${row.nan}`
                : row.kind === 'surface' ? row.note : JSON.stringify(row.projection)}`)
    }
    for (const row of conditionRows) {
        console.log(`condition  ${row.case.padEnd(46)} `
            + `head=${JSON.stringify(row.lastHead)} notices=${row.notices.length} `
            + `labels=${JSON.stringify(row.labels)}${row.fault ? ` fault=${row.fault.message}` : ''}`)
    }
    console.log(`\n${rows.length} tower rows + ${conditionRows.length} condition rows. --jsonl records them.`)
}

// Instrument sanity: the controls must answer, or this rig observes nothing.
const scalarOrder = rows.find((r) => r.source === '1 < 2')
assert.equal(scalarOrder.current, 1, 'scalar order must still answer')
assert.equal(rows.find((r) => r.source === "'a' < 'b'").current, 1, 'text order must still answer')
assert.equal(rows.find((r) => r.source === '[1,2] + [3,4]').current.join(','), '4,6',
    'vectors must be admitted at the center; only comparison is at question')
// Every comparison row must reach the center (a refusal is an observed answer).
for (const r of rows.filter((row) => row.kind === 'comparison')) {
    assert.ok(['value', 'tower-refusal', 'domain-refusal'].includes(r.answer),
        `${r.source} must answer or refuse by name at the one door, not ${r.answer}: ${r.current}`)
}
// Infinity rows record a route and a named offending operand; the policy is open.
for (const r of rows.filter((row) => row.kind === 'infinity')) {
    assert.ok(['value', 'tower-refusal', 'domain-refusal'].includes(r.answer),
        `${r.source}: unclassified route ${r.answer}`)
    assert.notEqual(r.preserve, null, `${r.source}: the offending operand must be nameable`)
}
const collision = rows.find((r) => r.source === '[1e16,1] > [1e16,0]')
assert.equal(collision.current, 1, 'exact squares must see the arrow naive hypot ties')
assert.equal(collision.magnitude, 0, 'the hypot column stays the contrast, not the contract')
const overflow = rows.find((r) => r.source === '[1e308,1e308] < [1.5e308,1.5e308]')
assert.equal(overflow.current, 1, 'exact squares order a pair whose hypot overflows')
assert.equal(overflow.magnitude, 'hypot cannot decide')
// Product/surface rows may stop at the parser, the surface or the center. A named
// route is evidence; an unexpected error already threw and failed the rig.
const NAMED_ROUTES = ['value', 'tower-refusal', 'domain-refusal', 'parse-fault', 'surface-unknown', 'arity-fault']
for (const r of rows.filter((row) => row.kind === 'product' || row.kind === 'surface')) {
    assert.ok(NAMED_ROUTES.includes(r.answer), `${r.source}: unclassified route ${r.answer}`)
}
// A spaced dot is a named route TODAY (parse fault), but implementing the token must
// move the row, not break the observation. Assert structure, never the current verdict.
const dotMixed = rows.find((r) => r.source === '2 . [1,2,3]')
assert.ok(NAMED_ROUTES.includes(dotMixed.answer), `spaced dot: unclassified route ${dotMixed.answer}`)
assert.equal(dotMixed.answer === 'value', dotMixed.refusal == null,
    'a value has no refusal text, and a refusal names its route')
// Condition controls: the rig must observe a taken branch and an unasked branch.
const firstMatch = conditionRows.find((row) => row.case === 'first match wins, a later branch is never asked')
assert.deepEqual(firstMatch.lastHead, [4, 0, 0], 'first-match control draws 1 + 3')
assert.equal(firstMatch.notices.length, 0, 'the unconsidered branch says nothing')
const directNaN = conditionRows.find((row) => row.case === 'direct non-finite condition')
assert.ok(directNaN.notices.length > 0 || directNaN.fault,
    'a direct non-finite condition must notice or fault; silence is not an answer')
// A parser regression must not masquerade as a numeric notice: every condition
// fixture is valid source, so its parse errors must be empty.
for (const row of conditionRows) {
    assert.equal(row.parseErrors.length, 0, `${row.case}: valid fixture must parse cleanly`)
}
// The laundered rows are RECORDED, not asserted: a later repair must move them.
