// The reveal control, pure. (id:laws-experiment-3-possibility)
// Run: node --test test/js/laws/reveal_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { hintsVisible, movedEnough, normalizeReveal, REVEAL_MOVE_TOL } from "../../../assets/js/turtling/laws/reveal.js"

test("Visible shows the law hints at once; Delayed waits for an explicit reveal", () => {
    assert.equal(hintsVisible("visible", false), true)
    assert.equal(hintsVisible("delayed", false), false)
    assert.equal(hintsVisible("delayed", true), true)
    assert.equal(hintsVisible("delayed", undefined), false)
    assert.equal(normalizeReveal(undefined), "visible")
    assert.equal(normalizeReveal("nonsense"), "visible")
    assert.equal(normalizeReveal("delayed"), "delayed")
})

// The discriminating witness: movement is recorded, but it can never open the
// gate. Only the explicit reveal does, and the condition stays Delayed after.
test("accepted movement never opens the gate; only an explicit reveal does", () => {
    let revealed = false
    for (let i = 0; i < 5; i++) {
        assert.equal(movedEnough([i, 0, 0], [i + 1, 0, 0]), true, "a real displacement was recorded")
        assert.equal(hintsVisible("delayed", revealed), false, "and the hints stayed hidden")
    }
    revealed = true                       // the facilitator's reveal-now, and nothing else
    assert.equal(hintsVisible("delayed", revealed), true)
    assert.equal(normalizeReveal("delayed"), "delayed", "the condition is unchanged by revealing")
})

test("an accepted-but-unchanged request is not a move, and bad geometry is not either", () => {
    assert.equal(movedEnough([5, 0, 0], [5, 0, 0]), false)
    assert.equal(movedEnough([5, 0, 0], [5, REVEAL_MOVE_TOL / 2, 0]), false)
    assert.equal(movedEnough([5, 0, 0], [5, REVEAL_MOVE_TOL * 2, 0]), true)
    assert.equal(movedEnough(null, [1, 0, 0]), false)
    assert.equal(movedEnough([0, 0], [1, 0, 0]), false)
    assert.equal(movedEnough([NaN, 0, 0], [1, 0, 0]), false)
})
