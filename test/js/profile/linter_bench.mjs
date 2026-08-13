// Linter micro-benchmark (id:gw-grammar) — the editor face must stay buttery
// while writing. Two hot paths:
//   1. Tokenization — runs on every keystroke over the viewport.
//   2. Code-cell activation — a StateField that recomputes on every cursor move.
//
// Run:  node --expose-gc test/js/profile/linter_bench.mjs
//
// It reports tokens/ms and heap churn for the tokenizer, and compares the naive
// activation path (findCells on every cursor move) against the cached path
// (findCells once per edit, cellAt per move) — the win that keeps arrows smooth.

import { plangModeSpec, findCells, cellAt } from "../../../assets/js/editor/plang-mode.js"
import { stepActivation } from "../../../assets/js/editor/code-cell-activation.js"

// Minimal StringStream mirroring CM6's StreamLanguage (same as the tokenizer test).
class Stream {
    constructor(text) { this.string = text; this.pos = 0; this.start = 0 }
    sol()  { return this.pos === 0 }
    eol()  { return this.pos >= this.string.length }
    peek() { return this.string[this.pos] }
    next() { return this.pos < this.string.length ? this.string[this.pos++] : undefined }
    eat(m) { const c = this.string[this.pos]; const ok = typeof m === "string" ? c === m : c && m.test(c); if (ok) { this.pos++; return c } }
    eatWhile(re) { const s = this.pos; while (!this.eol() && re.test(this.string[this.pos])) this.pos++; return this.pos > s }
    eatSpace()   { const s = this.pos; while (!this.eol() && /[ \t]/.test(this.string[this.pos])) this.pos++; return this.pos > s }
    skipToEnd()  { this.pos = this.string.length }
    backUp(n)    { this.pos -= n }
    current()    { return this.string.slice(this.start, this.pos) }
    indentation(){ return this.string.length - this.string.replace(/^[ \t]*/, "").length }
    match(pattern, consume = true) {
        if (typeof pattern === "string") {
            if (this.string.slice(this.pos, this.pos + pattern.length) === pattern) {
                if (consume !== false) this.pos += pattern.length
                return true
            }
            return null
        }
        const m = this.string.slice(this.pos).match(pattern)
        if (m && m.index > 0) return null
        if (m && consume !== false) this.pos += m[0].length
        return m
    }
}

// A DOM-free doc stand-in with the CM6 Text surface findCells/cellAt use.
function mkDoc(src) {
    const texts = src.split("\n")
    let pos = 0
    const objs = texts.map((text, i) => {
        const from = pos, to = pos + text.length
        pos = to + 1
        return { text, number: i + 1, from, to }
    })
    return {
        lines:  objs.length,
        length: pos,
        line:   (n) => objs[n - 1],
        lineAt: (p) => objs.find(o => p >= o.from && p <= o.to) || objs[objs.length - 1],
    }
}

// A realistic literate buffer: code interleaved with meadows carrying headlines,
// quotes, snippets, and full ``` cells — repeated to a writer-sized document.
function bigDoc(blocks) {
    const unit = [
        "fw 100",
        "rt 90",
        "for 4 do",
        "  fw 50 # a step [[note]]",
        "  rt 90",
        "end",
        "###",
        "* A chapter",
        "some /lean/ prose with a [[portal]] and =fw 10= inline",
        "| Dreams are the touchstones of our characters.",
        "> rt 45",
        "```",
        "def spiral n do",
        "  fw n",
        "  rt 90",
        "  spiral n + 5",
        "end",
        "```",
        "###",
    ]
    const out = []
    for (let i = 0; i < blocks; i++) out.push(...unit)
    return out.join("\n")
}

const lex = (src, state) => {
    let n = 0
    for (const line of src.split("\n")) {
        const stream = new Stream(line)
        while (!stream.eol()) {
            stream.start = stream.pos
            plangModeSpec.token(stream, state)
            n++
        }
    }
    return n
}

const ms = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6 }
const heapMB = () => { global.gc?.(); return process.memoryUsage().heapUsed / 1048576 }

const BLOCKS = 300               // ~5400 lines — a large literate document
const src    = bigDoc(BLOCKS)
const lines  = src.split("\n").length
const doc    = mkDoc(src)

console.log(`document: ${lines} lines, ${src.length} chars\n`)

// ── 1. Tokenizer throughput + churn ────────────────────────────────────────
{
    const REPEAT = 40
    let tokens = 0
    const before = heapMB()
    const t = ms(() => { for (let i = 0; i < REPEAT; i++) tokens = lex(src, plangModeSpec.startState()) })
    const after = heapMB()
    console.log("tokenizer")
    console.log(`  ${tokens} tokens/pass · ${REPEAT} passes in ${t.toFixed(1)}ms`)
    console.log(`  ${(tokens * REPEAT / t).toFixed(0)} tokens/ms · ${(t / REPEAT).toFixed(2)}ms/full-parse`)
    console.log(`  heap Δ over run: ${(after - before).toFixed(1)}MB\n`)
}

// ── 2. Activation: naive (findCells per move) vs cached (findCells once) ─────
{
    const MOVES = 20000          // cursor moves — arrows/clicks while writing
    // Random-ish cursor lines walking through the doc.
    const at = (i) => ((i * 37) % lines) + 1

    const naive = ms(() => {
        for (let i = 0; i < MOVES; i++) cellAt(findCells(doc), at(i))   // rebuild the cell index every move
    })

    const cached = ms(() => {
        const cells = findCells(doc)                                    // once per edit, not per move
        let key = null
        for (let i = 0; i < MOVES; i++) {
            const c = cellAt(cells, at(i))
            const k = c ? c.open : null
            if (k === key) continue                                     // memo: active cell unchanged → no work
            key = k
        }
    })

    console.log("activation (per cursor move)")
    console.log(`  naive  (findCells each move): ${naive.toFixed(1)}ms for ${MOVES} moves · ${(naive / MOVES * 1000).toFixed(2)}µs/move`)
    console.log(`  cached (findCells once)     : ${cached.toFixed(1)}ms for ${MOVES} moves · ${(cached / MOVES * 1000).toFixed(2)}µs/move`)
    console.log(`  speedup: ${(naive / cached).toFixed(1)}×`)
}

// ── 3. Shipped activation field: rebuilds decorations only when the cell changes ─
{
    const MOVES = 20000
    const at = (i) => ((i * 37) % lines) + 1
    let builds = 0
    const build = () => ({ deco: ++builds })   // count decoration rebuilds
    const NONE  = { none: true }

    let v = stepActivation(null, { docChanged: true, doc, headLine: at(0) }, build, NONE)
    const firstBuilds = builds
    const before = heapMB()
    const t = ms(() => {
        for (let i = 1; i < MOVES; i++)
            v = stepActivation(v, { selectionChanged: true, doc, headLine: at(i) }, build, NONE)
    })
    const after = heapMB()
    const rebuilds = builds - firstBuilds

    console.log("\nshipped activation field (stepActivation)")
    console.log(`  ${MOVES} cursor moves in ${t.toFixed(1)}ms · ${(t / MOVES * 1000).toFixed(2)}µs/move`)
    console.log(`  decoration rebuilds: ${rebuilds} of ${MOVES - 1} moves (${(rebuilds / (MOVES - 1) * 100).toFixed(1)}% — the rest are memo hits)`)
    console.log(`  heap Δ over run: ${(after - before).toFixed(1)}MB`)
}

// ── 4. The docChanged path — findCells + full rebuild once per keystroke ─────
{
    const KEYS = 4000                            // keystrokes while typing in a cell
    const build = () => ({ deco: {} })           // stand-in RangeSet
    const NONE  = { none: true }
    let v = stepActivation(null, { docChanged: true, doc, headLine: 14 }, build, NONE)
    const before = heapMB()
    const t = ms(() => {
        for (let i = 0; i < KEYS; i++)
            v = stepActivation(v, { docChanged: true, doc, headLine: 14 }, build, NONE)
    })
    const after = heapMB()
    console.log("\ntyping path (docChanged — findCells re-walk per keystroke)")
    console.log(`  ${KEYS} keystrokes in ${t.toFixed(1)}ms · ${(t / KEYS * 1000).toFixed(2)}µs/keystroke`)
    console.log(`  heap Δ over run: ${(after - before).toFixed(1)}MB`)
}
