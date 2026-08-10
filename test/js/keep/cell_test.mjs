// The keep cell's ask — one value, not a title beside a side-channel prev
// (kb-vet4 33). Run: node --test test/js/keep/cell_test.mjs

import { describe, test } from "node:test"
import assert from "node:assert/strict"

import { askKeep, watchAsk } from "../../../assets/js/keep/cell.js"

describe("askKeep: one value (kb-vet4 33)", () => {
    test("straight keep notifies { title } only — no prev key", () => {
        const seen = []
        const un = watchAsk((ask) => seen.push(ask))
        askKeep("a small step")
        un()
        assert.deepEqual(seen, [{ title: "a small step" }])
        assert.equal(Object.hasOwn(seen[0], "prev"), false)
    })

    test("draft fork notifies { title, prev } as one ask", () => {
        const parent = "a".repeat(64)
        const seen = []
        const un = watchAsk((ask) => seen.push(ask))
        askKeep("forked", { prev: parent })
        un()
        assert.deepEqual(seen, [{ title: "forked", prev: parent }])
    })

    test("empty / non-string prev is omitted — not a side channel", () => {
        const seen = []
        const un = watchAsk((ask) => seen.push(ask))
        askKeep("quiet", { prev: null })
        askKeep("quiet", { prev: "" })
        askKeep("quiet", {})
        un()
        for (const ask of seen) {
            assert.deepEqual(ask, { title: "quiet" })
            assert.equal(Object.hasOwn(ask, "prev"), false)
        }
    })
})
