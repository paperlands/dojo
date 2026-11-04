// The settlement fact and the live reveal clock's lifecycle constraints.
// (id:render-construction-cadence)
// Run: node --test test/js/runtime/settlement_test.mjs
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Group, Vector3 } from "../../../assets/js/utils/three-entry.js"
import { LineMaterial } from "../../../assets/js/utils/three-addons/lines/LineMaterial.js"
import { createCompositor } from "../../../assets/js/turtling/compositor.js"
import { createFocus } from "../../../assets/js/turtling/focus.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, fork, delayedResponder, settle } from "../laws/harness.mjs"

const seat = (source, config = {}) => {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild("host", fork("host", source), { fresh: true, deferStart: true })
    return scheduler
}
const tick = (scheduler, H, budget = null) => scheduler.withSlice(budget, () => scheduler.tick(H))
const drain = scheduler => { for (const frame of scheduler.registry.values()) frame.channel.drain() }

describe("isSettledThrough(H) — a fact, not a policy", () => {
    test("a future authored wait settles", () => {
        const scheduler = seat("fw 1\nwait 0.1\nfw 2")
        tick(scheduler, 0); drain(scheduler)
        assert.equal(scheduler.isSettledThrough(0), true)
    })

    test("a breath-parked construction does not settle", () => {
        const scheduler = seat("loop 8 do\n fw 1\nend\nwait 0.1", { breathEvery: 4 })
        tick(scheduler, 0, -1); drain(scheduler)
        assert.equal(scheduler.isSettledThrough(0), false)
    })

    test("a closed-but-due body does not settle (a future wait does)", () => {
        const scheduler = seat("fw 1\nwait 0.1\nfw 2")
        tick(scheduler, 0); drain(scheduler)
        assert.equal(scheduler.isSettledThrough(99), true, "before due, the wait settles")
        assert.equal(scheduler.isSettledThrough(100), false, "at due, it is an unserviced obligation")
    })

    test("a living descendant under an ended owner does not settle", () => {
        const scheduler = seat("draw r n do\n as kid do\n  fw 1\n  wait 0.1\n  loop n do\n   fw 1\n  end\n end\nend\nlet F = r 600", { breathEvery: 4 })
        tick(scheduler, 0); drain(scheduler)
        tick(scheduler, 100, -1); drain(scheduler)
        const parked = [...scheduler.registry.values()].some(frame => !frame.done && frame.suspension?.kind === "breath")
        assert.ok(parked, "a living breath-parked descendant exists")
        assert.equal(scheduler.isSettledThrough(100), false)
    })

    test("a queued derived move does not settle", () => {
        const scheduler = seat("let B\nlet A = (B.x, 0)", { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
        for (let pass = 0; pass < 50 && !scheduler.done; pass++) { tick(scheduler, 0); drain(scheduler) }
        const B = scheduler.root.children.get("host").children.get("B")
        scheduler.requestMotion(B, { rotation: SE3.identity().rotation, position: [7, 0, 0] }, scheduler.motionRevision)
        assert.equal(scheduler.isSettledThrough(0), false)
    })

    test("a retained admission does not settle, pending or ready", async () => {
        const responder = delayedResponder({ defer: Infinity })
        const scheduler = seat("fw 1", { admitAsync: responder.admit })
        tick(scheduler, 0); drain(scheduler)
        assert.equal(scheduler.isSettledThrough(0), false, "pending admission")
        const call = responder.calls[0]
        call.resolve({ accepted: true, transform: call.request.requested })
        await settle()
        assert.equal(scheduler.isSettledThrough(0), false, "ready admission is still unserviced")
    })

    test("a wholly finished tree settles", () => {
        const scheduler = seat("fw 1\nfw 2")
        for (let pass = 0; pass < 20 && !scheduler.done; pass++) { tick(scheduler, 0); drain(scheduler) }
        assert.equal(scheduler.done, true)
        assert.equal(scheduler.isSettledThrough(0), true)
    })
})

function display(source) {
    const scheduler = seat(source)
    const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
    ink._cached = true
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText: () => { throw Error("fixture has no labels") } })
    return { scheduler, compositor }
}

describe("live reveal clock — lifecycle constraints", () => {
    test("a new play resets the horizon and its elapsed baseline together", () => {
        const r = display("fw 1\nwait 0.1\nfw 2")
        r.compositor.advance(0)
        r.compositor.advance(32)
        assert.equal(r.scheduler.lastTickTime, 32, "the horizon advanced with the wall")
        r.compositor.beginPlay()
        assert.equal(r.scheduler.lastTickTime, 0, "a new play resets the horizon")
        r.compositor.advance(0)
        r.compositor.advance(16)
        assert.equal(r.scheduler.lastTickTime, 16, "the baseline restarted with it")
    })

    test("replacement within a play does not reset the shared clock", () => {
        const r = display("fw 1\nwait 0.1\nfw 2")
        r.compositor.advance(0)
        r.compositor.advance(32)
        const before = r.scheduler.lastTickTime
        r.scheduler.hotSwapChild("host", fork("host", "fw 1\nwait 0.1\nfw 2"), { fresh: false })
        assert.equal(r.scheduler.lastTickTime, before, "replacement keeps the horizon")
    })

    test("flush services the current horizon and manufactures no elapsed time", () => {
        const r = display("fw 1\nwait 0.1\nfw 2")
        r.compositor.advance(0)
        r.compositor.advance(32)
        const before = r.scheduler.lastTickTime
        r.compositor.flush()
        assert.equal(r.scheduler.lastTickTime, before, "flush does not advance the horizon")
    })

    test("the gate drains before it spends: a queued keyed build holds H", () => {
        let work = 0
        const scheduler = buildWorld({ capacity: 512, breathEvery: 4, clock: () => work,
            admit: ({ requested }) => { work++; return { accepted: true, transform: requested } } })
        scheduler.hotSwapChild("host", fork("host", "draw r n do\n loop n do\n  fw 1\n end\n wait 1\n fw 1\nend\nlet X\nlet F = r (X.x+1)"), { fresh: true, deferStart: true })
        const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
        ink._cached = true
        const compositor = createCompositor(scheduler, {
            scene, camera: { position: new Vector3(0, 0, 1000) },
            materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
        }, { focus: createFocus(scheduler), pacer: { budgetMs: 4, observe() {}, skip() {} }, createText: () => { throw Error("fixture has no labels") } })
        compositor.advance(0)
        compositor.advance(1000)
        assert.equal(scheduler.isSettledThrough(scheduler.lastTickTime), true, "the old answer settled")
        const X = scheduler.root.children.get("host").children.get("X")
        const result = scheduler.requestMotion(X, { rotation: SE3.identity().rotation, position: [12000, 0, 0] }, scheduler.motionRevision, "world")
        assert.equal(result.kind, "accept", "a new keyed question is accepted")
        assert.equal(scheduler.isSettledThrough(scheduler.lastTickTime), false, "a pending keyed build is not settled")
        const held = scheduler.lastTickTime
        compositor.advance(1016)
        assert.equal(scheduler.lastTickTime, held, "the compositor drains before the gate, so H holds over the re-seated build")
    })
})
