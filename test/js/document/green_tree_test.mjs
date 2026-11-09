// The green tree — identity across reparses (specs/compiler.org
// id:cmp-green-tree). Run with:
//   node --test test/js/document/green_tree_test.mjs
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

import { parseProgram, reparseProgram, printAST, reparseStats, resetReparseStats } from "../../../assets/js/turtling/parse.js"

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

    test("reservation — adoption never crosses position nor repeats an object", () => {
        for (const program of corpus) {
            const lines = program.split("\n")
            for (let i = 0; i < lines.length; i++) {
                for (const editedLines of edits(lines, i)) {
                    const edited = editedLines.join("\n")
                    const prev = parseProgram(program)
                    const seen = new Set()
                    let last = -1
                    for (const node of reparseProgram(edited, program, prev)) {
                        const at = prev.indexOf(node)
                        if (at < 0) continue
                        assert.ok(!seen.has(at), `prev[${at}] adopted twice:\n${edited}`)
                        assert.ok(at > last, `prev[${at}] adopted after prev[${last}] — crossed:\n${edited}`)
                        seen.add(at)
                        last = at
                    }
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

    test("identical twins keep their own objects — no crossing", () => {
        const src = "fw 10\nrt 90\nfw 10\nrt 90"
        const edited = "fw 11\nrt 90\nfw 10\nrt 90"
        const prev = parseProgram(src)
        const got = reparseProgram(edited, src, prev)
        assert.equal(frozen(got), frozen(parseProgram(edited)))
        assert.notEqual(got[0], prev[0], "the edited statement is fresh")
        assert.equal(got[2], prev[2], "the lower twin keeps the lower object")
        assert.notEqual(got[2], prev[0], "…never the twin above it")
        assert.deepEqual(prev[0].span, { line: 1, endLine: 1 }, "the unclaimed twin's span is not stolen")
        assert.deepEqual(prev[2].span, { line: 3, endLine: 3 })
    })

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

describe("convergence — indistinguishable, and it actually runs", () => {
    const PAGE = [
        "###", "* Chapter", "prose", "```",
        "def fig n do", "  fw n", "  rt 90", "end", "```", "###",
        "fw 10", "rt 90", "lt 45",
    ].join("\n")

    test("a mid-page keystroke converges and answers the full parse", () => {
        resetReparseStats()
        const prev = parseProgram(PAGE)
        const edited = PAGE.replace("fw 10", "fw 11")
        const got = reparseProgram(edited, PAGE, prev)
        assert.equal(reparseStats().fallback, 0, "the fast path answered")
        assert.ok(reparseStats().converged >= 1, "…and it is the fast path")
        assert.equal(frozen(got), frozen(parseProgram(edited)))
    })

    test("a removed fence declines the fast path and stays correct", () => {
        resetReparseStats()
        const prev = parseProgram(PAGE)
        const edited = PAGE.replace("```\ndef fig", "###\ndef fig")
        const got = reparseProgram(edited, PAGE, prev)
        assert.equal(reparseStats().fallback, 1, "a fence must decline: chunk edges move")
        assert.equal(frozen(got), frozen(parseProgram(edited)))
    })

    test("a typing chain never diverges and never falls back", () => {
        resetReparseStats()
        let text = PAGE
        let ast = parseProgram(PAGE)
        for (let i = 0; i < 8; i++) {
            const next = text.replace(/fw \d+/, `fw ${10 + i}`)
            ast = reparseProgram(next, text, ast)
            text = next
        }
        assert.equal(frozen(ast), frozen(parseProgram(text)))
        assert.equal(reparseStats().fallback, 0, "every keystroke converged")
    })

    // The fallback path used to return an array with no restart coordinates, so
    // ONE structural edit disarmed the fast path for the rest of the session
    // (measured: converged 1 / fallback 3 where 3/1 was expected).
    test("a structural fallback does not disarm the next keystroke", () => {
        resetReparseStats()
        let text = PAGE
        let ast = parseProgram(PAGE)

        const step = (next) => { const got = reparseProgram(next, text, ast); text = next; ast = got; return got }

        // 1. ordinary edit → the fast path answers
        step(PAGE.replace("fw 10", "fw 11"))
        // 2. structural edit (a meadow fence appears) → must fall back
        step(text.replace("###\n* Chapter", "###\n###\n* Chapter"))
        // 3. ordinary edit → MUST converge again
        step(text.replace("fw 11", "fw 12"))

        const stats = reparseStats()
        assert.equal(stats.fallback, 1, "exactly one fallback, for the structural edit")
        assert.ok(stats.converged >= 2, `the fast path came back (converged ${stats.converged})`)
        assert.equal(frozen(ast), frozen(parseProgram(text)))
    })

    // A one-character edit can create or destroy a fence while its dirty
    // substring holds no marker at all (`###` → `##` leaves `#`). The guard
    // therefore tests whole affected LINES; this pins the outcome either way.
    test("single-character fence edits never diverge", () => {
        const corpus = [
            "###\nprose\n```\nfw 1\n```\n###\nrt 90",
            "###\n* H\n```lang\nfw 1\n```\n###",
            "###\n```\nfw 1\n###\nrt 2",
            "###\n```\nfw 1\n```\n###",
        ]
        let tried = 0
        for (const program of corpus) {
            const lines = program.split("\n")
            for (let li = 0; li < lines.length; li++) {
                if (!lines[li].includes("```") && !lines[li].includes("###")) continue
                for (let ci = 0; ci < lines[li].length; ci++) {
                    for (const candidate of [lines[li].slice(0, ci) + lines[li].slice(ci + 1),
                                             lines[li].slice(0, ci) + "`" + lines[li].slice(ci)]) {
                        const next = lines.slice(); next[li] = candidate
                        const edited = next.join("\n")
                        if (edited === program) continue
                        tried++
                        const prev = parseProgram(program)
                        assert.equal(frozen(reparseProgram(edited, program, prev)), frozen(parseProgram(edited)),
                            `divergence on ${JSON.stringify(lines[li])} → ${JSON.stringify(candidate)}`)
                    }
                }
            }
        }
        assert.ok(tried > 90, `the sweep actually ran (${tried} single-character edits)`)
    })

    // CRLF and bare CR are line breaks to splitLines(); the convergence
    // coordinate arithmetic must count them the same way, or every line number
    // after the first CRLF is off by one.
    test("CRLF and bare CR documents converge on the same coordinates", () => {
        for (const eol of ["\r\n", "\r"]) {
            const page = ["###", "* Chapter", "```", "def fig n do", "  fw n", "end", "```", "###", "fw 10", "rt 90"].join(eol);
            const edited = page.replace("fw 10", "fw 11");
            const prev = parseProgram(page);
            const got = reparseProgram(edited, page, prev);
            assert.equal(frozen(got), frozen(parseProgram(edited)), `${JSON.stringify(eol)} diverged`);
        }
    })

    // A bare CR is a line break to splitLines(), so it must be one to the fence
    // guard too. Reading only LF made this converge onto a DIFFERENT forest than
    // a fresh parse (the guard never saw the fence), and made every ordinary
    // bare-CR edit fall back.
    test("bare-CR edits: the fence guard sees them, ordinary edits still converge", () => {
        resetReparseStats()
        const before = "a\r###\r###\r###\ra";
        const after = "a\r\r###\r###\ra";
        const got = reparseProgram(after, before, parseProgram(before));
        assert.equal(frozen(got), frozen(parseProgram(after)), "converged onto the wrong forest");
        assert.equal(reparseStats().fallback, 1, "a fence-bearing CR edit must fall back, not converge");

        resetReparseStats()
        const page = "###\r* H\r```\rfw 1\r```\r###\rfw 9";
        const edited = "###\r* H\r```\rfw 2\r```\r###\rfw 9";
        const g2 = reparseProgram(edited, page, parseProgram(page));
        assert.equal(frozen(g2), frozen(parseProgram(edited)));
        assert.ok(reparseStats().converged >= 1, "an ordinary CR edit must not become a blanket fallback");
    })

    test("reparsing twice from one parent is idempotent", () => {
        const prev = parseProgram(PAGE)
        const edited = "fw 5\n" + PAGE
        const a = reparseProgram(edited, PAGE, prev)
        const b = reparseProgram(edited, PAGE, prev)
        assert.equal(frozen(a), frozen(b), "the same parent answers the same forest")
        assert.equal(frozen(b), frozen(parseProgram(edited)))
    })
})
