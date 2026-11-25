// probe-status: active
// The native source catch: eligibility without moving H, one emitted instant at a
// time, owned beats, settle before observers, caller-owned lease. (id:nav-core-sill)
import { test } from "node:test"
import assert from "node:assert/strict"
import { Group, Vector3 } from "../../../assets/js/utils/three-entry.js"
import { createCompositor } from "../../../assets/js/turtling/compositor.js"
import { createMaterialCache } from "../../../assets/js/turtling/render/line/material-cache.js"
import { createFocus } from "../../../assets/js/turtling/focus.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, fork } from "../laws/harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { catchSite, createPlayCatch } from "../../../assets/js/turtling/catch.js"
import { holdPlay, playOf, releasePlay } from "../../../assets/js/turtling/playback.js"

const world = (f) => frameWorldTransform(f).position.map((n) => Math.round(n * 1e6) / 1e6)

function rig(source, opts = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...opts })
    const compositor = createCompositor(scheduler, {
        scene: new Group(), camera: { position: new Vector3(0, 0, 1000) },
        materials: createMaterialCache(), requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText: () => { throw Error("no labels") } })
    scheduler.hotSwapChild("host", fork("host", source), { fresh: true, deferStart: true })
    return { scheduler, compositor, turtle: { scheduler, compositor } }
}
const stepTo = (r, from, to) => { for (let t = from + 10; t <= to; t += 10) r.compositor.advance(t); return to }
const seat = (scheduler) => scheduler.root.children.get("host")

test("eligibility limits the frontier, not H or the pump clock", () => {
    const r = rig("fw 1\nwait 0.1\nfw 2")
    r.scheduler.tick(0, 0)                   // the birth instant at eligibility 0
    assert.deepEqual(world(seat(r.scheduler)), [1, 0, 0])
    r.scheduler.tick(600, 0)                 // H is 600, eligibility 0: nothing due
    assert.equal(r.scheduler.lastTickTime, 600, "H stays")
    assert.deepEqual(world(seat(r.scheduler)), [1, 0, 0])
    assert.equal(seat(r.scheduler).resumeAt, 100)
    r.scheduler.tick(600, 100)               // eligibility reaches the wait
    assert.deepEqual(world(seat(r.scheduler)), [3, 0, 0])
    assert.equal(r.scheduler.lastTickTime, 600, "H is unchanged by eligibility")
})

test("a breakpoint stops BEFORE the selected statement and resumes past it once", () => {
    const r = rig("wait 1\nrt 90\nfw 100")
    let receipt = null
    const catcher = createPlayCatch(r.turtle, {
        seat: "host", line: 2,
        hold: () => (receipt = holdPlay(r.turtle, playOf(r.turtle, "host"), () => true)),
        release: (lease) => releasePlay(r.turtle, lease),
    })
    r.compositor.advance(0)
    assert.equal(catcher.arm().state, "armed")
    stepTo(r, 0, 1500)
    const hit = catcher.read()
    assert.equal(hit.state, "hit")
    assert.equal(hit.instant, 1000, "the instant the wait ends")
    assert.equal(hit.authorizedH, 1000, "H stopped at the caught instant")
    assert.equal(hit.held, true)
    assert.equal(hit.receipt, receipt)
    assert.deepEqual(world(seat(r.scheduler)), [0, 0, 0], "rt 90 has not run")
    assert.equal(seat(r.scheduler).transform.deref().rotation.w, 1, "the turn did not execute")
    assert.equal(r.scheduler.done, false, "the same-instant suffix did not run")

    catcher.cancel()
    assert.equal(catcher.read().state, "cancelled")
    stepTo(r, 1500, 2000)
    assert.equal(r.scheduler.done, true)
    assert.deepEqual(world(seat(r.scheduler)), [0, -100, 0], "the uninterrupted suffix ran once")
})

test("a zero-wait suffix stays unrun until the breakpoint lifts", () => {
    const r = rig("fw 1\nwait 0\nfw 2\nwait 0\nfw 3\nwait 1")
    const catcher = createPlayCatch(r.turtle, {
        seat: "host", line: 3,
        hold: () => holdPlay(r.turtle, playOf(r.turtle, "host"), () => true),
        release: (lease) => releasePlay(r.turtle, lease),
    })
    assert.equal(catcher.arm().state, "armed")
    stepTo(r, 0, 600)
    const read = catcher.read()
    assert.equal(read.state, "hit")
    assert.equal(read.instant, 0)
    assert.equal(read.held, true)
    assert.deepEqual(world(seat(r.scheduler)), [1, 0, 0], "fw 2 has not run")
    assert.equal(r.scheduler.done, false)
    catcher.cancel()
    stepTo(r, 600, 2600)
    assert.equal(r.scheduler.done, true)
    assert.deepEqual(world(seat(r.scheduler)), [6, 0, 0])
})

test("arm refuses a manually held play; cancel never releases a foreign hold", () => {
    const r = rig("fw 1\nwait 0.1\nfw 2")
    r.compositor.advance(0)
    r.compositor.setHeld(true)
    const catcher = createPlayCatch(r.turtle, { seat: "host", line: 1, hold: () => 1, release: () => true })
    assert.equal(catcher.arm().state, "paused")
    catcher.cancel()
    assert.equal(r.compositor.held, true, "the manual hold is untouched")
})

test("a replaced seat makes the catch stale and releases nothing it never took", () => {
    const r = rig("fw 1\nwait 0.1\nfw 2")
    const catcher = createPlayCatch(r.turtle, { seat: "host", line: 1, hold: () => 7, release: () => true })
    r.compositor.advance(0)
    catcher.arm()
    const old = seat(r.scheduler)
    r.scheduler.hotSwapChild("host", fork("host", "fw 5\nwait 0.1\nfw 6"), { fresh: true })
    r.compositor.advance(0)
    const read = catcher.read()
    assert.equal(read.state, "stale")
    assert.equal(read.held, false)
    assert.notEqual(seat(r.scheduler).id, old.id)
})

test("below the target instant nothing runs: no fast-forward past H", () => {
    const r = rig("fw 1\nwait 0.1\nfw 2")
    let leased = 0
    const catcher = createPlayCatch(r.turtle, { seat: "host", line: 3, hold: () => ++leased, release: () => true })
    r.compositor.advance(0)
    assert.equal(catcher.arm().state, "armed")
    assert.equal(catcher.read().instant, null)
    r.compositor.advance(0)
    assert.equal(catcher.read().state, "armed")
    assert.deepEqual(world(seat(r.scheduler)), [1, 0, 0], "the target wait did not run")
    assert.equal(seat(r.scheduler).resumeAt, 100)
    r.compositor.advance(50)
    assert.equal(catcher.read().state, "armed")
    assert.deepEqual(world(seat(r.scheduler)), [1, 0, 0], "still no fast-forward")
    assert.equal(r.scheduler.lastTickTime, 50)
    r.compositor.advance(100)
    const hit = catcher.read()
    assert.equal(hit.state, "hit")
    assert.equal(hit.instant, 100)
    assert.deepEqual(world(seat(r.scheduler)), [1, 0, 0], "fw 2 has not run")
    catcher.cancel()
})

test("the same loop site catches at two distinct instants", () => {
    const r = rig("let B\nloop 2 do\n fw 1\n wait 0.1\nend")
    const catcher = createPlayCatch(r.turtle, {
        seat: "host", line: 3,
        hold: () => holdPlay(r.turtle, playOf(r.turtle, "host"), () => true),
        release: (lease) => releasePlay(r.turtle, lease),
    })
    assert.equal(catcher.arm().state, "armed")
    r.compositor.advance(0)
    const first = catcher.read()
    assert.equal(first.state, "hit")
    assert.equal(first.instant, 0, "first iteration")
    assert.deepEqual(world(seat(r.scheduler)), [0, 0, 0], "the first fw has not run")
    catcher.cancel()
    assert.equal(catcher.arm().state, "armed")
    stepTo(r, 0, 300)
    const second = catcher.read()
    assert.equal(second.state, "hit")
    assert.equal(second.instant, 100, "second iteration")
    assert.deepEqual(world(seat(r.scheduler)), [1, 0, 0], "only the first iteration ran")
    catcher.cancel()
})

test("done without a lease detaches instead of staying falsely caught", () => {
    const r = rig("fw 1\nwait 0.1\nfw 2\nwait 0.1\nfw 3")
    const catcher = createPlayCatch(r.turtle, { seat: "host", line: 3, hold: () => null, release: () => true })
    r.compositor.advance(0)
    catcher.arm()
    r.compositor.advance(600)
    assert.equal(catcher.read().state, "waiting-hold")
    r.scheduler.removeChild("host")                  // the world ends with no lease
    r.compositor.advance(600)
    const read = catcher.read()
    assert.equal(read.held, false)
    assert.notEqual(read.state, "hit")
    assert.notEqual(read.state, "waiting")
})

test("a walked statement line is a supported site; a blank line is not", () => {
    const r = rig("let B\nfw 1\nwait 0.1\nfw 2")
    const catcher = createPlayCatch(r.turtle, { seat: "host", line: 1, hold: () => 1, release: () => true })
    assert.equal(catcher.arm().state, "armed", "a declaration is walked in this frame")
    catcher.cancel()
    assert.deepEqual(catchSite(r.turtle, "host", 1)?.line, 1)
    assert.equal(catchSite(r.turtle, "host", 9), null)
})

test("a wait line catches before its duration is spent", () => {
    const r = rig("fw 1\nwait 0.1\nfw 2")
    assert.deepEqual(catchSite(r.turtle, "host", 2), { line: 2, type: "Call" }, "a wait is an executable site")
    let receipt = null
    const catcher = createPlayCatch(r.turtle, {
        seat: "host", line: 2,
        hold: () => (receipt = holdPlay(r.turtle, playOf(r.turtle, "host"), () => true)),
        release: (lease) => releasePlay(r.turtle, lease),
    })
    assert.equal(catcher.arm().state, "armed")
    r.compositor.advance(0)
    const read = catcher.read()
    assert.equal(read.state, "hit")
    assert.equal(read.held, true)
    assert.equal(read.receipt, receipt)
    assert.equal(seat(r.scheduler).elapsedTime, 0, "the wait itself has not elapsed")
    assert.equal(seat(r.scheduler).resumeAt, 0, "the wait has not even been entered")
})
