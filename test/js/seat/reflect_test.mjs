// The reflect law (D022) — what crosses the peer seam. Run with:
//   node --test test/js/seat/reflect_test.mjs
//
// The bug this pins: `renderstate.meta.commands` used to hold the instructions
// the LAST SEAT ran, published as if it were the buffer. A page seats once per
// cell, so the peer saw a PROGRAM's stripped fences (cells emptied), a PAGE's
// single cell, or — after a reach — a warm sibling, with the hatch gate closed
// behind it. Here the reflect is a QUERY over the authored buffer's standing
// tree, so what a peer renders is the document, byte for byte.
//
// The harness is the real seam in miniature: the page law's effects, the
// batch's hatch gate, and the reflect the surface would send. Nothing is
// mocked but the canvas.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { pageLaw } from "../../../assets/js/weave/page.js"
import { printAST, parseProgram, phaseCells, phaseAt, cellAtLine } from "../../../assets/js/turtling/parse.js"
import { diagnostics } from "../../../assets/js/weave/queries.js"

const PAGE_SRC = `###
* Heading
\`\`\`
loop 4 do
  fw 100
  rt 90
end
\`\`\`
** Subheading
\`\`\`
loop 8 do
  fw 100
  rt 45
end
\`\`\`
###`

const PROGRAM_SRC = `fw 1
###
previews stand beside the program

\`\`\`
fw 2
\`\`\`
###`

const PLAIN_SRC = `fw 3
rt 90`

const BROKEN_CELL_SRC = `###
* Heading
\`\`\`
fw 10
\`\`\`
** Subheading
\`\`\`
loop do
  fw 100
end
\`\`\`
###`

// The inner surface in miniature: the authored record, the batch gate, and
// the reflect the hatch seam would send (inner.js perform + reflection).
function surface() {
    const law = pageLaw()
    const memo = new Map()          // stands for turtle._parseMemo (plain tabs)
    const reached = new Map()       // stands for the surface's attention ledger
    let authored = null
    let gate = true                 // !turtle._hatchSuppressed

    const perform = (effects) => {
        for (const e of effects) {
            if (e.op === "seat") memo.set(e.key, e.nodes ?? parseProgram(e.code))
            if (e.op === "draw") memo.set(e.addr, parseProgram(e.code))
            if (e.op === "remove") memo.delete(e.key)
        }
        const runs = effects.filter((e) => e.op === "seat" || e.op === "draw")
        if (runs.length) gate = runs.some((e) => e.hatch !== false)
        return effects
    }

    // The surface's two channels, as inner.js has them: the canvas performs,
    // the input organ settles. Every law verb answers in one shape, so the
    // harness cannot hand the wrong half to the wrong door either.
    const enact = (addr, ans) => {
        if (ans.landed) reached.set(addr, ans.landed.line)
        return perform(ans.effects)
    }

    return {
        law,
        gate: () => gate,
        // The child's edit and his live draft are the SAME call — one verb, `own:true`,
        // his attention. The harness holds the reached line per addr exactly
        // as the inner shell does.
        edit(addr, name, content) {
            authored = { addr, name, text: content }
            return enact(addr, law.observe(addr, {
                name, doc: content, own: true,
                attention: reached.has(addr) ? { line: reached.get(addr) } : null,
            }))
        },
        draft(addr, name, code) {
            return this.edit(addr, name, code)
        },
        // The reach is line-addressed (D021); the harness resolves the cell
        // it means through the same door the law does.
        reach(addr, n) {
            const cells = phaseCells(law.tree(addr) ?? [])
            const line = cells[n]?.open ?? null
            reached.set(addr, line)
            return enact(addr, law.attend(addr, line))
        },
        friend(addr, name, ast) {
            const r = law.observe(addr, { name, doc: ast, own: false, attention: null })
            enact(addr, r)
            return { ...r, code: r.source }
        },
        // The reflect: the AUTHORED buffer's whole standing tree ⊕ its diagnostics.
        reflection() {
            if (!authored) return null
            const ast = law.tree(authored.addr) ?? memo.get(authored.addr)
            return {
                source: authored.text,
                commands: ast ?? [],
                diagnostics: ast ? diagnostics(ast) : [],
            }
        },
        // What the outershell would show: printAST over the reflected tree.
        rendered() {
            const r = this.reflection()
            return r?.commands?.length ? printAST(r.commands) : (r?.source ?? "")
        },
    }
}

describe("the reflect is the document (D022 law 1)", () => {
    test("a PAGE reflects the whole page — not the kindled cell", () => {
        const s = surface()
        s.edit("buf", "mine", PAGE_SRC)
        assert.equal(s.rendered(), PAGE_SRC)
    })

    test("a PROGRAM reflects the whole buffer — cells are NOT stripped", () => {
        const s = surface()
        s.edit("buf", "mine", PROGRAM_SRC)
        const shown = s.rendered()
        assert.equal(shown, PROGRAM_SRC)
        // The reported symptom, pinned dead: fences must never arrive empty.
        assert.ok(shown.includes("fw 2"), "the cell's code must survive the seam")
        assert.doesNotMatch(shown, /```\n```/, "no empty cell fences")
    })

    test("a PLAIN buffer reflects itself", () => {
        const s = surface()
        s.edit("buf", "mine", PLAIN_SRC)
        assert.equal(s.rendered(), PLAIN_SRC)
    })

    test("moving the cursor between cells does not change what a peer sees", () => {
        const s = surface()
        s.edit("buf", "mine", PAGE_SRC)
        const before = s.rendered()
        s.reach("buf", 1)
        assert.equal(s.rendered(), before)
        s.reach("buf", 0)
        assert.equal(s.rendered(), before)
    })

    test("an edit after a reach reflects the page, not the warm sibling", () => {
        const s = surface()
        s.edit("buf", "mine", PAGE_SRC)
        s.reach("buf", 1)
        const next = PAGE_SRC.replace("rt 45", "rt 60")
        s.edit("buf", "mine", next)
        assert.equal(s.rendered(), next)
    })
})

describe("errors propagate, at any nesting (D022 law 3)", () => {
    test("a broken cell's diagnostic rides the reflect, span-true", () => {
        const s = surface()
        s.edit("buf", "mine", BROKEN_CELL_SRC)
        const { diagnostics: wounds } = s.reflection()
        assert.ok(wounds.length >= 1, "the wound must cross the seam")
        const [first] = wounds
        assert.match(first.message, /loop/)
        assert.equal(first.kind, "parse")
        // The span is a TRUE buffer line — the broken `loop do` is line 8.
        assert.equal(first.span.line, 8)
        assert.equal(BROKEN_CELL_SRC.split("\n")[first.span.line - 1].trim(), "loop do")
    })

    test("the healthy parts still live — a diagnostic is not a dark canvas (D020)", () => {
        const s = surface()
        s.edit("buf", "mine", BROKEN_CELL_SRC)
        // The whole document still reflects, the good cell included.
        assert.ok(s.rendered().includes("fw 10"))
    })

    test("a clean page reflects no diagnostics", () => {
        const s = surface()
        s.edit("buf", "mine", PAGE_SRC)
        assert.deepEqual(s.reflection().diagnostics, [])
    })
})

describe("the hatch gate is the batch's word (D022)", () => {
    test("a page with a warm sibling keeps reflecting", () => {
        const s = surface()
        s.edit("buf", "mine", PAGE_SRC)
        s.reach("buf", 1)
        // This batch seats the kindled cell AND a passive warm sibling; the
        // sibling used to land last and close the gate for good.
        s.edit("buf", "mine", PAGE_SRC.replace("rt 45", "rt 60"))
        assert.equal(s.gate(), true)
    })

    test("a friend's push is passive — the gate closes, nothing is authored", () => {
        const s = surface()
        s.edit("buf", "mine", PLAIN_SRC)
        s.friend("@ada", "ada", parseProgram("fw 99"))
        assert.equal(s.gate(), false)
        // The child's buffer is still the authored one — a friend never becomes it.
        assert.equal(s.rendered(), PLAIN_SRC)
    })

    test("a live draft is hers — the gate opens and the draft is authored", () => {
        const s = surface()
        s.edit("buf", "mine", PLAIN_SRC)
        s.friend("@ada", "ada", parseProgram("fw 99"))
        s.draft("@ada", "ada", "fw 42\nrt 10")
        assert.equal(s.gate(), true)
        assert.equal(s.rendered(), "fw 42\nrt 10")
    })
})

describe("a watched friend's page mounts as a page (D022 consequence)", () => {
    test("a cell-bearing push seats the first cell, not the whole tree", () => {
        const s = surface()
        const { effects, code } = s.friend("@ada", "ada", parseProgram(PAGE_SRC))
        // The document still crosses whole — the watcher's viewer shows it all.
        assert.equal(code, PAGE_SRC)
        const seats = effects.filter((e) => e.op === "seat")
        assert.equal(seats.length, 1, "only the first cell mounts")
        assert.equal(seats[0].key, "@ada#1.1")
        assert.equal(seats[0].code, "loop 4 do\n  fw 100\n  rt 90\nend")
        assert.ok(seats.every((e) => e.hatch === false), "a friend's page never hatches")
    })

    test("their next push re-seats what stands — a peer keeps typing", () => {
        const s = surface()
        s.friend("@ada", "ada", parseProgram(PAGE_SRC))
        const next = PAGE_SRC.replace("rt 45", "rt 60")
        const { effects } = s.friend("@ada", "ada", parseProgram(next))
        assert.ok(effects.some((e) => e.op === "seat"), "a live peer's page re-seats")
    })

    test("a library page is static — a re-push changes nothing", () => {
        const s = surface()
        s.friend("~/roundness", "Roundness", parseProgram(PAGE_SRC))
        const { effects } = s.friend("~/roundness", "Roundness", parseProgram(PAGE_SRC))
        assert.deepEqual(effects, [])
    })

    test("another's page is not hers — it survives her opening a page", () => {
        const s = surface()
        s.friend("@ada", "ada", parseProgram(PAGE_SRC))
        assert.equal(s.law.hasPage("@ada"), false, "not her page")
        const hers = s.edit("buf", "mine", PAGE_SRC)   // stands HER local pages down
        assert.deepEqual(s.law.localPages(), ["buf"])
        // The exclusive law is the child's alone: opening his own page never reached
        // across to close theirs.
        assert.ok(!hers.some((e) => e.op === "remove" && e.key.startsWith("@ada")),
            "their cells are untouched by her page")
        // And their page is still live under it — their next keystroke seats.
        const { effects } = s.friend("@ada", "ada", parseProgram(PAGE_SRC.replace("rt 45", "rt 60")))
        assert.ok(effects.some((e) => e.op === "seat"))
    })
})

describe("a diagnostic is located by LINE, and names its phase (D021)", () => {
    // The ordinal could not do this: insert a cell above and every later
    // address shifts, so a standing diagnostic silently re-aims at a sister.
    const WOUNDED = `###
* chapter one

\`\`\`
fw 10
\`\`\`

** phase A

\`\`\`
loop do
  fw 1
end
\`\`\`
###`

    test("the diagnostic names the phase it stands in, not a cell number", () => {
        const ast = parseProgram(WOUNDED)
        const wounds = diagnostics(ast, [], "buf")
        const first = wounds[0]
        assert.equal(first.span.line, 11, "the broken `loop do`")
        assert.deepEqual(phaseAt(ast, first.span.line), ["chapter one", "phase A"])
    })

    test("inserting a cell above does not re-aim the diagnostic's phase", () => {
        const before = phaseAt(parseProgram(WOUNDED),
            diagnostics(parseProgram(WOUNDED), [], "buf")[0].span.line)
        const GROWN = WOUNDED.replace("* chapter one\n", "* chapter one\n\n```\nfw 0\n```\n")
        const ast = parseProgram(GROWN)
        const line = diagnostics(ast, [], "buf")[0].span.line
        assert.deepEqual(phaseAt(ast, line), before,
            "the same wound keeps the same phase though a cell appeared above it")
    })

    test("the broken cell is addressable by line, sisters unharmed", () => {
        const ast = parseProgram(WOUNDED)
        const cells = phaseCells(ast)
        const line = diagnostics(ast, [], "buf")[0].span.line
        const idx = cellAtLine(cells, line)
        assert.equal(idx, 1, "the second cell holds the wound")
        assert.equal(cells[0].code.trim(), "fw 10", "its sister is untouched")
        assert.deepEqual(cells[idx].path, ["chapter one", "phase A"])
    })
})
