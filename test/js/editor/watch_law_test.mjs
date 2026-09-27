// The watcher's law — one latch, three doors (D021, D023, D025 R5/R7).
//   node --test test/js/editor/watch_law_test.mjs
//
// The problem: these invariants once needed a live browser and a walked
// sequence — five mutable locals across five handlers in outer.js. They are
// properties of one value now.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { openWatch, step } from "../../../assets/js/editor/watch-law.js"

const LINES = 40
const peer = (line, head = null) => ({ kind: "peerLine", line, docLines: LINES, head })
const hand = (caret, spendCaret = false) => ({ kind: "hand", caret, spendCaret })

// Walk a sequence, keeping every answer — the shape a live session has.
function walk(events, state = openWatch()) {
    const answers = []
    for (const e of events) {
        const ans = step(state, e)
        state = ans.state
        answers.push(ans)
    }
    return { state, answers, last: answers[answers.length - 1] }
}

describe("open — the latch re-arms and nothing is owed", () => {
    test("a fresh watch follows, holds no line, owes no caret", () => {
        assert.deepEqual(openWatch(), { following: true, peerAt: null, ownCaret: null })
    })

    test("open drops everything the last friend left behind", () => {
        const { state } = walk([peer(7, 100), hand(7), { kind: "open" }])
        assert.deepEqual(state, { following: true, peerAt: null, ownCaret: null })
    })

    test("open performs nothing — the body has not arrived yet", () => {
        const ans = step({ following: false, peerAt: 9, ownCaret: 3 }, { kind: "open" })
        assert.deepEqual(Object.keys(ans), ["state"])
    })
})

describe("peerLine — the mark always, the light only while following", () => {
    test("following: mark, firefly, claim and viewport all arrive", () => {
        const { last, state } = walk([peer(12, 300)])
        assert.equal(last.mark, 12)
        assert.equal(last.chase, 12)
        assert.equal(last.claim, 12)
        assert.equal(last.viewport, 12)
        assert.equal(last.stir, true)
        assert.equal(state.peerAt, 12)
    })

    test("after the hand: mark and firefly ONLY — the light is not theirs", () => {
        const { last } = walk([peer(4, 100), hand(4), peer(19, 300)])
        assert.equal(last.mark, 19)
        assert.equal(last.chase, 19)
        assert.ok(!("claim" in last), "the hand holds the light")
        assert.ok(!("viewport" in last), "and the viewport with it")
    })

    test("a name before its body stirs, and commits nothing", () => {
        for (const bad of [0, -1, LINES + 1]) {
            const { last, state } = walk([peer(bad, 100)])
            assert.deepEqual(last, { state, stir: true }, `line ${bad} is not yet true`)
            assert.equal(state.peerAt, null, "the line was never taken")
        }
    })

    test("typing on the line they hold re-measures, and does not arrive again", () => {
        const { last } = walk([peer(12, 300), peer(12, 300)])
        assert.deepEqual(Object.keys(last).sort(), ["chase", "state", "stir"])
        assert.equal(last.chase, 12)
    })

    test("null is a line: the mark comes off, no arrival", () => {
        const { last, state } = walk([peer(12, 300), peer(null, 300)])
        assert.equal(last.mark, null)
        assert.equal(last.chase, null)
        assert.ok(!("viewport" in last), "there is nowhere to glide to")
        assert.equal(state.peerAt, null)
    })
})

describe("the caret the watcher was sitting at", () => {
    test("following stashes it on the FIRST arrival and holds it", () => {
        const { state } = walk([peer(5, 100), peer(9, 999), peer(14, 777)])
        assert.equal(state.ownCaret, 100, "a later arrival must not overwrite their seat")
    })

    test("nothing is stashed when there is no caret to read", () => {
        const { state } = walk([peer(5, null)])
        assert.equal(state.ownCaret, null)
    })

    test("nothing is stashed when the peer does not own the light", () => {
        const { state } = walk([hand(3), peer(5, 100)])
        assert.equal(state.ownCaret, null, "the hand never left its seat")
    })

    test("draftEnter gives it back, exactly once", () => {
        const first = walk([peer(5, 100), { kind: "draftEnter" }])
        assert.equal(first.last.caret, 100)
        assert.equal(first.state.ownCaret, null)

        const again = step(first.state, { kind: "draftEnter" })
        assert.ok(!("caret" in again), "spent is spent — the second entry moves nothing")
    })

    test("a click spends it; a keystroke does not", () => {
        const clicked = walk([peer(5, 100), hand(5, true)])
        assert.equal(clicked.state.ownCaret, null, "they just said where they want to be")

        const typed = walk([peer(5, 100), hand(5, false)])
        assert.equal(typed.state.ownCaret, 100, "a keystroke is not a choice of place")
    })
})

describe("hand — the light changes owner once", () => {
    test("the first hand halts the glide and claims its own line", () => {
        const { last, state } = walk([peer(12, 300), hand(31)])
        assert.equal(last.halt, true)
        assert.equal(last.claim, 31)
        assert.equal(state.following, false)
        assert.equal(state.peerAt, 12, "the peer is still where they are")
    })

    test("a hand that already holds the light asks for nothing", () => {
        const { last, state } = walk([hand(3), hand(8)])
        assert.deepEqual(last, { state }, "no second halt, no second claim")
        assert.equal(state.following, false)
    })
})

describe("resume — the firefly hands the light back", () => {
    test("a full arrival at their line, latch re-armed", () => {
        const { last, state } = walk([peer(4, 100), hand(4, true), { kind: "resume", line: 22, head: 555 }])
        assert.equal(state.following, true)
        assert.equal(state.peerAt, 22)
        assert.equal(state.ownCaret, 555, "the hand's seat, kept for the draft door")
        assert.equal(last.mark, 22)
        assert.equal(last.claim, 22)
        assert.equal(last.viewport, 22)
    })

    test("resuming onto no line re-arms the latch and unmarks", () => {
        const { last, state } = walk([{ kind: "resume", line: null, head: 5 }])
        assert.equal(state.following, true)
        assert.equal(last.mark, null)
        assert.ok(!("claim" in last))
    })
})

describe("reassert — whoever holds the light says it again", () => {
    test("their line while following", () => {
        const { last } = walk([peer(12, 300), { kind: "reassert", caret: 31 }])
        assert.equal(last.claim, 12)
    })

    test("the hand's caret after it intervened", () => {
        const { last } = walk([peer(12, 300), hand(31), { kind: "reassert", caret: 31 }])
        assert.equal(last.claim, 31)
    })

    test("following with no line yet claims nothing", () => {
        const { last } = walk([{ kind: "reassert", caret: 9 }])
        assert.equal(last.claim, null)
    })
})

describe("draftView — a diff has no line to stand on", () => {
    test("the mark comes off and the peer's line is dropped", () => {
        const { last, state } = walk([peer(12, 300), { kind: "draftView" }])
        assert.equal(last.mark, null)
        assert.equal(last.chase, null)
        assert.equal(state.peerAt, null)
        assert.equal(state.following, true, "the latch is untouched")
    })
})

describe("the properties the latch exists to hold", () => {
    // THE PARTITION: over any walk, a claim is the peer's line or the hand's
    // caret — never both, and never the peer's while the hand holds the light.
    test("the light has exactly one owner at every step", () => {
        const script = [
            peer(3, 10), peer(7, 20), hand(15), peer(9, 30),
            { kind: "reassert", caret: 15 }, { kind: "resume", line: 9, head: 15 },
            peer(11, 40), hand(2, true), { kind: "reassert", caret: 2 },
        ]
        let state = openWatch()
        for (const event of script) {
            const before = state
            const ans = step(state, event)
            state = ans.state
            if (!("claim" in ans)) continue
            if (state.following) {
                assert.equal(ans.claim, state.peerAt,
                    `${event.kind}: while following, the claim IS their line`)
            } else {
                assert.equal(ans.claim, event.caret ?? null,
                    `${event.kind}: after the hand, the claim comes from the caret`)
                assert.notEqual(ans.claim, before.peerAt,
                    `${event.kind}: and never from the peer`)
            }
        }
    })

    // A surface that performs an unnamed act is performing a guess.
    test("an answer never carries an undefined act", () => {
        const script = [
            peer(3, 10), peer(3, 10), peer(99, 10), hand(5), { kind: "resume", line: 2, head: 5 },
            { kind: "draftEnter" }, { kind: "draftView" }, { kind: "reassert", caret: 1 },
            { kind: "open" },
        ]
        const { answers } = walk(script)
        for (const ans of answers) {
            for (const [key, value] of Object.entries(ans)) {
                assert.notEqual(value, undefined, `${key} was named but says nothing`)
            }
        }
    })

    test("an unknown event is a fault, never a default", () => {
        assert.throws(() => step(openWatch(), { kind: "wheel" }), /unknown event "wheel"/)
    })
})
