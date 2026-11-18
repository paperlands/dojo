// Phase 0g: a controlled delayed admission, and the staleness fence.
//
// No worker, no solver. The responder hands back a Promise the test resolves by
// hand. The writer holds its logical instant until the verdict lands; a reply is
// applied only while the run that asked is still the run in the tree, so rewire,
// replacement, removal and disposal leave nothing stale acting.
// (laws-build.org id:laws-build-solve-seam)
//
// Run: node --test test/js/laws/phase0g_delayed_admission_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot, terminateAmbient } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const accept = (x) => ({ accepted: true, transform: { rotation: SE3.identity().rotation, position: [x, 0, 0] } })

// Drain microtasks and the check phase, so a resolved reply has certainly settled.
const settle = () => new Promise((done) => setImmediate(done))

function fork(name, src) {
    return {
        name, origin: SE3.identity(), frame: null,
        style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
        code: { ast: parseProgram(src), functions: {} },
        env: { userspace: new Map(), loopCounter: 0, scope: {} },
    }
}

// One deferred per motion request, so the test can resolve them in any order.
function delayedResponder({ defer = Infinity } = {}) {
    const calls = []
    let seen = 0
    const admit = (request) => {
        // Ordinary sibling motion answers at once; only the first `defer` calls park.
        if (seen++ >= defer) return { accepted: true, transform: request.requested }
        let resolve, reject
        const promise = new Promise((res, rej) => { resolve = res; reject = rej })
        calls.push({ request, resolve, reject })
        return promise
    }
    return { calls, admit }
}

function build(admit) {
    return createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: 64,
        motionAdmissionAsync: admit,
        onShout: () => {},
    })
}

function drive(scheduler, { maxTicks = 30 } = {}) {
    const trace = new Map()
    for (let i = 0; i < maxTicks && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        for (const frame of scheduler.registry.values()) {
            if (frame === scheduler.root) continue
            const key = frame.name
            if (!trace.has(key)) trace.set(key, [])
            trace.get(key).push(...frame.channel.drain())
        }
    }
    return trace
}

const pathEnds = (trace, name) =>
    (trace.get(name) ?? []).filter((e) => e.type === "path").map((p) => p.points.at(-1))

test("delayed accept: the writer holds its instant, then applies the landed pose", async () => {
    const responder = delayedResponder()
    const scheduler = build(responder.admit)
    scheduler.hotSwapChild("w", fork("w", "fw 10\nwait 1"))
    const w = scheduler.root.children.get("w")

    scheduler.tick(0)
    assert.equal(w.done, false, "the writer is still inside its instant")
    assert.equal(w.suspension?.kind, "admission", "the frame is explicitly awaiting a verdict")
    assert.deepEqual(w.transform.deref().position, [0, 0, 0], "nothing moved while pending")
    assert.deepEqual([...w.channel.drain()], [], "nothing was published while pending")

    responder.calls[0].resolve(accept(4))
    await settle()
    assert.equal(w.suspension?.verdict?.kind, "accept", "the verdict is ready to resume")

    const trace = drive(scheduler)
    assert.deepEqual([...w.transform.deref().position], [4, 0, 0])
    assert.deepEqual(pathEnds(trace, "w"), [[4, 0, 0]], "the accepted pose, not the requested 10")
})

test("delayed refusal: resolving { accepted: false } is a clean truth refusal", async () => {
    const responder = delayedResponder()
    const scheduler = build(responder.admit)
    scheduler.hotSwapChild("w", fork("w", "fw 10\nwait 1"))
    const w = scheduler.root.children.get("w")

    responder.calls[0].resolve({ accepted: false })
    await settle()
    const trace = drive(scheduler)

    assert.equal(w.error, null, "a refusal is not a fault")
    assert.deepEqual([...w.transform.deref().position], [0, 0, 0])
    assert.deepEqual(pathEnds(trace, "w"), [], "the refused move drew nothing")
})

test("delayed fault: a malformed resolution wounds and does not read as refusal", async () => {
    const responder = delayedResponder()
    const scheduler = build(responder.admit)
    scheduler.hotSwapChild("w", fork("w", "fw 10\nwait 1"))
    const w = scheduler.root.children.get("w")

    responder.calls[0].resolve({ accepted: true })
    await settle()
    drive(scheduler)

    assert.match(w.error?.message ?? "", /no transform\.position/)
})

test("delayed fault: a rejected responder wounds with its own message", async () => {
    const responder = delayedResponder()
    const scheduler = build(responder.admit)
    scheduler.hotSwapChild("w", fork("w", "fw 10\nwait 1"))
    const w = scheduler.root.children.get("w")

    responder.calls[0].reject(new Error("worker died"))
    await settle()
    drive(scheduler)

    assert.match(w.error?.message ?? "", /motion responder failed: worker died/)
})

test("a pending writer owns its instant: a sibling read waits for the verdict", async () => {
    const responder = delayedResponder({ defer: 1 })   // only the hand is delayed; the reader's own fw is not
    const scheduler = build(responder.admit)
    scheduler.hotSwapChild("o", fork("o", "wait 1\nfw w.x\nwait 1"))
    scheduler.hotSwapChild("w", fork("w", "fw 10\nwait 1"))
    const observer = scheduler.root.children.get("o")
    const writer = scheduler.root.children.get("w")

    drive(scheduler, { maxTicks: 3 })
    assert.deepEqual([...observer.transform.deref().position], [0, 0, 0], "the reader did not pass a pending writer")

    responder.calls[0].resolve(accept(4))
    await settle()
    const trace = drive(scheduler)

    assert.deepEqual([...writer.transform.deref().position], [4, 0, 0])
    assert.deepEqual(pathEnds(trace, "o"), [[4, 0, 0]], "the reader saw the settled accepted pose")
})

// --- staleness: replacement, removal, disposal -----------------------------

test("stale after replacement: the old frame's reply does not act", async () => {
    const responder = delayedResponder()
    const scheduler = build(responder.admit)
    scheduler.hotSwapChild("w", fork("w", "fw 10\nwait 1"))
    const old = scheduler.root.children.get("w")

    // A different source replaces the frame; the old run is terminated.
    scheduler.hotSwapChild("w", fork("w", "goto 2 0\nwait 1"))
    const next = scheduler.root.children.get("w")
    assert.notEqual(next, old, "the replacement is a new frame")
    assert.equal(old.done, true)

    responder.calls[0].resolve(accept(9))
    await settle()
    assert.deepEqual([...old.transform.deref().position], [0, 0, 0], "the stale reply never moved the old frame")
    assert.equal(next.suspension?.kind, "admission", "the replacement still waits for its own verdict")

    responder.calls[1].resolve(accept(2))
    await settle()
    const trace = drive(scheduler)
    assert.deepEqual([...next.transform.deref().position], [2, 0, 0])
    assert.deepEqual(pathEnds(trace, "w"), [[2, 0, 0]])
    assert.deepEqual(scheduler.errors, [])
})

test("stale after removal: resolving a removed frame's reply is inert", async () => {
    const responder = delayedResponder()
    const scheduler = build(responder.admit)
    scheduler.hotSwapChild("w", fork("w", "fw 10\nwait 1"))
    const w = scheduler.root.children.get("w")

    scheduler.removeChild("w")
    assert.equal(scheduler.root.children.has("w"), false)

    responder.calls[0].resolve(accept(9))
    await settle()
    drive(scheduler)

    assert.equal(w.done, true)
    assert.deepEqual(scheduler.errors, [], "a late reply to a removed frame is not an error")
})

test("stale after disposal: terminateAmbient ends the run, the reply is dropped", async () => {
    const responder = delayedResponder()
    const scheduler = build(responder.admit)
    scheduler.hotSwapChild("w", fork("w", "fw 10\nwait 1"))
    const w = scheduler.root.children.get("w")

    terminateAmbient(w)
    responder.calls[0].resolve(accept(9))
    await settle()
    drive(scheduler)

    assert.equal(w.done, true)
    assert.deepEqual([...w.transform.deref().position], [0, 0, 0])
    assert.deepEqual(scheduler.errors, [])
})
