// Phase 5a scheduler tests — run with: node --test test/js/scheduler_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler } from "../../assets/js/turtling/scheduler.js"

// Helper: create a generator from an array of events
function* genFromEvents(events) {
    for (const event of events) {
        yield event
    }
}

describe("scheduler basics", () => {
    test("drains a simple generator in one tick", () => {
        const events = [
            { type: "path", points: [[0,0,0],[100,0,0]], color: '#fff', thickness: 2 },
            { type: "head", position: [100,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#fff', headSize: 10 }
        ]
        const scheduler = createScheduler(genFromEvents(events))

        const produced = scheduler.tick(0)

        assert.ok(produced)
        assert.ok(scheduler.done)
        assert.ok(scheduler.channel.closed)

        const drained = scheduler.channel.drain()
        assert.equal(drained.length, 2)
        assert.equal(drained[0].type, "path")
        assert.equal(drained[1].type, "head")
    })

    test("empty generator completes immediately", () => {
        const scheduler = createScheduler(genFromEvents([]))

        scheduler.tick(0)

        assert.ok(scheduler.done)
        assert.ok(scheduler.channel.closed)
        assert.equal(scheduler.channel.drain().length, 0)
    })

    test("tick returns false when already done", () => {
        const scheduler = createScheduler(genFromEvents([]))
        scheduler.tick(0)

        const produced = scheduler.tick(100)
        assert.equal(produced, false)
    })
})

describe("wait handling", () => {
    test("wait pauses generator and sets resumeAt", () => {
        const events = [
            { type: "path", points: [[0,0,0],[50,0,0]], color: '#fff', thickness: 2 },
            { type: "wait", duration: 2000, position: [50,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#fff', headSize: 10 },
            { type: "path", points: [[50,0,0],[100,0,0]], color: '#fff', thickness: 2 },
            { type: "head", position: [100,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#fff', headSize: 10 }
        ]
        const scheduler = createScheduler(genFromEvents(events))

        scheduler.tick(0)

        assert.ok(!scheduler.done)
        assert.equal(scheduler.resumeAt, 2000)

        const frame0 = scheduler.channel.drain()
        // path before wait + head snapshot emitted at wait boundary
        assert.equal(frame0.length, 2)
        assert.equal(frame0[0].type, "path")
        assert.equal(frame0[1].type, "head")
    })

    test("tick before resumeAt does nothing", () => {
        const events = [
            { type: "wait", duration: 1000, position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#fff', headSize: 10 },
            { type: "head", position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#fff', headSize: 10 }
        ]
        const scheduler = createScheduler(genFromEvents(events))

        scheduler.tick(0) // hits wait, sets resumeAt=1000
        scheduler.channel.drain()

        const produced = scheduler.tick(500) // too early
        assert.equal(produced, false)
        assert.equal(scheduler.channel.drain().length, 0)
    })

    test("tick after resumeAt continues generator", () => {
        const events = [
            { type: "path", points: [[0,0,0],[50,0,0]], color: '#fff', thickness: 2 },
            { type: "wait", duration: 1000, position: [50,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#fff', headSize: 10 },
            { type: "path", points: [[50,0,0],[100,0,0]], color: '#fff', thickness: 2 },
            { type: "head", position: [100,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#fff', headSize: 10 }
        ]
        const scheduler = createScheduler(genFromEvents(events))

        // Frame 0: drains up to wait
        scheduler.tick(0)
        scheduler.channel.drain()

        // Frame at t=1000: resumes after wait
        scheduler.tick(1000)
        const frame1 = scheduler.channel.drain()

        assert.ok(scheduler.done)
        assert.equal(frame1.length, 2) // path + head
        assert.equal(frame1[0].type, "path")
        assert.equal(frame1[1].type, "head")
    })

    test("multiple waits create multiple pause points", () => {
        const events = [
            { type: "path", points: [[0,0,0],[10,0,0]], color: '#f', thickness: 1 },
            { type: "wait", duration: 500, position: [10,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 },
            { type: "path", points: [[10,0,0],[20,0,0]], color: '#f', thickness: 1 },
            { type: "wait", duration: 500, position: [20,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 },
            { type: "path", points: [[20,0,0],[30,0,0]], color: '#f', thickness: 1 },
            { type: "head", position: [30,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        ]
        const scheduler = createScheduler(genFromEvents(events))

        // t=0: first segment + wait head
        scheduler.tick(0)
        assert.equal(scheduler.resumeAt, 500)
        const f0 = scheduler.channel.drain()
        assert.equal(f0.length, 2) // path + head from wait

        // t=500: second segment + wait head
        scheduler.tick(500)
        assert.equal(scheduler.resumeAt, 1000) // 500 + 500
        const f1 = scheduler.channel.drain()
        assert.equal(f1.length, 2) // path + head from wait

        // t=1000: final segment + head
        scheduler.tick(1000)
        assert.ok(scheduler.done)
        const f2 = scheduler.channel.drain()
        assert.equal(f2.length, 2) // path + head
    })
})

describe("channel", () => {
    test("drain empties buffer", () => {
        const scheduler = createScheduler(genFromEvents([
            { type: "path", points: [[0,0,0],[1,0,0]], color: '#f', thickness: 1 }
        ]))

        scheduler.tick(0)

        const first = scheduler.channel.drain()
        assert.ok(first.length > 0)

        const second = scheduler.channel.drain()
        assert.equal(second.length, 0)
    })

    test("channel closes on generator exhaustion", () => {
        const scheduler = createScheduler(genFromEvents([]))
        scheduler.tick(0)

        assert.ok(scheduler.channel.closed)
    })
})

describe("commandCount", () => {
    test("captures generator return value as commandCount", () => {
        function* gen() {
            yield { type: "path", points: [[0,0,0],[100,0,0]], color: '#f', thickness: 1 }
            yield { type: "head", position: [100,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
            return 42
        }
        const scheduler = createScheduler(gen())
        scheduler.tick(0)

        assert.ok(scheduler.done)
        assert.equal(scheduler.commandCount, 42)
    })

    test("defaults to 0 when generator returns no value", () => {
        const scheduler = createScheduler(genFromEvents([]))
        scheduler.tick(0)

        assert.ok(scheduler.done)
        assert.equal(scheduler.commandCount, 0)
    })
})

describe("batch fast path", () => {
    test("program with no waits drains entirely in one tick", () => {
        const events = [
            { type: "path", points: [[0,0,0],[100,0,0]], color: '#e77808', thickness: 2 },
            { type: "path", points: [[100,0,0],[100,50,0]], color: '#e77808', thickness: 2 },
            { type: "head", position: [100,50,0], rotation: {w:1,x:0,y:0,z:0}, color: '#e77808', headSize: 10 }
        ]
        const scheduler = createScheduler(genFromEvents(events))

        scheduler.tick(0)

        assert.ok(scheduler.done)
        const all = scheduler.channel.drain()
        assert.equal(all.length, 3)
    })
})
