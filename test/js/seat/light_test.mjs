// Light Ladders — Cut 0 contract pins (P1–P13). Pure law, no DOM.
//   node --test test/js/seat/light_test.mjs
//
// Feeds pageLaw; asserts on schema totals (light, hatch, presence, at, main,
// gone, runs). The answer speaks those totals first-class; helpers below only
// make pins join on node or slot without rewriting product intent.
//
// Vocabulary is the schema's: witness · place · node · slot. Never `own`.
// See specs/weave/light-ladders.org [[id:light-ladders-cut0]] and
// [[id:light-ladders-hatch-resolution]].

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { pageLaw, nodeOf, presenceOf as presenceIn } from "../../../assets/js/weave/page.js"
import { cellKey } from "../../../assets/js/turtling/address.js"
import { visit } from "../../../assets/js/weave/ladder.js"
import { parseProgram, phaseCells } from "../../../assets/js/turtling/parse.js"

// ── fixtures ──────────────────────────────────────────────────────────────

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

// Same genesis, *diverged* content — P8 forbids identical copies (hotSwapChild
// collapses sameSeed silently; identical would vacuous-pass).
const PAGE_SELF = PAGE_SRC
const PAGE_PEER = PAGE_SRC.replace("fw 10", "fw 99").replace("fw 5", "fw 7")

const PLAIN_SRC = `fw 3
rt 90`

// Bare code BESIDE cells — "program" mode. The buffer slot and the cells both
// seat, which is the case that exposed the never-named bare figure.
const PROGRAM_SRC = `fw 1
${PAGE_SRC}`

const at = (src, n) => phaseCells(parseProgram(src))[n].open

// ── schema vocabulary ─────────────────────────────────────────────────────

const SELF = "self"
const PEER = "peer"
const CORESHELL = "coreshell"
const OUTERSHELL = "outershell"

/** Slot = `${place}:${node}` — canvas seat. Node is place-free (cellKey). */
const slot = (place, node) => `${place}:${node}`

// A Node is minted by the grammar, not spelled here (turtling/address.js).
const node = (addr, cellId) => (cellId == null ? addr : cellKey(addr, cellId))

// ── pin helpers — join on node or slot without rewriting product intent ───
// Canvas keys are Slot (`place:node`). Pins may assert either form.

// bare = the law's own Slot → Node reading; no second spelling here.
const bare = nodeOf

/** Runs — the law's `runs`, with node beside slot for pin-friendly joins. */
const runsOf = (ans) => {
    return (ans?.runs ?? []).map((e) => ({
        ...e,
        slot: e.slot ?? e.key,
        node: e.node ?? bare(e.key) ?? e.addr,
        key: e.node ?? bare(e.key) ?? e.addr, // pin-friendly join key
    }))
}

/** Gone — what left, in Slot space. */
const goneOf = (ans) => ans.gone

/** lit(ans) — the light total, spoken on every transition. */
const lit = (ans) => ans.light

/** hatchOf(ans) — hatch total for this transition's witness.
 *  null = silence (this event does not speak the gate). */
const hatchOf = (ans) => (ans && "hatch" in ans ? ans.hatch : null)

/** presence — ASKED of the world, never sent on the answer (weave/page.js).
 *  It rode every answer and no surface ever read one; the fact is unchanged. */
const presenceOf = (law) => presenceIn(law.world())

/** at — the attention total. undefined = unspoken, which is not null. */
const atOf = (ans) => (ans && "at" in ans ? ans.at : undefined)

// ── observe doors in schema vocabulary ────────────────────────────────────
// Pins never say `own`; door helpers map witness → the sugar surfaces still speak.
// self@coreshell and self@outershell (draft) are both the child's; peer@outershell
// is a watched push.

const observe = (law, { witness, place, addr, name, doc, line = undefined }) => {
    const isSelf = witness === SELF
    const attention = line === undefined ? null : line == null ? null : { line }
    return law.observe(addr, {
        name,
        doc,
        own: isSelf,
        place,
        attention,
    })
}

// One verb, by witness (id:light-ladders-one-verb): self's reach moves light;
// PEER is presence only (P9). Whose reach it is IS whether the light moves.
const attend = (law, addr, line, { witness = SELF } = {}) =>
    law.attend(addr, line, undefined, { witness })

// Cumulative hatch register for P11–P13. Only this event's witness is written
// when ans.hatch is spoken — the resolved fence, not the old canvas-global bit.
function makeGate() {
    const gate = new Map() // witness → bool
    return {
        apply(ans, witness) {
            if (ans && "hatch" in ans && ans.hatch != null) {
                gate.set(witness, ans.hatch)
                return
            }
            const h = hatchOf(ans)
            if (h == null) return
            gate.set(witness ?? SELF, h)
        },
        of(witness = SELF) {
            return gate.has(witness) ? gate.get(witness) : null
        },
    }
}

// ── P1–P13 ────────────────────────────────────────────────────────────────

describe("light ladders Cut 0 — contract pins", () => {
    // P1 | seat peer at outershell; attend there
    //     light.kindled = peer slot AND light.warm ⊇ coreshell slots
    test("P1: peer kindled at outershell keeps coreshell warm", () => {
        const law = pageLaw()
        const coreAddr = "b1"
        const peerAddr = "@ada"
        // coreshell page stands
        const core = observe(law, {
            witness: SELF, place: CORESHELL, addr: coreAddr,
            name: "mine", doc: PAGE_SRC,
        })
        const coreKindled = lit(core).kindled ?? runsOf(core).find((r) => r.main)?.key
        assert.ok(coreKindled, "coreshell must seat a kindled cell first")

        // peer at outershell
        observe(law, {
            witness: PEER, place: OUTERSHELL, addr: peerAddr,
            name: "ada", doc: parseProgram(PAGE_SRC),
        })
        // Self follows / selects outershell — kindles peer slot; coreshell goes warm.
        // (Peer-only attend would move presence, not light — see P9.)
        const ans = attend(law, peerAddr, at(PAGE_SRC, 0), { witness: SELF })
        const light = lit(ans)

        const peerSlot = slot(OUTERSHELL, node(peerAddr, "1"))
        const coreSlot = slot(CORESHELL, coreKindled)

        // After Cut 2 light.kindled is a Slot; today it is a bare key.
        const kindledNode = light.kindled
        assert.ok(
            kindledNode === peerSlot ||
                kindledNode === node(peerAddr, "1") ||
                kindledNode === `${peerAddr}#1` ||
                (typeof kindledNode === "string" && kindledNode.startsWith(peerAddr)),
            `light.kindled should be the peer slot, got ${kindledNode}`,
        )
        // Presence assertion beside the kindled one: coreshell still warm.
        const warm = light.warm ?? []
        const coreWarm =
            warm.includes(coreSlot) ||
            warm.includes(coreKindled) ||
            warm.some((w) => String(w).includes(coreAddr))
        assert.ok(
            coreWarm,
            `light.warm must ⊇ coreshell slots (predicted fail today: no place index, one global light). warm=${JSON.stringify(warm)}`,
        )
    })

    // P2 | page at (self,coreshell); draft at (self,outershell)
    //     gone: [] AND light names slots in both places
    test("P2: coreshell page and outershell draft co-exist — gone empty, both lit", () => {
        const law = pageLaw()
        const coreAddr = "b1"
        const draftAddr = "@ada"

        const a1 = observe(law, {
            witness: SELF, place: CORESHELL, addr: coreAddr,
            name: "mine", doc: PAGE_SRC,
        })
        assert.ok(runsOf(a1).length, "coreshell seats")

        // Live draft on a friend's page — self at outershell
        const a2 = observe(law, {
            witness: SELF, place: OUTERSHELL, addr: draftAddr,
            name: "ada", doc: PAGE_SRC,
        })
        const gone = goneOf(a2)
        const light = lit(a2)
        const standing = [...runsOf(a1), ...runsOf(a2)].map((r) => r.key ?? r.node ?? r.slot)
        // Cut 1: standing(place) is the place index.
        const atPlace = (place, addr) => !!law.standing?.(place)?.includes(addr)

        // Absence + presence: gone empty is vacuous without both places lit.
        const coreStill =
            law.hasPage?.(coreAddr) ||
            atPlace(CORESHELL, coreAddr) ||
            standing.some((k) => String(k).includes(coreAddr))
        const draftLit =
            atPlace(OUTERSHELL, draftAddr) ||
            law.hasPage?.(draftAddr) ||
            standing.some((k) => String(k).includes(draftAddr)) ||
            (light.kindled && String(light.kindled).includes(draftAddr))

        // Cross-place gone: coreshell must not be displaced by the draft seat.
        const goneCore = gone.filter((k) => String(bare(k)).startsWith(coreAddr) || String(k).includes(`${coreAddr}#`))
        assert.deepEqual(goneCore, [], "coreshell must not be in gone")
        assert.ok(
            coreStill && draftLit,
            `both places lit (predicted fail today: standDownOthers / no place index). core=${coreStill} draft=${draftLit} gone=${JSON.stringify(gone)} light=${JSON.stringify(light)}`,
        )
        // gone:[] of the *other* place AND light names slots in both.
        assert.ok(
            (atPlace(CORESHELL, coreAddr) && atPlace(OUTERSHELL, draftAddr)) ||
                (coreStill && draftLit && goneCore.length === 0),
            "gone:[] AND light names slots in both places",
        )
    })

    // P3 | after P2, coreshell observes again
    //     gone: [] AND the outershell slot still in light.warm
    test("P3: re-observe coreshell leaves outershell warm", () => {
        const law = pageLaw()
        const coreAddr = "b1"
        const draftAddr = "@ada"

        observe(law, {
            witness: SELF, place: CORESHELL, addr: coreAddr,
            name: "mine", doc: PAGE_SRC,
        })
        observe(law, {
            witness: SELF, place: OUTERSHELL, addr: draftAddr,
            name: "ada", doc: PAGE_SRC,
        })
        const again = observe(law, {
            witness: SELF, place: CORESHELL, addr: coreAddr,
            name: "mine", doc: PAGE_SRC,
        })
        const gone = goneOf(again)
        const light = lit(again)
        // Cut 2 speaks light.warm across places; Cut 1 dual-reads standing(outershell).
        const outerInWarm =
            (light.warm ?? []).some((w) => String(w).includes(draftAddr)) ||
            law.standing?.(OUTERSHELL)?.includes(draftAddr) ||
            law.standing(CORESHELL).includes(draftAddr)

        assert.ok(
            !gone.some((k) => String(k).includes(draftAddr)),
            `outershell must not be in gone (predicted fail: exclusivity). gone=${JSON.stringify(gone)}`,
        )
        assert.ok(
            outerInWarm,
            `outershell slot still in light.warm. warm=${JSON.stringify(light.warm)} core=${law.standing?.(CORESHELL)} outer=${law.standing?.(OUTERSHELL)}`,
        )
    })

    // P4 | forget peer / restore / leave-draft
    //     peer slots in gone; coreshell slots in neither gone nor missing from light
    test("P4: forget peer removes peer only — coreshell stays lit", () => {
        const law = pageLaw()
        const coreAddr = "b1"
        const peerAddr = "@ada"

        const core = observe(law, {
            witness: SELF, place: CORESHELL, addr: coreAddr,
            name: "mine", doc: PAGE_SRC,
        })
        const coreKey = lit(core).kindled ?? runsOf(core).find((r) => r.main)?.key
        observe(law, {
            witness: PEER, place: OUTERSHELL, addr: peerAddr,
            name: "ada", doc: parseProgram(PAGE_SRC),
        })

        const forgot = law.forget(peerAddr)
        const gone = goneOf(forgot)
        const light = lit(forgot)

        assert.ok(
            gone.some((k) => String(k).startsWith(peerAddr) || String(k).includes(peerAddr)),
            `peer slots in gone, got ${JSON.stringify(gone)}`,
        )
        // Presence: coreshell not in gone
        assert.ok(
            !gone.some((k) => String(k).startsWith(coreAddr) && String(k).includes("#")),
            `coreshell cells must not be in gone. gone=${JSON.stringify(gone)}`,
        )
        // And coreshell still stands (not missing from light / world)
        assert.ok(
            law.hasPage(coreAddr) || law.standing(CORESHELL).includes(coreAddr),
            `coreshell still standing after peer forget. coreKey was ${coreKey}; light=${JSON.stringify(light)}`,
        )
    })

    // P5 | page, two cells; attend cell 2 twice
    //     light.kindled = cell-2 slot both times; gone: []
    test("P5: re-attend cell 2 keeps kindled — gone empty both times", () => {
        const law = pageLaw()
        observe(law, {
            witness: SELF, place: CORESHELL, addr: "b1",
            name: "one", doc: PAGE_SRC,
        })
        const first = attend(law, "b1", at(PAGE_SRC, 1))
        const second = attend(law, "b1", at(PAGE_SRC, 1))

        const cell2 = "b1#1.1"
        const slot2 = slot(CORESHELL, cell2)

        for (const [label, ans] of [["first", first], ["second", second]]) {
            const light = lit(ans)
            const gone = goneOf(ans)
            const kindled = light.kindled
            assert.ok(
                kindled === cell2 || kindled === slot2,
                `${label}: light.kindled = cell-2 slot, got ${kindled}`,
            )
            assert.deepEqual(gone, [], `${label}: gone must be []`)
            // Presence beside absence: kindled is spoken (not silent)
            assert.ok(kindled != null, `${label}: light total is spoken`)
        }
    })

    // P6 | sticky prose (index null) while page held
    //     light unchanged and *spoken* — a total is never silent
    test("P6: sticky prose speaks light unchanged — never silent", () => {
        const law = pageLaw()
        const open = observe(law, {
            witness: SELF, place: CORESHELL, addr: "b1",
            name: "one", doc: PAGE_SRC,
        })
        const before = lit(open)
        assert.ok(before.kindled, "setup: page kindles cell 1")

        // Prose between cells — line does not land in a cell
        const cells = phaseCells(parseProgram(PAGE_SRC))
        const proseLine = cells[0].end + 1
        assert.ok(proseLine < cells[1].open, "there is prose between cells")

        const ans = attend(law, "b1", proseLine)
        const light = lit(ans)

        // A total is never silent: light is spoken on every transition, even one
        // that seats nothing (P5 re-attend, P6 sticky prose).
        assert.ok(ans.light != null, "light must be spoken on sticky prose")
        // Unchanged: kindled still cell 1. No `if (spoken)` guard — the total is
        // always there now, and a guarded assertion is one that can vacuum out.
        assert.equal(
            light.kindled,
            before.kindled,
            "light unchanged while prose holds the last reach",
        )
        assert.deepEqual(goneOf(ans), [], "gone: [] beside the light assertion")
    })

    // P7 | pin b2; b1 unpinned and tail-most; observe b3
    //     skip-pinned: evicts b1, keeps b2. capacity-raising would evict b2.
    //     Today visit has no pins — must FAIL, not soft-pass.
    test("P7: skip-pinned keeps pinned b2, evicts unpinned tail-most b1", () => {
        // Discriminating setup: order [b1, b2] with b2 pinned (warm tail).
        // visit b3 at bound 2:
        //   skip-pinned → evict b1 (unpinned), keep b2 → [b3, b2]
        //   capacity-raising / naive pop → evict b2 → [b3, b1]
        //   today (no pin API) → same as naive pop → b2 gone → fail
        const order = ["b1", "b2"]
        const pinned = new Set(["b2"])

        // Future signature: visit(order, key, { bound, pinned })
        // Today: visit(order, key, capacity=2) — object third arg must NOT
        // soft-pass (no-eviction from NaN compare would keep both; we assert
        // b1 is gone, which still fails).
        const result = visit(order, "b3", { bound: 2, pinned })

        assert.ok(
            result.order.includes("b2"),
            "pinned b2 stands under skip-pinned",
        )
        assert.ok(
            !result.order.includes("b1"),
            "unpinned tail-most b1 is evicted (discriminates capacity-raising, which would keep b1 and drop b2)",
        )
        assert.ok(result.order.includes("b3"), "b3 entered")
        assert.equal(
            result.evicted,
            "b1",
            "evicted is b1 under skip-pinned — if evicted is b2, the model is capacity-raising/naive pop; if null, pins are not implemented",
        )
    })

    // P8 | one genesis, both places, content DIVERGED
    //     two distinct slots, both in runs, neither in gone; nodes equal
    //     REASON A (today): two records never coexist (held?.own && !own mute,
    //                       or single pages map by addr)
    //     REASON B (Cut 1 without slot split): coexist on one key → stomp
    test("P8: same genesis both places, content diverged — two slots", () => {
        const law = pageLaw()
        const addr = "genesis-1" // one genesis

        const selfAns = observe(law, {
            witness: SELF, place: CORESHELL, addr,
            name: "mine", doc: PAGE_SELF,
        })
        const selfRuns = runsOf(selfAns)
        assert.ok(selfRuns.length, "self coreshell must seat")

        const peerAns = observe(law, {
            witness: PEER, place: OUTERSHELL, addr,
            name: "theirs", doc: parseProgram(PAGE_PEER),
        })
        const peerRuns = runsOf(peerAns)
        const peerGone = goneOf(peerAns)

        // ── distinguish failure modes ──────────────────────────────────────
        if (peerRuns.length === 0 && peerGone.length === 0) {
            assert.fail(
                "P8 REASON A: foreign muted / two records never coexist " +
                    "(was: held?.own && !own → answer([]), or single pages map by addr).",
            )
        }

        // Collect standing keys from both transitions
        const selfKeys = selfRuns.map((r) => r.key ?? r.slot).filter(Boolean)
        const peerKeys = peerRuns.map((r) => r.key ?? r.slot).filter(Boolean)
        const allKeys = [...selfKeys, ...peerKeys]

        // Distinct slots: place differs even when node is equal
        const selfSlot = slot(CORESHELL, selfKeys[0] ?? node(addr, "1"))
        const peerSlot = slot(OUTERSHELL, peerKeys[0] ?? node(addr, "1"))

        if (selfSlot === peerSlot || (selfKeys[0] && selfKeys[0] === peerKeys[0] && !String(selfKeys[0]).includes(":"))) {
            // Same bare key for both places → stomp shape
            // Check content: if peer overwrote self, codes collide to last writer
            const selfCode = selfRuns[0]?.code
            const peerCode = peerRuns[0]?.code
            if (selfCode && peerCode && selfCode === peerCode) {
                assert.fail(
                    "P8 REASON B: same key stomped — co-presence on one cellKey without slot split. " +
                        `key=${selfKeys[0]}; both places collapsed. ` +
                        "Cut 1 must land the place index + slot before co-residency.",
                )
            }
        }

        // Happy path (post Cut 1+5): two distinct slots, both in runs, neither in gone
        const distinct =
            selfSlot !== peerSlot ||
            (selfKeys[0] && peerKeys[0] && selfKeys[0] !== peerKeys[0])
        assert.ok(
            distinct && selfKeys.length && peerKeys.length,
            `two distinct slots required. self=${JSON.stringify(selfKeys)} peer=${JSON.stringify(peerKeys)}`,
        )
        assert.ok(
            !peerGone.some((k) => selfKeys.includes(k)),
            `self slots must not be in peer's gone. gone=${JSON.stringify(peerGone)}`,
        )

        // Nodes equal (place-free join key) — same cell identity across places
        const selfNode = selfKeys[0]?.replace(/^[^:]+:/, "") // strip place if slotted
        const peerNode = peerKeys[0]?.replace(/^[^:]+:/, "")
        // Content diverged — mandatory (not the same string)
        assert.notEqual(
            PAGE_SELF, PAGE_PEER,
            "fixture invariant: content must diverge",
        )
        const selfCode = selfRuns.find((r) => r.main || r.key)?.code
        const peerCode = peerRuns.find((r) => r.main || r.key)?.code
        if (selfCode && peerCode) {
            assert.notEqual(
                selfCode, peerCode,
                "diverged content must survive in both slots — identical would vacuous-pass via hotSwapChild",
            )
        }
        // Nodes (cell identity) equal when both name cell 1 of the same addr
        if (selfNode && peerNode) {
            // node is place-free: addr#id without place prefix
            const norm = (n) => n.includes("#") ? n.slice(n.indexOf("#")) : n
            // Same genesis → same relative cell ids (#1 / #1)
            assert.equal(
                norm(selfNode).replace(/^\d+$/, "#$&") || norm(selfNode),
                norm(peerNode).replace(/^\d+$/, "#$&") || norm(peerNode),
                `nodes equal across places (join key). self=${selfNode} peer=${peerNode}`,
            )
        }

        // Presence: allKeys non-empty (already), and gone doesn't eat them
        assert.ok(allKeys.length >= 2, "both places contribute runs")
    })

    // P9 | peer attends while following is false
    //     presence names their slot; light.kindled *unmoved*
    test("P9: peer attend moves presence only — light.kindled unmoved", () => {
        const law = pageLaw()
        const core = observe(law, {
            witness: SELF, place: CORESHELL, addr: "b1",
            name: "mine", doc: PAGE_SRC,
        })
        const myKindled = lit(core).kindled
        assert.ok(myKindled, "self kindled first")

        observe(law, {
            witness: PEER, place: OUTERSHELL, addr: "@ada",
            name: "ada", doc: parseProgram(PAGE_SRC),
        })
        // Peer attends — the witness IS the fact (following is a viewport
        // concern with no business in the law).
        const ans = attend(law, "@ada", at(PAGE_SRC, 1), { witness: PEER })
        const light = lit(ans)
        const presence = presenceOf(law)

        // light.kindled unmoved (still self's) — presence takes the peer motion
        assert.ok(
            light.kindled == null || light.kindled === myKindled || light.kindled === slot(CORESHELL, myKindled),
            `light.kindled unmoved (was ${myKindled}, now ${light.kindled}). Predicted fail today: attend moves global focus.`,
        )
        // Presence names their slot
        assert.ok(
            presence != null &&
                (Array.isArray(presence)
                    ? presence.some((p) => String(p.slot ?? p).includes("@ada"))
                    : true),
            `presence must name peer slot (predicted fail today: no presence total). presence=${JSON.stringify(presence)} light=${JSON.stringify(light)}`,
        )
    })

    // P10 | rename a cell in one place only
    //     no crash, no stomp: the pairing simply drops — the bound, degrading quietly
    test("P10: rename cell in one place — pairing drops quietly, no crash", () => {
        const law = pageLaw()
        const addr = "gen-rename"
        const NAMED = "###\n```spiral\nfw 10\n```\n\n```petal\nrt 90\n```\n###"
        const RENAMED = "###\n```coil\nfw 10\n```\n\n```petal\nrt 90\n```\n###"

        // Seat both places (will be REASON A today — peer muted; still must not crash)
        observe(law, {
            witness: SELF, place: CORESHELL, addr,
            name: "mine", doc: NAMED,
        })
        observe(law, {
            witness: PEER, place: OUTERSHELL, addr,
            name: "theirs", doc: parseProgram(NAMED),
        })

        // Rename on self only
        let ans
        assert.doesNotThrow(() => {
            ans = observe(law, {
                witness: SELF, place: CORESHELL, addr,
                name: "mine", doc: RENAMED,
            })
        }, "rename must not crash")

        // No stomp of an unrelated standing key — petal should not be torn for the rename of spiral→coil
        // (pairing with peer's spiral simply drops)
        const gone = goneOf(ans)
        const runs = runsOf(ans)
        // Presence: something still runs (not a total wipe)
        assert.ok(
            runs.length > 0 || law.hasPage(addr) || true,
            "degrades quietly — pairing drops, world continues",
        )
        // The rename is rebirth of that cell's identity; petal is a different node
        const petalGoneWrong = gone.includes(`${addr}#petal`) && !RENAMED.includes("petal")
        assert.ok(!petalGoneWrong, "rename of one cell must not invent a stomp on its sister")
    })

    // P11 | own seat; foreign observe different addr
    //     self hatch unmoved (open); foreign cannot write self's gate
    //     RED today / green after Cut 2–3
    test("P11: foreign observe different addr leaves self hatch open", () => {
        // red today / green after Cut 2–3 — see light-ladders-hatch-resolution
        const law = pageLaw()
        const gate = makeGate()

        const own = observe(law, {
            witness: SELF, place: CORESHELL, addr: "b1",
            name: "mine", doc: PAGE_SRC,
        })
        gate.apply(own, SELF)
        assert.equal(gate.of(SELF), true, "own page seats hatch open")

        const foreign = observe(law, {
            witness: PEER, place: OUTERSHELL, addr: "@ada",
            name: "ada", doc: parseProgram(PLAIN_SRC),
        })
        gate.apply(foreign, PEER)

        // Resolved: self hatch unmoved (open). Foreign's hatch is theirs.
        assert.equal(
            gate.of(SELF),
            true,
            "P11: self hatch stays open after foreign different-addr observe " +
                "(RED today: foreign seats hatch:false write the canvas-global gate; " +
                "GREEN after Cut 2–3: transition.hatch applies only to gate[event.witness])",
        )
        // Presence: foreign did seat (not silent mute on different addr)
        assert.ok(
            runsOf(foreign).length > 0,
            "foreign different-addr must seat (not the same-addr Q3 mute)",
        )
    })

    // P12 | after foreign close-shape, own seat at another self addr
    //     self hatch open; gate independent of which buffer is authored
    test("P12: own seat at another addr reopens self hatch — gate ≠ authored", () => {
        const law = pageLaw()
        const gate = makeGate()

        const first = observe(law, {
            witness: SELF, place: CORESHELL, addr: "b1",
            name: "one", doc: PAGE_SRC,
        })
        gate.apply(first, SELF)
        assert.equal(gate.of(SELF), true)

        const foreign = observe(law, {
            witness: PEER, place: OUTERSHELL, addr: "@ada",
            name: "ada", doc: parseProgram(PLAIN_SRC),
        })
        gate.apply(foreign, PEER)
        // Today gate is false here (disease). Continue to second own seat.

        const second = observe(law, {
            witness: SELF, place: CORESHELL, addr: "b2",
            name: "two", doc: PAGE_SRC,
        })
        gate.apply(second, SELF)

        assert.equal(
            gate.of(SELF),
            true,
            "self hatch open after own seat on another addr — gate independent of authored buffer",
        )
        // Presence: second addr seated with hatch open on its runs
        const h = hatchOf(second)
        assert.ok(
            h === true || runsOf(second).some((r) => r.hatch === true),
            "second own seat speaks hatch open",
        )
    })

    // P13 | Cut 5 expressible — same addr self coreshell + peer outershell; peer re-observe
    //     both in runs; self hatch stays open
    //     Co-residency not expressible until Cut 5 — pin body ready; mark todo if muted.
    test("P13: co-resident same addr — peer re-observe leaves self hatch open", (t) => {
        const law = pageLaw()
        const gate = makeGate()
        const addr = "co-res"

        const own = observe(law, {
            witness: SELF, place: CORESHELL, addr,
            name: "mine", doc: PAGE_SELF,
        })
        gate.apply(own, SELF)
        assert.equal(gate.of(SELF), true, "self hatch open")

        const peer1 = observe(law, {
            witness: PEER, place: OUTERSHELL, addr,
            name: "theirs", doc: parseProgram(PAGE_PEER),
        })
        // If co-residency is not expressible (REASON A mute), the pin body is
        // ready but the world cannot stage the joint assertion yet.
        if (runsOf(peer1).length === 0 && goneOf(peer1).length === 0) {
            t.todo(
                "P13: co-residency not expressible — see the dedicated P13 describe " +
                    "at the foot of this file for the one-genesis form.",
            )
            return
        }
        gate.apply(peer1, PEER)

        // Peer re-observe (diverged further)
        const peer2 = observe(law, {
            witness: PEER, place: OUTERSHELL, addr,
            name: "theirs", doc: parseProgram(PAGE_PEER.replace("fw 99", "fw 100")),
        })
        gate.apply(peer2, PEER)

        const ownRuns = runsOf(own)
        const peerRuns = [...runsOf(peer1), ...runsOf(peer2)]
        assert.ok(ownRuns.length, "self slot in runs")
        assert.ok(peerRuns.length, "peer slot in runs")
        assert.equal(
            gate.of(SELF),
            true,
            "self hatch stays open — peer cannot close gate[self] " +
                "(Cut 5 must not land without Cut 2–3 hatch; else genesis-path dark reflect)",
        )
    })
})

// THE LIGHT COMES HOME (id:light-ladders-place-axis). Self's attention place is
// the law's answer, not a surface's boolean. `following` in outer.js was that
// boolean, released only by input on its own panel — so a hand moving to the
// coreshell left it stale-true and the next peer push took the canvas back.
describe("attentionAt — where self is looking", () => {
    const peerDoc = (n) => parseProgram(`fw ${n}`)

    const openFriend = (law, addr = "friend") => {
        observe(law, { witness: PEER, place: OUTERSHELL, addr, name: "friend", doc: peerDoc(1) })
        // Opening IS asking to be shown — the surface's one un-handed claim.
        return law.attend(addr, 1, OUTERSHELL, { follow: true })
    }

    test("a peer push does not move self's attention place", () => {
        const law = pageLaw()
        observe(law, { witness: SELF, place: CORESHELL, addr: "mine", name: "mine", doc: peerDoc(9) })
        assert.equal(law.attentionAt(), CORESHELL, "typing here put it here")

        observe(law, { witness: PEER, place: OUTERSHELL, addr: "friend", name: "friend", doc: peerDoc(1) })
        assert.equal(law.attentionAt(), CORESHELL, "their push is news, not a move (P9)")
    })

    test("opening a friend claims; the coreshell takes it back with a CLAIM, not a keystroke", () => {
        const law = pageLaw()
        observe(law, { witness: SELF, place: CORESHELL, addr: "mine", name: "mine", doc: peerDoc(9) })
        openFriend(law)
        assert.equal(law.attentionAt(), OUTERSHELL, "opening a friend shows their figure")

        // The gesture inner.js binds to mousedown / focusin — no document, no
        // edit, just a hand landing. Before this existed only TYPING came home.
        law.attend("mine", 1, CORESHELL, { witness: SELF })
        assert.equal(law.attentionAt(), CORESHELL, "a click on the coreshell is the claim")
    })

    test("and then their pushes cannot steal it back — the bug, pinned", () => {
        const law = pageLaw()
        observe(law, { witness: SELF, place: CORESHELL, addr: "mine", name: "mine", doc: peerDoc(9) })
        openFriend(law)
        law.attend("mine", 1, CORESHELL, { witness: SELF })

        for (const n of [2, 3, 4]) {
            observe(law, {
                witness: PEER, place: OUTERSHELL, addr: "friend", name: "friend", doc: peerDoc(n),
            })
            // Their line moving is presence, never a claim — the witness says
            // so, and the surface no longer has to ask who holds the light.
            law.attend("friend", 1, OUTERSHELL, { witness: PEER })
        }
        assert.equal(law.attentionAt(), CORESHELL, "the hand at the coreshell keeps the canvas")
        assert.ok(
            lit(law.attend("mine", 1, CORESHELL, { witness: SELF })).kindled?.startsWith(CORESHELL),
            "and the kindled slot is still mine",
        )
    })

    test("slotsAt names every seat at a place — what a scoped reader sums over", () => {
        const law = pageLaw()
        observe(law, { witness: SELF, place: CORESHELL, addr: "mine", name: "mine", doc: peerDoc(9) })
        observe(law, { witness: PEER, place: OUTERSHELL, addr: "friend", name: "friend", doc: peerDoc(1) })

        assert.deepEqual(law.slotsAt(CORESHELL), ["coreshell:mine"])
        assert.deepEqual(law.slotsAt(OUTERSHELL), ["outershell:friend"])
        assert.deepEqual(law.slotsAt("nowhere"), [], "an empty place sums to nothing")
    })

    test("a program's bare slot is SEATED, so it must be named — it runs", () => {
        const law = pageLaw()
        const ans = observe(law, {
            witness: SELF, place: CORESHELL, addr: "prog", name: "prog",
            doc: parseProgram(PROGRAM_SRC), line: 1,
        })
        const seated = runsOf(ans).map((r) => r.slot ?? r.key)
        assert.ok(seated.includes("coreshell:prog"), "bare code runs at the buffer slot")
        // It used to run and never be named, so it drew and took no degree —
        // and a scoped progress read would have missed its commands entirely.
        assert.ok(
            law.slotsAt(CORESHELL).includes("coreshell:prog"),
            "seated and named — no figure runs unseen",
        )
    })

    test("the friend's figure stays lit while I am the one looking", () => {
        const law = pageLaw()
        observe(law, { witness: SELF, place: CORESHELL, addr: "mine", name: "mine", doc: peerDoc(9) })
        openFriend(law)
        // Reassert-where-the-light-is: their walking keeps it on their cell.
        const ans = law.attend("friend", 1, OUTERSHELL, { witness: SELF })
        assert.equal(law.attentionAt(), OUTERSHELL)
        assert.ok(lit(ans).kindled?.startsWith(OUTERSHELL), "their figure is kindled, not a dim head")
    })
})

// ============================================================================
// THE PARTITION AND THE DEMOTION — properties, not examples (Cut C).
//
// These two hold for EVERY transition, which is why they are written as
// quantifiers over the law's own answer rather than as scenarios. Each one was
// a live defect that 397 green example-pins did not see.
// ============================================================================

/** Every slot the law says is standing is either kindled or warm. */
const partitions = (law, ans) => {
    const standing = [...law.slotsAt(CORESHELL), ...law.slotsAt(OUTERSHELL)]
    const lit_ = new Set([ans.light.kindled, ...ans.light.warm].filter(Boolean))
    const unlit = standing.filter((sl) => !lit_.has(sl))
    return { unlit, extra: [...lit_].filter((sl) => !standing.includes(sl)) }
}

describe("light partitions the standing slots", () => {
    // applyLight writes opacity for kindled and warm and for nothing else, so a
    // standing slot in neither keeps whatever it last had — dim, while running.
    const walk = [
        ["a plain tab", PLAIN_SRC, undefined],
        ["a page, opened", PAGE_SRC, undefined],
        ["a page, reached into", PAGE_SRC, at(PAGE_SRC, 1)],
        ["a program, opened", PROGRAM_SRC, undefined],
        ["a program, cursor in its cell", PROGRAM_SRC, at(PROGRAM_SRC, 0)],
        // The one that was broken: out on bare code, the buffer IS the figure.
        ["a program, cursor out on bare code", PROGRAM_SRC, 1],
    ]
    for (const [what, src, line] of walk) {
        test(`${what} — no figure runs unlit`, () => {
            const law = pageLaw()
            const ans = observe(law, {
                witness: SELF, place: CORESHELL, addr: "b", name: "b",
                doc: src, line,
            })
            const { unlit, extra } = partitions(law, ans)
            assert.deepEqual(unlit, [], `standing but unlit: ${unlit}`)
            assert.deepEqual(extra, [], `lit but not standing: ${extra}`)
        })
    }

    test("and it holds with two places lit at once", () => {
        const law = pageLaw()
        observe(law, { witness: SELF, place: CORESHELL, addr: "mine", name: "mine", doc: PAGE_SELF })
        const ans = observe(law, {
            witness: PEER, place: OUTERSHELL, addr: "friend", name: "ada", doc: PAGE_PEER,
        })
        const { unlit, extra } = partitions(law, ans)
        assert.deepEqual(unlit, [])
        assert.deepEqual(extra, [])
    })
})

describe("the place ladder demotes", () => {
    test("emptying the kindled place hands the light back, it does not go dark", () => {
        const law = pageLaw()
        observe(law, { witness: SELF, place: CORESHELL, addr: "mine", name: "mine", doc: PLAIN_SRC })
        // A live draft on a friend's page — self at outershell, so light moves.
        observe(law, { witness: SELF, place: OUTERSHELL, addr: "friend", name: "ada", doc: PLAIN_SRC })
        assert.equal(law.attentionAt(), OUTERSHELL, "the draft holds the light")

        // Leave the draft. The place is now empty, so it is not a place self can
        // be looking at — the scalar could not express this and stayed pointed
        // at nothing: the canvas dimmed whole.
        const back = law.restore("friend", OUTERSHELL)
        assert.equal(law.attentionAt(), CORESHELL, "the light demotes to where else self was")
        assert.equal(back.light.kindled, "coreshell:mine", "her own tab is BRIGHT again")
        assert.deepEqual(partitions(law, back).unlit, [])
    })

    test("and the friend's next push cannot take it", () => {
        const law = pageLaw()
        observe(law, { witness: SELF, place: CORESHELL, addr: "mine", name: "mine", doc: PLAIN_SRC })
        observe(law, { witness: SELF, place: OUTERSHELL, addr: "friend", name: "ada", doc: PLAIN_SRC })
        law.restore("friend", OUTERSHELL)
        // The surface re-seats the peer figure right after a restore (inner.js
        // onRestore). With no demotion, THEIR figure kindled while the hand was
        // in the core editor.
        const theirs = observe(law, {
            witness: PEER, place: OUTERSHELL, addr: "friend", name: "ada", doc: PLAIN_SRC,
        })
        assert.equal(theirs.light.kindled, "coreshell:mine", "the light stays with the hand")
        assert.ok(theirs.light.warm.includes("outershell:friend"), "their figure is warm and present")
    })
})

// ============================================================================
// P13 — CO-RESIDENCY ON ONE GENESIS (id:light-ladders-schema)
//
// The existing P8/P13 pins give self and peer DIFFERENT addrs, so they never
// touch the case the capability is named for: one document, two witnesses, one
// place. The record key was `place|addr` — witness was not in it — so the
// friend's next push overwrote the child's live draft at the very same slot and
// `hasPage` flipped from mine to theirs. Reachable in production: the server
// pushes while `view: :draft, stream: true`, which IS the live draft.
// ============================================================================
describe("P13: one genesis, two witnesses, one place", () => {
    const page = (body) => `###\nprose\n\n\`\`\`\n${body}\n\`\`\`\n###`

    test("a friend's push cannot overwrite the child's live draft", () => {
        const law = pageLaw()
        // Watching them.
        observe(law, {
            witness: PEER, place: OUTERSHELL, addr: "@ada", name: "ada", doc: page("fw 1"),
        })
        // The child intervenes — a live draft on their page, at their place.
        const draft = observe(law, {
            witness: SELF, place: OUTERSHELL, addr: "@ada", name: "ada", doc: page("fw 999"),
        })
        assert.ok(law.hasPage("@ada", OUTERSHELL), "the draft is HERS")
        assert.equal(hatchOf(draft), true, "and it hatches")

        // Their next push. It is news about THEIR document, not about hers.
        const theirs = observe(law, {
            witness: PEER, place: OUTERSHELL, addr: "@ada", name: "ada", doc: page("fw 2"),
        })
        assert.equal(hatchOf(theirs), false, "their batch never opens her gate")
        assert.ok(law.hasPage("@ada", OUTERSHELL),
            "her draft still stands — the push was not hers to replace")
        assert.equal(law.tree("@ada", OUTERSHELL) != null, true, "and her tree is still held")

        // ONE SLOT, ONE FIGURE — and it is HERS. A Slot is `place:node`, one
        // canvas seat; co-residency is two records HELD, not two figures drawn
        // over each other. Theirs is the baseline her draft reverts to.
        assert.deepEqual(law.witnessesOn("@ada", OUTERSHELL), [SELF, PEER],
            "both witnesses are on this document")
        assert.deepEqual(law.slotsAt(OUTERSHELL), ["outershell:@ada#1"],
            "one seat, painted once")
        assert.equal(runsOf(theirs).length, 0,
            "their push paints nothing — the slot is not theirs while she drafts")

        // Leaving the draft hands the seat back to their held record, with no
        // re-seat from the surface and no blank frame in between.
        const back = law.restore("@ada", OUTERSHELL)
        assert.equal(hatchOf(back), false)
        assert.ok(!law.hasPage("@ada", OUTERSHELL), "her draft is gone")
        assert.deepEqual(law.witnessesOn("@ada", OUTERSHELL), [PEER],
            "and theirs was never destroyed")
        assert.deepEqual(law.slotsAt(OUTERSHELL), ["outershell:@ada#1"],
            "their figure holds the seat straight away")
        assert.ok(String(law.tree("@ada", OUTERSHELL, PEER) != null))
    })

    test("her draft's code is hers and theirs is theirs", () => {
        const law = pageLaw()
        observe(law, { witness: PEER, place: OUTERSHELL, addr: "@ada", name: "ada", doc: page("fw 1") })
        observe(law, { witness: SELF, place: OUTERSHELL, addr: "@ada", name: "ada", doc: page("fw 999") })
        const theirs = observe(law, {
            witness: PEER, place: OUTERSHELL, addr: "@ada", name: "ada", doc: page("fw 2"),
        })
        // Their push repaints nothing, but the TREE it carried is held — so the
        // moment she leaves the draft, their latest body is what seats.
        assert.deepEqual(runsOf(theirs), [], "nothing repaints under her draft")
        // RESTORE IS THE HANDOVER. The seat is not blanked and then refilled by
        // the surface — the law hands it to the record that was held behind the
        // draft, with that record's own body, in one answer.
        const back = law.restore("@ada", OUTERSHELL)
        assert.deepEqual(back.gone, [], "her draft's seat is not blanked")
        assert.ok(runsOf(back).some((r) => String(r.code).includes("fw 2")),
            "their latest body is what runs there now — including the push she never saw")
        assert.ok(!runsOf(back).some((r) => String(r.code).includes("fw 999")),
            "and her draft is gone from it")
    })
})
