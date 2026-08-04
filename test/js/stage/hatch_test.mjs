// The hatch verdict — when the reflect is hatched, and why.
// Run with: node --test test/js/stage/hatch_test.mjs
//
// Guards the bug this rule was rebuilt for: a program in an animation loop never
// reaches `done`, so a policy written as a list of CAUSES (first light, done)
// silently hatched it never — its reflect froze on the last finished run. The
// rule is now one question — would the watcher learn something new? (D025 R3) —
// with a floor per phase, so a fourth reason to hatch needs no new branch.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { hatchVerdict, BEAT } from "../../../assets/js/turtling/hatch.js"

// A canvas mid-life: drawn long ago, hatched once, nothing new to say.
const quiet = {
    now: 10_000, present: true, mine: true, walking: false,
    changedAt: 5_000, lastHatchAt: 5_000, firstDrawAt: 1_000,
}
const world = (over) => hatchVerdict({ ...quiet, ...over })

describe("hatch: silence", () => {
    test("no canvas, no hatch", () => {
        assert.deepEqual(world({ present: false, changedAt: 9_999 }), { owed: false, reason: null })
    })

    test("a friend's canvas is never hatched as your own (D022)", () => {
        // The gate closed: a watched program may animate all it likes.
        assert.deepEqual(world({ mine: false, walking: true, changedAt: 9_999 }),
                         { owed: false, reason: null })
    })

    test("a change the last hatch already carries teaches the watcher nothing", () => {
        assert.deepEqual(world({ changedAt: 5_000, lastHatchAt: 5_000 }), { owed: false, reason: null })
    })
})

describe("hatch: first light", () => {
    test("a fresh canvas waits half a second of DRAWING, not of page life", () => {
        // The old rule read the render loop's epoch clock, so a turtle seated
        // into a page that had been open for a minute hatched a blank frame.
        const drawing = { lastHatchAt: 0, firstDrawAt: 9_800, changedAt: 9_800, now: 10_000 }
        assert.deepEqual(world(drawing), { owed: true, reason: null })
        assert.deepEqual(world({ ...drawing, now: 9_800 + BEAT["first-light"] }),
                         { owed: true, reason: "first-light" })
    })

    test("owed while the floor runs — the loop may not idle out before the hatch", () => {
        const v = world({ lastHatchAt: 0, firstDrawAt: 9_990, changedAt: 9_990 })
        assert.equal(v.owed, true)
        assert.equal(v.reason, null)
    })
})

describe("hatch: alive — one glimpse per run", () => {
    // A run seated at 10_000 that is still walking.
    const running = { walking: true, changedAt: 10_000, lastHatchAt: 9_600 }

    test("the glimpse waits half a second INTO the walk, not since the last hatch", () => {
        // Measured from the seat: the first frames of a `dive`/`wait` loop are
        // nearly an empty canvas, and that is not worth sending as the snapshot.
        assert.equal(world({ ...running, now: 10_000 + BEAT.alive - 1 }).reason, null)
        assert.equal(world({ ...running, now: 10_000 + BEAT.alive }).reason, "alive")
    })

    test("a nine-thousand-step loop hatches ONCE and then holds its peace", () => {
        // The whole law: the run carries its code and one snapshot. `done` never
        // comes, and nothing re-arms while the figure walks.
        let lastHatchAt = 900            // the previous run's
        const changedAt = 1_000          // the seat, and nothing after it
        const shots = []
        for (let now = 1_000; now < 400_000; now += 16) {
            const v = hatchVerdict({
                now, present: true, mine: true, walking: true,
                changedAt, lastHatchAt, firstDrawAt: 500,
            })
            if (v.reason) { shots.push(now); lastHatchAt = now }
        }
        assert.equal(shots.length, 1, "one glimpse in six minutes of walking")
        assert.equal(shots[0] - changedAt >= BEAT.alive, true, "and it waited out the beat")
    })

    test("a busy stage does not lose the glimpse — it stays owed", () => {
        // hatch() returns false while a readback is in flight; nothing stamps
        // lastHatchAt, so the reflect stays changed and the verdict says hatch,
        // every frame, until one lands.
        assert.deepEqual(world({ ...running, now: 10_700 }), { owed: true, reason: "alive" })
    })

    test("editing while it walks re-arms the glimpse, once", () => {
        // The seat is the change; the new run gets its own single snapshot.
        const edited = { ...running, changedAt: 12_000, lastHatchAt: 10_500 }
        assert.equal(world({ ...edited, now: 12_400 }).reason, null)
        assert.equal(world({ ...edited, now: 12_500 }).reason, "alive")
    })
})

describe("hatch: settled", () => {
    test("the run's final figure lands after the settle floor", () => {
        // The end of the walk is a change (turtle.js stamps the edge), so the
        // final figure crosses even when a mid-walk glimpse already went.
        const ended = { walking: false, changedAt: 9_950, lastHatchAt: 9_900 }
        assert.equal(world({ ...ended, now: 9_900 + BEAT.settled - 1 }).reason, null)
        assert.equal(world({ ...ended, now: 9_900 + BEAT.settled }).reason, "settled")
    })

    test("a change on a long-still canvas hatches at once", () => {
        // Attention moved (D025 R4), or the keepalive came due. The floor is long past.
        assert.equal(world({ changedAt: 9_999 }).reason, "settled")
    })

    test("typing is a drumbeat of changes and not of hatches", () => {
        // A keystroke every 20ms for a second: the floor, not the keystroke, sets the beat.
        let lastHatchAt = 5_000
        let shots = 0
        for (let now = 5_000; now < 6_000; now += 20) {
            const v = hatchVerdict({
                now, present: true, mine: true, walking: false,
                changedAt: now, lastHatchAt, firstDrawAt: 1_000,
            })
            if (v.reason) { shots++; lastHatchAt = now }
        }
        assert.equal(shots, 4, "one hatch per settle floor, not one per keystroke")
    })
})
