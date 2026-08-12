// kernel/link.js — the address bar as a fact store (specs link-actions,
// id:la-law). Run: node --test test/js/kernel/link_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { createLink, SERVER } from "../../../assets/js/kernel/link.js"

const WORDS = { clan: SERVER, fork: "inner", action: "river", perf: "inner" }
const mint = (search) =>
    createLink(search, () => {}, { words: WORDS, base: "https://dojo.test/shell" })

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

describe("address — the vocabulary decides what travels (id:la-mint)", () => {
    test("a server word rides along; the override says what the link is for", () => {
        assert.equal(
            mint("?clan=PaperLand").address({ fork: "abc" }),
            "https://dojo.test/shell?clan=PaperLand&fork=abc",
        )
    })

    test("client words are this session's state and never travel", () => {
        // action, perf and a stale fork are all mine, not the recipient's.
        assert.equal(
            mint("?action=share&perf=1&fork=stale&clan=PaperLand").address({ fork: "abc" }),
            "https://dojo.test/shell?clan=PaperLand&fork=abc",
        )
    })

    test("an unowned word is not in the vocabulary, so it never travels", () => {
        assert.equal(mint("?rogue=1").address({ fork: "abc" }), "https://dojo.test/shell?fork=abc")
    })

    test("no server word, no override — the bare page", () => {
        assert.equal(mint("?action=share").address(), "https://dojo.test/shell")
    })

    test("a null override is left out, never spelled null", () => {
        assert.equal(mint("").address({ fork: null }), "https://dojo.test/shell")
    })

    test("minting never writes — the address bar is untouched", () => {
        const wrote = []
        const link = createLink("?clan=PaperLand", (qs) => wrote.push(qs), {
            words: WORDS,
            base: "https://dojo.test/shell",
        })
        link.address({ fork: "abc" })
        assert.equal(wrote.length, 0)
        assert.equal(link.read("fork"), null)
    })

    test("base follows the live location when none is injected", () => {
        const prev = globalThis.location
        globalThis.location = {
            origin: "https://dojo.test",
            pathname: "/shell",
            search: "?clan=Kai",
            hash: "",
        }
        try {
            const link = createLink("", () => {}, { words: WORDS })
            assert.equal(link.address({ fork: "abc" }), "https://dojo.test/shell?clan=Kai&fork=abc")
        } finally {
            if (prev === undefined) delete globalThis.location
            else globalThis.location = prev
        }
    })
})
