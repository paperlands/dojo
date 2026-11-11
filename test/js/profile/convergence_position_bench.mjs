// Where the edit IS, not only how big the document is — the convergence crossover.
// Uses min-of-rounds (test/js/profile/minn.mjs): a single run has a 3x spread here.
// Run: node --expose-gc test/js/profile/convergence_position_bench.mjs [cells]
// Where the edit is, not how big the document is: the convergence crossover.
import { parseProgram, reparseProgram, reparseStats, resetReparseStats } from "../../../assets/js/turtling/parse.js"
const unitBlock = (i) => ["###", `* Chapter ${i}`, "prose text", "```", `def fig${i} n do`,
  "  fw n", "  rt 90", "  for 4 do", "    fw 20", "    rt 90", "  end", "  wait 100",
  "end", "```", "###", ""].join("\n")
const cells = Number(process.argv[2] ?? 200)
const src = Array.from({ length: cells }, (_, i) => unitBlock(i)).join("\n")
const ls = src.split("\n")
const editAt = (frac) => Math.max(1, Math.min(ls.length - 2, Math.round(ls.length * frac)))
const minOf = (fn) => { let best = Infinity; for (let r = 0; r < 7; r++) { const t0 = performance.now(); for (let i = 0; i < 20; i++) fn(i); best = Math.min(best, (performance.now() - t0) / 20) } return best }
console.log(`${cells} cells · ${ls.length} lines`)
for (const frac of [0.02, 0.1, 0.5, 0.9, 0.98]) {
  const at = editAt(frac)
  const edited = (i) => { const a = ls.slice(); a[at] = `    fw ${20 + (i % 30)}`; return a.join("\n") }
  resetReparseStats()
  let prev = parseProgram(src), text = src
  const chained = minOf((i) => { const next = edited(i); const got = reparseProgram(next, text, prev); text = next; prev = got })
  const stats = reparseStats()
  console.log(`  edit at line ${String(at).padStart(5)} (${(frac * 100).toFixed(0).padStart(3)}%) · reparse ${chained.toFixed(3)} ms · converged ${stats.converged} fell ${stats.fallback}`)
}
const parse = minOf(() => parseProgram(src))
console.log(`  full parse                        ${parse.toFixed(3)} ms`)
