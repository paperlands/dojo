// Display work is bounded by the scheduler's time slice, not a second tick count.
// (id:render-construction-cadence)
import { test } from "node:test"
import assert from "node:assert/strict"
import { createCompositor } from "../../../assets/js/turtling/compositor.js"
import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, fork, deps } from "../laws/harness.mjs"

function rig({ finish = 140, expire = Infinity, stalled = false, building = true, atCut = true } = {}) {
    let ticks = 0
    const scheduler = {
        root: { children: new Map() }, registry: new Map(), lastTickTime: 0,
        readouts: { drain() {} },
        get done() { return ticks >= finish },
        get building() { return building && !this.done },
        // The display-cut reader: `false` = the world is mid-instant, so a spent
        // slice is not a place to let go. (id:render-construction-cadence)
        get atCut() { return atCut },
        // Settlement through H, mocked as always settled for the budget rig.
        isSettledThrough() { return true },
        tick() { if (this.done) return false; ticks++; return !stalled },
        withSlice(_ms, drive) { return drive(() => ticks >= expire) },
    }
    const compositor = createCompositor(scheduler, {
        scene: {}, camera: {}, materials: new Map(), requestRender() {},
        viewOffset: () => SE3.identity(),
    }, { focus: { kindled: null } })
    return { compositor, ticks: () => ticks }
}

test("one display frame can complete more than 64 admission ticks when time remains", () => {
    const r = rig()
    r.compositor.advance(0)
    assert.equal(r.ticks(), 140)
})

test("display pumping stops at the scheduler's slice once the world is at a display cut", () => {
    const r = rig({ expire: 9, atCut: true })
    r.compositor.advance(0)
    assert.equal(r.ticks(), 9)
})

test('a spent slice does not cut a value in half: the pump crosses it to the cut', () => {
    // Mid-instant (atCut false) every tick progresses but nothing is whole to show,
    // so the deadline is not a place to let go. The ceiling still bounds an instant
    // that never closes. (id:render-construction-cadence-wait-regression)
    const r = rig({ expire: 9, atCut: false })
    r.compositor.advance(0)
    assert.ok(r.ticks() > 9, 'a half-built value is finished, not cut at the spent slice')
    assert.ok(r.ticks() <= 9 + 64, 'the MAX_OVERRUN_TICKS ceiling still bounds an endless instant')
})

test("flush does not mistake a synchronous admission park for spent time", () => {
    const r = rig()
    assert.equal(r.compositor.flush(), true)
    assert.equal(r.ticks(), 140)
})

test("a stalled pump with no output does not spin until its deadline", () => {
    const r = rig({ stalled: true })
    r.compositor.advance(0)
    assert.equal(r.ticks(), 1)
})

test("the slice guard reads the scheduler's clock and closes with the slice", () => {
    let now = 10
    const scheduler = createScheduler(metaRoot(), { clock: () => now })
    let spent
    scheduler.withSlice(5, (outOfTime) => {
        assert.equal(typeof outOfTime, "function")
        spent = outOfTime
        assert.equal(spent(), false)
        now = 16
        assert.equal(spent(), true)
    })
    assert.equal(spent(), false, "no expired deadline escapes the slice")
})

test("closed synchronous drawing consumes replies inline; an open process still parks", () => {
    for (const closed of [true, false]) {
        const scheduler = buildWorld({ capacity: 512, admit: r => ({ accepted: true, transform: r.requested }) })
        const src = closed ? "let F = fw 10" : "let F\nas F do\n fw 10\nend"
        const host = scheduler.hotSwapChild("host", fork("host", src))
        const frame = host.children.get("F")
        assert.ok(frame)
        assert.equal(frame.done, closed)
        if (!closed) assert.equal(frame.suspension.kind, "admission")
    }
})

test("inline construction motion retains the admission gate", () => {
    let called = 0
    const scheduler = buildWorld({ admit: () => { called++; return { accepted: false } } })
    const host = scheduler.hotSwapChild("host", fork("host", "let F = fw 10"))
    const frame = host.children.get("F")
    assert.equal(called, 1)
    assert.equal(frame.done, true)
    assert.deepEqual(frame.transform.deref().position, [0, 0, 0])
    assert.equal(frame.channel.drain().some(e => e.type === "path"), false)
})

test("inline construction replies still yield when the reduction breath spends its slice", () => {
    let now = 0, calls = 0
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps, clock: () => now, execOpts: { breathEvery: 1 },
        motionAdmission: r => {
            if (++calls === 3) now = 2
            return { accepted: true, transform: r.requested }
        },
    })
    let host
    scheduler.withSlice(1, () => {
        host = scheduler.hotSwapChild("host", fork("host",
            "draw r n do\n loop n do\n  fw 1\n end\nend\nlet F = r 1000"))
    })
    const frame = host.children.get("F")
    assert.equal(frame.done, false)
    assert.equal(frame.suspension.kind, "breath")
    assert.ok(calls >= 3 && calls < 1000, "a breath stops a still-unfinished construction")
    scheduler.withSlice(1000, () => { while (!scheduler.done) scheduler.tick(0) })
    assert.equal(frame.done, true)
    assert.equal(calls, 1000)
})
