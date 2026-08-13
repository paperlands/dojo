// Sister ambients — coreshell + outershell figures stand together.
//   node --test test/js/seat/sister_ambient_test.mjs
//
// Pins the play-gauge findings (light-ladders Cut 1 fallout):
//   1. Peer document from source when commands is [] (plain hatch shape)
//   2. Draft at outershell never evicts coreshell sister
//   3. Empty commands must not seat a head-only noop when source exists
//
// `own` says WHO and nothing else — a peer observe names its place, as every
// door does. own:false → outershell was one boolean doing two axes' work,
// which is what let a draft collide with the record it drafted over.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { pageLaw } from "../../../assets/js/weave/page.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"

const SQUARE = `fw 80
rt 90
fw 80
rt 90
fw 80
rt 90
fw 80`

const TRI = `fw 200
rt 120
fw 200
rt 120
fw 200`

describe("sister ambients — coreshell + outershell", () => {
    test("peer doc from source string seats a full plain run (not empty head)", () => {
        const law = pageLaw()
        law.observe("mine", { name: "me", doc: SQUARE, own: true })
        // Hatch of a plain tab often arrives as commands:[] + source text.
        const peer = law.observe("friend", {
            name: "child",
            doc: TRI, // the source fallback path
            own: false, place: "outershell",
        })
        assert.equal(peer.runs.length, 1, "one whole-buffer run")
        assert.equal(peer.runs[0].slot, "outershell:friend")
        assert.ok(peer.runs[0].code.includes("fw 200"), "code is the triangle")
        assert.ok(
            peer.light.warm.includes("coreshell:mine") ||
                peer.light.kindled === "coreshell:mine",
            "coreshell sister stays in the light total",
        )
    })

    test("empty AST seats nothing useful — source path is mandatory", () => {
        const law = pageLaw()
        law.observe("mine", { name: "me", doc: SQUARE, own: true })
        const empty = law.observe("friend", {
            name: "child",
            doc: [], // what watchers got when programFor missed the slot key
            own: false, place: "outershell",
        })
        assert.equal(empty.runs[0]?.code ?? "", "", "empty AST → empty code")
        // The canvas would show only a head at identity — this pin documents
        // the disease so the surface fallback (source text) stays load-bearing.
    })

    test("draft at outershell keeps coreshell sister standing", () => {
        const law = pageLaw()
        law.observe("mine", { name: "me", doc: SQUARE, own: true })
        law.observe("friend", { name: "child", doc: TRI, own: false, place: "outershell" })
        law.attend("friend", 1, undefined, { follow: true })
        const draft = law.observe("friend", {
            name: "child",
            doc: TRI + "\nfw 1",
            own: true,
            place: "outershell",
        })
        assert.deepEqual(draft.gone, [], "no eviction of coreshell")
        assert.ok(law.orderOf("coreshell").includes("mine"), "coreshell sister stands")
        assert.ok(law.orderOf("outershell").includes("friend"), "draft on outer")
        assert.equal(draft.light.kindled, "outershell:friend")
        assert.ok(draft.light.warm.includes("coreshell:mine"), "coreshell is warm")
    })

    test("draft without place (pre-fix) evicts coreshell — regression of the bug", () => {
        const law = pageLaw()
        law.observe("mine", { name: "me", doc: SQUARE, own: true })
        law.observe("friend", { name: "child", doc: TRI, own: false, place: "outershell" })
        const bad = law.observe("friend", {
            name: "child",
            doc: TRI + "\nfw 1",
            own: true, // resolves to coreshell, capacity-1 pops mine
        })
        assert.ok(
            bad.gone.some((g) => g.includes("mine") || g === "coreshell:mine"),
            "bad draft evicts coreshell sister",
        )
        assert.ok(!law.orderOf("coreshell").includes("mine"))
    })

    test("AST peer doc also seats (page/program path)", () => {
        const law = pageLaw()
        law.observe("mine", { name: "me", doc: SQUARE, own: true })
        const peer = law.observe("friend", {
            name: "child",
            doc: parseProgram(TRI),
            own: false, place: "outershell",
        })
        assert.ok(peer.runs[0].code.includes("fw 200"))
        assert.equal(peer.runs[0].slot, "outershell:friend")
    })
})
