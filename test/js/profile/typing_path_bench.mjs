// Typing-path microbench — coreshell / CM latency spine
// (specs/weave/typing-path.org id:weave-typing-path-bench).
//
// Run:  node --expose-gc test/js/profile/typing_path_bench.mjs
//
// Measures the paced observe path the shells walk after a keystroke:
//   reparseProgram (parse + contentKey adopt) · pageLaw.observe · findProse
// Headless — no CM chrome, no WebGL. Numbers are the spine, not the paint.

import { reparseProgram, parseProgram, phaseCells } from "../../../assets/js/turtling/parse.js"
import { findProse } from "../../../assets/js/editor/plang-mode.js"
import { pageLaw } from "../../../assets/js/weave/page.js"

const OVERLAY = new Set(["span", "comment", "endComment", "lit"])
const contentKey = (node) =>
    JSON.stringify(node, (k, v) => (OVERLAY.has(k) ? undefined : v))

function unitBlock(i) {
    return [
        "###",
        `* Chapter ${i}`,
        "prose text",
        "```",
        `def fig${i} n do`,
        "  fw n",
        "  rt 90",
        "  for 4 do",
        "    fw 20",
        "    rt 90",
        "  end",
        "  wait 100",
        "end",
        "```",
        "###",
        "",
    ].join("\n")
}

const makeSrc = (n) => Array.from({ length: n }, (_, i) => unitBlock(i)).join("\n")

function mkDoc(src) {
    const texts = src.split("\n")
    let pos = 0
    const lines = texts.map((text, i) => {
        const from = pos, to = pos + text.length
        pos = to + 1
        return { text, number: i + 1, from, to }
    })
    return {
        lines: lines.length,
        length: Math.max(0, pos - 1),
        line: (n) => lines[n - 1],
        lineAt: (p) => lines.find((o) => p >= o.from && p <= o.to) || lines[lines.length - 1],
    }
}

function bench(name, n, fn) {
    for (let i = 0; i < Math.min(10, n); i++) fn(i)
    if (global.gc) global.gc()
    const t0 = performance.now()
    for (let i = 0; i < n; i++) fn(i)
    const ms = performance.now() - t0
    const per = ms / n
    return { name, n, perMs: per, perUs: per * 1000 }
}

function fmt(r) {
    return `${r.name.padEnd(44)} n=${String(r.n).padStart(4)}  ${(r.perMs).toFixed(3).padStart(8)} ms/op`
}

function midEditAt(src) {
    const lines = src.split("\n")
    const i = lines.findIndex((l) => l.includes("fw 20"))
    return i < 0 ? 0 : i
}

function applyMidEdit(src, editAt, i) {
    const ls = src.split("\n")
    ls[editAt] = `    fw ${20 + (i % 30)}`
    return ls.join("\n")
}

const SIZES = [8, 40, 80]

console.log("=== typing path bench (id:weave-typing-path-bench) ===")
console.log("node", process.version, global.gc ? "gc:on" : "gc:off")
console.log("")

for (const cells of SIZES) {
    const src = makeSrc(cells)
    const lines = src.split("\n").length
    const ast = parseProgram(src)
    const editAt = midEditAt(src)

    console.log(`--- ${cells} cells · ${lines} lines · ${src.length} B · top=${ast.length} ---`)

    const rows = [
        bench("parseProgram", 40, () => parseProgram(src)),
        bench("contentKey top×2", 80, () => {
            for (const n of ast) contentKey(n)
            for (const n of ast) contentKey(n)
        }),
        (() => {
            let prev = parseProgram(src), text = src
            return bench("reparseProgram mid-edit", 40, (i) => {
                const next = applyMidEdit(text, editAt, i)
                prev = reparseProgram(next, text, prev)
                text = next
            })
        })(),
        (() => {
            const law = pageLaw({ localKeys: () => [] })
            law.observe("b", { name: "b", doc: src, own: true, attention: { line: 5 } })
            let text = src
            return bench("pageLaw.observe mid-edit", 40, (i) => {
                text = applyMidEdit(text, editAt, i)
                return law.observe("b", {
                    name: "b", doc: text, own: true, attention: { line: editAt + 1 },
                })
            })
        })(),
        bench("findProse NEW doc", 80, (i) => findProse(mkDoc(src + (i % 2 ? " " : "")))),
        (() => {
            const fixed = mkDoc(src)
            return bench("findProse SAME doc (memo)", 500, () => findProse(fixed))
        })(),
    ]

    for (const r of rows) console.log(fmt(r))

    // Seat emission: how often does a mid-edit produce canvas effects?
    const law = pageLaw()
    law.observe("e", { name: "e", doc: src, own: true, attention: { line: 5 } })
    let text = src, empty = 0, seats = 0
    for (let i = 0; i < 30; i++) {
        text = applyMidEdit(text, editAt, i)
        const ans = law.observe("e", {
            name: "e", doc: text, own: true, attention: { line: editAt + 1 },
        })
        // Two named arrays, not tagged ops (Cut A) — a run IS a seat.
        if (!ans.runs.length) empty++
        else seats += ans.runs.length
    }
    console.log(`  seat emission (30 mid-edits): empty=${empty} seat/draw=${seats}`)

    // Sibling === survival after one cell edit
    const a1 = parseProgram(src)
    const c1 = phaseCells(a1)
    let hits = 0, at = -1
    const ls = src.split("\n")
    for (let i = 0; i < ls.length; i++) {
        if (ls[i].includes("fw 20")) {
            hits++
            if (hits === Math.min(3, cells)) { at = i; break }
        }
    }
    if (at >= 0) {
        ls[at] = "    fw 99"
        const a2 = reparseProgram(ls.join("\n"), src, a1)
        const c2 = phaseCells(a2)
        let same = 0
        for (let i = 0; i < c1.length; i++) {
            const n1 = c1[i].nodes, n2 = c2[i].nodes
            if (n1 && n2 && n1.length === n2.length && n1.every((n, j) => n === n2[j])) same++
        }
        console.log(`  sibling nodes === after 1-cell edit: ${same}/${c1.length}`)
    }

    const reparse = rows.find((r) => r.name.startsWith("reparseProgram"))
    if (reparse) {
        console.log(`  pace duty @20ms: ${((reparse.perMs / 20) * 100).toFixed(0)}% (reparse alone)`)
    }
    console.log("")
}

console.log("See specs/weave/typing-path.org for ranking and levers.")
console.log("DONE")
