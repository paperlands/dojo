// The seating law (weave/page.js) — pure decisions, effects out. Run with:
//   node --test test/js/weave_page_test.mjs
//
// Pins: the three shapes (plain / program / page, by document alone), the
// exclusive law across kinds, the ladder (window of two; a program's is one),
// the cursor law's third clause, ownership's lifecycle, and idempotence — a
// seat is a RUN, so a transition writing the record that already stands emits
// nothing.
//
// And the law this file exists to hold: ONE VERB. `mine` and `theirs` differ
// only in `own` and `attention`; every pin reading the same through both is a
// pin on the seamlessness of drafting.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { pageLaw } from "../../assets/js/weave/page.js"
import { parseProgram, phaseCells, cellIdentities } from "../../assets/js/turtling/parse.js"

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

// The reach speaks LINES (D021), not cell ordinals. `at(src, n)` is the test's
// own resolution of "the nth cell" to the line its fence opens on, so these
// pins keep reading as intent while driving the real, line-addressed door.
const at = (src, n) => phaseCells(parseProgram(src))[n].open

const ops = (effects) => effects.map((e) => e.op)
const seats = (effects) => effects.filter((e) => e.op === "seat")
const removes = (effects) => effects.filter((e) => e.op === "remove")
const main = (effects) => effects.find((e) => e.main)

// The surfaces, as the law now sees them. the child's core shell and his live draft
// on a friend's page are the same call — `mine`; a watched friend's push is
// `theirs`. Two scalars apart, and nothing else.
const attn = (line) => (line == null ? null : { line })
const ask = (law, addr, name, src, line) =>
    law.observe(addr, { name, doc: src, own: true, attention: attn(line) })
const mine = (...a) => ask(...a).effects
const theirs = (law, addr, name, src, line) =>
    law.observe(addr, { name, doc: parseProgram(src), own: false, attention: attn(line) })
// The sugar verbs answer in the same shape as observe; these read the channel
// each pin is about, so no pin can hand the wrong half to the wrong door.
const step = (law, addr, line) => law.attend(addr, line).effects
const revert = (law, addr) => law.restore(addr).effects
const shut = (law, addr) => law.forget(addr).effects

describe("the priority law — what a buffer's shape runs", () => {
    test("a plain buffer draws whole, nothing else", () => {
        const law = pageLaw()
        const fx = mine(law, "b1", "one", PLAIN_SRC)
        assert.deepEqual(ops(fx), ["draw"])
        assert.equal(main(fx).code, PLAIN_SRC)
    })

    test("a program: bare code draws with cells stripped; its cells rest", () => {
        const law = pageLaw()
        const ans = ask(law, "b1", "one", PROGRAM_SRC)
        const drawn = main(ans.effects)
        assert.equal(drawn.op, "draw")
        assert.match(drawn.code, /fw 1/)
        assert.ok(!drawn.code.includes("fw 2"), "a preview never runs twice")
        assert.equal(seats(ans.effects).length, 0, "previews are dormant until reached")
        // The organ's answer rides its own channel, never the canvas alphabet.
        assert.deepEqual(ans.landed, { line: null },
            "a program opens with its previews at rest")
    })

    test("a page: the kindled cell runs, the whole buffer never beside it", () => {
        // The law NAMES what it displaces — its one injected read.
        const law = pageLaw({ localKeys: () => ["sisterA", "sisterB"] })
        const ans = ask(law, "b1", "one", PAGE_SRC)
        const fx = ans.effects
        assert.ok(removes(fx).some((e) => e.key === "sisterA"), "the local group leaves, by name")
        assert.ok(removes(fx).some((e) => e.key === "sisterB"))
        assert.ok(removes(fx).some((e) => e.key === "b1"), "the whole-buffer ambient leaves")
        assert.ok(fx.every((e) => e.op !== "clearLocal"),
            "no wildcard: every word of the alphabet names its target")
        const kindled = main(fx)
        assert.equal(kindled.op, "seat")
        assert.equal(kindled.key, "b1#1")
        assert.equal(kindled.name, "one", "the first cell wears the page's name")
        // ONE attention move, carrying both faces of the register (D006).
        const focused = fx.find((e) => e.op === "focus")
        assert.equal(focused.key, "b1#1", "the key is the identity the light moves by")
        assert.equal(focused.name, "one", "the name is its display view")
        assert.ok(fx.every((e) => e.op !== "kindle"), "kindle collapsed into focus")
        assert.deepEqual(ans.landed, { line: at(PAGE_SRC, 0) })
    })

    test("a program's cells inherit its bare code as vocabulary (D019)", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PROGRAM_SRC)
        const fx = step(law, "b1", at(PROGRAM_SRC, 0))
        const [preview] = seats(fx)
        assert.match(preview.vocab, /fw 1/, "previews fork from the program's code")
        assert.equal(preview.hatch, false)
    })

    test("a program's bare code and first cell share a NAME — never a target", () => {
        const law = pageLaw()
        const opened = mine(law, "b1", "one", PROGRAM_SRC)
        const bare = main(opened)
        assert.equal(bare.addr, "b1")
        assert.equal(bare.name, "one", "the bare code wears the buffer's name")
        const fx = step(law, "b1", at(PROGRAM_SRC, 0))
        const lit = fx.find((e) => e.op === "focus")
        assert.equal(lit.name, "one", "so does cell 1 — the collision is real")
        assert.equal(lit.key, "b1#1",
            "so nothing the canvas does may key on that name: appearance moves by key")
    })

    test("a page cell's vocabulary flows down the outline (D019)", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const fx = step(law, "b1", at(PAGE_SRC, 1))
        const [cell] = seats(fx)
        assert.match(cell.vocab, /fw 10/, "the chapter inherits the page root's cells")
    })
})

describe("the exclusive law across kinds", () => {
    test("drawing a plain tab stands a local page down", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const fx = mine(law, "b2", "two", PLAIN_SRC)
        assert.ok(removes(fx).some((e) => e.key === "b1#1"), "the page's cells leave")
        assert.equal(main(fx).op, "draw")
        assert.deepEqual(law.localPages(), [])
    })

    test("entering a cell-bearing tab stands other local pages down", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const fx = mine(law, "b2", "two", PAGE_SRC)
        assert.ok(removes(fx).some((e) => e.key === "b1#1"))
        assert.deepEqual(law.localPages(), ["b2"])
    })

    test("another's page persists — it belongs to the outershell", () => {
        const law = pageLaw()
        theirs(law, "~/spirals", "spirals", PAGE_SRC)
        const fx = mine(law, "b1", "one", PLAIN_SRC)
        assert.ok(!removes(fx).some((e) => e.key.startsWith("~/spirals")),
            "a plain draw never closes a page that is not hers")
        assert.deepEqual(law.localPages(), [], "another's page is not hers to tab")
    })

    test("a revisited plain tab draws again — its figure left with the last draw", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PLAIN_SRC)
        mine(law, "b2", "two", PLAIN_SRC)             // exclusive: b1's figure leaves
        const fx = mine(law, "b1", "one", PLAIN_SRC)  // back to b1, unedited
        assert.equal(main(fx).op, "draw",
            "idempotence is about the RECORD, and b1's record left with its figure")
    })

    test("fences gone — the page stands down and the plain path takes over", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const fx = mine(law, "b1", "one", PLAIN_SRC)
        assert.ok(removes(fx).some((e) => e.key === "b1#1"))
        assert.equal(main(fx).op, "draw")
        assert.equal(law.hasPage("b1"), false)
    })
})

describe("the ladder on the canvas", () => {
    test("an unknown addr reaches nothing", () => {
        const law = pageLaw()
        assert.deepEqual(step(law, "ghost", at(PAGE_SRC, 0)), [])
    })

    test("a page reads with a warm window of two; past it, eviction", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const fx1 = step(law, "b1", at(PAGE_SRC, 1))
        assert.equal(seats(fx1)[0].key, "b1#1.1")
        assert.ok(fx1.some((e) => e.op === "focus" && e.name === "one·2"))
        assert.ok(fx1.some((e) => e.op === "degree" && e.degree === "warm" && e.key === "b1#1"),
            "the cell she left stays warm beside the kindled one — named by KEY, as focus is")
        assert.equal(removes(fx1).length, 0)
        const fx2 = step(law, "b1", at(PAGE_SRC, 2))
        assert.ok(removes(fx2).some((e) => e.key === "b1#1"),
            "past the window of two, the oldest is evicted")
    })

    test("the idempotence pin: re-reaching the kindled cell seats nothing", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        // A seat is a RUN — never re-run what already burns. Focus may still
        // reaffirm the light (a name-collision can steal it without reseating).
        const again = step(law, "b1", at(PAGE_SRC, 0))
        assert.equal(seats(again).length, 0, "no re-seat")
        assert.ok(again.every((e) => e.op === "focus"), "focus only, if anything")
        assert.ok(again.some((e) => e.op === "focus" && e.key === "b1#1"),
            "re-attend reclaims the kindled cell's light")
        step(law, "b1", at(PAGE_SRC, 1))
        const stay = step(law, "b1", at(PAGE_SRC, 1))
        assert.equal(seats(stay).length, 0)
        assert.ok(stay.some((e) => e.op === "focus" && e.key === "b1#1.1"))
    })

    test("pageKey answers the kindled cell — not always cell 1", () => {
        // World-focus and currentTabRef ask pageKey for the page's handle.
        // Answering entries[0] while the ladder sits on cell 2 dimmed the
        // figure the child was looking at and lit cell 1 again.
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        assert.equal(law.pageKey("b1"), "b1#1", "first light is cell 1")
        step(law, "b1", at(PAGE_SRC, 1))
        assert.equal(law.pageKey("b1"), "b1#1.1",
            "after a reach, the page's handle is the kindled cell")
        step(law, "b1", at(PAGE_SRC, 2))
        assert.equal(law.pageKey("b1"), "b1#1.2")
        assert.equal(law.pageKey("ghost"), null)
    })

    test("a preview holds one cell — cursor-only, capacity one", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PROGRAM_SRC)
        step(law, "b1", at(PROGRAM_SRC, 0))
        const fx = step(law, "b1", at(PROGRAM_SRC, 1))
        assert.equal(seats(fx)[0].key, "b1#2")
        assert.ok(removes(fx).some((e) => e.key === "b1#1"),
            "the previous preview leaves — a preview is cursor-only")
    })

    test("the cursor law's third clause: on bare code previews rest, a page ignores", () => {
        const law = pageLaw()
        mine(law, "p", "prog", PROGRAM_SRC)
        step(law, "p", at(PROGRAM_SRC, 0))
        const fx = step(law, "p", null)
        assert.ok(removes(fx).some((e) => e.key === "p#1"))
        assert.ok(fx.some((e) => e.op === "focus" && e.world === true),
            "the program regains the light")
        assert.deepEqual(step(law, "p", null), [], "already at rest — nothing more")

        const law2 = pageLaw()
        mine(law2, "b1", "one", PAGE_SRC)
        assert.deepEqual(step(law2, "b1", null), [], "prose keeps the last reach on a page")
    })

    test("her place survives an edit; a shorter split clamps it away", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        step(law, "b1", at(PAGE_SRC, 2))
        // A real keystroke, in a cell the child is not sitting in. The split is
        // unchanged, so his place must ride through it.
        const ans = ask(law, "b1", "one", PAGE_SRC.replace("fw 10", "fw 11"))
        const fx = ans.effects
        assert.equal(main(fx).key, "b1#1.2", "the kindled cell is where she was")
        assert.deepEqual(ans.landed, { line: at(PAGE_SRC, 2) })

        const shorter = mine(law, "b1", "one", `###\n\`\`\`\nfw 1\n\`\`\`\n###`)
        assert.ok(removes(shorter).some((e) => e.key === "b1#1.2"),
            "siblings from the longer previous split leave the canvas")
        assert.equal(main(shorter).key, "b1#1", "indexes past the split clamp away")
    })
})

describe("ownership — who owns an addr's canvas", () => {
    test("a friend's push seats passively — never hatching as hers", () => {
        const law = pageLaw()
        const { effects, merge } = theirs(law, "kai", "kai", "fw 7")
        const [s] = seats(effects)
        assert.equal(s.hatch, false)
        assert.ok(effects.some((e) => e.op === "degree" && e.key === "kai" && e.unlessFocused === true))
        assert.equal(merge, true)
    })

    test("an owned canvas is not displaced by an unowned report", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", "fw 7")
        const draft = mine(law, "kai", "kai", "fw 99")
        assert.equal(main(draft).op, "draw", "a live draft is hers, and draws as hers")
        const push = theirs(law, "kai", "kai", "fw 8")
        assert.deepEqual(push.effects, [], "the draft is not clobbered")
        assert.equal(push.merge, false)
        // Their stream recorded underneath the whole time — the revert ground.
        const back = revert(law, "kai")
        assert.match(seats(back)[0].code, /fw 8/, "revert lands on the LATEST push")
        assert.equal(seats(back)[0].hatch, false, "reverting is passive")
    })

    test("a draft with nothing recorded reverts to nothing", () => {
        const law = pageLaw()
        mine(law, "kai", "kai", "fw 1")
        assert.deepEqual(revert(law, "kai"), [])
    })

    test("forget clears the whole ledger — a re-watch starts clean", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", "fw 7")
        mine(law, "kai", "kai", "fw 99")
        const fx = shut(law, "kai")
        assert.ok(removes(fx).some((e) => e.key === "kai"))
        const { effects } = theirs(law, "kai", "kai", "fw 7")
        assert.ok(seats(effects).length, "no stale record blocks the re-watch")
    })

    test("page-ness follows the document, not the addr: their page mounts as a page", () => {
        const law = pageLaw()
        const first = theirs(law, "~/spirals", "spirals", PAGE_SRC)
        const [s] = seats(first.effects)
        assert.equal(s.key, "~/spirals#1")
        assert.equal(s.hatch, false, "another's page never hatches as hers")
        assert.ok(first.effects.some((e) => e.op === "focus" && e.name === "spirals"))
    })

    test("idempotence is the record's, over EVERY addr — not a ~/ prefix", () => {
        const law = pageLaw()
        // A library page that never changes and a peer who re-pushes the same
        // text are the same law at two speeds.
        theirs(law, "~/spirals", "spirals", PAGE_SRC)
        const again = theirs(law, "~/spirals", "spirals", PAGE_SRC)
        assert.deepEqual(again.effects, [], "the record that stands is the record it would write")
        assert.equal(again.merge, false)

        theirs(law, "kai", "kai", PAGE_SRC)
        assert.deepEqual(theirs(law, "kai", "kai", PAGE_SRC).effects, [],
            "and it holds for a peer addr, which the prefix rule never covered")

        const law2 = pageLaw()
        mine(law2, "b1", "one", PAGE_SRC)
        assert.deepEqual(mine(law2, "b1", "one", PAGE_SRC), [],
            "and for her own tab")
    })

    test("a cell-less page (pure prose) mounts passively", () => {
        const law = pageLaw()
        const { effects } = theirs(law, "~/meadow", "meadow", PROSE_SRC)
        assert.equal(seats(effects)[0].key, "~/meadow", "no cells — the passive mount is right")
        assert.equal(law.hasPage("~/meadow"), false)
    })

    // ── The seam this whole law exists to close ─────────────────────────────
    test("a draft on their PAGE is a PAGE — cells, not one whole-buffer blob", () => {
        const law = pageLaw()
        theirs(law, "~/spirals", "spirals", PAGE_SRC)
        const fx = mine(law, "~/spirals", "spirals", PAGE_SRC.replace("fw 5", "fw 7"))
        const seated = seats(fx)
        assert.ok(seated.length, "the draft seats cells")
        assert.ok(seated.every((s) => s.key.startsWith("~/spirals#")),
            "every seat is a CELL — the whole buffer never runs beside its own cells")
        assert.ok(!seated.some((s) => s.key === "~/spirals"),
            "no whole-buffer blob: this is what made a draft restart the page per keystroke")
    })

    test("a draft walks the SAME ladder her own tab walks", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", PAGE_SRC)
        mine(law, "kai", "kai", PAGE_SRC)                 // she intervenes
        const fx = step(law, "kai", at(PAGE_SRC, 1))     // her cursor moves
        assert.equal(seats(fx)[0].key, "kai#1.1", "the reached cell runs, and only it")
        assert.equal(seats(fx)[0].hatch, true, "her draft is hers — it hatches")
        assert.ok(fx.some((e) => e.op === "degree" && e.degree === "warm"),
            "the cell she left stays warm — the window of two, as on her own tab")
    })

    test("a draft keeps the green tree — untouched cells are not reborn per keystroke", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", PAGE_SRC)
        const before = seats(mine(law, "kai", "kai", PAGE_SRC))[0]
        assert.ok(before.nodes?.length, "a draft's seats carry live node slices")
        // Type in the LAST cell. The kindled first cell must ride through
        // ===-identical: its frame does not notice the keystroke.
        const after = seats(mine(law, "kai", "kai", PAGE_SRC.replace("fw 5", "fw 7")))[0]
        assert.equal(after.key, before.key)
        for (let i = 0; i < before.nodes.length; i++) {
            assert.equal(after.nodes[i], before.nodes[i],
                "the draft reuses the held tree — it no longer hands over a bare string")
        }
    })

    test("the draft ends and their page comes back AS A PAGE", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", PAGE_SRC)
        mine(law, "kai", "kai", PAGE_SRC.replace("fw 5", "fw 7"))
        const back = seats(revert(law, "kai"))
        assert.ok(back.length, "their page returns")
        assert.ok(back.every((s) => s.key.startsWith("kai#")),
            "as cells — not the one whole-buffer seat the old revert dropped it to")
        assert.ok(back.every((s) => s.hatch === false), "and passively: it is theirs again")
    })

    test("hatch follows ownership alone, across every call shape", () => {
        const law = pageLaw()
        assert.equal(seats(theirs(law, "kai", "kai", PAGE_SRC).effects)[0].hatch, false)
        assert.equal(seats(mine(law, "kai", "kai", PAGE_SRC))[0].hatch, true)
        assert.equal(seats(revert(law, "kai"))[0].hatch, false)

        const law2 = pageLaw()
        assert.equal(seats(mine(law2, "b1", "one", PAGE_SRC))[0].hatch, true)
    })

    test("a followed PROGRAM gets its vocabulary too (D019, on the peer surface)", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", PROGRAM_SRC)
        const fx = step(law, "kai", at(PROGRAM_SRC, 0))
        const [preview] = seats(fx)
        assert.match(preview.vocab, /fw 1/,
            "their bare code is their cells' vocabulary — the old friend path skipped this")
        assert.equal(preview.hatch, false, "and it is still theirs")
    })
})

describe("toggle — the page flips whole, a plain tab falls through", () => {
    test("a weave buffer toggles its PAGE on and off", () => {
        const law = pageLaw()
        const on = law.toggle("b1", "one", PAGE_SRC)
        assert.equal(on.paged, true)
        assert.equal(main(on.effects).key, "b1#1")
        const off = law.toggle("b1", "one", PAGE_SRC)
        assert.equal(off.paged, true)
        assert.ok(removes(off.effects).some((e) => e.key === "b1#1"))
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

        const first = mine(law, "b1", "one", PAGE_SRC)
        const before = seats(first)[0]
        assert.ok(before.nodes?.length, "seats carry live node slices")

        // Edit the LAST cell (fw 5 → fw 7): the kindled first cell's nodes
        // must ride through ===-identical — its content key, its memos, and
        // (Phase 3) its frame never notice the keystroke.
        const edited = PAGE_SRC.replace("fw 5", "fw 7")
        const second = mine(law, "b1", "one", edited)
        const after = seats(second)[0]
        assert.equal(after.key, before.key)
        for (let i = 0; i < before.nodes.length; i++) {
            assert.equal(after.nodes[i], before.nodes[i],
                "the sibling cell's nodes are the same objects, not re-parses")
        }
    })
})

// ── The line door (D021) ────────────────────────────────────────────────────
// The ordinal is culled from every SEAM. What remains as the frame KEY is the
// cell's NAME, or — unnamed — its place in the tree (D024). A key names a body
// for one evaluation and must be stable across edits, and a line is strictly
// worse there: any edit above a cell would move it and restart a running
// figure. These pin both halves.
describe("the reach is addressed by line, not by ordinal", () => {
    test("any line INSIDE a cell reaches it — not just its fence", () => {
        const cells = phaseCells(parseProgram(PAGE_SRC))
        const second = cells[1]
        for (let line = second.open; line <= second.end; line++) {
            const law = pageLaw()
            mine(law, "b1", "one", PAGE_SRC)
            const fx = step(law, "b1", line)
            assert.equal(seats(fx)[0]?.key, "b1#1.1",
                `line ${line} stands in the second cell`)
        }
    })

    test("a line in PROSE between cells reaches nothing — the last reach holds", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const cells = phaseCells(parseProgram(PAGE_SRC))
        const between = cells[0].end + 1          // the blank/prose after cell 1
        assert.ok(between < cells[1].open, "there is prose between the cells")
        assert.deepEqual(step(law, "b1", between), [],
            "prose keeps the light where it was — a page ignores")
    })

    test("a cell inserted ABOVE does not re-aim a standing reach", () => {
        // The ordinal's defect, pinned: with ordinals the same figure answered
        // to a different number the moment a sister appeared above it.
        const GROWN = PAGE_SRC.replace("a meadow of prose",
                                       "a meadow of prose\n\n```\nfw 0\n```")
        const before = phaseCells(parseProgram(PAGE_SRC))
        const after = phaseCells(parseProgram(GROWN))
        // "fw 5" is the last cell in both documents; its ORDINAL moved…
        const iBefore = before.findIndex((c) => c.code.trim() === "fw 5")
        const iAfter = after.findIndex((c) => c.code.trim() === "fw 5")
        assert.notEqual(iBefore, iAfter, "the ordinal shifted under insertion")
        // …and the law still lands on that same figure when addressed by the
        // line it now occupies, with its phase intact.
        const law = pageLaw()
        mine(law, "b1", "one", GROWN)
        const fx = step(law, "b1", after[iAfter].open)
        assert.equal(seats(fx)[0].code.trim(), "fw 5", "the figure she meant")
        assert.deepEqual(after[iAfter].path, before[iBefore].path,
            "and its phase is unmoved — sisters of the same chapter")
    })

    test("a line past the end reaches nothing rather than lying", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        assert.deepEqual(step(law, "b1", 9999), [])
    })

    test("the frame KEY survives a text edit — never rename a running body", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const first = main(mine(law, "b1", "one", PAGE_SRC.replace("fw 10", "fw 11"))).key
        assert.equal(first, "b1#1",
            "editing inside cell 1 keeps its key — the frame is not reborn")
    })
})

// ── THE CELL WEARS ITS NAME (D024) ──────────────────────────────────────────
// The ground D024 stands on: a page of two cells, a third inserted ABOVE,
// touching neither body. Under `#cellN` the frame that was running `rt 90` was
// re-seated with `fw 10` — two running figures body-swapped by an edit that
// touched neither. These pin the fix and its honest residue.
describe("the cell wears its name — identity, not position", () => {
    const cells = (src) => phaseCells(parseProgram(src))
    const ids = (src) => cellIdentities(cells(src)).map((i) => i.id)

    const NAMED = "###\n```spiral\nfw 10\n```\n\n```petal\nrt 90\n```\n###"
    const NAMED_ABOVE = "###\n```bud\nfw 999\n```\n\n```spiral\nfw 10\n```\n\n```petal\nrt 90\n```\n###"

    test("a named cell keeps its key when a cell opens above it", () => {
        assert.deepEqual(ids(NAMED), ["spiral", "petal"])
        assert.deepEqual(ids(NAMED_ABOVE), ["bud", "spiral", "petal"],
            "the newcomer takes its own name; neither sister is re-keyed")
    })

    test("the running figure is not body-swapped — the probe D024 was written for", () => {
        const law = pageLaw()
        const before = main(mine(law, "b1", "one", NAMED)).key
        assert.equal(before, "b1#spiral", "the kindled cell answers to the author's word")
        const fx = mine(law, "b1", "one", NAMED_ABOVE)
        assert.ok(!removes(fx).some((e) => e.key === "b1#spiral"),
            "spiral is not torn down by an edit that never touched it")
        assert.ok(!seats(fx).some((e) => e.key === "b1#spiral" && e.code.includes("999")),
            "and nothing else's code is poured into its frame")
    })

    test("an unnamed cell is bounded to its SECTION, not the buffer", () => {
        const two = "###\n* one\n```\nfw 1\n```\n** deep\n```\nfw 2\n```\n* nine\n```\nfw 9\n```\n###"
        assert.deepEqual(ids(two), ["1.1", "1.1.1", "2.1"])
        // A cell opened in chapter one. Chapter nine's key must not move.
        const opened = "###\n* one\n```\nfw 0\n```\n```\nfw 1\n```\n** deep\n```\nfw 2\n```\n* nine\n```\nfw 9\n```\n###"
        assert.equal(ids(opened).at(-1), "2.1", "chapter nine is untouched")
        assert.ok(ids(opened).includes("1.2"), "its own sister DID shift — the honest residue")
    })

    test("a headline's TITLE never enters the key — renaming rebirths nothing", () => {
        const a = "###\n* chapter one\n```\nfw 1\n```\n###"
        const b = "###\n* a different name entirely\n```\nfw 1\n```\n###"
        assert.deepEqual(ids(a), ids(b))
    })

    test("a cell above every headline is named by its place in the preamble", () => {
        assert.deepEqual(ids("###\n```\nfw 1\n```\n```\nfw 2\n```\n* later\n```\nfw 3\n```\n###"),
            ["1", "2", "1.1"])
    })

    test("the SAME word under two phases is two cells, not a collision", () => {
        const both = "###\n* T\n** S1\n```myname\nfw 1\n```\n** S2\n```myname\nfw 2\n```\n###"
        const marks = cellIdentities(cells(both))
        assert.deepEqual(marks.map((m) => m.id), ["1.1.myname", "1.2.myname"],
            "the section is what makes her word mean a different place")
        assert.deepEqual(marks.map((m) => m.collides), [false, false])
        assert.deepEqual(marks.map((m) => m.name), ["myname", "myname"],
            "and she is told her own word back, not the key")
    })

    test("the same word TWICE IN ONE phase is one place claimed twice — MARKED", () => {
        const dup = "###\n* one\n```spiral\nfw 1\n```\n```spiral\nfw 2\n```\n###"
        const marks = cellIdentities(cells(dup))
        assert.deepEqual(marks.map((m) => m.id), ["1.spiral", "1.2"],
            "the first keeps the word; the later answers to its ordinal")
        assert.deepEqual(marks.map((m) => m.collides), [false, true])
        assert.deepEqual(marks.map((m) => m.why), [null, "duplicate"])
    })

    test("a name may not be spelled as a PLACE — the silent alias, refused", () => {
        // `1.2` as a word keys the same frame as the cell that SITS at 1.2, and
        // a duplicate check watching names alone cannot see it.
        const clash = "###\n```1.2\nfw 0\n```\n* ch\n```\nfw 1\n```\n```\nfw 2\n```\n###"
        const marks = cellIdentities(cells(clash))
        assert.deepEqual(marks.map((m) => m.id), ["1", "1.1", "1.2"],
            "the word is refused, so the named cell takes its own place instead")
        assert.deepEqual(marks.map((m) => m.why), ["place", null, null])
        assert.equal(new Set(marks.map((m) => m.id)).size, 3, "and no two cells share a key")
    })

    test("rename is rebirth — a name IS the identity", () => {
        assert.deepEqual(ids("###\n```spiral\nfw 1\n```\n###"), ["spiral"])
        assert.deepEqual(ids("###\n```coil\nfw 1\n```\n###"), ["coil"])
    })

    test("an unnamed page is unchanged apart from the key spelling", () => {
        assert.deepEqual(ids(PAGE_SRC), ["1", "1.1", "1.2"],
            "no name anywhere, so every cell is named by where it sits")
    })
})
