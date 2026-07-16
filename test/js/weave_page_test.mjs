// The page law (weave/page.js) — pure decisions, effects out. Run with:
//   node --test test/js/weave_page_test.mjs
//
// Pins: the priority law (PLAIN / PROGRAM / PAGE by document shape), the
// exclusive law across kinds (~/ library pages persist, local pages stand
// down together), the ladder on the canvas (window of two; preview window of
// one), the cursor law's third clause, the slot ledger's lifecycle (draft
// owns the slot; forget clears whole), and the idempotence pin: a seat is a
// RUN, so re-reaching the kindled cell must emit nothing — the
// consequence-purity ⊗ turtle-statefulness tension, resolved.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { pageLaw } from "../../assets/js/weave/page.js"
import { parseProgram } from "../../assets/js/turtling/parse.js"

const PAGE_SRC = `###
a meadow of prose

\`\`\`
fw 10
\`\`\`

* chapter

\`\`\`
rt 90
\`\`\`

\`\`\`
fw 5
\`\`\`
###`

const PROGRAM_SRC = `fw 1
###
previews stand beside the program

\`\`\`
fw 2
\`\`\`

\`\`\`
fw 3
\`\`\`
###`

const PLAIN_SRC = `fw 3
rt 90`

const PROSE_SRC = `###
only prose lives here — a meadow with no figure
###`

const ops = (effects) => effects.map((e) => e.op)
const seats = (effects) => effects.filter((e) => e.op === "seat")
const removes = (effects) => effects.filter((e) => e.op === "remove")
const main = (effects) => effects.find((e) => e.main)

describe("the priority law — what a buffer's shape runs", () => {
    test("a plain buffer draws whole, nothing else", () => {
        const law = pageLaw()
        const fx = law.edit("b1", "one", PLAIN_SRC)
        assert.deepEqual(ops(fx), ["draw"])
        assert.equal(main(fx).code, PLAIN_SRC)
    })

    test("a PROGRAM: bare code draws with cells stripped; previews rest", () => {
        const law = pageLaw()
        const fx = law.edit("b1", "one", PROGRAM_SRC)
        const drawn = main(fx)
        assert.equal(drawn.op, "draw")
        assert.match(drawn.code, /fw 1/)
        assert.ok(!drawn.code.includes("fw 2"), "a preview never runs twice")
        assert.equal(seats(fx).length, 0, "previews are dormant until reached")
        assert.equal(fx.find((e) => e.op === "reach").index, null,
            "a program opens with its previews at rest")
    })

    test("a PAGE: the kindled cell runs, the whole buffer never beside it", () => {
        const law = pageLaw()
        const fx = law.edit("b1", "one", PAGE_SRC)
        assert.ok(fx.some((e) => e.op === "clearLocal"), "entering a page clears the local group")
        assert.ok(removes(fx).some((e) => e.key === "b1"), "the whole-buffer ambient leaves")
        const kindled = main(fx)
        assert.equal(kindled.op, "seat")
        assert.equal(kindled.key, "b1#cell1")
        assert.equal(kindled.name, "one", "the first cell wears the page's name")
        assert.ok(fx.some((e) => e.op === "kindle" && e.key === "b1#cell1"))
        assert.equal(fx.find((e) => e.op === "reach").index, 0)
    })

    test("a preview's vocabulary is the PROGRAM (D019 under the priority law)", () => {
        const law = pageLaw()
        law.edit("b1", "one", PROGRAM_SRC)
        const fx = law.reach("b1", 0)
        const [preview] = seats(fx)
        assert.match(preview.vocab, /fw 1/, "previews fork from the program's code")
        assert.equal(preview.hatch, false)
    })

    test("a page cell's vocabulary flows down the outline (D019)", () => {
        const law = pageLaw()
        law.edit("b1", "one", PAGE_SRC)
        const fx = law.reach("b1", 1)
        const [cell] = seats(fx)
        assert.match(cell.vocab, /fw 10/, "the chapter inherits the page root's cells")
    })
})

describe("the exclusive law across kinds", () => {
    test("drawing a plain tab stands a local page down", () => {
        const law = pageLaw()
        law.edit("b1", "one", PAGE_SRC)
        const fx = law.edit("b2", "two", PLAIN_SRC)
        assert.ok(removes(fx).some((e) => e.key === "b1#cell1"), "the page's cells leave")
        assert.equal(main(fx).op, "draw")
        assert.deepEqual(law.localPages(), [])
    })

    test("entering a cell-bearing tab stands other local pages down", () => {
        const law = pageLaw()
        law.edit("b1", "one", PAGE_SRC)
        const fx = law.edit("b2", "two", PAGE_SRC)
        assert.ok(removes(fx).some((e) => e.key === "b1#cell1"))
        assert.deepEqual(law.localPages(), ["b2"])
    })

    test("library ~/ pages persist — they belong to the outershell", () => {
        const law = pageLaw()
        law.friendPush("~/spirals", "spirals", parseProgram(PAGE_SRC))
        const fx = law.edit("b1", "one", PLAIN_SRC)
        assert.ok(!removes(fx).some((e) => e.key.startsWith("~/spirals")),
            "a plain draw never closes the library's page")
        assert.deepEqual(law.localPages(), [], "~/ pages are not hers to tab")
    })

    test("fences gone — the page stands down and the plain path takes over", () => {
        const law = pageLaw()
        law.edit("b1", "one", PAGE_SRC)
        const fx = law.edit("b1", "one", PLAIN_SRC)
        assert.ok(removes(fx).some((e) => e.key === "b1#cell1"))
        assert.equal(main(fx).op, "draw")
        assert.equal(law.hasPage("b1"), false)
    })
})

describe("the ladder on the canvas", () => {
    test("an unknown addr reaches nothing", () => {
        const law = pageLaw()
        assert.deepEqual(law.reach("ghost", 0), [])
    })

    test("a page reads with a warm window of two; past it, eviction", () => {
        const law = pageLaw()
        law.edit("b1", "one", PAGE_SRC)
        const fx1 = law.reach("b1", 1)
        assert.equal(seats(fx1)[0].key, "b1#cell2")
        assert.ok(fx1.some((e) => e.op === "focus" && e.name === "one·2"))
        assert.ok(fx1.some((e) => e.op === "degree" && e.degree === "warm" && e.name === "one"),
            "the cell she left stays warm beside the kindled one")
        assert.equal(removes(fx1).length, 0)
        const fx2 = law.reach("b1", 2)
        assert.ok(removes(fx2).some((e) => e.key === "b1#cell1"),
            "past the window of two, the oldest is evicted")
    })

    test("the idempotence pin: re-reaching the kindled cell emits nothing", () => {
        const law = pageLaw()
        law.edit("b1", "one", PAGE_SRC)
        assert.deepEqual(law.reach("b1", 0), [],
            "a seat re-runs — the law never re-runs what already burns")
        law.reach("b1", 1)
        assert.deepEqual(law.reach("b1", 1), [])
    })

    test("a preview holds one cell — cursor-only, capacity one", () => {
        const law = pageLaw()
        law.edit("b1", "one", PROGRAM_SRC)
        law.reach("b1", 0)
        const fx = law.reach("b1", 1)
        assert.equal(seats(fx)[0].key, "b1#cell2")
        assert.ok(removes(fx).some((e) => e.key === "b1#cell1"),
            "the previous preview leaves — a preview is cursor-only")
    })

    test("the cursor law's third clause: on bare code previews rest, a page ignores", () => {
        const law = pageLaw()
        law.edit("p", "prog", PROGRAM_SRC)
        law.reach("p", 0)
        const fx = law.reach("p", null)
        assert.ok(removes(fx).some((e) => e.key === "p#cell1"))
        assert.ok(fx.some((e) => e.op === "focus" && e.world === true),
            "the program regains the light")
        assert.deepEqual(law.reach("p", null), [], "already at rest — nothing more")

        const law2 = pageLaw()
        law2.edit("b1", "one", PAGE_SRC)
        assert.deepEqual(law2.reach("b1", null), [], "prose keeps the last reach on a page")
    })

    test("her place survives an edit; a shorter split clamps it away", () => {
        const law = pageLaw()
        law.edit("b1", "one", PAGE_SRC)
        law.reach("b1", 2)
        const fx = law.edit("b1", "one", PAGE_SRC)
        assert.equal(main(fx).key, "b1#cell3", "the kindled cell is where she was")
        assert.equal(fx.find((e) => e.op === "reach").index, 2)

        const shorter = law.edit("b1", "one", `###\n\`\`\`\nfw 1\n\`\`\`\n###`)
        assert.ok(removes(shorter).some((e) => e.key === "b1#cell3"),
            "siblings from the longer previous split leave the canvas")
        assert.equal(main(shorter).key, "b1#cell1", "indexes past the split clamp away")
    })
})

describe("the slot ledger — who owns an addr's canvas slot", () => {
    const AST = () => parseProgram("fw 7")

    test("a friend's push seats passively — never hatching as hers", () => {
        const law = pageLaw()
        const { effects, merge } = law.friendPush("kai", "kai", AST())
        const [s] = seats(effects)
        assert.equal(s.hatch, false)
        assert.ok(effects.some((e) => e.op === "degree" && e.unlessFocused === true))
        assert.equal(merge, true)
    })

    test("a running draft owns the slot; the friend's stream records underneath", () => {
        const law = pageLaw()
        law.friendPush("kai", "kai", AST())
        const draft = law.draftSeat("kai", "kai", "fw 99")
        assert.equal(seats(draft)[0].hatch ?? true, true, "a live draft hatches")
        const push = law.friendPush("kai", "kai", parseProgram("fw 8"))
        assert.deepEqual(push.effects, [], "the draft is not clobbered")
        assert.equal(push.merge, false)
        const revert = law.draftStop("kai")
        assert.match(seats(revert)[0].code, /fw 8/, "revert lands on the LATEST recorded code")
        assert.equal(seats(revert)[0].hatch, false, "reverting is passive")
    })

    test("a draft with nothing recorded reverts to nothing", () => {
        const law = pageLaw()
        law.draftSeat("kai", "kai", "fw 1")
        assert.deepEqual(law.draftStop("kai"), [])
    })

    test("forget clears the whole ledger — a re-watch starts clean", () => {
        const law = pageLaw()
        law.friendPush("kai", "kai", AST())
        law.draftSeat("kai", "kai", "fw 99")
        const fx = law.forget("kai")
        assert.ok(removes(fx).some((e) => e.key === "kai"))
        const { effects } = law.friendPush("kai", "kai", AST())
        assert.ok(seats(effects).length, "no stale draft entry blocks the re-watch")
    })

    test("a ~/ addr IS page-ness: first cell mounts, a re-push changes nothing", () => {
        const law = pageLaw()
        const first = law.friendPush("~/spirals", "spirals", parseProgram(PAGE_SRC))
        const [s] = seats(first.effects)
        assert.equal(s.key, "~/spirals#cell1")
        assert.equal(s.hatch, false, "the library never hatches as hers")
        assert.ok(first.effects.some((e) => e.op === "focus" && e.name === "spirals"))
        const again = law.friendPush("~/spirals", "spirals", parseProgram(PAGE_SRC))
        assert.deepEqual(again.effects, [], "a view toggle — the ladder holds")
        assert.equal(again.merge, false)
    })

    test("a cell-less ~/ page (pure prose) mounts passively", () => {
        const law = pageLaw()
        const { effects } = law.friendPush("~/meadow", "meadow", parseProgram(PROSE_SRC))
        assert.equal(seats(effects)[0].key, "~/meadow", "no cells — the passive mount is right")
        assert.equal(law.hasPage("~/meadow"), false)
    })

    test("a draft on a weave page owns the whole page — siblings stand down", () => {
        const law = pageLaw()
        law.friendPush("~/spirals", "spirals", parseProgram(PAGE_SRC))
        const fx = law.draftSeat("~/spirals", "spirals", "fw 1")
        assert.ok(removes(fx).some((e) => e.key === "~/spirals#cell1"))
        assert.equal(seats(fx)[0].key, "~/spirals")
    })
})

describe("toggle — the page flips whole, a plain tab falls through", () => {
    test("a weave buffer toggles its PAGE on and off", () => {
        const law = pageLaw()
        const on = law.toggle("b1", "one", PAGE_SRC)
        assert.equal(on.paged, true)
        assert.equal(main(on.effects).key, "b1#cell1")
        const off = law.toggle("b1", "one", PAGE_SRC)
        assert.equal(off.paged, true)
        assert.ok(removes(off.effects).some((e) => e.key === "b1#cell1"))
        assert.ok(removes(off.effects).some((e) => e.key === "b1"),
            "a preview tab's program ambient goes with its cells")
        assert.equal(law.hasPage("b1"), false)
    })

    test("a plain tab is not the law's to toggle", () => {
        const law = pageLaw()
        const t = law.toggle("b1", "one", PLAIN_SRC)
        assert.equal(t.paged, false)
        assert.deepEqual(t.effects, [], "the turtle's own toggle takes it whole")
    })
})

describe("the green tree through the law — identity across edits", () => {
    test("an edit to one cell keeps the sibling cells' node objects (id:cmp-green-tree)", () => {
        const law = pageLaw()
        const seats = (effects) => effects.filter((e) => e.op === "seat")

        const first = law.edit("b1", "one", PAGE_SRC)
        const before = seats(first)[0]
        assert.ok(before.nodes?.length, "seats carry live node slices")

        // Edit the LAST cell (fw 5 → fw 7): the kindled first cell's nodes
        // must ride through ===-identical — its content key, its memos, and
        // (Phase 3) its frame never notice the keystroke.
        const edited = PAGE_SRC.replace("fw 5", "fw 7")
        const second = law.edit("b1", "one", edited)
        const after = seats(second)[0]
        assert.equal(after.key, before.key)
        for (let i = 0; i < before.nodes.length; i++) {
            assert.equal(after.nodes[i], before.nodes[i],
                "the sibling cell's nodes are the same objects, not re-parses")
        }
    })
})
