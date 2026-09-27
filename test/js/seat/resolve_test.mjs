// The resolver — the docuverse address grammar and scope law, pinned
// (Q2/Q3 settled <2026-07-12>; owner⊗path cut on reflect). Run with:
//   node --test test/js/seat/resolve_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { normalize, parseAddress, resolve } from "../../../assets/js/weave/resolve.js"

describe("normalization — forgiving on match, verbatim on display", () => {
    test("case and the space/dash/underscore family fold to one form", () => {
        assert.equal(normalize("The Wonder"), normalize("the wonder"))
        assert.equal(normalize("does-it-stop"), normalize("does it stop"))
        assert.equal(normalize("getting_started"), normalize("getting started"))
    })

    test("no fuzz: plurals are the index's healing, never the resolver's guess", () => {
        assert.notEqual(normalize("spiral"), normalize("spirals"))
    })
})

describe("the address grammar — two faces, an owner prefix", () => {
    test("bare, ~-rooted, my/, and id-face words each read cleanly", () => {
        assert.deepEqual(parseAddress("roundness"),
            { owner: null, name: "roundness", face: "name" })
        assert.deepEqual(parseAddress("~/roundness"),
            { owner: "~", name: "roundness", face: "name" })
        assert.deepEqual(parseAddress("my/roundness"),
            { owner: "my", name: "roundness", face: "name" })
        assert.deepEqual(parseAddress("frag-roundness"),
            { owner: null, name: "frag-roundness", face: "id" })
    })

    test("a known someone splits; an unknown prefix stays a drawer path", () => {
        // Shoot 5: kai is someone only when named as such.
        assert.deepEqual(parseAddress("kai/roundness", ["kai"]),
            { owner: "kai", name: "roundness", face: "name" })
        // Without a known owner, the slash is a corpus drawer — not a shelf.
        assert.deepEqual(parseAddress("kai/roundness"),
            { owner: null, name: "kai/roundness", face: "name" })
        assert.deepEqual(parseAddress("primitives/control/as"),
            { owner: null, name: "primitives/control/as", face: "name" })
    })

    test("~/ reaches nested drawers whole — the library path survives", () => {
        assert.deepEqual(parseAddress("~/primitives/control/as"),
            { owner: "~", name: "primitives/control/as", face: "name" })
    })
})

describe("the scope law — her world shadows the library", () => {
    // The corpus's real deviation rides this fixture on purpose:
    // frag-spiral names the file spirals.org — only the index knows.
    const world = {
        ambients: ["spirals", "coil"],
        index: {
            "frag-spiral": { name: "spirals", title: "Spirals" },
            "frag-roundness": { name: "roundness", title: "Roundness" },
            "prim-as": { name: "primitives/control/as", title: "as — Summon a Friend" },
        },
    }

    test("her ambient wins over the corpus fragment of the same name", () => {
        assert.deepEqual(resolve("spirals", world), { kind: "ambient", name: "spirals" })
    })

    test("a qualified ~/name escapes the shadow — reaching past her own is saying so", () => {
        const r = resolve("~/spirals", world)
        assert.equal(r.kind, "fragment")
        assert.equal(r.name, "spirals")
    })

    test("my/name is the mirror escape — hers only, never falling through to the library", () => {
        assert.deepEqual(resolve("my/spirals", world), { kind: "ambient", name: "spirals" })
        // roundness lives only on the corpus shelf; my/ does not reach it
        assert.equal(resolve("my/roundness", world).kind, "unborn")
    })

    test("an id-face word resolves through the index to today's name", () => {
        const r = resolve("frag-spiral", world)
        assert.deepEqual(r, { kind: "fragment", name: "spirals", id: "frag-spiral", title: "Spirals" })
    })

    test("forgiving match: [[The Wonder]]-style caps and spacing still land", () => {
        const r = resolve("Frag-Roundness", world)
        assert.equal(r.kind, "fragment")
        assert.equal(r.name, "roundness")
    })

    test("without an index, names still walk; id-faces wait unborn", () => {
        const bare = { ambients: ["coil"], index: null }
        assert.equal(resolve("frag-spiral", bare).kind, "unborn")
        assert.equal(resolve("coil", bare).kind, "ambient")
    })

    test("a word neither world knows is unborn — an invitation, never an error", () => {
        assert.deepEqual(resolve("the moonlit stair", world), { kind: "unborn", word: "the moonlit stair" })
    })

    test("nested corpus paths resolve by whole name — / is not an owner", () => {
        const r = resolve("primitives/control/as", world)
        assert.equal(r.kind, "fragment")
        assert.equal(r.name, "primitives/control/as")
        assert.equal(r.id, "prim-as")
    })
})
