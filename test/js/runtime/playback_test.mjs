// The stage's one hold is a lease on ONE play, and the runtime ends it.
// (id:nav-core-sill, id:host-run-pause)
//
// The old seam let the dial's paint release the hold. A same-slot replacement or
// a new sibling then left scheduler.held true, so the successor was born paused;
// nothing but a painter could end it. These tests hold and mutate with NO paint
// and no HUD: the runtime must release on the seat edge, and a stale lease must
// not touch a successor's hold.
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createCompositor } from "../../../assets/js/turtling/compositor.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, fork } from "../laws/harness.mjs"
import { currentPlay, holdPlay, holdsPlay, playOf, releasePlay, seatOf } from "../../../assets/js/turtling/playback.js"

const stage = () => ({
    scene: {}, camera: {}, materials: new Map(),
    requestRender() {}, viewOffset: () => SE3.identity(),
})

function rig(source = "fw 10\nwait 1\nfw 5") {
    const scheduler = buildWorld()
    const compositor = createCompositor(scheduler, stage(), { focus: { kindled: null } })
    const turtle = { scheduler, compositor }
    // Exactly what Turtle._ensureScheduler wires: a seat edge re-asks the lease.
    scheduler.root._onSeatChange = () => compositor.verifyHold()
    scheduler.hotSwapChild("A", fork("A", source))
    // The meta root's own generator ends on the first tick; settle it so each test's
    // clock starts from a world with only the seat in it.
    scheduler.tick(0)
    return { turtle, scheduler, compositor }
}

const pause = (turtle) => {
    const before = playOf(turtle, "A")
    assert.ok(before, "the seat reads")
    const lease = holdPlay(turtle, before)
    assert.ok(lease != null, "a solo, unfinished play can be held")
    return { play: playOf(turtle, "A"), lease }   // the held reading names the lease
}

describe("the reading is derived, not remembered", () => {
    test("a finished play keeps its elapsed time while the tick clock moves", () => {
        const { turtle, scheduler } = rig("fw 10\nwait 0.2\nfw 5")
        scheduler.tick(0)
        scheduler.tick(200)
        assert.equal(scheduler.done, true)
        const end = playOf(turtle, "A")
        assert.equal(end.phase, "finished")

        scheduler.lastTickTime = 9000      // an idle/camera frame moved the tick clock
        scheduler.tick(9000)
        assert.equal(playOf(turtle, "A").ms, end.ms, "the settled clock survives idle work")
    })

    test("a terminal frame fault is reported; a notice is not", () => {
        const { turtle, scheduler } = rig("wait 0.1\nnope")
        scheduler.tick(0)
        scheduler.tick(100)
        assert.equal(scheduler.done, true)
        assert.equal(playOf(turtle, "A").phase, "fault")
    })

    test("a descendant's wait makes the play timed, and a sibling's does not", () => {
        const { turtle, scheduler } = rig("as Kid do\n wait 1\n fw 1\nend\nfw 5")
        assert.equal(playOf(turtle, "A").waited, true, "the root never waits; the kid does")

        scheduler.hotSwapChild("B", fork("B", "fw 1\nwait 9"))
        assert.equal(playOf(turtle, "A").waited, true, "A's own wait still counts")
    })

    test("seatOf is identity only — no live frame, no reading", () => {
        const { turtle, scheduler } = rig()
        const identity = seatOf(turtle, "A")
        assert.deepEqual(Object.keys(identity).sort(), ["id", "run"])
        assert.equal(identity.id, scheduler.root.children.get("A").id)
        assert.equal(seatOf(turtle, "gone"), null)
    })
})

describe("a scoped hold ends at the runtime's edges, with no paint", () => {
    test("the seat replacement releases before it can pause the successor", () => {
        const { turtle, scheduler } = rig()
        pause(turtle)
        assert.equal(scheduler.held, true)

        scheduler.hotSwapChild("A", fork("A", "fw 3\nwait 0.5\nfw 4"))
        assert.equal(scheduler.held, false, "a replaced play does not inherit the pause")

        scheduler.tick(10_000)
        assert.equal(scheduler.done, true, "the successor ran to its own end")
    })

    test("a second root arriving while held ends the solo play's pause", () => {
        const { turtle, scheduler } = rig()
        pause(turtle)
        scheduler.hotSwapChild("B", fork("B", "fw 1\nwait 1\nfw 2"))
        assert.equal(scheduler.held, false, "the stage is shared; one play cannot be paused alone")
    })

    test("removing the held seat releases the hold — the reachable end while held", () => {
        // A hold stops drive work, so a held play finishes through a tree change, not
        // a tick. That seat edge is the same one the runtime re-asks.
        const { turtle, scheduler } = rig()
        pause(turtle)
        scheduler.removeChild("A")
        assert.equal(scheduler.held, false)
    })

    test("disposal drops the lease", () => {
        const { turtle, scheduler, compositor } = rig()
        const { lease } = pause(turtle)
        compositor.dispose()
        assert.equal(scheduler.held, false)
        assert.equal(holdsPlay(turtle, lease), false)
    })
})

describe("release is by lease number, never by slot", () => {
    test("a stale release cannot cancel a successor's hold", () => {
        const { turtle, scheduler } = rig()
        const { lease: oldLease } = pause(turtle)
        assert.equal(releasePlay(turtle, oldLease), true)
        assert.equal(scheduler.held, false)

        scheduler.hotSwapChild("A", fork("A", "fw 2\nwait 0.3\nfw 1"))
        const { lease: newLease } = pause(turtle)
        assert.equal(releasePlay(turtle, oldLease), false, "the predecessor's receipt is dead")
        assert.equal(scheduler.held, true, "the successor keeps its own pause")
        assert.equal(holdsPlay(turtle, newLease), true)
    })

    test("a re-taken lease is a new owner; the old receipt refuses", () => {
        const { turtle, scheduler } = rig()
        const { lease: first } = pause(turtle)
        assert.equal(releasePlay(turtle, first), true)
        const { lease: second } = pause(turtle)      // same play, a NEW lease
        assert.notEqual(second, first)
        assert.equal(releasePlay(turtle, first), false, "the earlier lease is not the current one")
        assert.equal(scheduler.held, true)
    })

    test("an explicit host hold is not a scoped lease and is left alone", () => {
        const { turtle, scheduler, compositor } = rig()
        compositor.setHeld(true)         // the flag-only door (host.js)
        const play = playOf(turtle, "A")
        assert.equal(holdPlay(turtle, play), null, "one hold at a time")
        assert.equal(releasePlay(turtle, 1), false)
        assert.equal(releasePlay(turtle, null), false)
        assert.equal(scheduler.held, true, "only its owner releases a flag-only hold")
    })
})

describe("a reading must still describe the world", () => {
    test("a replacement in the same slot retires the painted reading", () => {
        const { turtle, scheduler } = rig()
        const play = playOf(turtle, "A")
        assert.equal(currentPlay(turtle, play), true)
        scheduler.hotSwapChild("A", fork("A", "fw 3\nwait 0.5"))
        assert.equal(currentPlay(turtle, play), false, "same slot is not identity")
    })

    test("a second root retires it, and A→B→A does not revive it", () => {
        const { turtle, scheduler } = rig()
        const play = playOf(turtle, "A")
        scheduler.hotSwapChild("B", fork("B", "fw 1\nwait 1"))
        assert.equal(currentPlay(turtle, play), false, "a shared stage has no single play")

        scheduler.removeChild("B")
        assert.equal(currentPlay(turtle, play), true, "alone again")
        scheduler.hotSwapChild("A", fork("A", "fw 1\nwait 1"))
        assert.equal(currentPlay(turtle, play), false, "A→B→A is a new incarnation of A")
    })

    test("a hold needs the stage to itself and an unfinished play", () => {
        const { turtle, scheduler } = rig()
        scheduler.hotSwapChild("B", fork("B", "fw 1\nwait 1"))
        assert.equal(holdPlay(turtle, playOf(turtle, "A")), null)
        assert.equal(scheduler.held, false)

        const solo = rig("fw 4")
        solo.scheduler.tick(0)
        assert.equal(solo.scheduler.done, true)
        assert.equal(holdPlay(solo.turtle, playOf(solo.turtle, "A")), null)
    })
})
