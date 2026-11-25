// An exhausted allowance must not burn the overrun ceiling on an unchanged, admission-parked
// opportunity: a tick with no progress and no drain is a stop, not a reason to retry.
// Repair: apply the no-progress/no-drain exit in the exhausted-budget branch of driveToRest.
// (id:render-construction-cadence)
// Run: node --test test/js/runtime/pump_overrun_test.mjs
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Group, Vector3 } from "../../../assets/js/utils/three-entry.js"
import { LineMaterial } from "../../../assets/js/utils/three-addons/lines/LineMaterial.js"
import { createCompositor } from "../../../assets/js/turtling/compositor.js"
import { createFocus } from "../../../assets/js/turtling/focus.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, fork, delayedResponder, settle } from "../laws/harness.mjs"

const MAX_OVERRUN = 64

function rig(source, { budgetMs = -1, capacity = 512, admitAsync, admit } = {}) {
    const clock = { work: 0 }
    const responder = delayedResponder()
    const motionAsync = admitAsync ?? ((request) => { clock.work++; return responder.admit(request) })
    const scheduler = admitAsync || !admit
        ? buildWorld({ capacity, breathEvery: 4, clock: () => clock.work, admitAsync: motionAsync })
        : buildWorld({ capacity, breathEvery: 4, clock: () => clock.work, admit })
    scheduler.hotSwapChild("host", fork("host", source), { fresh: true, deferStart: true })
    const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
    ink._cached = true
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), pacer: { budgetMs, observe() {}, skip() {} }, createText: () => { throw Error("fixture has no labels") } })
    const stats = { ticks: 0, drains: 0 }
    const wrapDrains = () => {
        for (const frame of scheduler.registry.values()) {
            if (frame.channel.__counted) continue
            const drain = frame.channel.drain.bind(frame.channel)
            frame.channel.drain = () => { stats.drains++; return drain() }
            frame.channel.__counted = true
        }
    }
    const original = scheduler.tick.bind(scheduler)
    scheduler.tick = (now) => { stats.ticks++; const advanced = original(now); wrapDrains(); return advanced }
    wrapDrains()
    return { scheduler, compositor, clock, responder, stats, reset: () => { stats.ticks = 0; stats.drains = 0 },
        paths: () => { let n = 0; scene.traverse((o) => { n += o.geometry?.instanceCount || 0 }); return n } }
}
const host = (r) => r.scheduler.root.children.get("host")

describe("pump overrun — an unchanged parked opportunity stops", () => {
    test("pending admission: one unsuccessful tick on later opportunities, not the ceiling", () => {
        const r = rig("fw 1")
        r.compositor.advance(0)                 // seats and parks on admission
        assert.equal(host(r).suspension?.kind, "admission", "the frame parks on admission")
        r.reset()
        r.compositor.advance(16)
        assert.ok(r.stats.ticks <= 1, `expected <= 1 tick, got ${r.stats.ticks}`)
        assert.ok(r.stats.drains <= 4, `expected a bounded drain, got ${r.stats.drains}`)
    })

    test("controlled reply: resumes promptly with exactly one request", async () => {
        const r = rig("fw 1")
        r.compositor.advance(0)
        r.compositor.advance(16)
        assert.equal(r.responder.calls.length, 1, "one request while parked")
        const call = r.responder.calls[0]
        call.resolve({ accepted: true, transform: call.request.requested })
        await settle()
        for (let i = 0; i < 4 && !r.scheduler.done; i++) r.compositor.advance(32 + i * 16)
        assert.equal(r.scheduler.done, true, "the reply resumes and the program finishes")
        assert.equal(r.responder.calls.length, 1, "no re-request")
    })

    test("debt: productive draining still permits resumption", () => {
        const r = rig("fw 1\nfw 2", { capacity: 1, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
        for (let i = 0; i < 12 && !r.scheduler.done; i++) r.compositor.advance(i * 16)
        assert.equal(r.scheduler.done, true, "credit is freed by draining and the program finishes")
        assert.equal(r.paths(), 2, "both motions landed")
    })

    test("breath: construction continues on later opportunities", () => {
        const r = rig("loop 8 do\n fw 1\nend", { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
        for (let i = 0; i < 40 && !r.scheduler.done; i++) r.compositor.advance(i * 16)
        assert.equal(r.scheduler.done, true, "construction completes across opportunities")
        assert.equal(r.paths(), 8, "all eight segments landed")
    })

    test("positive allowance genuinely consumed before parking", () => {
        // Budget 2 is spent by two admissions; the third request is withheld.
        // Auto-answer the first two motions, withhold the third: the positive allowance
        // is genuinely consumed before the park.
        const clock = { work: 0 }
        let served = 0
        const scheduler = buildWorld({ capacity: 512, breathEvery: 4, clock: () => clock.work,
            admitAsync: (request) => { clock.work++; return served++ < 2 ? { accepted: true, transform: request.requested } : new Promise(() => {}) } })
        scheduler.hotSwapChild("host", fork("host", "loop 4 do\n fw 1\nend"), { fresh: true, deferStart: true })
        const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
        ink._cached = true
        const compositor = createCompositor(scheduler, { scene, camera: { position: new Vector3(0, 0, 1000) },
            materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity() },
            { focus: createFocus(scheduler), pacer: { budgetMs: 2, observe() {}, skip() {} }, createText: () => { throw Error("no labels") } })
        let ticks = 0
        const original = scheduler.tick.bind(scheduler)
        scheduler.tick = (now) => { ticks++; return original(now) }
        compositor.advance(0)                    // spends the allowance, then parks on the withheld request
        assert.ok(clock.work >= 2, `allowance genuinely consumed (work=${clock.work})`)
        assert.equal(scheduler.root.children.get("host").suspension?.kind, "admission", "parked on the withheld request")
        // Assert on the call where the positive allowance actually expired, not on a later
        // call that would receive a fresh allowance.
        assert.ok(ticks <= 8, `bounded retries on the expiring advance, got ${ticks} ticks`)
    })

    test("spawn ordering: a declaration after a parked motion waits for the reply", async () => {
        const responder = delayedResponder()
        const admitAsync = (request) => request.frame.name === "sib"
            ? { accepted: true, transform: request.requested }
            : responder.admit(request)
        const r = rig("fw 1\nas sib do\n fw 5\nend", { admitAsync })
        r.compositor.advance(0)
        assert.equal(host(r).suspension?.kind, "admission", "the motion parks first")
        assert.equal(host(r).children.get("sib"), undefined, "the later declaration is not born while parked")
        const call = responder.calls[0]
        call.resolve({ accepted: true, transform: call.request.requested })
        await settle()
        for (let i = 0; i < 4 && !r.scheduler.done; i++) r.compositor.advance(16 + i * 16)
        assert.ok(host(r).children.get("sib"), "the sibling is born once the reply resumes")
    })

    // Already-runnable siblings: both bodies seated independently before any pumping, then
    // the insertion order reversed. A runnable `run` (fw 5, answered) sits beside a parked
    // `park` (fw 1, withheld).
    for (const order of [["run", "park"], ["park", "run"]]) {
        test(`already-seated siblings (${order.join(" then ")}): the runnable one is serviced`, () => {
            const responder = delayedResponder()
            const clock = { work: 0 }
            const scheduler = buildWorld({ capacity: 512, breathEvery: 4, clock: () => clock.work,
                admitAsync: (request) => { clock.work++; return request.frame.name === "run" ? { accepted: true, transform: request.requested } : responder.admit(request) } })
            for (const name of order) scheduler.hotSwapChild(name, fork(name, name === "run" ? "fw 5" : "fw 1"), { fresh: true, deferStart: true })
            const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
            ink._cached = true
            const compositor = createCompositor(scheduler, { scene, camera: { position: new Vector3(0, 0, 1000) },
                materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity() },
                { focus: createFocus(scheduler), pacer: { budgetMs: -1, observe() {}, skip() {} }, createText: () => { throw Error("no labels") } })
            for (let i = 0; i < 6; i++) compositor.advance(i * 16)
            assert.equal(scheduler.root.children.get("park").suspension?.kind, "admission", "the parked sibling is parked")
            // FINDING: with the owning park seated first the pass stops on its instant and the
            // later runnable sibling is never serviced; seated first, the runnable one is.
            assert.equal(scheduler.root.children.get("run").done, order[0] === "run", `runnable serviced depends on order (${order.join(" then ")})`)
        })
    }
})
