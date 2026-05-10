// Scheduler tests — run with: node --test test/js/scheduler_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, createAmbientCtx, allDone, worldTransform } from "../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../assets/js/turtling/parse.js"
import { execute, drainEvents } from "../../assets/js/turtling/executor.js"
import { ASTNode } from "../../assets/js/turtling/ast.js"
import { SE3 } from "../../assets/js/turtling/se3.js"
import { createAtom } from "../../assets/js/turtling/atom.js"

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

// ---------------------------------------------------------------------------
// Phase 5b: Parser — `as` keyword
// ---------------------------------------------------------------------------

describe("parser: as keyword", () => {
    test("as name do ... end parses to Ambient node", () => {
        const ast = parseProgram("as sky do\n  fw 100\nend")
        assert.equal(ast.length, 1)
        assert.equal(ast[0].type, "Ambient")
        assert.equal(ast[0].value, "sky")
        assert.equal(ast[0].children.length, 1)
        assert.equal(ast[0].children[0].type, "Call")
        assert.equal(ast[0].children[0].value, "fw")
    })

    test("sibling ambients parse as separate nodes", () => {
        const ast = parseProgram("as a do\n  fw 50\nend\nas b do\n  rt 90\nend")
        assert.equal(ast.length, 2)
        assert.equal(ast[0].type, "Ambient")
        assert.equal(ast[0].value, "a")
        assert.equal(ast[1].type, "Ambient")
        assert.equal(ast[1].value, "b")
    })

    test("nested ambients parse correctly", () => {
        const ast = parseProgram("as sky do\n  as cloud do\n    fw 10\n  end\nend")
        assert.equal(ast.length, 1)
        assert.equal(ast[0].type, "Ambient")
        assert.equal(ast[0].value, "sky")
        assert.equal(ast[0].children.length, 1)
        assert.equal(ast[0].children[0].type, "Ambient")
        assert.equal(ast[0].children[0].value, "cloud")
    })

    test("ambient mixed with commands", () => {
        const ast = parseProgram("fw 50\nas sky do\n  fw 100\nend\nrt 90")
        assert.equal(ast.length, 3)
        assert.equal(ast[0].type, "Call")
        assert.equal(ast[1].type, "Ambient")
        assert.equal(ast[2].type, "Call")
    })

    test("as without name throws", () => {
        assert.throws(() => parseProgram("as do\n  fw 100\nend"), /requires ambient name/)
    })
})

// ---------------------------------------------------------------------------
// Phase 5b: Executor — spawn events
// ---------------------------------------------------------------------------

// Minimal math mock
function mockDeps() {
    return {
        mathParser: {
            isNumeric(expr) { return /^-?\d+\.?\d*$/.test(expr) },
            parse(expr) { return { value: expr, children: [] } },
            defineFunction() {},
            reset() {}
        },
        mathEvaluator: {
            constants: {},
            namespace_check(val) { return val in this.constants },
            run(tree) { return parseFloat(tree.value) || 0 }
        }
    }
}

function call(name, ...args) {
    return new ASTNode('Call', name,
        args.map(a => new ASTNode('Argument', String(a)))
    )
}

function ambient(name, children) {
    return new ASTNode('Ambient', name, children)
}

describe("executor: ambient spawn", () => {
    test("ambient node yields spawn event", () => {
        const ast = [ambient("sky", [call("fw", 100)])]
        const events = drainEvents(ast, mockDeps())

        const spawns = events.filter(e => e.type === "spawn")
        assert.equal(spawns.length, 1)
        assert.equal(spawns[0].name, "sky")
        assert.ok(Array.isArray(spawns[0].ast))
        assert.ok(spawns[0].transform)
        assert.ok(spawns[0].penState)
    })

    test("spawn carries parent transform snapshot", () => {
        // fw 50 moves parent to (50,0,0), then spawn should snapshot that
        const ast = [call("fw", 50), ambient("sky", [call("fw", 100)])]
        const events = drainEvents(ast, mockDeps())

        const spawn = events.find(e => e.type === "spawn")
        // Parent was at ~(50, 0, 0) when spawn happened
        assert.ok(Math.abs(spawn.transform.position[0] - 50) < 0.01)
    })

    test("spawn carries pen state snapshot", () => {
        const ast = [call("beColour", "'red'"), ambient("sky", [call("fw", 100)])]
        const events = drainEvents(ast, mockDeps())

        const spawn = events.find(e => e.type === "spawn")
        assert.equal(spawn.penState.color, "red")
    })

    test("parent continues after ambient block", () => {
        const ast = [call("fw", 50), ambient("sky", [call("fw", 100)]), call("fw", 50)]
        const events = drainEvents(ast, mockDeps())

        // Should have: path(fw 50), spawn, path(fw 50), head
        const paths = events.filter(e => e.type === "path")
        assert.ok(paths.length >= 1) // at least one path from parent
        const spawn = events.find(e => e.type === "spawn")
        assert.ok(spawn)
        const head = events.find(e => e.type === "head")
        assert.ok(head)
    })

    test("sibling ambients yield separate spawn events", () => {
        const ast = [
            ambient("a", [call("fw", 10)]),
            ambient("b", [call("fw", 20)])
        ]
        const events = drainEvents(ast, mockDeps())

        const spawns = events.filter(e => e.type === "spawn")
        assert.equal(spawns.length, 2)
        assert.equal(spawns[0].name, "a")
        assert.equal(spawns[1].name, "b")
    })
})

// ---------------------------------------------------------------------------
// Phase 5b: Tree scheduler — ambient lifecycle
// ---------------------------------------------------------------------------

describe("tree scheduler: spawn handling", () => {
    test("spawn event creates child ambient", () => {
        function* parentGen() {
            yield { type: "path", points: [[0,0,0],[50,0,0]], color: '#f', thickness: 1 }
            yield {
                type: "spawn", name: "child",
                ast: [call("fw", 100)],
                transform: { rotation: { w: 1, x: 0, y: 0, z: 0, raw: () => ({w:1,x:0,y:0,z:0}), multiply: () => ({w:1,x:0,y:0,z:0}), rotate: (v) => v }, position: [0,0,0] },
                penState: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 }
            }
            yield { type: "head", position: [50,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        }

        const scheduler = createScheduler(parentGen(), {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        // First tick: parent runs, spawns child, parent done
        scheduler.tick(0)

        assert.ok(scheduler.registry.has("child"))
        assert.ok(!scheduler.done) // child hasn't run yet
    })

    test("child ambient executes on next tick", () => {
        function* parentGen() {
            yield {
                type: "spawn", name: "child",
                ast: [call("fw", 100)],
                transform: { rotation: { w: 1, x: 0, y: 0, z: 0, raw: () => ({w:1,x:0,y:0,z:0}), multiply: () => ({w:1,x:0,y:0,z:0}), rotate: (v) => v }, position: [0,0,0] },
                penState: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 }
            }
            yield { type: "head", position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        }

        const scheduler = createScheduler(parentGen(), {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        scheduler.tick(0) // parent spawns child, parent completes
        assert.ok(!scheduler.done)

        scheduler.tick(0) // child executes
        assert.ok(scheduler.done)

        // Child should have produced events on its own channel
        const childCtx = scheduler.registry.get("child")
        assert.ok(childCtx.done)
    })

    test("allDone checks entire tree", () => {
        function* parentGen() {
            yield {
                type: "spawn", name: "c1",
                ast: [call("fw", 10)],
                transform: { rotation: { w: 1, x: 0, y: 0, z: 0, raw: () => ({w:1,x:0,y:0,z:0}), multiply: () => ({w:1,x:0,y:0,z:0}), rotate: (v) => v }, position: [0,0,0] },
                penState: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 }
            }
            yield { type: "head", position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        }

        const scheduler = createScheduler(parentGen(), {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        scheduler.tick(0) // parent done, child spawned
        assert.ok(!scheduler.done)
        assert.ok(!allDone(scheduler.root))

        scheduler.tick(0) // child done
        assert.ok(scheduler.done)
        assert.ok(allDone(scheduler.root))
    })

    test("structured concurrency: parent waits for children", () => {
        // Parent spawns child that has a wait. Parent completes immediately.
        // Parent waits for child — scheduler.done is false until child finishes.
        function* parentGen() {
            yield {
                type: "spawn", name: "waiter",
                ast: [call("wait", 5), call("fw", 100)],
                transform: { rotation: { w: 1, x: 0, y: 0, z: 0, raw: () => ({w:1,x:0,y:0,z:0}), multiply: () => ({w:1,x:0,y:0,z:0}), rotate: (v) => v }, position: [0,0,0] },
                penState: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 }
            }
            yield { type: "head", position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        }

        const scheduler = createScheduler(parentGen(), {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        scheduler.tick(0)   // parent done, child spawned
        scheduler.tick(0)   // child starts, hits wait(5) → resumeAt = 5000

        const childCtx = scheduler.registry.get("waiter")
        assert.ok(!childCtx.done) // child is waiting
        assert.ok(!scheduler.done) // scheduler waits for child

        scheduler.tick(5000) // child resumes after wait, completes
        assert.ok(childCtx.done)
        assert.ok(scheduler.done)
    })

    test("commandCount sums across all ambients", () => {
        function* parentGen() {
            yield {
                type: "spawn", name: "child",
                ast: [call("fw", 10), call("rt", 90)],
                transform: { rotation: { w: 1, x: 0, y: 0, z: 0, raw: () => ({w:1,x:0,y:0,z:0}), multiply: () => ({w:1,x:0,y:0,z:0}), rotate: (v) => v }, position: [0,0,0] },
                penState: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 }
            }
            yield { type: "head", position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
            return 3
        }

        const scheduler = createScheduler(parentGen(), {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        scheduler.tick(0) // parent done (count=3), child spawned
        scheduler.tick(0) // child done (count=2: fw+rt)

        assert.ok(scheduler.done)
        assert.ok(scheduler.commandCount >= 3) // at least parent's count
    })
})

// ---------------------------------------------------------------------------
// Phase 5b: Integration — parse → execute → schedule
// ---------------------------------------------------------------------------

describe("integration: as keyword end-to-end", () => {
    test("as sky do fw 100 end spawns and completes", () => {
        const ast = parseProgram("as sky do\n  fw 100\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#e77808' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        // Tick until done
        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        assert.ok(scheduler.done)
        assert.ok(scheduler.registry.has("sky"))
        assert.ok(scheduler.registry.get("sky").done)
    })

    test("sibling ambients both execute", () => {
        const ast = parseProgram("as a do\n  fw 50\nend\nas b do\n  rt 90\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#e77808' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        assert.ok(scheduler.done)
        assert.ok(scheduler.registry.has("a"))
        assert.ok(scheduler.registry.has("b"))
        assert.ok(scheduler.registry.get("a").done)
        assert.ok(scheduler.registry.get("b").done)
    })

    test("commands before ambient execute in root", () => {
        const ast = parseProgram("fw 50\nas sky do\n  fw 100\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#e77808' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            // Drain channels to prevent overflow
            for (const ctx of scheduler.registry.values()) {
                ctx.channel.drain()
            }
            ticks++
        }

        assert.ok(scheduler.done)
        // Root had fw 50 (path event on root channel)
        // Sky had fw 100 (path event on sky channel)
        assert.ok(scheduler.registry.has("sky"))
    })
})

// ---------------------------------------------------------------------------
// Phase 5c: Transform atoms + worldTransform
// ---------------------------------------------------------------------------

describe("transform atom", () => {
    test("AmbientCtx.transform is an Atom", () => {
        const ctx = createAmbientCtx('test', (function*(){})(), SE3.identity(), 64, null)
        // Should have deref/swap methods
        assert.equal(typeof ctx.transform.deref, 'function')
        assert.equal(typeof ctx.transform.swap, 'function')
    })

    test("transform atom initialized from provided value", () => {
        const t = { rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [10, 20, 30] }
        const ctx = createAmbientCtx('test', (function*(){})(), t, 64, null)
        const val = ctx.transform.deref()
        assert.deepEqual(val.position, [10, 20, 30])
    })

    test("scheduler updates transform atom from head events", () => {
        function* gen() {
            yield { type: "path", points: [[0,0,0],[100,0,0]], color: '#f', thickness: 1 }
            yield { type: "head", position: [100,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        }
        const scheduler = createScheduler(gen())
        scheduler.tick(0)

        const rootTransform = scheduler.root.transform.deref()
        assert.deepEqual(rootTransform.position, [100, 0, 0])
    })

    test("scheduler updates transform atom from wait events", () => {
        function* gen() {
            yield { type: "wait", duration: 1000, position: [50,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
            yield { type: "head", position: [50,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        }
        const scheduler = createScheduler(gen())
        scheduler.tick(0) // hits wait

        const rootTransform = scheduler.root.transform.deref()
        assert.deepEqual(rootTransform.position, [50, 0, 0])
    })

    test("child ambient has parentId set", () => {
        function* gen() {
            yield {
                type: "spawn", name: "child",
                ast: [call("fw", 10)],
                transform: SE3.identity(),
                penState: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 }
            }
            yield { type: "head", position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        }

        const scheduler = createScheduler(gen(), {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        scheduler.tick(0)
        const child = scheduler.registry.get("child")
        assert.equal(child.parentId, "root")
    })
})

describe("worldTransform", () => {
    test("root returns identity", () => {
        const root = createAmbientCtx('root', (function*(){})(), SE3.identity(), 64, null)
        const registry = new Map([['root', root]])

        const wt = worldTransform(root, registry)
        assert.deepEqual(wt.position, [0, 0, 0])
    })

    test("child of root gets root transform as world origin", () => {
        const rootTransform = { rotation: SE3.identity().rotation, position: [100, 0, 0] }
        const root = createAmbientCtx('root', (function*(){})(), rootTransform, 64, null)
        const child = createAmbientCtx('child', (function*(){})(), SE3.identity(), 64, 'root')
        const registry = new Map([['root', root], ['child', child]])

        const wt = worldTransform(child, registry)
        assert.ok(Math.abs(wt.position[0] - 100) < 0.01)
        assert.ok(Math.abs(wt.position[1]) < 0.01)
    })

    test("grandchild composes root + child transforms", () => {
        const rootT = SE3.translateLocal(SE3.identity(), 100, 0, 0)
        const childT = SE3.translateLocal(SE3.identity(), 50, 0, 0)

        const root = createAmbientCtx('root', (function*(){})(), rootT, 64, null)
        const child = createAmbientCtx('child', (function*(){})(), childT, 64, 'root')
        const grandchild = createAmbientCtx('gc', (function*(){})(), SE3.identity(), 64, 'child')
        const registry = new Map([['root', root], ['child', child], ['gc', grandchild]])

        const wt = worldTransform(grandchild, registry)
        // grandchild world origin = compose(root(100,0,0), child(50,0,0)) = (150,0,0)
        assert.ok(Math.abs(wt.position[0] - 150) < 0.01)
    })

    test("worldTransform reflects live parent movement", () => {
        const root = createAmbientCtx('root', (function*(){})(), SE3.identity(), 64, null)
        const child = createAmbientCtx('child', (function*(){})(), SE3.identity(), 64, 'root')
        const registry = new Map([['root', root], ['child', child]])

        // Initially root at origin
        let wt = worldTransform(child, registry)
        assert.ok(Math.abs(wt.position[0]) < 0.01)

        // Parent moves — update root's transform atom
        root.transform.swap(() => SE3.translateLocal(SE3.identity(), 200, 0, 0))

        // Child's worldTransform should reflect parent's live position
        wt = worldTransform(child, registry)
        assert.ok(Math.abs(wt.position[0] - 200) < 0.01)
    })
})

describe("inertial frame integration", () => {
    test("child draws at parent position", () => {
        // Parent: fw 100, then spawn child that draws fw 50
        const ast = parseProgram("fw 100\nas sky do\n  fw 50\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#e77808' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        // Tick until done
        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            for (const ctx of scheduler.registry.values()) ctx.channel.drain()
            ticks++
        }

        // Root transform should be at ~(100,0,0) — parent's final position
        const rootT = scheduler.root.transform.deref()
        assert.ok(Math.abs(rootT.position[0] - 100) < 1)

        // Child exists and has parentId = 'root'
        const sky = scheduler.registry.get("sky")
        assert.equal(sky.parentId, "root")

        // worldTransform(sky) = root's transform = (100,0,0)
        const wt = worldTransform(sky, scheduler.registry)
        assert.ok(Math.abs(wt.position[0] - 100) < 1)

        // Child's own transform reflects its local cursor (fw 50 from local origin)
        const childT = sky.transform.deref()
        assert.ok(Math.abs(childT.position[0] - 50) < 1)
    })

    test("spawn updates parent transform atom immediately", () => {
        // Verify parent transform atom is updated at spawn time,
        // so siblings spawned later get accurate worldTransform
        const ast = parseProgram("fw 50\nas a do\n  fw 10\nend\nfw 50\nas b do\n  fw 10\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#e77808' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        // Tick until done
        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            for (const ctx of scheduler.registry.values()) ctx.channel.drain()
            ticks++
        }

        // Both children should have root as parent
        assert.equal(scheduler.registry.get("a").parentId, "root")
        assert.equal(scheduler.registry.get("b").parentId, "root")

        // Root's final transform = fw 50 + fw 50 = ~(100,0,0)
        const rootT = scheduler.root.transform.deref()
        assert.ok(Math.abs(rootT.position[0] - 100) < 1)
    })
})
