// The outline is the ambient tree (Decision 019) — heading-scoped vocabulary,
// pinned. Run with:
//   node --test test/js/phase/outline_test.mjs
//
// A heading (`* name` in the meadow) is a named ambient; cells directly under
// it are sibling processes inside it. Vocabulary flows DOWN the outline,
// never sideways — the Jupyter refusal held by construction. The vocabulary
// is the phase's REHEARSAL: the ancestors' code runs lazily from t=0 by the
// one executor semantics (drainNamespace — headless, waits fast-forward, no
// sibling negotiation, loud budget) and the pure-function namespace it
// registered forks to the member. phaseCells only says WHOSE code is
// vocabulary; the flat view is just `.map(c => c.code)`.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, printAST, phaseCells } from "../../../assets/js/turtling/parse.js"
import { execute, drainNamespace } from "../../../assets/js/turtling/executor.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const freshDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const rehearse = (vocab, opts = {}) => drainNamespace(parseProgram(vocab), freshDeps(), opts)

// One page, every sectioning law present: a root preamble cell, a phase
// whose direct cells define and (refused) use, a subsection member, and a
// second phase that starts fresh.
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

const sections = () => phaseCells(parseProgram(PAGE))

describe("the outline is the ambient tree (D019) — phasing", () => {
    test("a root cell has no ancestors — its vocabulary is empty", () => {
        const [root] = sections()
        assert.ok(root.code.includes("def base do"))
        assert.equal(root.vocab, null)
    })

    test("vocabulary flows down: the root's cells reach a phase's cells", () => {
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

    test("a new phase starts fresh: the previous phase's cells are gone, the root's remain", () => {
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
        for (const cell of phaseCells(parseProgram(src))) {
            assert.equal(cell.vocab, null)
        }
    })

    test("the phasing survives the wire: JSON-thawed nodes phase the same", () => {
        const ast = parseProgram(PAGE)
        const thawed = JSON.parse(JSON.stringify(ast))
        // Printed projections match across the socket; the node slices are
        // each tree's own (identity is per-tree — content is the wire truth).
        const projection = (cells) => cells.map(({ code, vocab }) => ({ code, vocab }))
        assert.deepEqual(projection(phaseCells(thawed)), projection(phaseCells(ast)))
    })

    test("the partition never severs identity: cells carry live slices of the one tree", () => {
        const ast = parseProgram(PAGE)
        const cells = phaseCells(ast)
        // Every cell node IS a node of the buffer tree — the same object,
        // not a re-parse (specs/compiler.org id:cmp-vet diagnostic 1).
        for (const cell of cells) {
            for (const node of cell.nodes) {
                assert.ok(ast.includes(node), "cell node is === a buffer tree node")
            }
        }
        // A descendant's vocabulary nodes ARE its ancestors' cell nodes —
        // the same objects the ancestor cells carry, never copies.
        const [root, chapterDef, , member] = cells
        assert.ok(member.vocabNodes.some((n) => root.nodes.includes(n)),
            "the root's nodes flow down as themselves")
        assert.ok(member.vocabNodes.some((n) => chapterDef.nodes.includes(n)),
            "the chapter's nodes flow down as themselves")
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
        const cells = phaseCells(parseProgram(src))
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

    test("the budget ends a runaway rehearsal loudly — error surfaced", () => {
        const { functions, error } = rehearse(`loop 999999 do
  fw 1
end`, { maxCommands: 500 })
        assert.ok(error, "author discretion has a loud floor")
        assert.match(error.message, /Maximum command limit/)
        assert.deepEqual(functions, {}, "nothing was defined before the floor — but the shelf still exists")
    })

    // The containment law, applied ACROSS cells. This used to discard the whole
    // namespace on any fault, so one broken line in a phase stripped its
    // vocabulary from every cell beneath it — and each descendant then died
    // with "Function square not defined" pointing at ITS OWN line, the child
    // blamed for the parent's diagnostic. That was the cascade.
    test("a broken rehearsal keeps the words it registered (D020 across cells)", () => {
        const { functions, error } = rehearse(`def square do
  fw 1
end
nosuchthing 1
def after do
  fw 2
end`)
        assert.ok(error, "the wound is not swallowed")
        assert.match(error.message, /nosuchthing/)
        assert.equal(error.span.line, 4, "span-true on the ANCESTOR's own line")
        assert.ok(functions.square, "words registered before the fault still stand")
        assert.ok(!functions.after, "the walk stopped there — containment, not resurrection")
    })

    test("end to end: a member walks its phase's word through the fork spec", () => {
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
            const cells = phaseCells(ast)
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
