// The settlement fact and the live reveal clock's lifecycle constraints.
// (id:render-construction-cadence)
// Run: node --test test/js/runtime/settlement_test.mjs
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Group, Vector3 } from "../../../assets/js/utils/three-entry.js"
import { LineMaterial } from "../../../assets/js/utils/three-addons/lines/LineMaterial.js"
import { createCompositor } from "../../../assets/js/turtling/compositor.js"
import { createMaterialCache } from "../../../assets/js/turtling/render/line/material-cache.js"
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

function display(source, config, opts) {
    const scheduler = seat(source, config)
    const scene = new Group()
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: createMaterialCache(), requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText: () => { throw Error("fixture has no labels") }, ...opts })
    return { scheduler, compositor, scene }
}

test("nested work scopes restore an expired caller even on a throw", () => {
    let now = 0
    const scheduler = seat("fw 1\nwait 0.1", { clock: () => now })
    const boom = new Error("nested probe")
    let checkOuter, observed
    const off = scheduler.onAcceptedChange(() => {
        now = 2
        const before = checkOuter()
        const inner = scheduler.withSlice(8, expired => expired())
        const after = checkOuter()
        let caught
        try { scheduler.withSlice(null, () => { throw boom }) } catch (error) { caught = error }
        observed = { before, inner, after, afterThrow: checkOuter(), caught }
    })
    scheduler.withSlice(1, expired => {
        checkOuter = expired
        scheduler.tick(0)
    })
    off()
    assert.deepEqual(observed, { before: true, inner: false, after: true, afterThrow: true, caught: boom })
    assert.equal(checkOuter(), false, "outermost exit restores unpaced mode")
})
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

    test("a hold stops due work in frames and flushes, not just future waits", () => {
        let work = 0
        const { scheduler, compositor, scene } = display("loop 100 do\n fw 1\nend", {
            clock: () => work, admit: ({ requested }) => { work++; return { accepted: true, transform: requested } },
        }, { pacer: { budgetMs: 2, observe() {}, skip() {} } })
        const inkCount = () => {
            let n = 0
            scene.traverse(node => { n += node.geometry?.instanceCount ?? 0 })
            return n
        }
        compositor.advance(1000)
        assert.ok(work > 0 && !scheduler.done, "the fixture has sliced work due at H")
        const before = [work, inkCount()]
        assert.equal(compositor.setHeld(true), true)
        assert.equal(compositor.setHeld(true), false)
        compositor.advance(1100)
        compositor.flush()
        assert.deepEqual([work, inkCount()], before)
        assert.equal(scheduler.lastTickTime, 0)
        assert.equal(compositor.setHeld(false), true)
        assert.equal(compositor.setHeld(false), false)
        compositor.advance(1200)
        assert.ok(work > before[0], "due work is permitted again")
        assert.equal(scheduler.lastTickTime, 0)
        for (let i = 1; i <= 100 && !scheduler.done; i++) compositor.advance(1200 + i * 16)
        assert.equal(scheduler.done, true)
        assert.ok(inkCount() > before[1], "the resumed program adds ink")
    })

    test("a partly elapsed wait survives both sleeping and rendering during a hold", () => {
        for (const frames of [[], [60, 2060]]) {
            const observed = []
            const { scheduler, compositor } = display("fw 1\nwait 0.1\nfw 2", {}, {
                pacer: { budgetMs: 4, observe: n => observed.push(n), skip() {} },
            })
            compositor.advance(0)
            compositor.advance(40)
            compositor.setHeld(true)
            for (const t of frames) {
                compositor.advance(t)
                assert.equal(scheduler.lastTickTime, 40)
                assert.equal(scheduler.done, false)
            }
            const resumeAt = frames.length ? 4080 : 640
            compositor.setHeld(false)
            compositor.advance(resumeAt)
            assert.equal(scheduler.lastTickTime, 40)
            assert.equal(scheduler.done, false)
            assert.deepEqual(observed, [40])
            compositor.advance(resumeAt + 59)
            assert.equal(scheduler.done, false)
            compositor.advance(resumeAt + 60)
            assert.equal(scheduler.lastTickTime, 100)
            assert.equal(scheduler.done, true)
        }
    })

    test("explicit hand input and its derived arrow remain live while the play is held", () => {
        const { scheduler, compositor } = display("let B\nlet V = [80, B.x, 0]\nwait 0.1\nfw 1")
        compositor.advance(0)
        compositor.advance(40)
        const tip = () => compositor.vectorNames().find(({ name }) => name === "V")?.to
        assert.deepEqual(tip(), [80, 0, 0])
        compositor.setHeld(true)
        const move = scheduler.proposePlace(["host", "B"], [7, 0, 0], scheduler.motionRevision)
        assert.equal(move.kind, "accept")
        compositor.advance(160)
        assert.deepEqual(tip(), [80, 7, 0])
        assert.equal(scheduler.lastTickTime, 40)
        assert.equal(scheduler.done, false)
    })

    test("a component reply cannot publish from its microtask while held", async () => {
        const responder = delayedResponder()
        const { scheduler, compositor } = display("let B\nfw 1", { admitAsync: responder.admit })
        compositor.advance(0)
        const frame = scheduler.root.children.get("host")
        const B = frame.children.get("B")
        const call = responder.calls[0]
        const revision = scheduler.motionRevision
        const pendingSeq = frame.suspension.seq
        compositor.setHeld(true)
        call.resolve({ accepted: true, transform: call.request.requested,
            component: [{ frame: B, transform: { ...SE3.identity(), position: [7, 0, 0] } }] })
        await settle()
        const { reply, verdict } = frame.suspension
        assert.equal(verdict, null, "an offered reply has not been admitted")
        assert.equal(frame.suspension.seq, pendingSeq + 1)
        assert.equal(reply.verdict.kind, "accept")
        assert.equal(reply.attempt.writer, frame, "keep the exact writer")
        assert.equal(reply.verdict.component[0].frame, B, "keep the exact participant")
        assert.equal(Object.values(frame.suspension).some(value => typeof value === "function"), false)
        assert.equal(B.transform.deref().position[0], 0, "a reply cannot commit outside the frame pump")
        assert.equal(scheduler.motionRevision, revision)
        compositor.advance(120)
        compositor.flush()
        assert.equal(scheduler.done, false)
        compositor.setHeld(false)
        compositor.advance(136)
        assert.equal(frame.transform.deref().position[0], 1)
        assert.equal(B.transform.deref().position[0], 7)
        assert.equal(scheduler.motionRevision, revision + 1)
        assert.equal(frame.motionSeq, pendingSeq + 2)
        assert.equal(frame.suspension, null, "the admitted verdict was consumed on the same turn")
        assert.equal(scheduler.done, true)
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

    // The sample is measured before the drain; a reset edge during the drain must
    // revoke it. Both interleavings are injected at the real drain seam.
    // (id:runtime-state-tla)
    test("a hold edge inside the drain revokes the in-flight sample", () => {
        const r = display("fw 1\nwait 1\nfw 1")
        r.compositor.advance(0)
        r.compositor.advance(40)
        assert.equal(r.scheduler.lastTickTime, 40)
        const drain = r.scheduler.readouts.drain
        r.scheduler.readouts.drain = (...args) => {
            r.scheduler.readouts.drain = drain
            assert.equal(r.compositor.setHeld(true), true)
            assert.equal(r.compositor.setHeld(false), true)
            return drain(...args)
        }
        r.compositor.advance(60)
        assert.equal(r.scheduler.lastTickTime, 40, "a pause/resume pair does not license the stale allowance")
    })

    test("a new play inside the drain revokes the in-flight sample", () => {
        const r = display("fw 1\nwait 1\nfw 1")
        r.compositor.advance(0)
        r.compositor.advance(40)
        const drain = r.scheduler.readouts.drain
        r.scheduler.readouts.drain = (...args) => {
            r.scheduler.readouts.drain = drain
            r.compositor.beginPlay()
            r.scheduler.hotSwapChild("host", fork("host", "wait 1\nfw 3"), { fresh: true })
            r.compositor.flush()
            assert.equal(r.scheduler.lastTickTime, 0)
            return drain(...args)
        }
        r.compositor.advance(60)
        assert.equal(r.scheduler.lastTickTime, 0, "a new play does not inherit the old play's allowance")
    })

    // The inter-play gap is not a frame of the new play; sampling it would cut
    // the AIMD quantum. A held edge already discards its first cadence sample.
    // (id:render-construction-cadence)
    test("a fresh play does not sample the inter-play gap as a frame", () => {
        const observed = []
        const pacer = { budgetMs: 4, observe: n => observed.push(n), skip() {} }
        const r = display("fw 1\nwait 1\nfw 1", {}, { pacer })
        r.compositor.advance(0)
        r.compositor.advance(16)
        assert.deepEqual(observed, [16])
        r.compositor.beginPlay()
        r.compositor.advance(516)
        assert.deepEqual(observed, [16], "the gap between plays is not a frame cost")
        r.compositor.advance(532)
        assert.deepEqual(observed, [16, 16], "the next real frame is observed")
    })

    test("a new play inside the drain does not sample the pre-edge gap", () => {
        const observed = []
        const r = display("fw 1\nwait 1\nfw 1", {}, { pacer: { budgetMs: 4, observe: n => observed.push(n), skip() {} } })
        r.compositor.advance(0)
        r.compositor.advance(16)
        assert.deepEqual(observed, [16])
        const drain = r.scheduler.readouts.drain
        r.scheduler.readouts.drain = (...args) => {
            r.scheduler.readouts.drain = drain
            r.compositor.beginPlay()
            return drain(...args)
        }
        r.compositor.advance(516)
        assert.deepEqual(observed, [16], "the pre-edge timestamp is not a frame of the new play")
        r.compositor.advance(532)
        assert.deepEqual(observed, [16, 16], "the first real frame of the play is sampled")
    })
})
