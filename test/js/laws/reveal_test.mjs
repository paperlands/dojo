// The reveal control, pure. (id:laws-experiment-3-possibility)
// Run: node --test test/js/laws/reveal_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { hintsVisible, revealedBy, normalizeReveal, REVEAL_MOVE_TOL } from "../../../assets/js/turtling/laws/reveal.js"

test("Visible shows the law hints at once; Delayed withholds them together", () => {
    assert.equal(hintsVisible("visible", false), true)
    assert.equal(hintsVisible("delayed", false), false)
    assert.equal(hintsVisible("delayed", true), true)
    assert.equal(hintsVisible("delayed", undefined), false)
    assert.equal(normalizeReveal(undefined), "visible")
    assert.equal(normalizeReveal("nonsense"), "visible")
    assert.equal(normalizeReveal("delayed"), "delayed")
})

test("one accepted hand move reveals, but only a real displacement", () => {
    const move = (from, to) => revealedBy({ mode: "delayed", revealed: false, from, to })
    assert.equal(move([0, 0, 0], [1, 0, 0]), true)
    assert.equal(move([0, 0, 0], [0, 0, 0]), false, "an accepted-but-unchanged request is not a move")
    assert.equal(move([0, 0, 0], [REVEAL_MOVE_TOL / 2, 0, 0]), false, "below the declared floor")
    assert.equal(move([0, 0, 0], [REVEAL_MOVE_TOL * 2, 0, 0]), true, "above the declared floor")
})

test("bad geometry never reveals, and Visible is already revealed", () => {
    assert.equal(revealedBy({ mode: "delayed", revealed: false, from: null, to: [1, 0, 0] }), false)
    assert.equal(revealedBy({ mode: "delayed", revealed: false, from: [0, 0], to: [1, 0, 0] }), false)
    assert.equal(revealedBy({ mode: "delayed", revealed: false, from: [NaN, 0, 0], to: [1, 0, 0] }), false)
    assert.equal(revealedBy({ mode: "visible", revealed: false, from: null, to: null }), true)
    assert.equal(revealedBy({ mode: "delayed", revealed: true, from: null, to: null }), true)
})
