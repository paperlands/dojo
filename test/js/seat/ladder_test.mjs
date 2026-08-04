// The degree ladder — appearance in DEGREE as one pure transition. Run with:
//   node --test test/js/seat/ladder_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { visit } from "../../../assets/js/weave/ladder.js"

describe("the ladder — kindled, warm, evicted", () => {
    test("revisiting the kindled key is a memo hit — same array, no motion", () => {
        const order = [0]
        const r = visit(order, 0)
        assert.equal(r.order, order)
        assert.equal(r.entered, null)
        assert.equal(r.evicted, null)
    })

    test("reaching the next cell kindles it; the one she left stays warm", () => {
        const r = visit([0], 1)
        assert.deepEqual(r.order, [1, 0])
        assert.equal(r.entered, 1)
        assert.equal(r.evicted, null)
    })

    test("a third reach evicts the oldest — the window of two holds", () => {
        const r = visit([1, 0], 2)
        assert.deepEqual(r.order, [2, 1])
        assert.equal(r.entered, 2)
        assert.equal(r.evicted, 0)
    })

    test("walking back into the warm cell swaps the pair — nothing mounts, nothing leaves", () => {
        const r = visit([2, 1], 1)
        assert.deepEqual(r.order, [1, 2])
        assert.equal(r.entered, null)
        assert.equal(r.evicted, null)
    })

    test("capacity 1 is the editor's law — one active, the rest gone", () => {
        const r = visit([0], 1, 1)
        assert.deepEqual(r.order, [1])
        assert.equal(r.entered, 1)
        assert.equal(r.evicted, 0)
    })
})
