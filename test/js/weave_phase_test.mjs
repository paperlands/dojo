// THE PHASE — attention is the address (D021). Run with:
//   node --test test/js/weave_section_test.mjs
//
// One datum names where a peer is: a LINE. From it the phase is DERIVED, never
// stored. Prose (headlines and all) rides WHOLE; only the CELLS of the phase
// the attention inhabits ride live — sibling phases keep dormant fences but
// drop their bodies. stripCells and a whole-tree reflect are the two endpoints;
// reflectPhase is the family between them.
//
// What the ordinal-addressed predecessor could not do, and these pin:
//   - name a phase that owns no cell yet (authoring's whole formative moment)
//   - survive a cell being inserted above it
//   - hand a watcher an exact coordinate rather than an inferred absence

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
    parseProgram, printAST, phaseCells, reflectPhase, stripCells, phaseAt, cellAtLine,
} from "../../assets/js/turtling/parse.js"

// A nested outline: root preamble, a phase with its OWN cell plus two
// subheading phases (A holds two sibling cells, B one), then a second phase.
const NESTED = `###
intro prose

\`\`\`
root1
\`\`\`

* chapter one

\`\`\`
c1a
\`\`\`

** phase A

\`\`\`
pa1
\`\`\`

\`\`\`
pa2
\`\`\`

** phase B

\`\`\`
pb1
\`\`\`

* chapter two

\`\`\`
c2a
\`\`\`
###`

// The LINE each figure's body sits on — the address, read off the source.
const lineOf = (src, needle) => src.split("\n").findIndex((l) => l.trim() === needle) + 1
const L = (n) => ({ line: n, col: 0, endLine: n, endCol: 0 })
const at = (src, needle) => L(lineOf(src, needle))

const shownOf = (ast, a) => printAST(reflectPhase(ast, a).commands)
const codesOf = (ast, a) => phaseCells(reflectPhase(ast, a).commands).map((c) => c.code.trim())

describe("reflectPhase — the inhabited phase's cells, all prose", () => {
    test("prose (every headline) always rides whole, whatever the phase", () => {
        const ast = parseProgram(NESTED)
        for (const body of ["root1", "c1a", "pa1", "pb1", "c2a"]) {
            const shown = shownOf(ast, at(NESTED, body))
            for (const prose of ["intro prose", "* chapter one", "** phase A", "** phase B", "* chapter two"]) {
                assert.match(shown, new RegExp(prose.replace("*", "\\*")),
                    `at ${body}: prose "${prose}" is the watcher's outline, always present`)
            }
        }
    })

    test("a deepest subheading rides its OWN sibling cells, no others", () => {
        const ast = parseProgram(NESTED)
        const codes = codesOf(ast, at(NESTED, "pa1"))
        assert.deepEqual(codes.filter(Boolean), ["pa1", "pa2"],
            "phase A's two siblings ride together; no sibling section leaks")
        assert.equal(codes.length, 6, "all six cells remain as slots — five dormant")
    })

    test("a subheading does NOT ride its parent phase's own cell", () => {
        // c1a sits directly under * phase one; ** phase A is DEEPER — a
        // different phase. Down the outline, never up.
        const shown = shownOf(parseProgram(NESTED), at(NESTED, "pa1"))
        assert.ok(!/\bc1a\b/.test(shown), "the parent phase's own figure stays dormant")
        assert.ok(!/\broot1\b/.test(shown), "the root preamble's figure stays dormant")
    })

    test("sibling phases are sovereign, and a headline's own cell is its own phase", () => {
        const ast = parseProgram(NESTED)
        assert.deepEqual(codesOf(ast, at(NESTED, "pb1")).filter(Boolean), ["pb1"])
        assert.deepEqual(codesOf(ast, at(NESTED, "c1a")).filter(Boolean), ["c1a"])
        assert.deepEqual(codesOf(ast, at(NESTED, "root1")).filter(Boolean), ["root1"])
        assert.deepEqual(codesOf(ast, at(NESTED, "c2a")).filter(Boolean), ["c2a"])
    })

    test("standing in a phase's PROSE inhabits that phase — no cell needed", () => {
        // The line of `** phase B` itself: the child is in the heading, not a figure.
        const ast = parseProgram(NESTED)
        const headLine = NESTED.split("\n").findIndex((l) => l.trim() === "** phase B") + 1
        assert.deepEqual(codesOf(ast, L(headLine)).filter(Boolean), ["pb1"],
            "the section the child stands in, whether or not his caret is in a figure")
    })
})

describe("reflectPhase — what the cell ordinal could not do", () => {
    // The formative moment: a heading and its paragraphs exist before any
    // fence. The ordinal address had no entry for a cell-less phase, so the
    // watcher was told the PREVIOUS phase for the whole of authoring.
    const FRESH = NESTED.replace("* chapter two",
        "* chapter two\n\n** the spiral\n\nwhat if it curled")

    test("a phase with ZERO cells names itself the moment she types its heading", () => {
        assert.deepEqual(phaseAt(parseProgram(FRESH), lineOf(FRESH, "what if it curled")),
            ["chapter two", "the spiral"])
    })

    test("inserting a cell above does not re-aim the phase", () => {
        // Ordinals shift under insertion; lines above the insertion do not.
        const before = phaseAt(parseProgram(NESTED), lineOf(NESTED, "pa1"))
        const GROWN = NESTED.replace("intro prose", "intro prose\n\n```\nzeroth\n```")
        assert.deepEqual(phaseAt(parseProgram(GROWN), lineOf(GROWN, "pa1")), before,
            "the same figure keeps the same section though a cell appeared above it")
    })

    test("an EMPTY cell she just opened is addressable — dormant ≢ empty", () => {
        const OPENED = NESTED.replace("** phase B", "** phase B\n\n```\n\n```")
        const ast = parseProgram(OPENED)
        // The child's caret on the blank line inside the fence just opened —
        // the exact instant the old "first cell with a body" heuristic mounted
        // somebody else's figure.
        const lines = OPENED.split("\n")
        const heading = lines.indexOf("** phase B")
        const blank = lines.findIndex((l, i) =>
            i > heading && l === "" && lines[i - 1] === "```" && lines[i + 1] === "```") + 1

        assert.deepEqual(phaseAt(ast, blank), ["chapter one", "phase B"])
        const cells = phaseCells(ast)
        const at = cellAtLine(cells, blank)
        assert.equal(cells[at].code.trim(), "", "the cell found by span is the empty one she opened")
        assert.notEqual(at, null, "an empty cell is addressable at all — the whole point")
    })
})

describe("reflectPhase — the attention's coordinates in the projection", () => {
    test("a line above every dropped body is unmoved", () => {
        const a = at(NESTED, "root1")
        assert.equal(reflectPhase(parseProgram(NESTED), a).attend.line, a.line,
            "nothing was shed above the root preamble's own figure")
    })

    test("the translated line lands on the SAME text in the projection", () => {
        // The exact claim a watcher depends on: point at attend.line in the
        // reflected document and you are looking at what the peer is looking at.
        const ast = parseProgram(NESTED)
        for (const body of ["root1", "c1a", "pa1", "pa2", "pb1", "c2a"]) {
            const a = at(NESTED, body)
            const { commands, attend } = reflectPhase(ast, a)
            const shown = printAST(commands).split("\n")
            assert.equal(shown[attend.line - 1].trim(), body,
                `attention on "${body}" translates onto "${body}" in the projection`)
        }
    })

    test("cols ride untouched; a selection's two ends translate together", () => {
        const line = lineOf(NESTED, "pa1")
        const { attend } = reflectPhase(parseProgram(NESTED),
            { line, col: 1, endLine: line, endCol: 3 })
        assert.equal(attend.col, 1)
        assert.equal(attend.endCol, 3)
        assert.equal(attend.endLine, attend.line, "a one-line selection stays one line")
    })
})

describe("reflectPhase — endpoints and round-trip", () => {
    test("null attention reflects the whole tree and points nowhere", () => {
        const ast = parseProgram(NESTED)
        const { commands, attend } = reflectPhase(ast, null)
        assert.equal(commands, ast, "a plain buffer / program at rest is untouched")
        assert.equal(attend, null)
    })

    test("a flat page (no headlines) reflects whole — backward compatible", () => {
        const flat = `###\n\`\`\`\nfw 1\n\`\`\`\n\n\`\`\`\nfw 2\n\`\`\`\n###`
        const ast = parseProgram(flat)
        assert.deepEqual(
            phaseCells(reflectPhase(ast, L(lineOf(flat, "fw 1"))).commands).map((c) => c.code.trim()),
            ["fw 1", "fw 2"], "one root section holds both cells → both ride")
        assert.deepEqual(phaseAt(ast, lineOf(flat, "fw 1")), [],
            "a root-preamble phase has no headline path")
    })

    test("stripCells is the empty-phase endpoint — every body gone, fences kept", () => {
        const ast = parseProgram(NESTED)
        const phase = reflectPhase(ast, at(NESTED, "pa1")).commands
        assert.equal(phaseCells(phase).length, phaseCells(ast).length,
            "the same number of cell SLOTS as the whole — none lost, just dormant")
        assert.equal(stripCells(ast).filter((n) => n?.meta?.cellFence).length,
            phase.filter((n) => n?.meta?.cellFence).length,
            "the fence skeleton is identical to stripCells' — meadow edges survive")
    })

    test("the dormant slice round-trips: printAST → reparse keeps the cell count", () => {
        const shown = shownOf(parseProgram(NESTED), at(NESTED, "pa1"))
        const reparsed = phaseCells(parseProgram(shown))
        assert.equal(reparsed.length, 6, "six cells survive the text round-trip (five dormant)")
        assert.deepEqual(reparsed.map((c) => c.code.trim()).filter(Boolean), ["pa1", "pa2"])
    })

    test("kept cells are the SAME node objects — identity through the partition", () => {
        const ast = parseProgram(NESTED)
        const phase = reflectPhase(ast, at(NESTED, "pa1")).commands
        for (const node of phase) assert.ok(ast.includes(node), "no node is re-parsed or cloned")
    })

    test("a line past the end inhabits the last open phase rather than lying", () => {
        const ast = parseProgram(NESTED)
        assert.deepEqual(phaseAt(ast, 9999), ["chapter two"])
        assert.deepEqual(codesOf(ast, L(9999)).filter(Boolean), ["c2a"])
    })
})

describe("phaseAt — the watcher reads the phase off the outline", () => {
    const crumb = (needle) => phaseAt(parseProgram(NESTED), lineOf(NESTED, needle))

    test("a deepest subheading reads phase › phase", () => {
        assert.deepEqual(crumb("pa1"), ["chapter one", "phase A"])
        assert.deepEqual(crumb("pb1"), ["chapter one", "phase B"], "a sibling phase re-roots at the chapter")
    })

    test("a phase's own cell reads the phase alone", () => {
        assert.deepEqual(crumb("c1a"), ["chapter one"])
        assert.deepEqual(crumb("c2a"), ["chapter two"])
    })

    test("a root-preamble phase has no headline path", () => {
        assert.deepEqual(crumb("root1"), [])
    })

    test("the crumb is read from the ORIGINAL tree or the projection alike", () => {
        // The watcher holds only the projection and the translated attention —
        // and gets the same answer, because prose rides whole either way.
        const ast = parseProgram(NESTED)
        const a = at(NESTED, "pa1")
        const { commands, attend } = reflectPhase(ast, a)
        assert.deepEqual(phaseAt(commands, attend.line), phaseAt(ast, a.line))
        assert.deepEqual(phaseAt(commands, attend.line), ["chapter one", "phase A"])
    })
})
