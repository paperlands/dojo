// The outline is the ambient tree (Decision 019) — heading-scoped vocabulary,
// pinned. Run with:
//   node --test test/js/weave_sections_test.mjs
//
// A heading (`* name` in the meadow) is a named ambient; cells directly under
// it are sibling processes inside it. Vocabulary flows DOWN the outline,
// never sideways — the Jupyter refusal held by construction. The vocabulary
// is the chapter's REHEARSAL: the ancestors' code runs lazily from t=0 by the
// one executor semantics (drainNamespace — headless, waits fast-forward, no
// sibling negotiation, loud budget) and the pure-function namespace it
// registered forks to the member. sectionCells only says WHOSE code is
// vocabulary; splitCells stays its flat view.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, printAST, splitCells, sectionCells } from "../../assets/js/turtling/parse.js"
import { execute, drainNamespace } from "../../assets/js/turtling/executor.js"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"

const freshDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const rehearse = (vocab, opts = {}) => drainNamespace(parseProgram(vocab), freshDeps(), opts)

// One page, every sectioning law present: a root preamble cell, a chapter
// whose direct cells define and (refused) use, a subsection member, and a
// second chapter that starts fresh.
const PAGE = `###
Before any chapter — the page's own ground.

\`\`\`
def base do
  fw 5
end
\`\`\`

* Chapter One

\`\`\`
def petal do
  fw 10
  rt 90
end
\`\`\`

\`\`\`
petal
\`\`\`

** First figure

\`\`\`
loop 4 do
  petal
end
\`\`\`

* Chapter Two

\`\`\`
base
\`\`\`
###`

const sections = () => sectionCells(parseProgram(PAGE))

describe("the outline is the ambient tree (D019) — sectioning", () => {
    test("splitCells stays the flat view of sectionCells", () => {
        const ast = parseProgram(PAGE)
        assert.deepEqual(splitCells(ast), sectionCells(ast).map((c) => c.code))
    })

    test("a root cell has no ancestors — its vocabulary is empty", () => {
        const [root] = sections()
        assert.ok(root.code.includes("def base do"))
        assert.equal(root.vocab, null)
    })

    test("vocabulary flows down: the root's cells reach a chapter's cells", () => {
        const [, chapterDef] = sections()
        assert.ok(chapterDef.code.includes("def petal do"))
        assert.match(chapterDef.vocab, /def base do/)
    })

    test("never sideways: a sibling cell's code is not its neighbour's vocabulary", () => {
        const [, , chapterUse] = sections()
        assert.equal(chapterUse.code.trim(), "petal")
        assert.match(chapterUse.vocab, /def base do/)
        assert.ok(!chapterUse.vocab.includes("def petal"),
            "sibling cells under one heading stay sovereign — the Jupyter refusal")
    })

    test("a subsection member folds every ancestor level, in document order", () => {
        const [, , , member] = sections()
        assert.ok(member.code.includes("loop 4 do"))
        assert.match(member.vocab, /def base do/)
        assert.match(member.vocab, /def petal do/)
        assert.ok(member.vocab.indexOf("def base") < member.vocab.indexOf("def petal"),
            "shallower ancestors speak first; deeper defs shadow on collision")
    })

    test("a new chapter starts fresh: the previous chapter's cells are gone, the root's remain", () => {
        const cells = sections()
        const chapterTwo = cells[cells.length - 1]
        assert.equal(chapterTwo.code.trim(), "base")
        assert.match(chapterTwo.vocab, /def base do/)
        assert.ok(!chapterTwo.vocab.includes("def petal"),
            "sibling sections fork from the page root, never from each other")
    })

    test("a page without headings is exactly yesterday's page — every cell sovereign", () => {
        const src = `###
\`\`\`
def a do
  fw 1
end
\`\`\`
\`\`\`
fw 2
\`\`\`
###`
        for (const cell of sectionCells(parseProgram(src))) {
            assert.equal(cell.vocab, null)
        }
    })

    test("the sectioning survives the wire: JSON-thawed nodes section the same", () => {
        const ast = parseProgram(PAGE)
        const thawed = JSON.parse(JSON.stringify(ast))
        assert.deepEqual(sectionCells(thawed), sectionCells(ast))
    })
})

describe("the rehearsal (drainNamespace) — vocabulary by the one executor", () => {
    test("deeper defs shadow shallower — the fold order is the scope order", () => {
        const src = `###
\`\`\`
def mark do
  fw 1
end
\`\`\`
* Chapter
\`\`\`
def mark do
  fw 2
end
\`\`\`
** Figure
\`\`\`
mark
\`\`\`
###`
        const cells = sectionCells(parseProgram(src))
        const { functions, error } = rehearse(cells[cells.length - 1].vocab)
        assert.equal(error, null)
        assert.equal(printAST(functions.mark.body).trim(), "fw 2",
            "the chapter's word wins over the page root's inside its own sections")
    })

    test("a def born under control flow flows — the rehearsal is a real run", () => {
        const { functions, error } = rehearse(`when 1 do
  def hidden do
    fw 1
  end
end
loop 2 do
  def looped do
    fw 2
  end
end`)
        assert.equal(error, null)
        assert.ok(functions.hidden, "a satisfied condition registers its word")
        assert.ok(functions.looped, "a loop-born word registers")
    })

    test("waits fast-forward: a def after wait is vocabulary — logical time costs a drain nothing", () => {
        const { functions, error } = rehearse(`fw 5
wait 3
def late do
  fw 1
end`)
        assert.equal(error, null)
        assert.ok(functions.late)
    })

    test("fn flows through userspace — the whole pure-function namespace forks", () => {
        const { userspace, error } = rehearse(`fn seven [3+4]
def petal do
  fw seven
end`)
        assert.equal(error, null)
        assert.ok([...userspace.keys()].some((k) => k.includes("seven")),
            "the named value rides the userspace map (keyed name⊗arity)")
    })

    test("no sibling negotiation: a cross-ambient read resolves to nothing instead of suspending", () => {
        const { functions, error } = rehearse(`fw leader.x
def after do
  fw 1
end`)
        assert.equal(error, null, "the rehearsal never blocks on an absent sibling")
        assert.ok(functions.after, "words past the read still register")
    })

    test("the budget ends a runaway rehearsal loudly — no namespace, error surfaced", () => {
        const { functions, error } = rehearse(`loop 999999 do
  fw 1
end`, { maxCommands: 500 })
        assert.ok(error, "author discretion has a loud floor")
        assert.match(error.message, /Maximum command limit/)
        assert.equal(functions, null)
    })

    test("end to end: a member walks its chapter's word through the fork spec", () => {
        const src = `###
* Chapter
\`\`\`
def petal n do
  fw n
  rt 90
end
\`\`\`
** Figure
\`\`\`
petal 10
\`\`\`
###`
        for (const seam of ["live", "thawed"]) {
            let ast = parseProgram(src)
            if (seam === "thawed") ast = JSON.parse(JSON.stringify(ast))
            const cells = sectionCells(ast)
            const member = cells[cells.length - 1]
            const { functions, error } = rehearse(member.vocab)
            assert.equal(error, null)
            // The seat: functions ride the fork spec into the member's own run.
            const events = []
            const gen = execute(parseProgram(member.code), freshDeps(), { functions })
            let r
            while (!(r = gen.next()).done) events.push(r.value)
            assert.ok(events.some((e) => e.type === "path"),
                `${seam}: the member's walk drew — petal was inherited`)
            assert.equal(r.value.commandCount, 2)
        }
    })
})
