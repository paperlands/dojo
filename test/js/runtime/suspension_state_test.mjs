// The frame lifecycle is one record (`suspension`) and one table (`SUSPENSIONS`).
// This fence keeps it legible: every stop names its kind, a breath owns nothing,
// a debt outranks a breath, and a cross-ambient read that is not ready is the one
// `dataflow` kind. (id:output-ledger-r2-instant)
import { test } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot, parkBreath, parkOwing } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const fork = (name, src) => ({
    name, origin: SE3.identity(), frame: null,
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
