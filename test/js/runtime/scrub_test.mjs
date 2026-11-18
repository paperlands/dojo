// Forward scrub: raise the eligibility ceiling without inventing wall credit.
// The scene catches up in scheduler order; reads stay on the accepted prefix.
// Run: node --test test/js/runtime/scrub_test.mjs
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Group, Vector3 } from "../../../assets/js/utils/three-entry.js"
import { createCompositor } from "../../../assets/js/turtling/compositor.js"
import { createFocus } from "../../../assets/js/turtling/focus.js"
import { createMaterialCache } from "../../../assets/js/turtling/render/line/material-cache.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, fork } from "../laws/harness.mjs"

function display(source, config = {}, opts = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild("host", fork("host", source), { fresh: true, deferStart: true })
    const compositor = createCompositor(scheduler, {
        scene: new Group(), camera: { position: new Vector3(0, 0, 1000) },
        materials: createMaterialCache(), requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText() { throw Error("fixture has no labels") }, ...opts })
    return { scheduler, compositor }
}

describe("forward scrub — a ceiling, not a world jump", () => {
    test("raises the ceiling and services the target without wall credit", () => {
        const r = display("fw 1\nwait 1\nfw 1")
        r.compositor.advance(0)
        r.compositor.advance(40)
        assert.equal(r.scheduler.lastTickTime, 40)
        assert.equal(r.compositor.scrubTo(1000), true)
        assert.equal(r.scheduler.lastTickTime, 1000)
        r.compositor.flush()
        assert.equal(r.scheduler.done, true, "the target instant is serviced")
        r.compositor.advance(56)
        assert.equal(r.scheduler.lastTickTime, 1000, "the frame after a scrub takes no wall credit")
        r.compositor.advance(72)
        assert.equal(r.scheduler.lastTickTime, 1016, "wall credit resumes after the target")
        r.compositor.dispose()
    })

    test("refuses equal, backward, and non-finite targets", () => {
        const r = display("fw 1\nwait 1\nfw 1")
        r.compositor.advance(0)
        r.compositor.advance(40)
        assert.equal(r.compositor.scrubTo(1000), true)
        assert.equal(r.compositor.scrubTo(1000), false)
        assert.equal(r.compositor.scrubTo(999), false)
        assert.equal(r.compositor.scrubTo(NaN), false)
        assert.equal(r.compositor.scrubTo(Infinity), false)
        assert.equal(r.scheduler.lastTickTime, 1000)
        r.compositor.dispose()
    })

    test("while held it moves the promise, not the scene", () => {
        const r = display("fw 1\nwait 1\nfw 1")
        r.compositor.advance(0)
        r.compositor.advance(40)
        assert.equal(r.compositor.setHeld(true), true)
        assert.equal(r.compositor.scrubTo(1000), true)
        r.compositor.flush()
        assert.equal(r.scheduler.lastTickTime, 1000, "the cue moved")
        assert.equal(r.scheduler.done, false, "the scene did not")
        assert.equal(r.compositor.setHeld(false), true)
        r.compositor.advance(56)
        assert.equal(r.scheduler.done, true, "the scene catches up on resume")
        assert.equal(r.scheduler.lastTickTime, 1000)
        r.compositor.dispose()
    })

    test("a scrub from inside the pump is refused", () => {
        const r = display("fw 1\nwait 0.05\nfw 1\nwait 0.1\nfw 1")
        r.compositor.advance(0)
        r.compositor.advance(40)
        let seen
        const orig = r.scheduler.tick
        r.scheduler.tick = function (now) {
            const out = orig.call(this, now)
            if (seen === undefined) seen = r.compositor.scrubTo(1000)
            return out
        }
        r.compositor.advance(56)
        r.scheduler.tick = orig
        assert.equal(seen, false, "the pump owns the pass")
        assert.equal(r.scheduler.lastTickTime, 56, "the mirror is not corrupted")
        r.compositor.dispose()
    })

    test("a nested flush cannot clear the parent's phase", () => {
        const r = display("let B\nlet A = (B.x, 0)\nwait 1\nfw 1", {
            admit: ({ requested }) => ({ accepted: true, transform: requested }),
        })
        r.compositor.advance(0)
        const B = r.scheduler.root.children.get("host").children.get("B")
        r.scheduler.requestMotion(B, { rotation: SE3.identity().rotation, position: [7, 0, 0] }, r.scheduler.motionRevision)
        let first, second
        const off = r.scheduler.onAcceptedChange(() => {
            if (first !== undefined) return
            first = r.compositor.scrubTo(1000)
            r.compositor.flush()
            second = r.compositor.scrubTo(1000)
        })
        r.compositor.advance(56)
        off()
        assert.equal(first, false, "the parent pump owns the phase")
        assert.equal(second, false, "the nested drive restored the parent phase")
        r.compositor.advance(72)
        assert.notEqual(r.scheduler.lastTickTime, 1000, "a refused raise does not surface on the next frame")
        r.compositor.dispose()
    })

    test("a scrub between frames does not change pacing", () => {
        const observed = []
        const r = display("fw 1\nwait 1\nfw 1", {}, { pacer: { budgetMs: 4, observe: n => observed.push(n), skip() {} } })
        r.compositor.advance(0)
        r.compositor.advance(16)
        assert.deepEqual(observed, [16])
        r.compositor.scrubTo(1000)
        r.compositor.advance(32)
        assert.deepEqual(observed, [16, 16], "the jump is not a frame")
        r.compositor.dispose()
    })

    test("a read during catch-up sees the accepted prefix", () => {
        const r = display("let B\nlet A = (B.x, 0)\nwait 0.1\nfw 1", {
            admit: ({ requested }) => ({ accepted: true, transform: requested }),
        })
        r.compositor.advance(0)
        const B = r.scheduler.root.children.get("host").children.get("B")
        assert.ok(B, "B seated")
        const queued = r.scheduler.requestMotion(B, { rotation: SE3.identity().rotation, position: [7, 0, 0] }, r.scheduler.motionRevision)
        assert.equal(queued.kind, "accept")
        assert.equal(r.scheduler.isSettledThrough(0), false, "a queued derived move unsettles")
        assert.equal(r.compositor.scrubTo(1000), true)
        const before = r.scheduler.readPlace(["host", "A"], "position", "host")
        r.compositor.flush()
        const after = r.scheduler.readPlace(["host", "A"], "position", "host")
        assert.deepEqual(before, { kind: "value", value: [0, 0, 0] }, "inspection is the scene, not the cue")
        assert.deepEqual(after, { kind: "value", value: [7, 0, 0] }, "service commits the target")
        r.compositor.dispose()
    })
})
