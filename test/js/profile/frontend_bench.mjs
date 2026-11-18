// Front-end bench — reader · parser · lexer · evaluator.
//
//   node test/js/profile/frontend_bench.mjs
//
// These are the paths the notation work changes, and they sit at the FRONT of the
// user loop: every keystroke re-parses, every program flush re-reads arguments,
// every expression evaluation walks the lexer/parser/evaluator. Measured here so a
// change cannot land unmeasured — the gap that let `readArguments` cost 11× the
// splitter it replaced, unseen.
//
// Reports absolute cost; ASSERTS only machine-independent guards (ratios of two
// measurements on THIS machine), so a busy machine cannot fail it — wall-clock is a
// report, not a fence (see breath_cost_bench.mjs for why).

import { parseProgram, readArguments } from "../../../assets/js/turtling/parse.js"
import { Lexer } from "../../../assets/js/turtling/mafs/lexer.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const pad = (s, n) => String(s).padEnd(n)
const us = (v) => v < 1 ? (v * 1000).toFixed(0) + " ns" : v < 1000 ? v.toFixed(3) + " µs" : (v / 1000).toFixed(3) + " ms"
function bench(name, n, fn) {
    for (let i = 0; i < Math.min(200, n); i++) fn(i)     // warm
    const xs = []
    for (let r = 0; r < 3; r++) {
        const t0 = process.hrtime.bigint()
        for (let i = 0; i < n; i++) fn(i)
        xs.push(Number(process.hrtime.bigint() - t0) / 1e3 / n)
    }
    xs.sort((a, b) => a - b)
    return { name, n, us: xs[1] }        // median of 3 — a ratio must not swing on one sample
}

let failures = 0
const guard = (label, ok, msg) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : "  —  " + msg}`)
    if (!ok) failures++
}
console.log("\n=== frontend bench ===  node " + process.version + "\n")

// ── 0. Reference: the cost of parsing ONE line of ink ────────────────────────
// The reader reads one held invocation's arguments; the parser reads one line.
// "Reading an invocation should cost about what parsing a line costs" is the
// invariant the reader guard below uses — a ratio of two same-machine measures.
const unit = "def fig0 n do\n fw n\n rt 90\n for 4 do\n  fw 20\n  rt 90\n end\n wait 100\nend\n"
const parseLineUs = bench("parseProgram ref", 3000, () => parseProgram(unit)).us / unit.split("\n").length

// ── 1. Reader — the boundary reader, per held-figure invocation ──────────────
// The reference is the dumb whitespace split this reader replaced. It could not
// read the contract (`fw 2 + 3` became three args), so the ratio IS the cost of
// one contract — reported, not fenced. The fence is against the parser instead.
function oldSplitCommandArgs(rest) {
    if (rest === '') return []
    const out = []; let depth = 0, start = 0
    for (let i = 0; i < rest.length; i++) {
        const c = rest[i]
        if (c === '[' || c === '(') depth++
        else if (c === ']' || c === ')') depth--
        else if ((c === ' ' || c === '\t') && depth === 0) { if (i > start) out.push(rest.slice(start, i)); start = i + 1 }
    }
    if (start < rest.length) out.push(rest.slice(start)); return out.filter(Boolean)
}
// One entry = one held invocation (`let F = <cmd> <args>`).
const INVOCATIONS = ["2 + 3", "(1 + 2) 4", "90", "'pi'", "mod(count, 7)", "sin(30) + 1"]
const rNew = bench("readArguments", 400000, (i) => readArguments(INVOCATIONS[i % INVOCATIONS.length]))
const rOld = bench("old split (reference)", 400000, (i) => oldSplitCommandArgs(INVOCATIONS[i % INVOCATIONS.length]))
console.log("READER — one held invocation (`let F = <args>`)")
console.log("  " + pad(rNew.name, 34) + pad(us(rNew.us), 12) + "/invocation")
console.log("  " + pad(rOld.name, 34) + pad(us(rOld.us), 12) + "/invocation")
console.log("  " + pad("ratio — the cost of one contract", 34) + pad((rNew.us / rOld.us).toFixed(1) + "×", 12) + "(reported: the splitter could not read the contract)")
guard("reader ≤ 3× a parsed line", rNew.us <= 3 * parseLineUs,
    `reading an invocation (${us(rNew.us)}) costs >3× parsing a line (${us(parseLineUs)})`)
console.log("")

// ── 2. Parser — parseProgram, per line, across sizes ────────────────────────
const unitN = (i) => `def fig${i} n do\n fw n\n rt 90\n for 4 do\n  fw 20\n  rt 90\n end\n wait 100\nend\n`
const prog = (k) => Array.from({ length: k }, (_, i) => unitN(i)).join("")
const SIZES = [11, 22, 44]
console.log("PARSER")
const parseRows = SIZES.map((k) => {
    const src = prog(k), lines = src.split("\n").length
    const r = bench(`${lines} lines`, k > 22 ? 4000 : 8000, () => parseProgram(src))
    return { lines, r, perLine: r.us / lines }
})
for (const { lines, r, perLine } of parseRows)
    console.log("  " + pad(`parseProgram (${lines} lines)`, 34) + pad(us(r.us), 12) + "/parse   " + perLine.toFixed(3) + " µs/line")
const perLineGrowth = parseRows[2].perLine / parseRows[0].perLine
guard("per-line cost flat across 4× size", perLineGrowth <= 1.6,
    `per line grew ${perLineGrowth.toFixed(2)}× from ${parseRows[0].lines}→${parseRows[2].lines} lines (supralinear, or GC-bound)`)
console.log("")

// ── 3. Lexer — the char walk over operators, names and calls ────────────────
const lexer = new Lexer()
const LEX = ["mod(count, 7) + 1", "1 + 2 * 3 - 4/5", "sin(30) + [x+1]"]
console.log("LEXER")
const lexRows = LEX.map((src) => bench(src, 400000, () => lexer.tokenize(src)))
for (const r of lexRows) console.log("  " + pad(r.name, 34) + pad(us(r.us), 12) + "/tokenize")
guard("a call lexes within 2× plain arithmetic", lexRows[0].us <= 2 * lexRows[1].us,
    `'mod(count, 7) + 1' ${us(lexRows[0].us)} vs '1 + 2 * 3' ${us(lexRows[1].us)}`)
console.log("")

// ── 4. Evaluator — the builtins the notation work touched ───────────────────
const parser = new Parser(), evaluator = new Evaluator()
const EXPRS = ["1 + 2 * 3", "round(2.7)", "round(2.7, 5)", "atan2(1, 2)", "mod(7, 3)", "sin(1)"]
const trees = Object.fromEntries(EXPRS.map((e) => [e, parser.parse(e)]))
console.log("EVALUATOR")
const evalRows = EXPRS.map((e) => ({ e, r: bench(e, 300000, () => evaluator.run(trees[e], {})) }))
const arith = evalRows[0].r.us
// The bar is a STOCK builtin (same call overhead), not the arithmetic floor — a tiny
// floor makes the ratio swing on noise. So `round`/`atan2` are compared to `sin(1)`.
const stock = evalRows.find((x) => x.e === "sin(1)").r.us
for (const { e, r } of evalRows) console.log("  " + pad(e, 34) + pad(us(r.us), 12) + "/eval   " + (r.us / arith).toFixed(2) + "× vs 1+2*3")
const worst = Math.max(...evalRows.filter((x) => x.e !== "sin(1)").map((x) => x.r.us / stock))
guard("builtins within 3× a stock builtin", worst <= 3.0, `worst is ${worst.toFixed(2)}× sin(1) — a builtin is unexpectedly heavy`)
console.log("")

if (failures > 0) { console.error(`${failures} guard failure(s).`); process.exit(1) }
console.log("All front-end guards passed.\n")
