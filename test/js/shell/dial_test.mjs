// The shell's dial commands: authority epoch + the one lease this surface took.
// (id:nav-core-sill, id:host-run-pause)
//
// A painted command is not authority. These tests drive the shell seam with a real
// scheduler/compositor and NO DOM: stale views must not reset the world, release a
// successor's hold, or outlive the surface that painted them.
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createCompositor } from "../../../assets/js/turtling/compositor.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, fork } from "../laws/harness.mjs"
import { holdsPlay } from "../../../assets/js/turtling/playback.js"
import { createDial } from "../../../assets/js/hooks/shell/dial.js"

const stage = () => ({
    scene: {}, camera: {}, materials: new Map(),
    requestRender() {}, viewOffset: () => SE3.identity(),
})

function rig(source = "fw 10\nwait 1\nfw 5") {
    const scheduler = buildWorld()
    const compositor = createCompositor(scheduler, stage(), { focus: { kindled: null } })
    const turtle = { scheduler, compositor }
    scheduler.root._onSeatChange = () => compositor.verifyHold()
    scheduler.hotSwapChild("A", fork("A", source))
    scheduler.tick(0)
    return { turtle, scheduler, compositor }
}

// The shell's standing rule and recipe, in their smallest testable form.
function dialFor(rig, over = {}) {
    const state = { allowed: true, reseats: 0, acts: 0 }
    const dial = createDial(rig.turtle, {
        seat: () => ({ slot: "A" }),
        authority: () => state.allowed,
        prepareReplay: () => () => { state.reseats++; return true },
        acted: () => { state.acts++ },
        ...over,
    })
    return { dial, state }
}

describe("a pause is this surface's lease, not a global flag", () => {
    test("pause takes it, resume releases exactly that lease", () => {
        const r = rig()
        const { dial } = dialFor(r)
        const reading = dial.read()
        assert.equal(reading.phase, "running")
        assert.equal(reading.pause(), true)
        assert.equal(r.scheduler.held, true)

        const paused = dial.read()
        assert.equal(paused.phase, "paused")
        assert.equal(paused.resume(), true)
        assert.equal(r.scheduler.held, false)
    })

    test("a re-taken lease is a new owner; an older paint cannot release it", () => {
        const r = rig()
        const { dial } = dialFor(r)
        assert.equal(dial.read().pause(), true)     // lease 1
        const painted = dial.read()                 // carries lease 1
        assert.equal(dial.read().resume(), true)
        assert.equal(dial.read().pause(), true)     // lease 2, same play

        assert.equal(painted.resume(), false, "the earlier paint holds a dead lease")
        assert.equal(r.scheduler.held, true)
    })

    test("a captured resume for A cannot release B, even in the same epoch", () => {
        const r = rig()
        const { dial } = dialFor(r)
        assert.equal(dial.read().pause(), true)
        const paintedA = dial.read()

        r.scheduler.hotSwapChild("A", fork("A", "fw 2\nwait 1\n fw 3"))
        assert.equal(dial.read().pause(), true)     // B's lease
        assert.equal(paintedA.resume(), false)
        assert.equal(r.scheduler.held, true, "B keeps its own pause")
    })

    test("a foreign (flag-only) hold is neither resumed nor replayed over", () => {
        const r = rig()
        const { dial, state } = dialFor(r)
        r.compositor.setHeld(true)       // an explicit stage/host user
        const reading = dial.read()
        assert.equal(reading.resume(), false)
        assert.equal(reading.replay(), false, "a fresh play would clear that hold")
        assert.equal(state.reseats, 0)
        assert.equal(r.scheduler.held, true)
    })
})

describe("an authority edge ends every painted command", () => {
    test("ended() releases this surface's pause and retires the reading", () => {
        const r = rig()
        const { dial } = dialFor(r)
        const reading = dial.read()
        assert.equal(reading.pause(), true)

        dial.ended()
        assert.equal(r.scheduler.held, false)
        assert.equal(reading.resume(), false, "the epoch moved")
        assert.equal(reading.replay(), false)
    })

    test("A→B→A in the same frame cannot revive an old reading", () => {
        const r = rig()
        const { dial, state } = dialFor(r)
        const painted = dial.read()
        dial.ended()                      // claim/buffer changed…
        dial.ended()                      // …and came back; the frame never moved
        assert.equal(painted.replay(), false)
        assert.equal(painted.pause(), false)
        assert.equal(state.reseats, 0)
        assert.equal(r.scheduler.held, false)
    })

    test("a stale ending cannot drop a lease taken after it", () => {
        const r = rig()
        const { dial } = dialFor(r)
        const first = dial.read()
        first.pause()
        dial.ended()
        const second = dial.read()
        assert.equal(second.pause(), true)
        const secondLease = r.compositor.holdOwner.id

        first.resume()                    // a captured predecessor command
        assert.equal(r.scheduler.held, true, "the successor's lease survives")
        assert.equal(holdsPlay(r.turtle, secondLease), true)
    })
})

describe("a replay is admitted by the current world", () => {
    test("a grant retired during preparation refuses before seating", () => {
        const r = rig()
        let commits = 0
        const { dial } = dialFor(r, {
            prepareReplay: () => {
                dial.ended()
                return () => { commits++; return true }
            },
        })
        assert.equal(dial.read().replay(), false)
        assert.equal(commits, 0)
    })
    test("a same-slot replacement refuses the painted view before any reset", () => {
        const r = rig()
        const { dial, state } = dialFor(r)
        const painted = dial.read()

        r.scheduler.hotSwapChild("A", fork("A", "fw 3\nwait 0.5"))
        const clock = r.scheduler.lastTickTime
        assert.equal(painted.replay(), false)
        assert.equal(state.reseats, 0, "no fresh play ran")
        assert.equal(r.scheduler.lastTickTime, clock, "the shared clock did not reset")
    })

    test("a second root refuses it without touching the stage", () => {
        const r = rig()
        const { dial, state } = dialFor(r)
        const painted = dial.read()
        r.scheduler.hotSwapChild("B", fork("B", "fw 1\nwait 1"))
        assert.equal(painted.replay(), false)
        assert.equal(state.reseats, 0)
    })

    test("restart from held seats a new play at 0 and holds it again", () => {
        const r = rig()
        let reseats = 0
        const { dial } = dialFor(r, {
            prepareReplay: () => () => {
                reseats++
                r.compositor.beginPlay()  // the fresh-play door: horizon and holds reset
                r.scheduler.hotSwapChild("A", fork("A", "fw 1\nwait 1\nfw 2"))
                return true
            },
        })
        const painted = dial.read()
        assert.equal(painted.pause(), true)
        const paused = dial.read()
        assert.equal(paused.replay(), true)
        assert.equal(reseats, 1)
        assert.equal(r.scheduler.lastTickTime, 0, "the new play starts at the axis origin")
        assert.equal(r.scheduler.held, true, "explicit restart kept the pause")
    })

    test("an ordinary replacement never inherits the pause", () => {
        const r = rig()
        const { dial } = dialFor(r)
        const painted = dial.read()
        assert.equal(painted.pause(), true)
        r.scheduler.hotSwapChild("A", fork("A", "fw 1\nwait 1"))
        assert.equal(r.scheduler.held, false)
        assert.equal(painted.replay(), false)
    })
})

describe("teardown closes the controller", () => {
    test("close() retires reads and the lease", () => {
        const r = rig()
        const { dial } = dialFor(r)
        const painted = dial.read()
        assert.equal(painted.pause(), true)
        dial.close()
        assert.equal(r.scheduler.held, false)
        assert.equal(dial.read(), null, "no new controls after teardown")
        assert.equal(painted.resume(), false)
    })
})
