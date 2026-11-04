// Phase 0b: one deterministic accepted-motion protocol through real executor/scheduler.
// Run: node --test test/js/laws/phase0b_motion_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const spawn = (name, source) => ({
    type: "spawn", name, frame: null, origin: SE3.identity(),
    style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
    code: { ast: parseProgram(source), functions: {} },
    env: { userspace: new Map(), loopCounter: 0, scope: {} },
})

function* duet(order) {
    for (const name of order) {
        yield name === "writer"
            ? spawn("writer", "fw 10\nfw 2\nwait 1")
            : spawn("observer", "fw writer.x")
    }
}

function schedulerFor({ order, channelCapacity = 16, admit }) {
    return createScheduler(duet(order), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1 },
        channelCapacity,
        motionAdmission: admit,
    })
}

function drive(scheduler, maxTicks = 20, { sliced = false } = {}) {
    scheduler.trace = new Map()
    for (let i = 0; i < maxTicks && !scheduler.done; i++) {
        const tick = () => scheduler.tick(i * 1000)
        if (sliced) scheduler.withSlice(2, tick)
        else tick()
        for (const child of scheduler.root.children.values()) {
            const events = child.channel.drain()
            if (!scheduler.trace.has(child.name)) scheduler.trace.set(child.name, [])
            scheduler.trace.get(child.name).push(...events)
        }
    }
}

const clampFirstMove = (requests) => ({ command, from, requested }) => {
    requests.push({ command, from: [...from.position], requested: [...requested.position] })
    if (command === "fw" && requested.position[0] === 10) {
        return { accepted: true, transform: { ...requested, position: [6, 0, 0] } }
    }
    return { accepted: true, transform: requested }
}

test("adjustment excludes rejected endpoint, next command starts accepted, sibling reads final accepted pose", () => {
    const requests = []
    const scheduler = schedulerFor({
        order: ["writer", "observer"],
        admit: clampFirstMove(requests),
    })
    drive(scheduler)

    const writer = scheduler.root.children.get("writer")
    const observer = scheduler.root.children.get("observer")
    assert.ok(writer?.done && observer?.done, "both ambients settle")
    assert.deepEqual(requests.slice(0, 2).map((r) => r.from), [[0, 0, 0], [6, 0, 0]])
    assert.deepEqual(requests.slice(0, 2).map((r) => r.requested), [[10, 0, 0], [8, 0, 0]])
    assert.deepEqual(writer.transform.deref().position, [8, 0, 0])
    const ink = scheduler.trace.get("writer").filter((event) => event.type === "path")
    assert.deepEqual(ink.map((path) => path.points.at(-1)), [[6, 0, 0], [8, 0, 0]])
    assert.deepEqual(ink[0].points[0], [0, 0, 0])
    assert.deepEqual(observer.transform.deref().position, [8, 0, 0], "sibling's fw writer.x used admitted pose")
})

test("refusal emits no requested geometry and leaves the next command at the old pose", () => {
    const scheduler = schedulerFor({
        order: ["writer", "observer"],
        admit: ({ from, requested }) => requested.position[0] === 10
            ? { accepted: false, transform: from }
            : { accepted: true, transform: requested },
    })
    drive(scheduler)

    const writer = scheduler.root.children.get("writer")
    const paths = scheduler.trace.get("writer").filter((event) => event.type === "path")
    assert.deepEqual(writer.transform.deref().position, [2, 0, 0])
    assert.deepEqual(paths.map((path) => path.points.at(-1)), [[2, 0, 0]], "only the following accepted command draws")
    assert.ok(paths.every((path) => path.points.flat().every((n) => n !== 10)), "refused endpoint never enters ink")
})

test("admission absent preserves scheduler/executor movement", () => {
    const scheduler = schedulerFor({ order: ["writer", "observer"], admit: undefined })
    drive(scheduler)
    assert.deepEqual(scheduler.root.children.get("writer").transform.deref().position, [12, 0, 0])
})

test("same-instant reader cannot pass a writer parked at admission, in either spawn order", () => {
    for (const order of [["writer", "observer"], ["observer", "writer"]]) {
        for (const channelCapacity of [1, 16]) {
            for (const sliced of [false, true]) {
                let calls = 0
                let clock = 0
                const scheduler = createScheduler(metaRoot(), {
                    createDeps: deps,
                    execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
                    channelCapacity,
                    clock: () => ++clock,
                    motionAdmission: ({ requested, frame }) => {
                        if (frame.name === "writer") calls++
                        return { accepted: true, transform: {
                            ...requested,
                            position: requested.position[0] === 10 ? [6, 0, 0] : requested.position,
                        } }
                    },
                })
                const fork = (name, source) => ({
                    name, origin: SE3.identity(), frame: null,
                    style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
                    code: { ast: parseProgram(source), functions: {} },
                    env: { userspace: new Map(), loopCounter: 0, scope: {} },
                })
                scheduler.hotSwapChild("observer", fork("observer", "fw writer.x"))
                scheduler.hotSwapChild("writer", fork("writer", "fw 10\nfw 2\nwait 1"))
                if (order[0] === "writer") {
                    const writer = scheduler.root.children.get("writer")
                    const observer = scheduler.root.children.get("observer")
                    scheduler.root.children.clear()
                    scheduler.root.children.set("writer", writer)
                    scheduler.root.children.set("observer", observer)
                }
                const writer = scheduler.root.children.get("writer")
                assert.ok(writer, `writer spawned in order ${order}`)
                assert.equal(writer.suspension?.kind, "admission", `admission parks without language wait (${order}, cap=${channelCapacity}); errors=${JSON.stringify(scheduler.errors)}`)
                scheduler.tick(0)
                drive(scheduler, 20, { sliced })
                assert.equal(calls, 2, "both writer commands pass through the same protocol")
                assert.deepEqual(
                    scheduler.root.children.get("observer").transform.deref().position,
                    [8, 0, 0],
                    `accepted observation: order=${order}, capacity=${channelCapacity}, sliced=${sliced}`
                )
            }
        }
    }
})
