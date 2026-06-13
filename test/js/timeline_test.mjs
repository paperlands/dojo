// Render-clock timeline — the sequential half of the compositor's advance().
// Run with: node --test test/js/timeline_test.mjs
//
// Guards the rerun-after-idle lifecycle bug: the render-on-demand loop idles out
// when nothing changes, so the wall clock can jump between advance() calls. Left
// alone, the next advance computes a huge `now` and the scheduler fast-forwards
// the animation ("rerun starts halfway, converges to zero over 2-4 reruns").
// rebaseEpoch absorbs an idle-out gap so sim time continues from where it paused.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { rebaseEpoch, idleFloorMs } from "../../assets/js/turtling/timeline.js"

const FRAME = 1000 / 60          // 16.67ms, the vsync frame
const FLOOR = idleFloorMs(FRAME) // 1000ms idle floor

// Simulate a sequence of advance() wall timestamps, returning the sim time `now`
// the compositor would compute at each. `now` is what the scheduler ticks against.
function simulate(wallTimes) {
    let epoch = null
    let lastWallT = null
    const nows = []
    for (const t of wallTimes) {
        epoch = rebaseEpoch(epoch, lastWallT, t, FRAME, FLOOR)
        lastWallT = t
        if (epoch === null) epoch = t
        nows.push(t - epoch)
    }
    return nows
}

describe("timeline: idle floor derives from the vsync cadence", () => {
    test("floor is the RAF background-throttle (~1s), never below it", () => {
        assert.equal(idleFloorMs(1000 / 60), 1000)     // 60fps → 4 frames < 1s → clamped to 1s
        assert.equal(idleFloorMs(1000 / 30), 1000)     // 30fps → 133ms ×… still 1s floor
        assert.equal(idleFloorMs(300), 1200)           // very low refresh → 4 frames dominates
    })
})

describe("timeline: rebaseEpoch (rerun-after-idle lifecycle)", () => {
    test("first frame establishes the epoch (no rebase)", () => {
        assert.equal(rebaseEpoch(null, null, 1000, FRAME, FLOOR), null)
    })

    test("normal per-frame advance does not rebase (gap < floor)", () => {
        // 60fps cadence: each gap is one frame, far under the idle floor.
        const nows = simulate([1000, 1016, 1033, 1049])
        assert.equal(nows[0], 0)
        // sim time tracks wall time 1:1 — animation runs at real speed.
        assert.ok(Math.abs(nows[3] - 49) < 1e-9, `expected ~49, got ${nows[3]}`)
    })

    test("a slow but sub-floor frame (0.5s) is NOT treated as idle", () => {
        const nows = simulate([1000, 1500])  // 500ms gap < 1000ms floor
        assert.ok(Math.abs(nows[1] - 500) < 1e-9, "sub-floor gap passes through (real time elapsed)")
    })

    test("an idle-out gap is absorbed — sim time continues, does not fast-forward", () => {
        // Animate to now=2000, then the loop idles 30s and wakes at wall=33000.
        // Without the fix: now = 33000 - 1000 = 32000 (huge → fast-forward).
        // With the fix: the 30s idle gap is folded into epoch, so now ≈ 2000 + 1 frame.
        const nows = simulate([1000, 2000, 3000, /* idle */ 33000])
        assert.equal(nows[0], 0)
        assert.equal(nows[2], 2000)               // before idle: sim == active wall time
        const resumed = nows[3]
        assert.ok(resumed >= 2000 && resumed <= 2000 + FRAME + 1e-6,
            `resume should continue from ~2000 (+1 frame), got ${resumed}`)
    })

    test("repeated idle-outs each absorb their own gap (no drift accumulation)", () => {
        // Three idle-outs of increasing length; sim time must only ever advance by
        // the active frames + one frame of slack per resume, never by idle duration.
        const nows = simulate([0, 1000 / 60, /* idle 10s */ 10000, /* idle 60s */ 70000])
        const active = 1000 / 60
        // After two idle-outs, sim ≈ active + 2 frames of slack — bounded, tiny.
        assert.ok(nows[3] < active + 3 * FRAME,
            `sim time stayed bounded across repeated idles, got ${nows[3]}`)
    })

    test("forward progress is never frozen — one frame of slack survives each resume", () => {
        // The slack (gap - (gap - FRAME) = FRAME) guarantees the woken frame still
        // ticks once, so a resumed animation is not stalled.
        const nows = simulate([0, /* idle */ 5000])
        assert.ok(nows[1] > 0 && Math.abs(nows[1] - FRAME) < 1e-9,
            `resume advances exactly one frame, got ${nows[1]}`)
    })
})
