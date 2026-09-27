import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
    createArbiter, frameOf, travelFrom, wrapAngle, SPAN, DRIFT, TWIST
} from "../../../assets/js/utils/gesture.js"

// Two fingers on a horizontal line, `span` apart, centred on (cx, cy),
// rotated by `deg` about that centre.
const pinch = (span, cx = 0, cy = 0, deg = 0) => {
    const t = deg * Math.PI / 180
    const h = span / 2
    return frameOf(
        { x: cx - h * Math.cos(t), y: cy - h * Math.sin(t) },
        { x: cx + h * Math.cos(t), y: cy + h * Math.sin(t) }
    )
}

describe("wrapAngle", () => {
    test("leaves small angles alone", () => {
        assert.equal(wrapAngle(0), 0)
        assert.ok(Math.abs(wrapAngle(1) - 1) < 1e-12)
    })

    test("a twist across ±π reads as a small turn, not a full one", () => {
        // 179° -> -179° is a 2° turn, not a 358° one.
        const d = wrapAngle((-179 - 179) * Math.PI / 180)
        assert.ok(Math.abs(d * 180 / Math.PI - 2) < 1e-9, `${d * 180 / Math.PI}`)
    })
})

describe("frameOf", () => {
    test("reads span, midpoint and angle", () => {
        const f = frameOf({ x: 0, y: 0 }, { x: 100, y: 0 })
        assert.equal(f.span, 100)
        assert.equal(f.cx, 50)
        assert.equal(f.cy, 0)
        assert.equal(f.angle, 0)
    })

    test("swapping the two points flips the angle by π but not span or midpoint", () => {
        const a = { x: 10, y: 20 }, b = { x: 60, y: 20 }
        const f = frameOf(a, b), g = frameOf(b, a)
        assert.equal(f.span, g.span)
        assert.equal(f.cx, g.cx)
        assert.ok(Math.abs(Math.abs(wrapAngle(f.angle - g.angle)) - Math.PI) < 1e-12)
    })

    test("coincident fingers are a degenerate but finite frame", () => {
        const f = frameOf({ x: 5, y: 5 }, { x: 5, y: 5 })
        assert.equal(f.span, 0)
        assert.ok(Number.isFinite(f.angle))
    })
})

describe("travelFrom — one unit for all three channels", () => {
    test("twist is the ARC a finger traced, so it scales with span", () => {
        const wide = travelFrom(pinch(200), pinch(200, 0, 0, 30))
        const narrow = travelFrom(pinch(20), pinch(20, 0, 0, 30))
        // Same 30° turn: 10x the span is 10x the arc.
        assert.ok(Math.abs(wide[TWIST] / narrow[TWIST] - 10) < 1e-9)
    })

    test("coincident fingers cannot travel on twist (arc is zero)", () => {
        const t = travelFrom(pinch(0), pinch(0, 0, 0, 90))
        assert.equal(t[TWIST], 0)
    })
})

describe("createArbiter", () => {
    test("nothing wins until a channel crosses slop", () => {
        const a = createArbiter()
        a.begin(pinch(100))
        assert.equal(a.decide(pinch(105), 10), null)   // 5px of span — under slop
        assert.equal(a.decide(pinch(108), 10), null)   // 8px — still under
        assert.equal(a.decide(pinch(120), 10), SPAN)   // 20px — committed
    })

    test("exactly at slop commits", () => {
        const a = createArbiter()
        a.begin(pinch(100))
        assert.equal(a.decide(pinch(110), 10), SPAN)
    })

    test("the committed channel owns the gesture even when another overtakes it", () => {
        const a = createArbiter()
        a.begin(pinch(100))
        assert.equal(a.decide(pinch(140), 10), SPAN)
        // Now drift hugely — span still owns the gesture.
        assert.equal(a.decide(pinch(140, 500, 500), 10), SPAN)
        assert.equal(a.channel, SPAN)
    })

    test("a sloppy pinch commits to span, not drift — the bug this exists for", () => {
        const a = createArbiter()
        a.begin(pinch(200))
        // 200px of pinch against 40px of thumb drift: span must win outright.
        assert.equal(a.decide(pinch(400, 40, 40), 10), SPAN)
    })

    test("a parallel two-finger drag commits to drift", () => {
        const a = createArbiter()
        a.begin(pinch(200))
        assert.equal(a.decide(pinch(200, 60, 60), 10), DRIFT)
    })

    test("a deliberate twist commits to twist", () => {
        const a = createArbiter()
        a.begin(pinch(200))
        assert.equal(a.decide(pinch(200, 0, 0, 40), 10), TWIST)
    })

    test("fingers held still never commit", () => {
        const a = createArbiter()
        a.begin(pinch(200))
        for (let i = 0; i < 20; i++) assert.equal(a.decide(pinch(200), 10), null)
        assert.equal(a.channel, null)
    })

    test("a tie breaks span > drift > twist — fixed, never float noise", () => {
        const a = createArbiter()
        const base = frameOf({ x: 0, y: 0 }, { x: 100, y: 0 })
        a.begin(base)
        // span grows by exactly 20 (100 -> 120) and the midpoint moves by
        // exactly 20 (50 -> 70) along one axis. A true tie.
        const tie = frameOf({ x: 10, y: 0 }, { x: 130, y: 0 })
        assert.equal(travelFrom(base, tie)[SPAN], 20)
        assert.equal(travelFrom(base, tie)[DRIFT], 20)
        assert.equal(a.decide(tie, 10), SPAN)
    })

    test("begin re-arms after a gesture ends", () => {
        const a = createArbiter()
        a.begin(pinch(100))
        assert.equal(a.decide(pinch(200), 10), SPAN)
        a.begin(pinch(200))
        assert.equal(a.channel, null)
        assert.equal(a.decide(pinch(200, 60, 0), 10), DRIFT)
    })

    test("decide before begin is inert rather than throwing", () => {
        const a = createArbiter()
        assert.equal(a.decide(pinch(100), 10), null)
    })

    test("a null frame (a finger not yet tracked) is inert", () => {
        const a = createArbiter()
        a.begin(pinch(100))
        assert.equal(a.decide(null, 10), null)
    })

    test("slop is a decision parameter — raising it demands more travel", () => {
        const a = createArbiter()
        a.begin(pinch(100))
        assert.equal(a.decide(pinch(130), 50), null)   // 30px < 50
        assert.equal(a.decide(pinch(160), 50), SPAN)   // 60px > 50
    })

    test("a live slop change takes effect on the very next decision", () => {
        const a = createArbiter()
        a.begin(pinch(100))
        assert.equal(a.decide(pinch(120), 50), null)   // 20px under a loose slop
        assert.equal(a.decide(pinch(120), 10), SPAN)   // same travel, tighter slop
    })
})
