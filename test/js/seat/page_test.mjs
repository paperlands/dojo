// The seating law (weave/page.js) — pure decisions, effects out. Run with:
//   node --test test/js/seat/page_test.mjs
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

import { pageLaw, nodeOf } from "../../../assets/js/weave/page.js"
import { parseProgram, phaseCells, cellIdentities } from "../../../assets/js/turtling/parse.js"

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

// THE ANSWER, READ AS ITSELF. This was a dual-read scaffold spanning three API
// generations (tagged effect ops → Cut 1 slots → Cut 2 totals) whose normaliser
// MUTATED the law's own answer objects. It kept the old shapes green, so no cut
// could ever be finished — only added to. Retired with Cut A.
//
// The one translation that stays: pins read NODE form (`b1#1`) because a node is
// the join key a reader speaks, while a canvas seat is `place:node`.
// nodeOf comes from the law — a test that re-spells the separator is a second
// grammar, and the drift it invites is exactly the one Cut D fenced.
const view = (r) => ({ ...r, key: nodeOf(r.slot), slot: r.slot, node: r.node })

/** Whole-buffer run (plain / program bare) — no cell `#` in the node. */
const isBufferRun = (r) => r?.node != null && !String(r.node).includes("#")
/** Draw-like = the whole-buffer run the child is looking at (own plain / bare). */
const isDraw = (r, a) => isBufferRun(r) && a.main != null && r.slot === a.main

const seats = (a) => a.runs.filter((r) => !isDraw(r, a)).map(view)
const draws = (a) => a.runs.filter((r) => isDraw(r, a)).map(view)
const removes = (a) => a.gone.map((key) => ({ key: nodeOf(key), slot: key }))
const main = (a) =>
    a.main == null ? undefined
        : view(a.runs.find((r) => r.slot === a.main)
            ?? { slot: a.main, node: nodeOf(a.main) })

/** lit — the light total, in node form. */
const lit = (a) => ({
    kindled: a.light.kindled != null ? nodeOf(a.light.kindled) : null,
    kindledName: a.light.name ?? null,
    warm: a.light.warm.map(nodeOf),
    // World focus: the light is on a whole BUFFER, not on any one cell — read
    // off the kindled slot itself. It used to be `kindled == null`, which made
    // the running figure unlit (light must partition the standing slots).
    world: a.light.kindled != null && !String(a.light.kindled).includes("#"),
})
const landedOf = (a) => (a.at ? { line: a.at.line } : null)
const hatchOf = (a) => a.hatch
/** Nothing seated and nothing left (idempotence pins). */
const silent = (a) => a.runs.length === 0 && a.gone.length === 0

// The surfaces, as the law now sees them. the child's core shell and his live draft
// on a friend's page are the same call — `mine`; a watched friend's push is
// `theirs`. Two scalars apart, and nothing else.
// Verbs return the FULL answer (Cut 2 totals live on it).
const attn = (line) => (line == null ? null : { line })
const ask = (law, addr, name, src, line) =>
    law.observe(addr, { name, doc: src, own: true, attention: attn(line) })
const mine = (...a) => ask(...a)
// Live draft on a friend's page — (self, outershell), never coreshell capacity-1.
const draft = (law, addr, name, src, line) =>
    law.observe(addr, { name, doc: src, own: true, place: "outershell", attention: attn(line) })
// A watched friend's push — at THEIR place, named, because `own` says who and
// place says where (Cut E).
const theirs = (law, addr, name, src, line) =>
    law.observe(addr, {
        name, doc: parseProgram(src), own: false,
        place: "outershell", attention: attn(line),
    })
// The sugar verbs answer in the same shape as observe; these read the channel
// each pin is about, so no pin can hand the wrong half to the wrong door.
const step = (law, addr, line) => law.attend(addr, line)
const revert = (law, addr) => law.restore(addr, "outershell")
const shut = (law, addr) => law.forget(addr)

describe("the priority law — what a buffer's shape runs", () => {
    test("a plain buffer draws whole, nothing else", () => {
        const law = pageLaw()
        const out = mine(law, "b1", "one", PLAIN_SRC)
        assert.equal(draws(out).length, 1, "one whole-buffer draw")
        assert.equal(seats(out).length, 0)
        assert.equal(main(out).code, PLAIN_SRC)
    })

    test("a program: bare code draws with cells stripped; its cells rest", () => {
        const law = pageLaw()
        const ans = ask(law, "b1", "one", PROGRAM_SRC)
        const drawn = main(ans)
        assert.ok(draws(ans).length > 0 && main(ans)?.key === drawn?.key, "bare code draws")
        assert.match(drawn.code, /fw 1/)
        assert.ok(!drawn.code.includes("fw 2"), "a preview never runs twice")
        assert.equal(seats(ans).length, 0, "previews are dormant until reached")
        // The organ's answer rides its own channel, never the canvas alphabet.
        assert.deepEqual(landedOf(ans), { line: null },
            "a program opens with its previews at rest")
    })

    test("a page: the kindled cell runs, the whole buffer never beside it", () => {
        // Cut 1: law holds its own orders — no localKeys injection. A prior
        // plain at another addr leaves via place capacity 1, not by name-list.
        const law = pageLaw()
        mine(law, "sisterA", "sA", PLAIN_SRC)
        const ans = ask(law, "b1", "one", PAGE_SRC)
        assert.ok(removes(ans).some((e) => e.key === "sisterA"),
            "prior coreshell plain leaves via addr capacity 1")
        assert.ok(removes(ans).some((e) => e.key === "b1"), "the whole-buffer ambient leaves")
        const kindled = main(ans)
        assert.ok(seats(ans).some((s) => s.key === kindled.key), "kindled is a seat")
        assert.equal(kindled.key, "b1#1")
        assert.equal(kindled.name, "one", "the first cell wears the page's name")
        // ONE attention move, carrying both faces of the register (D006).
        const light = lit(ans)
        assert.equal(light.kindled, "b1#1", "the key is the identity the light moves by")
        assert.equal(light.kindledName, "one", "the name is its display view")
        assert.deepEqual(landedOf(ans), { line: at(PAGE_SRC, 0) })
    })

    test("a program's cells inherit its bare code as vocabulary (D019)", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PROGRAM_SRC)
        const fx = step(law, "b1", at(PROGRAM_SRC, 0))
        const [preview] = seats(fx)
        assert.match(preview.vocab, /fw 1/, "previews fork from the program's code")
        // Per-seat hatch deleted (Cut 2); own program still speaks hatch open as total.
        assert.equal(hatchOf(fx), true, "own program seat speaks hatch open")
    })

    test("a program's bare code and first cell share a NAME — never a target", () => {
        const law = pageLaw()
        const opened = mine(law, "b1", "one", PROGRAM_SRC)
        const bare = main(opened)
        assert.equal(bare.node, "b1", "a whole-buffer run's node IS the addr")
        assert.equal(bare.name, "one", "the bare code wears the buffer's name")
        const out = step(law, "b1", at(PROGRAM_SRC, 0))
        const light = lit(out)
        assert.equal(light.kindledName, "one", "so does cell 1 — the collision is real")
        assert.equal(light.kindled, "b1#1",
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
        const out = mine(law, "b2", "two", PLAIN_SRC)
        assert.ok(removes(out).some((e) => e.key === "b1#1"), "the page's cells leave")
        assert.ok(draws(out).length > 0, "plain tab draws")
        assert.deepEqual(law.standing(), [])
    })

    test("entering a cell-bearing tab stands other local pages down", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const out = mine(law, "b2", "two", PAGE_SRC)
        assert.ok(removes(out).some((e) => e.key === "b1#1"))
        assert.deepEqual(law.standing(), ["b2"])
    })

    test("another's page persists — it belongs to the outershell", () => {
        const law = pageLaw()
        theirs(law, "~/spirals", "spirals", PAGE_SRC)
        const out = mine(law, "b1", "one", PLAIN_SRC)
        assert.ok(!removes(out).some((e) => e.key.startsWith("~/spirals")),
            "a plain draw never closes a page that is not hers")
        assert.deepEqual(law.standing(), [], "another's page is not hers to tab")
    })

    test("a revisited plain tab draws again — its figure left with the last draw", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PLAIN_SRC)
        mine(law, "b2", "two", PLAIN_SRC)             // exclusive: b1's figure leaves
        const out = mine(law, "b1", "one", PLAIN_SRC)  // back to b1, unedited
        assert.ok(draws(out).length > 0,
            "idempotence is about the RECORD, and b1's record left with its figure")
    })

    test("fences gone — the page stands down and the plain path takes over", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const out = mine(law, "b1", "one", PLAIN_SRC)
        assert.ok(removes(out).some((e) => e.key === "b1#1"))
        assert.ok(draws(out).length > 0)
        assert.equal(law.hasPage("b1"), false)
    })
})

describe("the ladder on the canvas", () => {
    test("an unknown addr reaches nothing", () => {
        const law = pageLaw()
        assert.ok(silent(step(law, "ghost", at(PAGE_SRC, 0))), "unknown addr seats nothing")
    })

    test("a page reads with a warm window of two; past it, eviction", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        const fx1 = step(law, "b1", at(PAGE_SRC, 1))
        assert.equal(seats(fx1)[0].key, "b1#1.1")
        const light1 = lit(fx1)
        assert.equal(light1.kindled, "b1#1.1")
        assert.equal(light1.kindledName, "one·2")
        assert.ok(light1.warm.includes("b1#1"),
            "the cell she left stays warm beside the kindled one — named by KEY, as focus is")
        assert.equal(removes(fx1).length, 0)
        const fx2 = step(law, "b1", at(PAGE_SRC, 2))
        assert.ok(removes(fx2).some((e) => e.key === "b1#1"),
            "past the window of two, the oldest is evicted")
    })

    test("the idempotence pin: re-reaching the kindled cell seats nothing", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        // A seat is a RUN — never re-run what already burns. Light may still
        // reaffirm (a name-collision can steal it without reseating). Read the
        // light total — after Cut 2 there is no focus op (light-ladders-cut0).
        const again = step(law, "b1", at(PAGE_SRC, 0))
        assert.equal(seats(again).length, 0, "no re-seat")
        assert.equal(removes(again).length, 0, "no eviction on re-attend")
        const lightAgain = lit(again)
        assert.equal(lightAgain.kindled, "b1#1",
            "re-attend reclaims the kindled cell's light")
        step(law, "b1", at(PAGE_SRC, 1))
        const stay = step(law, "b1", at(PAGE_SRC, 1))
        assert.equal(seats(stay).length, 0)
        assert.equal(lit(stay).kindled, "b1#1.1")
    })

    test("the page's handle is the KINDLED cell — not always cell 1", () => {
        // A page seats no frame under its addr, only its cells, so "which key
        // stands for this page" is a real question — and its answer is the light
        // total. It used to be a second door (pageKey) that answered entries[0]
        // while the ladder sat on cell 2: the figure the child was looking at
        // dimmed and cell 1 lit again. One question, one answer.
        const law = pageLaw()
        assert.equal(lit(mine(law, "b1", "one", PAGE_SRC)).kindled, "b1#1",
            "first light is cell 1")
        assert.equal(lit(step(law, "b1", at(PAGE_SRC, 1))).kindled, "b1#1.1",
            "after a reach, the page's handle is the kindled cell")
        assert.equal(lit(step(law, "b1", at(PAGE_SRC, 2))).kindled, "b1#1.2")
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
        const out = step(law, "p", null)
        assert.ok(removes(out).some((e) => e.key === "p#1"))
        assert.ok(lit(out).world === true, "the program regains the light")
        assert.equal(lit(out).kindled, "p", "and it is the bare code that is BRIGHT")
        assert.ok(silent(step(law, "p", null)), "already at rest — nothing more")

        const law2 = pageLaw()
        mine(law2, "b1", "one", PAGE_SRC)
        assert.ok(silent(step(law2, "b1", null)), "prose keeps the last reach on a page")
    })

    test("her place survives an edit; a shorter split clamps it away", () => {
        const law = pageLaw()
        mine(law, "b1", "one", PAGE_SRC)
        step(law, "b1", at(PAGE_SRC, 2))
        // A real keystroke, in a cell the child is not sitting in. The split is
        // unchanged, so his place must ride through it.
        const ans = ask(law, "b1", "one", PAGE_SRC.replace("fw 10", "fw 11"))
        assert.equal(main(ans).key, "b1#1.2", "the kindled cell is where she was")
        assert.deepEqual(landedOf(ans), { line: at(PAGE_SRC, 2) })

        const shorter = mine(law, "b1", "one", `###\n\`\`\`\nfw 1\n\`\`\`\n###`)
        assert.ok(removes(shorter).some((e) => e.key === "b1#1.2"),
            "siblings from the longer previous split leave the canvas")
        assert.equal(main(shorter).key, "b1#1", "indexes past the split clamp away")
    })
})

describe("ownership — who owns an addr's canvas", () => {
    test("a friend's push seats passively — never hatching as hers", () => {
        const law = pageLaw()
        const ans = theirs(law, "kai", "kai", "fw 7")
        const [s] = seats(ans)
        assert.equal(hatchOf(ans), false)
        assert.equal(s.key, "kai")
        // degree/unlessFocused deleted (Cut 2) — light total names the passive seat.
        assert.ok(
            lit(ans).kindled === "kai" || (lit(ans).warm ?? []).includes("kai"),
            "friend's seat is spoken on the light total",
        )
        assert.equal(ans.merge, true)
    })

    test("co-residency: draft at outershell keeps coreshell sister", () => {
        // Live draft seats (self, outershell) — coreshell capacity-1 must not
        // see the draft or the sister figure is gone (play-gauge finding).
        const law = pageLaw()
        mine(law, "mine", "me", "fw 1")
        theirs(law, "kai", "kai", "fw 7")
        const d = draft(law, "kai", "kai", "fw 99")
        assert.ok(draws(d).length + seats(d).length > 0, "draft seats on outershell")
        assert.ok(law.orderOf("coreshell").includes("mine"), "coreshell sister stands")
        assert.ok(law.orderOf("outershell").includes("kai"), "her draft on outer")
        assert.ok(law.orderOf("outershell", "peer").includes("kai"),
            "and their record on its OWN ladder — a shared one made her draft evict it")
        assert.deepEqual(d.gone, [], "no cross-place eviction")

        // THE BUG THIS PIN USED TO ASSERT. It read "peer push re-seats outer",
        // which is the friend's code replacing the child's live draft at the very
        // same slot. Their push is HELD now; the slot is not theirs to paint.
        const push = theirs(law, "kai", "kai", "fw 8")
        assert.deepEqual(push.runs, [], "their push repaints nothing under her draft")
        assert.deepEqual(push.gone, [], "and takes nothing away")
        assert.equal(hatchOf(push), false, "nor does it open her gate")

        const back = revert(law, "kai")
        assert.deepEqual(removes(back), [], "the seat changes hands, it is not emptied")
        assert.ok(seats(back).length + draws(back).length > 0,
            "their held body — fw 8, the push she never saw — seats on the way out")
        assert.equal(hatchOf(back), false, "leave-draft closes the gate")
    })

    test("a draft with no peer reverts by dropping outershell draft", () => {
        const law = pageLaw()
        draft(law, "kai", "kai", "fw 1")
        const back = revert(law, "kai")
        assert.ok(removes(back).length, "outershell draft leaves")
        assert.ok(
            !law.orderOf("coreshell").includes("kai") &&
                !law.orderOf("outershell").includes("kai"),
            "nothing left standing",
        )
        assert.equal(hatchOf(back), false)
    })

    test("forget clears the whole ledger — a re-watch starts clean", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", "fw 7")
        mine(law, "kai", "kai", "fw 99")
        const gone = shut(law, "kai")
        assert.ok(removes(gone).some((e) => e.key === "kai"))
        const again = theirs(law, "kai", "kai", "fw 7")
        assert.ok(seats(again).length, "no stale record blocks the re-watch")
    })

    test("page-ness follows the document, not the addr: their page mounts as a page", () => {
        const law = pageLaw()
        const first = theirs(law, "~/spirals", "spirals", PAGE_SRC)
        const [s] = seats(first)
        assert.equal(s.key, "~/spirals#1")
        assert.equal(hatchOf(first), false, "another's page never hatches as hers")
        const light = lit(first)
        assert.equal(light.kindled, "~/spirals#1")
        assert.equal(light.kindledName, "spirals")
    })

    test("idempotence is the record's, over EVERY addr — not a ~/ prefix", () => {
        const law = pageLaw()
        // A library page that never changes and a peer who re-pushes the same
        // text are the same law at two speeds.
        theirs(law, "~/spirals", "spirals", PAGE_SRC)
        const again = theirs(law, "~/spirals", "spirals", PAGE_SRC)
        assert.ok(silent(again), "the record that stands is the record it would write")
        assert.equal(again.merge, false)

        theirs(law, "kai", "kai", PAGE_SRC)
        assert.ok(silent(theirs(law, "kai", "kai", PAGE_SRC)),
            "and it holds for a peer addr, which the prefix rule never covered")

        const law2 = pageLaw()
        mine(law2, "b1", "one", PAGE_SRC)
        assert.ok(silent(mine(law2, "b1", "one", PAGE_SRC)),
            "and for her own tab")
    })

    test("a cell-less page (pure prose) mounts passively", () => {
        const law = pageLaw()
        const ans = theirs(law, "~/meadow", "meadow", PROSE_SRC)
        assert.equal(seats(ans)[0].key, "~/meadow", "no cells — the passive mount is right")
        assert.equal(law.hasPage("~/meadow"), false)
    })

    // ── The seam this whole law exists to close ─────────────────────────────
    test("a draft on their PAGE is a PAGE — cells, not one whole-buffer blob", () => {
        const law = pageLaw()
        theirs(law, "~/spirals", "spirals", PAGE_SRC)
        const fx = draft(law, "~/spirals", "spirals", PAGE_SRC.replace("fw 5", "fw 7"))
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
        draft(law, "kai", "kai", PAGE_SRC)                // she intervenes
        const out = step(law, "kai", at(PAGE_SRC, 1))     // her cursor moves
        assert.equal(seats(out)[0].key, "kai#1.1", "the reached cell runs, and only it")
        assert.equal(hatchOf(out), true, "her draft is hers — it hatches")
        assert.ok(lit(out).warm.length > 0,
            "the cell she left stays warm — the window of two, as on her own tab")
    })

    test("a draft keeps the green tree — untouched cells are not reborn per keystroke", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", PAGE_SRC)
        const before = seats(draft(law, "kai", "kai", PAGE_SRC))[0]
        assert.ok(before.nodes?.length, "a draft's seats carry live node slices")
        // Type in the LAST cell. The kindled first cell must ride through
        // ===-identical: its frame does not notice the keystroke.
        const after = seats(draft(law, "kai", "kai", PAGE_SRC.replace("fw 5", "fw 7")))[0]
        assert.equal(after.key, before.key)
        for (let i = 0; i < before.nodes.length; i++) {
            assert.equal(after.nodes[i], before.nodes[i],
                "the draft reuses the held tree — it no longer hands over a bare string")
        }
    })

    test("the draft ends — the seat CHANGES HANDS, it is not emptied", () => {
        // A draft used to overwrite the friend's record at their place: one key
        // for two witnesses. Now both are held and the seat is handed back, so
        // the surface no longer has to re-seat the peer to un-blank the canvas.
        const law = pageLaw()
        theirs(law, "kai", "kai", PAGE_SRC)
        draft(law, "kai", "kai", PAGE_SRC.replace("fw 5", "fw 7"))
        assert.ok(law.tree("kai", "outershell", "self"), "the draft is held as hers")
        assert.ok(law.tree("kai", "outershell", "peer"), "and theirs was never replaced")

        const backAns = revert(law, "kai")
        assert.deepEqual(removes(backAns), [], "nothing leaves the canvas")
        assert.ok(seats(backAns).length, "their body seats in the same answer")
        assert.equal(hatchOf(backAns), false, "leave-draft is passive")
        assert.equal(law.tree("kai", "outershell", "self"), null, "her draft is gone")
        assert.ok(law.tree("kai", "outershell", "peer"), "their page stands, unasked")
        assert.ok(law.slotsAt("outershell").every((s) => s.startsWith("outershell:kai#")),
            "as cells — outershell holds the page record")
    })

    test("hatch follows ownership alone, across every call shape", () => {
        const law = pageLaw()
        assert.equal(hatchOf(theirs(law, "kai", "kai", PAGE_SRC)), false)
        assert.equal(hatchOf(draft(law, "kai", "kai", PAGE_SRC)), true)
        assert.equal(hatchOf(revert(law, "kai")), false)

        const law2 = pageLaw()
        assert.equal(hatchOf(mine(law2, "b1", "one", PAGE_SRC)), true)
    })

    test("a followed PROGRAM gets its vocabulary too (D019, on the peer surface)", () => {
        const law = pageLaw()
        theirs(law, "kai", "kai", PROGRAM_SRC)
        const fx = step(law, "kai", at(PROGRAM_SRC, 0))
        const [preview] = seats(fx)
        assert.match(preview.vocab, /fw 1/,
            "their bare code is their cells' vocabulary — the old friend path skipped this")
        assert.equal(hatchOf(fx), false, "and it is still theirs")
    })
})

describe("toggle — the page flips whole, a plain tab falls through", () => {
    test("a weave buffer toggles its PAGE on and off", () => {
        const law = pageLaw()
        const on = law.toggle("b1", "one", PAGE_SRC)
        assert.equal(law.hasPage("b1"), true, "on = the page stands")
        assert.equal(main(on).key, "b1#1")
        assert.ok(removes(on).some((e) => e.key === "b1"),
            "a whole-buffer ambient never burns beside its own cells")
        const off = law.toggle("b1", "one", PAGE_SRC)
        assert.ok(removes(off).some((e) => e.key === "b1#1"), "off = its cells leave")
        assert.ok(!removes(off).includes("b1"),
            "and NOT the buffer slot — a page never seated one, so `gone` stays a set")
        assert.equal(law.hasPage("b1"), false)
    })

    test("a plain tab pins on the coreshell order (Cut 1 — was turtle.toggleAmbient)", () => {
        const law = pageLaw()
        const on = law.toggle("b1", "one", PLAIN_SRC)
        assert.equal(law.hasPage("b1"), false, "a plain tab is not a page")
        assert.ok(draws(on).length > 0 || seats(on).length > 0 || main(on),
            "plain toggle seats via the law — pin property, not a second machine")
        const off = law.toggle("b1", "one", PLAIN_SRC)
        assert.ok(removes(off).some((e) => e.key === "b1"),
            "second toggle unpins and removes")
    })
})

describe("the green tree through the law — identity across edits", () => {
    test("an edit to one cell keeps the sibling cells' node objects (id:cmp-green-tree)", () => {
        const law = pageLaw()

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
        assert.ok(silent(step(law, "b1", between)),
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
        assert.ok(silent(step(law, "b1", 9999)))
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
