// The frame lifecycle is one record (`suspension`) and one table (`SUSPENSIONS`).
// This fence keeps it legible: every stop names its kind, a breath owns nothing,
// a debt outranks a breath, and a cross-ambient read that is not ready is the one
// `dataflow` kind. (id:output-ledger-r2-instant)
import { test } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot, parkBreath, parkOwing, resolveBinding } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, at, drive, ends } from '../laws/harness.mjs'

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const fork = (name, src, origin = SE3.identity()) => ({
    name, origin, frame: null,
    style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
    code: { ast: parseProgram(src), functions: {} },
    env: { userspace: new Map(), loopCounter: 0, scope: {} },
})

test("breath: a suspension that owes nothing and restarts no wait", () => {
    const f = { suspension: null }
    parkBreath(f)
    assert.equal(f.suspension.kind, "breath")
    assert.equal(f.suspension.owed, null)
    const first = f.suspension
    parkBreath(f)
    assert.equal(f.suspension, first, "an unchanged breath is not restarted")
})

test("debt: a deposit outranks a breath and survives a change of kind", () => {
    const f = { suspension: null }
    const owed = { type: "path" }
    parkOwing(f, "credit", owed)
    parkBreath(f)
    assert.equal(f.suspension.kind, "credit", "a breath must not drop a held deposit")
    assert.equal(f.suspension.owed, owed)
    parkOwing(f, "residency", owed)
    assert.equal(f.suspension.kind, "residency", "re-owing moves the kind")
    assert.equal(f.suspension.owed, owed, "and never the debt")
})

test("a cross-ambient read of a mid-instant frame suspends as dataflow", () => {
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: 64,
        motionAdmission: ({ requested }) => ({ accepted: true, transform: requested }),
        onShout: () => {},
    })
    scheduler.hotSwapChild("writer", fork("writer", "fw 10\nwait 1"))
    const writer = scheduler.root.children.get("writer")
    assert.equal(writer.suspension?.kind, "admission", "the writer parks mid-instant")
    assert.equal(writer.midInstant, true)

    scheduler.hotSwapChild("reader", fork("reader", "fw writer.x"))
    const reader = scheduler.root.children.get("reader")
    assert.equal(reader.suspension?.kind, "dataflow", "a not-ready read is the one dataflow kind")
    assert.equal(reader.suspension.on, writer, "and it names the frame it waits on")
})

// The suspension boundary has two sides: a read that is ASKED parks, and a branch
// that was never considered cannot. First-match guards EVALUATION, so after a match
// the poisoned sibling read is never asked at all. (id:numeric-boundaries-adversarial-followup)
test("a condition asked of an absent sibling parks as dataflow", () => {
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: 64,
        motionAdmission: ({ requested }) => ({ accepted: true, transform: requested }),
        onShout: () => {},
    })
    scheduler.hotSwapChild("reader", fork("reader", "when 0 do\n fw 1\nend\nwhen ghost.x do\n fw 2\nend\nfw 3"))
    const reader = scheduler.root.children.get("reader")
    assert.equal(reader.suspension?.kind, "dataflow", "the unanswerable read suspends the walk")
})

test("a matched when never asks, so a poisoned read cannot park the walk", () => {
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: 64,
        motionAdmission: ({ requested }) => ({ accepted: true, transform: requested }),
        onShout: () => {},
    })
    scheduler.hotSwapChild("reader", fork("reader", "when 1 do\n fw 1\nend\nwhen ghost.x do\n fw 2\nend\nfw 3"))
    const reader = scheduler.root.children.get("reader")
    for (let i = 0; i < 20 && !reader.done; i++) scheduler.tick(i * 1000)
    assert.equal(reader.done, true, "the walk completes: the branch was never considered")
    assert.equal(reader.suspension?.kind ?? null, null, "and never parks as dataflow")
    const ends = reader.channel.drain().filter((e) => e.type === "path").map((p) => p.points.at(-1))
    assert.deepEqual(ends, [[1, 0, 0], [4, 0, 0]], "the poison drew nothing: fw 1 then fw 3")
})

test("readout preflight cannot release another argument's dataflow wait", () => {
    const scheduler = buildWorld()
    const a = scheduler.hotSwapChild("a", fork("a", "", at(1)))
    const reader = scheduler.hotSwapChild("reader", fork("reader", "goto a.x b.x\nwait 1"))
    const watcher = scheduler.hotSwapChild("watcher", fork("watcher", "fw reader.x"))
    const suspension = reader.suspension, generator = reader.generator
    const watcherSuspension = watcher.suspension
    assert.equal(suspension?.kind, "dataflow")
    assert.equal(suspension.on, null, "the missing b has no frame yet")
    assert.equal(watcherSuspension?.on, reader)

    assert.equal(scheduler.readouts.dependsOnFrame(() => resolveBinding(reader, "a.x"), a), true)
    assert.equal(reader.generator, generator, "preflight did not run the coroutine")
    assert.equal(reader.suspension, suspension, "only the coroutine may release this wait")
    assert.equal(reader.suspension.on, null)
    assert.throws(() => resolveBinding(watcher, "reader.x"), error => error.blocked === true)
    assert.equal(watcher.suspension, watcherSuspension)
    assert.deepEqual(watcher.transform.deref().position, [0, 0, 0])
})

test("the original coroutine resumes once and keeps its earlier admitted argument", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const a = scheduler.hotSwapChild("a", fork("a", "", at(1)))
    const reader = scheduler.hotSwapChild("reader", fork("reader", "goto a.x b.x\nfw 1\nwait 1"))
    const generator = reader.generator
    assert.equal(reader.suspension?.kind, "dataflow")
    assert.equal(scheduler.requestMotion(a, at(9), scheduler.motionRevision).kind, "accept")
    scheduler.hotSwapChild("b", fork("b", "", at(5)))
    assert.equal(reader.generator, generator)
    const trace = drive(scheduler)
    assert.equal(reader.error, null)
    assert.equal(reader.done, true)
    assert.equal(reader.suspension, null)
    assert.deepEqual(ends(trace, "reader"), [[1, 5, 0], [2, 5, 0]])
    assert.deepEqual(reader.transform.deref().position, [2, 5, 0])
})

test("a successful actor read can finish without a following command or a retained wait", () => {
    const scheduler = buildWorld()
    const reader = scheduler.hotSwapChild("reader", fork("reader", "when b.x do\n fw 99\nend"))
    assert.equal(reader.suspension?.kind, "dataflow")
    scheduler.hotSwapChild("b", fork("b", ""))
    const trace = drive(scheduler)
    assert.equal(reader.error, null)
    assert.equal(reader.done, true)
    assert.equal(reader.generator, null)
    assert.equal(reader.suspension, null)
    assert.deepEqual(ends(trace, "reader"), [])
})

test("replacement and removal retire a waiting continuation without passing its wait to a namesake", () => {
    for (const withdrawal of ["replace", "remove"]) {
        const scheduler = buildWorld()
        const old = scheduler.hotSwapChild("reader", fork("reader", "fw b.x\nfw 100"))
        assert.equal(old.suspension?.kind, "dataflow")
        old.channel.drain()
        if (withdrawal === "remove") scheduler.removeChild("reader")
        const fresh = scheduler.hotSwapChild("reader", fork("reader", "fw 7"))
        assert.notEqual(fresh, old)
        assert.equal(old.done, true)
        assert.equal(old.suspension, null)
        assert.equal(scheduler.registry.has(old.id), false)
        assert.notEqual(fresh.suspension?.kind, "dataflow")
        scheduler.hotSwapChild("b", fork("b", "", at(5)))
        const trace = drive(scheduler)
        assert.deepEqual(old.transform.deref().position, [0, 0, 0])
        assert.deepEqual(old.channel.drain(), [])
        assert.deepEqual(ends(trace, "reader"), [[7, 0, 0]])
        assert.deepEqual(fresh.transform.deref().position, [7, 0, 0])
        assert.equal(fresh.suspension, null)
    }
})

test("a waiting read that becomes a terminal fault leaves no dataflow debt", () => {
    const scheduler = buildWorld()
    const reader = scheduler.hotSwapChild("reader", fork("reader", "fw missing.x"))
    assert.equal(reader.suspension?.kind, "dataflow")
    drive(scheduler)
    assert.equal(reader.done, true)
    assert.equal(reader.generator, null)
    assert.match(reader.error?.message, /Undefined assistant: missing/)
    assert.equal(reader.suspension, null)
})

test("input deferral keeps a ready coroutine waiting until its execution permission returns", () => {
    const scheduler = buildWorld()
    const reader = scheduler.hotSwapChild("reader", fork("reader", "fw b.x\nwait 1"))
    const suspension = reader.suspension, generator = reader.generator
    assert.equal(suspension?.kind, "dataflow")
    const release = scheduler.defer(reader)
    scheduler.hotSwapChild("b", fork("b", "", at(5)))
    const held = drive(scheduler, { maxTicks: 3 })
    assert.equal(reader.suspension, suspension)
    assert.equal(reader.generator, generator)
    assert.equal(reader.done, false)
    assert.deepEqual(ends(held, "reader"), [])
    assert.deepEqual(reader.transform.deref().position, [0, 0, 0])
    assert.equal(release(), true)
    const resumed = drive(scheduler)
    assert.equal(reader.error, null)
    assert.equal(reader.done, true)
    assert.equal(reader.suspension, null)
    assert.deepEqual(ends(resumed, "reader"), [[5, 0, 0]])
})
