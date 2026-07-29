// The lit tokenizer — Phase 6 editor face (id:gw-grammar). Run with:
//   node --test test/js/lit_tokenizer_test.mjs
//
// The subtlety this pins: the margin is one line (pop at EOL, code resumes on the
// next line); the meadow persists across lines (pop only at the closing `###`).
// A leak either way would tokenize code as prose or prose as code.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { plangModeSpec, isCellOpener, codeCellFoldService, findCells, cellAt, eyelineCell, marginOutlineFoldService, findProse, defaultAttend} from "../../assets/js/editor/plang-mode.js"
import { stepActivation } from "../../assets/js/editor/code-cell-activation.js"
import { outline, classify, splitLines } from "../../assets/js/turtling/parse.js"

// A faithful-enough StringStream + per-line loop, mirroring CM6's StreamLanguage:
// state is created once and carried across lines; token() is called until EOL.
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

// Tokenize a whole program → flat list of { text, style } across all lines.
function lex(src) {
    const state = plangModeSpec.startState()
    const out = []
    for (const line of src.split("\n")) {
        const stream = new Stream(line)
        while (!stream.eol()) {
            stream.start = stream.pos
            const style = plangModeSpec.token(stream, state)
            if (stream.pos === stream.start) throw new Error(`no progress at "${line}" pos ${stream.pos}`)
            out.push({ text: stream.current(), style })
        }
    }
    return out
}

// All styles seen for a given text fragment.
const stylesOf = (toks, text) => toks.filter(t => t.text === text).map(t => t.style)

describe("the margin door", () => {
    test("the `#` marker dims; the prose is inked; a portal glows", () => {
        const toks = lex("fw 50 # take [[a step]]")
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "50"), ["number"])
        assert.deepEqual(stylesOf(toks, "#"), ["lineComment"])
        assert.deepEqual(stylesOf(toks, "[[a step]]"), ["link"])
    })

    test("a description portal glows whole — [[frag-x][word]] is one link", () => {
        const toks = lex("fw 50 # see [[frag-spiral][Spiralling to the End]]")
        assert.deepEqual(stylesOf(toks, "[[frag-spiral][Spiralling to the End]]"), ["link"])
    })

    test("the margin does not leak — the next line is code again", () => {
        const toks = lex("fw 50 # a note\nrt 90")
        // `rt` on line 2 must tokenize as a keyword, not prose
        assert.deepEqual(stylesOf(toks, "rt"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "90"), ["number"])
    })

    test("a lone `#` at end of line is just a dim marker", () => {
        const toks = lex("fw 50 #\nrt 90")
        assert.deepEqual(stylesOf(toks, "#"), ["lineComment"])
        assert.deepEqual(stylesOf(toks, "rt"), ["keyword"])
    })
})

// One grammar behind both doors (id:gw-grammar): the per-line marks the meadow speaks
// (`* ` headline, `| ` quote, `> ` snippet) live behind the margin `#` too, so an
// outline heading or a quote can ride a single code line — outshine in the buffer.
describe("the margin door — the shared per-line prose grammar", () => {
    test("`# * Title` is an outline heading riding the code (depth → h-level)", () => {
        const toks = lex("fw 50 # * The Ascent\nfw 10 # ** a turn")
        assert.deepEqual(stylesOf(toks, "* The Ascent"), ["heading1"])
        assert.deepEqual(stylesOf(toks, "** a turn"), ["heading2"])
        assert.deepEqual(stylesOf(toks, "#"), ["lineComment", "lineComment"]) // both `#` markers dim
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword", "keyword"])        // the code beside it stays code
    })

    test("the space disambiguates — `# *bold*` is inline strong, not a headline", () => {
        const toks = lex("fw 50 # *bold* aside")
        assert.deepEqual(stylesOf(toks, "*bold*"), ["strong"])
        assert.ok(!toks.some(t => t.style && t.style.startsWith("heading")))
    })

    test("`# | quote` wears the quote face; a portal still glows inside it", () => {
        const toks = lex('draw # | "gently" she said, see [[home]]')
        assert.ok(toks.some(t => t.style === "quote"))
        assert.deepEqual(stylesOf(toks, "[[home]]"), ["link"])
        assert.deepEqual(stylesOf(toks, "draw"), ["keyword"]) // the code beside the margin is untouched
    })

    test("`# > code` is a snippet — real linting under the faded-mono face", () => {
        const toks = lex("hide # > rt 45")
        assert.deepEqual(stylesOf(toks, "rt"), ["keyword monospace"])
        assert.deepEqual(stylesOf(toks, "45"), ["number monospace"])
        assert.deepEqual(stylesOf(toks, "hide"), ["keyword"])
    })

    test("a margin block does not leak — the next code line is code again", () => {
        for (const src of ["fw 50 # * Heading\nrt 90", "fw 50 # | a quote\nrt 90", "fw 50 # > fw 1\nrt 90"]) {
            const toks = lex(src)
            assert.deepEqual(stylesOf(toks, "rt"), ["keyword"], `leaked after: ${src}`)
            assert.deepEqual(stylesOf(toks, "90"), ["number"], `leaked after: ${src}`)
        }
    })

    test("the ``` cell mark stays meadow-only — a one-line margin can't open a cell", () => {
        const toks = lex("fw 50 # ```\nrt 90")
        // the backticks are just inked prose in the margin, and the next line is still code
        assert.ok(!toks.some(t => t.style && t.style.startsWith("heading")))
        assert.deepEqual(stylesOf(toks, "rt"), ["keyword"])
    })
})

describe("the meadow door", () => {
    test("fences dim, headlines rise, prose inks, portals glow", () => {
        const toks = lex("###\n* Chapter\nsome /lean/ prose with [[marco]]\n###")
        const fences = toks.filter(t => t.text === "###")
        assert.equal(fences.length, 2)
        assert.ok(fences.every(t => t.style === "lineComment"))
        assert.deepEqual(stylesOf(toks, "* Chapter"), ["heading1"])
        assert.deepEqual(stylesOf(toks, "/lean/"), ["emphasis"])
        assert.deepEqual(stylesOf(toks, "[[marco]]"), ["link"])
    })

    test("headline depth becomes heading level — h1, h2, h3", () => {
        const toks = lex("###\n* One\n** Two\n*** Three\n###")
        assert.deepEqual(stylesOf(toks, "* One"), ["heading1"])
        assert.deepEqual(stylesOf(toks, "** Two"), ["heading2"])
        assert.deepEqual(stylesOf(toks, "*** Three"), ["heading3"])
    })

    test("=code= riding prose keeps the real linting, wearing the faded-mono face", () => {
        const toks = lex("###\nthe turn is =fw 100= and =rt 90=\n###")
        // inner words carry BOTH their code tag AND monospace (the fade)
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword monospace"])
        assert.deepEqual(stylesOf(toks, "100"), ["number monospace"])
        assert.deepEqual(stylesOf(toks, "rt"), ["keyword monospace"])
        assert.deepEqual(stylesOf(toks, "90"), ["number monospace"])
        // delimiters dim; prose after the code resumes as prose, not code
        assert.ok(toks.some(t => t.text === "=" && t.style === "lineComment"))
        assert.deepEqual(stylesOf(toks, "and "), ["comment"])
    })

    test("the meadow persists across lines then releases — code resumes after `###`", () => {
        const toks = lex("###\nrt 90 is prose here, not a turn\n###\nrt 90")
        const closeFence = toks.map(t => t.text).lastIndexOf("###")
        const inside = toks.slice(0, closeFence)
        const after  = toks.slice(closeFence + 1)
        // inside the meadow, `rt` is prose, never a keyword
        assert.ok(!inside.some(t => t.style === "keyword"))
        // after the closing fence, code tokenizes as code again
        assert.deepEqual(stylesOf(after, "rt"), ["keyword"])
        assert.deepEqual(stylesOf(after, "90"), ["number"])
    })

    test("an unclosed meadow keeps inking to EOF — never a swallowed program", () => {
        const toks = lex("###\nfw 10 rt 90 end all prose now")
        // none of the code-looking words become keywords
        assert.ok(!toks.some(t => t.style === "keyword"))
    })
})

describe("prose blocks — the quotation bar and the snippet prompt", () => {
    test("`| …` is a quotation: the bar dims, the words wear the quote face", () => {
        const toks = lex("###\n| Dreams are the touchstones of our characters.\n###")
        assert.ok(toks.some(t => t.text.includes("|") && t.style === "lineComment")) // the marginal bar dissolves
        assert.ok(toks.some(t => t.style === "quote"))           // the voice wears the quote face
        assert.ok(!toks.some(t => t.style === "comment"))        // never plain inked prose
    })

    test("a portal still glows inside a quote", () => {
        const toks = lex("###\n| see [[dreams]] within\n###")
        assert.deepEqual(stylesOf(toks, "[[dreams]]"), ["link"]) // one markup grammar inside prose space
        assert.ok(toks.some(t => t.style === "quote"))
    })

    test("a quote is one line — code resumes below, nothing leaks", () => {
        const toks = lex("###\n| a quoted line\n###\nrt 90")
        assert.deepEqual(stylesOf(toks, "rt"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "90"), ["number"])
    })

    test("`> …` is a code snippet: real linting under the faded-mono face", () => {
        const toks = lex("###\n> fw 100\n###")
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword monospace"])
        assert.deepEqual(stylesOf(toks, "100"), ["number monospace"])
    })

    test("a snippet is one line — meadow prose resumes below, nothing leaks", () => {
        const toks = lex("###\n> fw 100\nrt 90 is prose here\n###")
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword monospace"]) // linted + faded
        assert.ok(!toks.some(t => t.style === "keyword"))             // no bare keyword escapes the fence
        assert.ok(toks.some(t => t.text.startsWith("rt 90") && t.style === "comment")) // the line below is prose
    })
})

describe("the code cell — ``` … ``` fenced blocks, linted at full strength", () => {
    test("the fences dim; the cell's lines are FULL-strength code, no fade", () => {
        const toks = lex("###\n```\nfw 100\nrt 90\n```\n###")
        // the ``` fences dissolve like the meadow fence
        const fences = toks.filter(t => t.text.trim() === "```")
        assert.equal(fences.length, 2)
        assert.ok(fences.every(t => t.style === "lineComment"))
        // code inside is the ordinary tags at full strength — no `monospace` fade
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "100"), ["number"])
        assert.deepEqual(stylesOf(toks, "rt"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "90"), ["number"])
    })

    test("the cell spans many lines and keeps block structure (do/end) linted", () => {
        const toks = lex("###\n```\nfor 4 do\n  fw 100\nend\n```\n###")
        assert.deepEqual(stylesOf(toks, "for"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "do"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "end"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword"])
    })

    test("the cell releases at the closing ``` — meadow prose resumes, code does not leak", () => {
        const toks = lex("###\n```\nfw 100\n```\nrt 90 is prose again\n###")
        // inside the cell, code is code
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword"])
        // after the closing fence we are prose again — `rt` is not a keyword
        assert.ok(toks.some(t => t.text.startsWith("rt 90") && t.style === "comment"))
    })

    // THE MARKER DISSOLVES, THE NAME DOES NOT (D024). The word on an opening
    // fence is the cell's identity and the author wrote it, so it takes a face
    // of its own rather than dimming away with the ```.
    test("an opening fence may carry a name; the marker and the name part", () => {
        const toks = lex("###\n```spiral\nfw 100\n```\n###")
        assert.ok(toks.some(t => t.text.includes("```") && !t.text.includes("spiral")
                              && t.style === "lineComment"), "the fence still dissolves")
        assert.ok(toks.some(t => t.text.includes("spiral") && t.style === "labelName"),
                  "the author's word is lit")
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword"])
    })

    test("a bare opening fence names nothing — no stray name token", () => {
        const toks = lex("###\n```\nfw 100\n```\n###")
        assert.ok(!toks.some(t => t.style === "labelName"))
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword"])
    })

    test("an unclosed cell keeps linting to EOF — never swallowed as prose", () => {
        const toks = lex("###\n```\nfw 100\nrt 90")
        assert.deepEqual(stylesOf(toks, "fw"), ["keyword"])
        assert.deepEqual(stylesOf(toks, "rt"), ["keyword"])
    })
})

// A DOM-free CM6 `state.doc` stand-in — enough for the fold services (litFold /
// indentFold aren't unit-tested; the ``` opener/closer pairing is worth pinning).
function mkDoc(src) {
    const texts = src.split("\n")
    let pos = 0
    const objs = texts.map((text, i) => {
        const from = pos, to = pos + text.length
        pos = to + 1                                          // +1 for the newline
        return { text, number: i + 1, from, to }
    })
    return {
        lines:  objs.length,
        length: pos,
        line:   (n) => objs[n - 1],
        lineAt: (p) => objs.find(o => p >= o.from && p <= o.to) || objs[objs.length - 1],
    }
}

describe("the code cell — folds like a phase (scrollable groundwork)", () => {
    test("only the opening ``` folds; the closer does not", () => {
        const doc = mkDoc("###\n```\nfw 100\nrt 90\n```\n###")
        assert.equal(isCellOpener(doc, 2), true)             // the opening fence
        assert.equal(isCellOpener(doc, 5), false)            // the closing fence
        assert.equal(isCellOpener(doc, 3), false)            // a body line
    })

    test("the fold spans the opener's end to the closing fence — the cell collapses whole", () => {
        const doc  = mkDoc("###\n```\nfw 100\nrt 90\n```\n###")
        const open = doc.line(2)
        const range = codeCellFoldService({ doc }, open.from, open.to)
        assert.deepEqual(range, { from: open.to, to: doc.line(5).to })   // through the closing ```
    })

    test("``` outside a meadow is not a cell — nothing folds", () => {
        const doc = mkDoc("```\nfw 100\n```")                 // no ### — this is code space, not prose
        assert.equal(isCellOpener(doc, 1), false)
        assert.equal(codeCellFoldService({ doc }, doc.line(1).from, doc.line(1).to), null)
    })

    test("two cells in one meadow each fold from their own opener", () => {
        const doc = mkDoc("###\n```\nfw 100\n```\nprose between\n```\nrt 90\n```\n###")
        assert.equal(isCellOpener(doc, 2), true)             // first opener
        assert.equal(isCellOpener(doc, 4), false)            // first closer
        assert.equal(isCellOpener(doc, 6), true)             // second opener
        assert.equal(isCellOpener(doc, 8), false)            // second closer
    })
})

describe("cursor-driven activation — which cell is live (the eval gate)", () => {
    test("findCells returns each cell's line span and termination", () => {
        const doc = mkDoc("###\n```\nfw 100\n```\nbetween\n```\nrt 90\n```\n###")
        // `path` rides every cell now: the editor and the parser read ONE
        // prose walk (turtling/parse.js outline), so a cell knows the phase
        // whose sisters it stands among, here as at the seam. `name` and
        // `coord` ride the same walk — the cell's identity (D024): unnamed
        // here, so each is named by its place among the preamble's cells.
        assert.deepEqual(findCells(doc), [
            { open: 2, end: 4, terminated: true, path: [], name: null, coord: [1] },
            { open: 6, end: 8, terminated: true, path: [], name: null, coord: [2] },
        ])
    })

    test("an unterminated cell (meadow closes) still reports its span", () => {
        const doc = mkDoc("###\n```\nfw 100\n###\nrt 90")   // ### closes the meadow, ending the cell
        assert.deepEqual(findCells(doc),
            [{ open: 2, end: 3, terminated: false, path: [], name: null, coord: [1] }])
    })

    test("``` outside a meadow is not a cell", () => {
        assert.deepEqual(findCells(mkDoc("```\nfw 100\n```")), [])
    })

    test("cellAt: the cursor's line picks the active cell; outside every cell is null", () => {
        const doc   = mkDoc("###\n```\nfw 100\n```\nbetween\n```\nrt 90\n```\n###")
        const cells = findCells(doc)
        const cell = (open, end, coord) => ({ open, end, terminated: true, path: [], name: null, coord })
        assert.deepEqual(cellAt(cells, 3), cell(2, 4, [1]))   // inside first cell body
        assert.deepEqual(cellAt(cells, 2), cell(2, 4, [1]))   // on its opening fence
        assert.deepEqual(cellAt(cells, 7), cell(6, 8, [2]))   // inside second cell
        assert.equal(cellAt(cells, 5), null)                                      // prose between cells — inert
        assert.equal(cellAt(cells, 1), null)                                      // the meadow fence — inert
    })
})

// The memo that keeps writing buttery: cursor movement must not re-walk the cell
// index or rebuild decorations unless the active cell actually changed.
describe("activation memo — cursor movement stays free of linter churn", () => {
    const doc  = mkDoc("###\n```\nfw 100\nrt 90\n```\nbetween\n```\nrt 45\n```\n###")
    const NONE = { none: true }                              // Decoration.none stand-in

    test("moving within the active cell rebuilds nothing (same value, cached index)", () => {
        let builds = 0
        const build = () => ({ deco: ++builds })
        const v0 = stepActivation(null, { docChanged: true, doc, headLine: 3 }, build, NONE)
        assert.equal(builds, 1)                              // first parse builds once
        const v1 = stepActivation(v0, { selectionChanged: true, doc, headLine: 4 }, build, NONE)
        assert.equal(v1, v0)                                 // SAME object — memo hit, zero allocation
        assert.equal(builds, 1)                              // no rebuild
        assert.equal(v1.cells, v0.cells)                     // cell index reused, not re-walked
    })

    test("moving to a different cell rebuilds exactly once, keeping the cached index", () => {
        let builds = 0
        const build = () => ({ deco: ++builds })
        const v0 = stepActivation(null, { docChanged: true, doc, headLine: 3 }, build, NONE)  // cell #1
        const v1 = stepActivation(v0, { selectionChanged: true, doc, headLine: 8 }, build, NONE) // cell #2
        assert.notEqual(v1, v0)
        assert.equal(builds, 2)
        assert.equal(v1.cells, v0.cells)                     // still the cached index — no re-walk
    })

    test("moving into prose keeps the light — sticky, and a memo hit", () => {
        let builds = 0
        const build = () => ({ deco: ++builds })
        const v0 = stepActivation(null, { docChanged: true, doc, headLine: 8 }, build, NONE)  // cell #2
        const v1 = stepActivation(v0, { selectionChanged: true, doc, headLine: 6 }, build, NONE) // prose "between"
        assert.equal(v1, v0)                                 // leaving to prose never moves focus
        assert.equal(v1.key, 7)                              // cell #2 stays lit
        const v2 = stepActivation(v1, { selectionChanged: true, doc, headLine: 1 }, build, NONE) // meadow fence
        assert.equal(v2, v1)
        assert.equal(builds, 1)
    })

    test("first light: cursor in prose lights the FIRST cell (init parity with the canvas)", () => {
        const build = (d, cells, active) => ({ active })
        const v0 = stepActivation(null, { docChanged: true, doc, headLine: 1 }, build, NONE)
        assert.equal(v0.key, 2)                              // the first cell wears the light
    })

    test("out of the fence, on bare code, no cell is active — she is making", () => {
        // fw 5 | ### | ``` | fw 100 | ``` | ### | rt 90
        const mixed = mkDoc("fw 5\n###\n```\nfw 100\n```\n###\nrt 90")
        let builds = 0
        const build = () => ({ deco: ++builds })
        const v0 = stepActivation(null, { docChanged: true, doc: mixed, headLine: 1 }, build, NONE)
        assert.equal(v0.key, null)                           // first light on bare code lights nothing
        const v1 = stepActivation(v0, { selectionChanged: true, doc: mixed, headLine: 4 }, build, NONE)
        assert.equal(v1.key, 3)                              // into the cell — it wakes
        const v2 = stepActivation(v1, { selectionChanged: true, doc: mixed, headLine: 7 }, build, NONE)
        assert.equal(v2.key, null)                           // out past the fence — all cells rest
        const v3 = stepActivation(v2, { selectionChanged: true, doc: mixed, headLine: 4 }, build, NONE)
        assert.equal(v3.key, 3)                              // reaching back into the cell relights it
    })

    test("prose keeps the light only INSIDE the meadow", () => {
        const mixed = mkDoc("fw 5\n###\nprose\n```\nfw 100\n```\nmore\n###\nrt 90")
        const build = () => ({ deco: 1 })
        const v0 = stepActivation(null, { docChanged: true, doc: mixed, headLine: 5 }, build, NONE) // in the cell
        assert.equal(v0.key, 4)
        const v1 = stepActivation(v0, { selectionChanged: true, doc: mixed, headLine: 7 }, build, NONE) // prose "more"
        assert.equal(v1, v0)                                 // inside the meadow: sticky, memo hit
        const v2 = stepActivation(v1, { selectionChanged: true, doc: mixed, headLine: 9 }, build, NONE) // bare rt 90
        assert.equal(v2.key, null)                           // outside: the light goes out
        const v3 = stepActivation(v2, { selectionChanged: true, doc: mixed, headLine: 3 }, build, NONE) // prose again
        assert.equal(v3.key, null)                           // nothing held to restore — prose alone lights nothing
    })

    test("the scroll gesture resolves by EYELINE — the topmost cell still on screen", () => {
        const cells = findCells(doc)                         // #1 spans 2…5, #2 spans 7…9
        assert.equal(eyelineCell(cells, 1, 4), cells[0])     // #1 under the eyeline
        assert.equal(eyelineCell(cells, 1, 9), cells[0])     // BOTH in view → the top one, not the last
        assert.equal(eyelineCell(cells, 3, 8), cells[0])     // #1 half off the top still holds it
        assert.equal(eyelineCell(cells, 6, 9), cells[1])     // #1 clean off the top → #2 takes it
        assert.equal(eyelineCell(cells, 6, 6), cells[0])     // only prose on screen: the one above holds
        assert.equal(eyelineCell(cells, 10, 10), cells[1])   // past everything: the last one above
        assert.equal(eyelineCell(cells, 1, 1), cells[0])     // before any cell → first light
        assert.equal(eyelineCell([], 1, 5), null)            // a cell-less page has no reach
    })

    test("a sliver does not hold the eyeline — the cell must fill the eye", () => {
        const cells = findCells(doc)                         // #1 spans 2…5, #2 spans 7…9
        assert.equal(eyelineCell(cells, 5, 9), cells[1])     // #1 down to its last line → #2, whole, takes it
        assert.equal(eyelineCell(cells, 4, 9), cells[0])     // #1 still half itself → it keeps it
        assert.equal(eyelineCell(cells, 5, 7), cells[0])     // slivers both ends: neither fills, the one above holds
        const tall = [{ open: 1, end: 100, terminated: true }]
        assert.equal(eyelineCell(tall, 40, 50), tall[0])     // a cell taller than the screen IS the screen
    })

    test("an edit (docChanged) re-walks the index", () => {
        const build = () => ({ deco: 1 })
        const v0 = stepActivation(null, { docChanged: true, doc, headLine: 3 }, build, NONE)
        // CM6 replaces the Text object on every edit — the findProse WeakMap
        // keys on that identity. Same content, new doc → fresh walk.
        const edited = mkDoc("###\n```\nfw 100\nrt 90\n```\nbetween\n```\nrt 45\n```\n###")
        const v1 = stepActivation(v0, { docChanged: true, doc: edited, headLine: 3 }, build, NONE)
        assert.notEqual(v1.cells, v0.cells)                  // fresh index after an edit
        // Same doc identity + docChanged still hits the memo (content cannot
        // have changed without a new Text) — real edits always bring a new doc.
        const v2 = stepActivation(v1, { docChanged: true, doc: edited, headLine: 3 }, build, NONE)
        assert.equal(v2.cells, v1.cells)
    })
})

// The margin outline — a `# * name` heading riding code folds the code beneath it,
// outshine-style, level by level (id:gw-grammar). The phase runs to the next
// same-or-shallower margin heading, a meadow opening, or EOF.
describe("the margin outline — `# * name` folds code like an outline node", () => {
    const foldAt = (doc, n) => marginOutlineFoldService({ doc }, doc.line(n).from, doc.line(n).to)

    test("a heading folds the code beneath it, down to the next sibling heading", () => {
        const doc   = mkDoc("fw 0 # * One\n  rt 90\n  fw 10\nfw 5 # * Two\n  rt 45")
        const range = foldAt(doc, 1)
        assert.deepEqual(range, { from: doc.line(1).to, to: doc.line(3).to }) // through fw 10, not into Two
    })

    test("a deeper heading nests — h2 folds inside h1's span", () => {
        const doc = mkDoc("fw 0 # * One\n  fw 1 # ** sub\n  rt 90\nfw 5 # * Two")
        assert.deepEqual(foldAt(doc, 1), { from: doc.line(1).to, to: doc.line(3).to }) // One holds sub + its body
        assert.deepEqual(foldAt(doc, 2), { from: doc.line(2).to, to: doc.line(3).to }) // sub holds just rt 90
    })

    test("the last heading folds to end-of-file", () => {
        const doc = mkDoc("fw 0 # * Only\n  rt 90\n  fw 10")
        assert.deepEqual(foldAt(doc, 1), { from: doc.line(1).to, to: doc.line(3).to })
    })

    test("a plain margin and a bare code line are not outline headings — nothing folds", () => {
        const doc = mkDoc("fw 50 # just a note\nrt 90")
        assert.equal(foldAt(doc, 1), null)
        assert.equal(foldAt(doc, 2), null)
    })

    test("a meadow opening ends the section; a `# *` inside a meadow is the meadow's, not ours", () => {
        const doc = mkDoc("fw 0 # * One\n  rt 90\n###\n* a chapter\n###")
        assert.deepEqual(foldAt(doc, 1), { from: doc.line(1).to, to: doc.line(2).to }) // stops at the ### fence
        assert.equal(foldAt(doc, 4), null)                                             // meadow headline — litFold owns it
    })
})

// The collapse this pins (2026-07-26): the editor's prose walk and the
// parser's are ONE function. Three hand-rolled state machines used to compute
// the same meadow⊗cell⊗headline shape and agreed only by luck. If these two
// ever disagree, the fence has been reopened.
describe("one prose walk — the editor and the parser see the same shape", () => {
    const CASES = [
        "###\n```\nfw 1\n```\n\n```\nfw 2\n```\n###",
        "###\n* chapter\n\n```\nfw 1\n###",                 // the clearing closes an open cell
        "###\n* chapter\n\n```\nfw 1",                      // unterminated at EOF
        "###\n```paperlang\nfw 1\n```\n###",                // an info word rides the opener
        "###\n* one\n```\na\n```\n** two\n```\nb\n```\n###", // nested phases
        "fw 1\n###\nprose\n```\nfw 2\n```\n###",            // a PROGRAM: bare code outside
    ]
    for (const src of CASES) {
        test(`agree on ${JSON.stringify(src.slice(0, 28))}…`, () => {
            const fromDoc = findProse(mkDoc(src))
            const fromLines = outline(src.split("\n"))
            assert.deepEqual(fromDoc, fromLines)
        })
    }

    test("a headline inside a cell is code, not a phase", () => {
        const { phases } = outline("###\n```\n* not a heading\n```\n* a heading\n###".split("\n"))
        assert.deepEqual(phases.map((s) => s.title), ["a heading"])
    })
})

// The scan is the shared mind (2026-07-29). `classify` names each line's place
// ONCE; outline is a fold over that naming, and the tokenizer becomes one next.
// These tests are on the NAMING, because both readers inherit what it gets wrong.
describe("classify — one name per line", () => {
    const roles = (src) => classify(splitLines(src)).map((r) => r.role)

    test("a clearing, a phase, a cell", () => {
        assert.deepEqual(
            roles("###\n* one\nprose\n```\nfw 1\n```\n###"),
            ["meadowOpen", "headline", "prose", "cellOpen", "code", "cellClose", "meadowClose"])
    })

    test("bare code outside every clearing is code, never prose", () => {
        assert.deepEqual(roles("fw 1\n* not a phase\n\n###\nprose\n###"),
            ["code", "code", "code", "meadowOpen", "prose", "meadowClose"])
    })

    test("inside a cell everything is code — a headline included", () => {
        assert.deepEqual(roles("###\n```\n* not a heading\n### not a fence either\n```\n###"),
            ["meadowOpen", "cellOpen", "code", "code", "cellClose", "meadowClose"])
    })

    test("the clearing closes an open cell, and says so", () => {
        const rows = classify(splitLines("###\n```\nfw 1\n###"))
        assert.deepEqual(rows.map((r) => r.role),
            ["meadowOpen", "cellOpen", "code", "meadowClose"])
        assert.equal(rows[3].closesCell, true, "the fence took the cell with it")
    })

    test("what runs off the end gets no closing role — the fold closes it", () => {
        assert.deepEqual(roles("###\n```\nfw 1"), ["meadowOpen", "cellOpen", "code"])
    })

    test("the word on the fence rides the opener; unnamed is null", () => {
        const [, named] = classify(splitLines("###\n```paperlang\n```\n###"))
        assert.equal(named.info, "paperlang")
        const [, bare] = classify(splitLines("###\n```\n```\n###"))
        assert.equal(bare.info, null)
    })

    test("a bare ``` opens outside a cell and closes inside one", () => {
        assert.deepEqual(roles("###\n```\na\n```\n```\nb\n```\n###"),
            ["meadowOpen", "cellOpen", "code", "cellClose",
             "cellOpen", "code", "cellClose", "meadowClose"])
    })

    test("a headline carries its depth and title, stars folded off", () => {
        const [, h] = classify(splitLines("###\n** deeper name\n###"))
        assert.deepEqual([h.depth, h.title], [2, "deeper name"])
    })

    // A tape split elsewhere (CM6 hands us its own lines) may carry a stray \r,
    // and `###\r` matches no predicate in the grammar table.
    test("a CRLF tape still has fences", () => {
        assert.deepEqual(classify("###\r\n```\r\nfw 1\r\n```\r\n###\r".split("\n")).map((r) => r.role),
            ["meadowOpen", "cellOpen", "code", "cellClose", "meadowClose"])
    })

    test("the scan is 1:1 with the tape — it never adds or drops a line", () => {
        const CORPUS = [
            "", "\n\n", "fw 1", "###", "```", "###\n```",
            "###\n```\nfw 1\n```\n\n```\nfw 2\n```\n###",
            "###\n* chapter\n\n```\nfw 1\n###",
            "###\n* one\n```\na\n```\n** two\n```\nb\n```\n###",
            "fw 1\n###\nprose\n```\nfw 2\n```\n###",
        ]
        for (const src of CORPUS) {
            const lines = splitLines(src)
            assert.equal(classify(lines).length, lines.length, JSON.stringify(src))
        }
    })
})

describe("defaultAttend — where a never-attended buffer opens", () => {
    test("a page opens at its first cell's opener, never at the fence itself", () => {
        const doc = mkDoc("###\n```\nfw 1\n```\n\n```\nfw 2\n```\n###")
        const offset = defaultAttend(doc)
        const at = doc.lineAt(offset)
        assert.equal(at.number, 2, "the first cell's opener line")
        assert.equal(offset, at.to, "at its END — never landing ON the ``` fence")
    })

    test("a program — bare code outside any fence — has no page law; null stands", () => {
        assert.equal(defaultAttend(mkDoc("fw 1\njmp 50")), null)
    })

    test("bare code beside a fenced cell is still a program, not a page", () => {
        // isPageDoc requires EVERY non-blank line inside a meadow — one bare
        // line outside disqualifies the whole doc, same gate reach.js uses.
        assert.equal(defaultAttend(mkDoc("fw 1\n###\nprose\n```\nfw 2\n```\n###")), null)
    })

    test("an empty page — no cells yet — has nothing to open on", () => {
        assert.equal(defaultAttend(mkDoc("###\nprose only\n###")), null)
    })
})
