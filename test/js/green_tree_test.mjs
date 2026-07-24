// The green tree — identity across reparses (specs/compiler.org
// id:cmp-green-tree). Run with:
//   node --test test/js/green_tree_test.mjs
//
// What this pins:
//   · EQUIVALENCE — reparseProgram answers the forest the text means,
//     byte-for-byte the same structure as a fresh parseProgram, under an
//     adversarial sweep of edits (replace/delete/insert at every line of a
//     corpus that includes meadows, cells, unterminated blocks, stray ends,
//     glued ends, blanks, and comments). Reuse only decides which node
//     OBJECTS carry the answer — never what the answer is.
//   · IDENTITY — an edit to one block leaves every other top-level block's
//     nodes ===-identical (the Phase 1 alive-when; the Phase 2 memo key and
//     Phase 3 swap predicate).
//   · THE POSITION OVERLAY — a reused block below an edit keeps its object
//     and shifts its span; a block above an edit costs nothing at all.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, reparseProgram, printAST } from "../../assets/js/turtling/parse.js"

// Structure comparison that ignores object identity (JSON is the wire truth).
const frozen = (ast) => JSON.stringify(ast)

describe("equivalence — reparse always answers what a full parse would", () => {
    const corpus = [
        "fw 10\nrt 90\nfw 10",
        "def square s do\n  for 4 do\n    fw s\n    rt 90\n  end\nend\nsquare 50",
        "as sky do\n  fw 10\nend\nas sea do\n  rt 90\nend",
        "fw 10\n\n# a note\nfw 20 end draw",      // blanks, comments, glued end
        "for 3 do\nfw 10\nrt 90",                  // unterminated — containment
        "fw 10\nend\nrt 90",                       // stray end
        "###\nprose above\n###\nfw 10\n###\nprose below\n###",
        "###\nwords\n```\nfw 10\n```\nmore words\n###\nrt 90",  // a cell
        "when 'shout' do\n  fw 5\nend\nfw 1",
        // A pressed page: two meadow groups, each holding a cell.
        "###\none\n```\nfw 10\n```\n###\n###\ntwo\n```\nrt 90\n```\n###",
        // Degenerate fences: adjacent empty meadows; a cell auto-closed by
        // ###; a meadow auto-closed at EOF; stacked openers around code.
        "###\n###\n###\n###",
        "###\n```\nfw 10\n###\nrt 90",
        "fw 1\n###\nprose to the end",
        "###\n###\nfw 1\n###\nx\n###",
    ]
    const edits = (lines, i) => [
        [...lines.slice(0, i), "lt 45", ...lines.slice(i + 1)],   // replace
        [...lines.slice(0, i), ...lines.slice(i + 1)],            // delete
        [...lines.slice(0, i + 1), "bk 7", ...lines.slice(i + 1)],// insert after
        [...lines.slice(0, i), "", ...lines.slice(i)],            // blank line
        [...lines.slice(0, i), "for 2 do", "fw 3", "end", ...lines.slice(i + 1)], // paste a block
        [...lines.slice(0, i), ...lines.slice(i + 3)],            // cut a chunk
        [...lines.slice(i), ...lines.slice(0, i)],                // move (rotate)
    ]

    test("the adversarial sweep — every edit at every line of every program", () => {
        for (const program of corpus) {
            const lines = program.split("\n")
            for (let i = 0; i < lines.length; i++) {
                for (const editedLines of edits(lines, i)) {
                    const edited = editedLines.join("\n")
                    // A fresh prev tree per case: reparse may shift reused spans.
                    const prev = parseProgram(program)
                    const got = reparseProgram(edited, program, prev)
                    assert.equal(frozen(got), frozen(parseProgram(edited)),
                        `divergence editing line ${i + 1} of:\n${program}\n→\n${edited}`)
                }
            }
        }
    })

    test("appending after an unterminated block extends its containment", () => {
        const program = "for 3 do\nfw 10"
        const prev = parseProgram(program)
        const got = reparseProgram("for 3 do\nfw 10\nrt 90", program, prev)
        assert.equal(got.length, 1, "the new line rides INSIDE the error")
        assert.equal(got[0].type, "Error")
        assert.deepEqual(got[0].children.map(n => n.value), ["fw", "rt"])
    })

    test("a fence edit falls back but stays correct", () => {
        const program = "fw 10\nrt 90"
        const prev = parseProgram(program)
        const got = reparseProgram("fw 10\n###\nrt 90", program, prev)
        assert.equal(frozen(got), frozen(parseProgram("fw 10\n###\nrt 90")))
    })
})

describe("identity — untouched blocks keep their node objects", () => {
    const PAGE = "def square s do\n  fw s\nend\nsquare 10\nas sky do\n  rt 90\nend"

    test("an edit to one block leaves every other block ===-identical", () => {
        const prev = parseProgram(PAGE)
        const edited = PAGE.replace("square 10", "square 99")
        const got = reparseProgram(edited, PAGE, prev)
        assert.equal(got[0], prev[0], "the def above the edit is the same object")
        assert.notEqual(got[1], prev[1], "the edited statement is fresh")
        assert.equal(got[2], prev[2], "the ambient below the edit is the same object")
        assert.equal(got[2].children[0], prev[2].children[0], "…to its leaves")
    })

    test("an edit below a block costs the block nothing — span untouched", () => {
        const prev = parseProgram(PAGE)
        const got = reparseProgram(PAGE + "\nfw 1", PAGE, prev)
        assert.equal(got[0], prev[0])
        assert.deepEqual(got[0].span, { line: 1, endLine: 3 })
    })

    // Trivia is OVERLAY, not identity: a comment / meadow-prose edit keeps the
    // node object (its running frame never restarts) yet copies the fresh text
    // IN, so the shared tree carries the new comment/prose. Only a change to
    // MEANING mints a fresh node.
    test("a comment edit keeps the node object, refreshes its text", () => {
        const src = "fw 10 # a step\nrt 90"
        const prev = parseProgram(src)
        const got = reparseProgram("fw 10 # a BOLD step\nrt 90", src, prev)
        assert.equal(got[0], prev[0], "same object — no rerun")
        assert.equal(got[0].meta.comment, " a BOLD step", "…carrying the fresh comment for sharing")
        assert.equal(printAST(got), "fw 10 # a BOLD step\nrt 90")
    })

    test("a meadow-prose edit keeps the node object, refreshes its prose", () => {
        const src = "###\nold prose\n###\nfw 10"
        const prev = parseProgram(src)
        const got = reparseProgram("###\nnew prose\n###\nfw 10", src, prev)
        assert.equal(got[0], prev[0], "same meadow object — no rerun")
        assert.equal(got[0].meta.lit, "new prose", "…carrying the fresh prose")
    })

    test("an end-comment edit keeps the block object", () => {
        const src = "loop 3 do\n  fw 1\nend # done"
        const prev = parseProgram(src)
        const got = reparseProgram("loop 3 do\n  fw 1\nend # DONE!", src, prev)
        assert.equal(got[0], prev[0], "same loop object — no rerun")
        assert.equal(got[0].meta.endComment, " DONE!")
    })

    test("a code edit under an unchanged comment still mints a fresh node", () => {
        const src = "fw 10 # a step\nrt 90"
        const prev = parseProgram(src)
        const got = reparseProgram("fw 99 # a step\nrt 90", src, prev)
        assert.notEqual(got[0], prev[0], "meaning changed → fresh node → rerun")
        assert.equal(got[1], prev[1], "the untouched sibling holds")
    })

    test("an edit above a block shifts the reused block's span in place", () => {
        const prev = parseProgram(PAGE)
        const ambient = prev[2]
        const got = reparseProgram("fw 5\n" + PAGE, PAGE, prev)
        assert.equal(got[3], ambient, "the same object…")
        assert.deepEqual(ambient.span, { line: 6, endLine: 8 }, "…at its new lines")
        assert.deepEqual(ambient.children[0].span, { line: 7, endLine: 7 })
    })

    test("a blank-line edit inserts one Empty, keeps every block's object", () => {
        const prev = parseProgram(PAGE)
        // A bare Enter between `end` and `square 10`. The blank registers as a
        // fresh Empty node (line-number parity; the seed changes so the frame
        // reruns) — but every real block keeps its identity, adopted at its
        // shifted index.
        const got = reparseProgram("def square s do\n  fw s\nend\n\nsquare 10\nas sky do\n  rt 90\nend", PAGE, prev)
        const blocks = got.filter(n => n.type !== "Empty")
        assert.equal(blocks[0], prev[0])
        assert.equal(blocks[1], prev[1])
        assert.equal(blocks[2], prev[2])
        assert.equal(got.filter(n => n.type === "Empty").length, 1, "just the newline")
    })

    test("the pressed page reuses at the cell grain — a sibling group never reparses", () => {
        const page = "###\none\n```\nfw 10\n```\n###\n###\ntwo\n```\nrt 90\n```\n###"
        const prev = parseProgram(page)
        const edited = page.replace("fw 10", "fw 99")
        const got = reparseProgram(edited, page, prev)
        assert.equal(frozen(got), frozen(parseProgram(edited)))
        // The edited cell's group reparses whole; the second group — prose,
        // fences, and code — keeps every node object (Phase 3 stage 1's
        // felt unit: the sibling cell will never flicker).
        const kept = prev.slice(-4)   // second group's units: prose, fence, rt, fence
        assert.deepEqual(got.slice(-4), kept)
        for (let i = 0; i < 4; i++) assert.equal(got[got.length - 4 + i], kept[i])
        assert.notEqual(got[2], prev[2], "the edited cell's code is fresh")
    })

    test("early cutoff — identical text answers the identical forest", () => {
        const prev = parseProgram(PAGE)
        assert.equal(reparseProgram(PAGE, PAGE, prev), prev)
    })

    test("no prev — reparse IS the total parse", () => {
        const got = reparseProgram("fw 10", null, null)
        assert.equal(frozen(got), frozen(parseProgram("fw 10")))
    })

    test("the round-trip law survives reuse", () => {
        const prev = parseProgram(PAGE)
        const edited = "fw 5\n" + PAGE
        const got = reparseProgram(edited, PAGE, prev)
        assert.equal(printAST(got), printAST(parseProgram(edited)))
    })
})
