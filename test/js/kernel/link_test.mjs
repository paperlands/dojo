// kernel/link.js — the address bar as a fact store (specs link-actions,
// id:la-law). Run: node --test test/js/kernel/link_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { createLink } from "../../../assets/js/kernel/link.js"

describe("read — never consumes", () => {
    test("a present word answers, twice", () => {
        const link = createLink("?action=share&fork=abc")
        assert.equal(link.read("action"), "share")
        assert.equal(link.read("action"), "share")
        assert.equal(link.read("fork"), "abc")
    })

    test("an absent word is null, a valueless word is empty string", () => {
        const link = createLink("?perf")
        assert.equal(link.read("weave"), null)
        assert.equal(link.read("perf"), "")
    })

    test("an empty search is a quiet link", () => {
        const link = createLink("")
        assert.equal(link.read("action"), null)
    })

    test("live location wins over the seed when one stands (id:la-law)", () => {
        // Soft nav rewrites the address without re-importing the module —
        // the engine must re-read location, not a closed-over snapshot.
        const prev = globalThis.location
        globalThis.location = { search: "?fork=live", pathname: "/shell", hash: "" }
        try {
            const link = createLink("?fork=seed")
            assert.equal(link.read("fork"), "live")
        } finally {
            if (prev === undefined) delete globalThis.location
            else globalThis.location = prev
        }
    })
})

describe("carry — the mirror writes only on change", () => {
    test("a new word lands beside its neighbours", () => {
        const wrote = []
        const link = createLink("?weave=spirals", (qs) => wrote.push(qs))
        link.carry("action", "share")
        assert.deepEqual(wrote, ["weave=spirals&action=share"])
        assert.equal(link.read("action"), "share")
    })

    test("the same word twice writes once", () => {
        const wrote = []
        const link = createLink("", (qs) => wrote.push(qs))
        link.carry("action", "share")
        link.carry("action", "share")
        assert.equal(wrote.length, 1)
    })

    test("null lifts the word out and leaves neighbours standing", () => {
        const wrote = []
        const link = createLink("?action=share&fork=abc", (qs) => wrote.push(qs))
        link.carry("action", null)
        assert.deepEqual(wrote, ["fork=abc"])
        assert.equal(link.read("action"), null)
        assert.equal(link.read("fork"), "abc")
    })

    test("lifting an absent word is silence", () => {
        const wrote = []
        const link = createLink("?fork=abc", (qs) => wrote.push(qs))
        link.carry("action", null)
        assert.equal(wrote.length, 0)
    })
})
