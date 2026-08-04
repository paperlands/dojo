// The press — Shoot 0's transpile table (id:gw-grammar), pinned. Run with:
//   node --test test/js/seat/press_test.mjs
//
// Each test holds one row of the table; the last holds the whole-fragment
// guarantee: pressed source parses clean under the ONE parser, and forking a
// page really is holding its buffer.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { transpile } from "../../../assets/js/weave/parse.js"
import { parseProgram, printAST, phaseCells } from "../../../assets/js/turtling/parse.js"

// spirals.org in miniature — every press-table row present at least once.
const FRAGMENT = `* SPIRALS *
:PROPERTIES:
:ID: frag-spiral
:TYPE: pattern
:END:
#+title: Spirals
#+FILETAGS: :codex:fragment:

#+BEGIN_QUOTE
A snail wears one on its back.
A fern keeps one curled up tight.
#+END_QUOTE

** The wonder
A spiral goes round like a circle ([[id:frag-roundness]]) — but each time
round it swings out a *little wider*. You need a number that won't sit still.

#+BEGIN_SRC paperlang
def coil x do
  fw x
  rt 90
  coil x+1
end

coil 0
#+END_SRC

Type it and watch! The first sides are too short to see ([[id:frag-does-it-stop]]).
`

describe("the press table", () => {
    test("harvests :ID: and #+title; the drawers are the machine's share", () => {
        const { id, title, source } = transpile(FRAGMENT)
        assert.equal(id, "frag-spiral")
        assert.equal(title, "Spirals")
        assert.ok(!source.includes(":PROPERTIES:"))
        assert.ok(!source.includes("#+"))
    })

    test("the cell stands in the meadow: src becomes ``` … ``` inside one clearing", () => {
        const { source } = transpile(FRAGMENT)
        assert.match(source, /^def coil x do$/m)
        assert.ok(!source.includes("BEGIN_SRC"))
        const fences = source.split("\n").filter(l => l.trim() === "###")
        assert.equal(fences.length, 2, "the page is ONE clearing — cells do not close it")
        const cellFences = source.split("\n").filter(l => l.trim() === "```")
        assert.equal(cellFences.length, 2, "the cell wears its own fences inside the meadow")
        const open = source.indexOf("###")
        const close = source.lastIndexOf("###")
        assert.ok(source.indexOf("```") > open && source.lastIndexOf("```") < close,
            "the cell rides INSIDE the meadow (findCells only sees cells in prose)")
    })

    test("the sibling ambients of Shoot 1 DERIVE from the one AST — never ferried", () => {
        // press → parse → split: the cell split has exactly one source of
        // truth, the cellFence markers the parser already carries.
        const { source } = transpile(FRAGMENT)
        const cells = phaseCells(parseProgram(source)).map((c) => c.code)
        assert.equal(cells.length, 1)
        assert.ok(cells[0].includes("def coil x do"))
        assert.ok(cells[0].includes("coil 0"))
        assert.ok(!cells[0].includes("```"), "a cell holds code only, never its fences")
        // and the split survives the wire: JSON-thawed nodes split the same
        const thawed = JSON.parse(JSON.stringify(parseProgram(source)))
        assert.deepEqual(phaseCells(thawed).map((c) => c.code), cells)
    })

    test("portals keep the id-face; only the id: scheme is stripped", () => {
        // Q2 settled <2026-07-12>: the press knows one file and never guesses
        // a foreign name — id → name belongs to the resolver + index.
        const { source } = transpile(FRAGMENT)
        assert.ok(source.includes("[[frag-roundness]]"))
        assert.ok(source.includes("[[frag-does-it-stop]]"))
        assert.ok(!source.includes("[[id:"))
    })

    test("the quote wears the bar: one | per line", () => {
        const { source } = transpile(FRAGMENT)
        assert.match(source, /^\| A snail wears one on its back\.$/m)
        assert.match(source, /^\| A fern keeps one curled up tight\.$/m)
    })

    test("headlines survive verbatim — prose names are phrases", () => {
        // Q3 settled <2026-07-12>: verbatim, spaces and caps intact — the
        // phase's name IS its address; forgiveness lives in the resolver's
        // comparison, never in what is stored or shown.
        const { source } = transpile(FRAGMENT)
        assert.match(source, /^\*\* The wonder$/m)
    })

    test("the fork guarantee: pressed source parses clean under the one parser", () => {
        const { source } = transpile(FRAGMENT)
        const ast = parseProgram(source)
        assert.ok(Array.isArray(ast) && ast.length > 0)
        // the program survives the press whole: coil is defined and walked —
        // the cell is code being code, not prose swallowed by the meadow
        assert.ok(ast.some(n => n.type === "Define" && n.value === "coil"))
        // and the buffer survives the AST whole: printAST re-emits the cell
        // fences inside the clearing, so the outer viewer's cell dim/fold
        // (findCells) reads the reprinted buffer exactly as the pressed one
        const reprint = printAST(ast)
        const cellFences = reprint.split("\n").filter(l => l.trim() === "```")
        assert.equal(cellFences.length, 2)
        assert.match(reprint, /^###/m)
    })
})
