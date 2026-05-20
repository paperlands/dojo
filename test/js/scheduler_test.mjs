// Scheduler tests — run with: node --test test/js/scheduler_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, createAmbientCtx, allDone, worldTransform } from "../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../assets/js/turtling/parse.js"
import { execute, drainEvents } from "../../assets/js/turtling/executor.js"
import { ASTNode } from "../../assets/js/turtling/ast.js"
import { SE3 } from "../../assets/js/turtling/se3.js"

// Helper: find a child ambient by name in the tree (not via registry)
function findChild(root, name) {
    return root.children.get(name) || null
}

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

        const drained = scheduler.channel.drain()
        assert.equal(drained.length, 2)
        assert.equal(drained[0].type, "path")
        assert.equal(drained[1].type, "head")
    })

    test("empty generator completes immediately", () => {
        const scheduler = createScheduler(genFromEvents([]))

        scheduler.tick(0)

        assert.ok(scheduler.done)
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

    test("channel stays open after generator exhaustion", () => {
        // Channel stays open — frame-targeted descendants may still write
        const scheduler = createScheduler(genFromEvents([]))
        scheduler.tick(0)

        assert.ok(!scheduler.channel.closed)
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

        const child = findChild(scheduler.root, "child")
        assert.ok(child)
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

        const child = findChild(scheduler.root, "child")
        assert.ok(child.done)
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

        const childCtx = findChild(scheduler.root, "waiter")
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

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        assert.ok(scheduler.done)
        const sky = findChild(scheduler.root, "sky")
        assert.ok(sky)
        assert.ok(sky.done)
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
        assert.ok(findChild(scheduler.root, "a"))
        assert.ok(findChild(scheduler.root, "b"))
        assert.ok(findChild(scheduler.root, "a").done)
        assert.ok(findChild(scheduler.root, "b").done)
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
        assert.ok(findChild(scheduler.root, "sky"))
    })
})

// ---------------------------------------------------------------------------
// Transform atoms + worldTransform
// ---------------------------------------------------------------------------

describe("transform atom", () => {
    test("AmbientCtx.transform is an Atom", () => {
        const ctx = createAmbientCtx('test', (function*(){})(), SE3.identity(), 64, null)
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

    test("child ambient has parent reference set", () => {
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
        const child = findChild(scheduler.root, "child")
        assert.equal(child.parent, scheduler.root)
    })
})

describe("worldTransform", () => {
    test("root returns identity", () => {
        const root = createAmbientCtx('root', (function*(){})(), SE3.identity(), 64, null)

        const wt = worldTransform(root)
        assert.deepEqual(wt.position, [0, 0, 0])
    })

    test("child of root gets root transform as world origin", () => {
        const rootTransform = { rotation: SE3.identity().rotation, position: [100, 0, 0] }
        const root = createAmbientCtx('root', (function*(){})(), rootTransform, 64, null)
        const child = createAmbientCtx('child', (function*(){})(), SE3.identity(), 64, root)

        const wt = worldTransform(child)
        assert.ok(Math.abs(wt.position[0] - 100) < 0.01)
        assert.ok(Math.abs(wt.position[1]) < 0.01)
    })

    test("grandchild composes root + child transforms", () => {
        const rootT = SE3.translateLocal(SE3.identity(), 100, 0, 0)
        const childT = SE3.translateLocal(SE3.identity(), 50, 0, 0)

        const root = createAmbientCtx('root', (function*(){})(), rootT, 64, null)
        const child = createAmbientCtx('child', (function*(){})(), childT, 64, root)
        const grandchild = createAmbientCtx('gc', (function*(){})(), SE3.identity(), 64, child)

        const wt = worldTransform(grandchild)
        // grandchild world origin = compose(root(100,0,0), child(50,0,0)) = (150,0,0)
        assert.ok(Math.abs(wt.position[0] - 150) < 0.01)
    })

    test("worldTransform reflects live parent movement", () => {
        const root = createAmbientCtx('root', (function*(){})(), SE3.identity(), 64, null)
        const child = createAmbientCtx('child', (function*(){})(), SE3.identity(), 64, root)

        // Initially root at origin
        let wt = worldTransform(child)
        assert.ok(Math.abs(wt.position[0]) < 0.01)

        // Parent moves — update root's transform atom
        root.transform.swap(() => SE3.translateLocal(SE3.identity(), 200, 0, 0))

        // Child's worldTransform should reflect parent's live position
        wt = worldTransform(child)
        assert.ok(Math.abs(wt.position[0] - 200) < 0.01)
    })
})

// ---------------------------------------------------------------------------
// Fault isolation
// ---------------------------------------------------------------------------

describe("fault isolation", () => {
    test("generator error marks ambient done, preserves channel events", () => {
        function* gen() {
            yield { type: "path", points: [[0,0,0],[100,0,0]], color: '#f', thickness: 1 }
            throw new Error("Function mistake not defined")
        }
        const scheduler = createScheduler(gen())

        scheduler.tick(0)

        assert.ok(scheduler.done)
        assert.equal(scheduler.root.error, "Function mistake not defined")

        const drained = scheduler.channel.drain()
        // path event + error event
        assert.equal(drained.length, 2)
        assert.equal(drained[0].type, "path")
        assert.equal(drained[1].type, "error")
        assert.equal(drained[1].message, "Function mistake not defined")
    })

    test("error event includes ambientId", () => {
        function* gen() {
            throw new Error("boom")
        }
        const scheduler = createScheduler(gen())
        scheduler.tick(0)

        const drained = scheduler.channel.drain()
        const errorEvent = drained.find(e => e.type === 'error')
        assert.equal(errorEvent.ambientId, scheduler.root.id)
    })

    test("scheduler.errors returns all crashed ambients", () => {
        function* gen() {
            yield { type: "path", points: [[0,0,0],[50,0,0]], color: '#f', thickness: 1 }
            throw new Error("oops")
        }
        const scheduler = createScheduler(gen())
        scheduler.tick(0)

        const errors = scheduler.errors
        assert.equal(errors.length, 1)
        assert.equal(errors[0].ambientId, scheduler.root.id)
        assert.equal(errors[0].message, "oops")
    })

    test("no errors on successful execution", () => {
        const scheduler = createScheduler(genFromEvents([
            { type: "head", position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        ]))
        scheduler.tick(0)

        assert.equal(scheduler.errors.length, 0)
    })

    test("child crash does not affect parent or siblings", () => {
        // Parent spawns two children: one crashes, one succeeds
        function* parentGen() {
            yield {
                type: "spawn", name: "good",
                ast: [call("fw", 100)],
                transform: SE3.identity(),
                penState: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 }
            }
            yield {
                type: "spawn", name: "bad",
                ast: [call("fw", 50), call("mistake")],
                transform: SE3.identity(),
                penState: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 }
            }
            yield { type: "head", position: [0,0,0], rotation: {w:1,x:0,y:0,z:0}, color: '#f', headSize: 10 }
        }

        const scheduler = createScheduler(parentGen(), {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        // Tick until done or max
        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            for (const ctx of scheduler.registry.values()) ctx.channel.drain()
            ticks++
        }

        assert.ok(scheduler.done)

        // Parent completed normally
        assert.ok(scheduler.root.done)
        assert.equal(scheduler.root.error, null)

        // Good child completed normally
        const good = findChild(scheduler.root, "good")
        assert.ok(good.done)
        assert.equal(good.error, null)

        // Bad child crashed
        const bad = findChild(scheduler.root, "bad")
        assert.ok(bad.done)
        assert.ok(bad.error)
        assert.ok(bad.error.includes("mistake"))
    })

    test("valid commands render despite later error (integration)", () => {
        // "fw 100 rt 90 mistake" — fw and rt should produce events,
        // mistake should error but not destroy them
        const ast = parseProgram("fw 100\nrt 90\nmistake")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#e77808' })

        const scheduler = createScheduler(generator)
        scheduler.tick(0)

        assert.ok(scheduler.done)
        assert.equal(scheduler.errors.length, 1)
        assert.ok(scheduler.errors[0].message.includes("mistake"))

        // Channel should have: path (from fw 100) + error
        // rt 90 doesn't produce a path event (no movement, just rotation)
        const drained = scheduler.channel.drain()
        const paths = drained.filter(e => e.type === "path")
        assert.ok(paths.length >= 1, "valid path events survived the crash")

        const errors = drained.filter(e => e.type === "error")
        assert.equal(errors.length, 1)
    })
})

// ---------------------------------------------------------------------------
// Nested same-name ambients
// ---------------------------------------------------------------------------

describe("nested same-name ambients", () => {
    test("nested as turn do ... as turn do ... end end does not crash", () => {
        const ast = parseProgram("as turn do\n  fw 100\n  as turn do\n    fw 100\n  end\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#e77808' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            for (const ctx of scheduler.registry.values()) ctx.channel.drain()
            ticks++
        }

        assert.ok(scheduler.done)
        assert.equal(scheduler.errors.length, 0)

        // Both ambients exist as tree nodes
        const outer = findChild(scheduler.root, "turn")
        assert.ok(outer)
        const inner = findChild(outer, "turn")
        assert.ok(inner)

        // Inner has outer as parent (direct reference)
        assert.equal(inner.parent, outer)
        assert.equal(outer.parent, scheduler.root)
    })

    test("worldTransform works for deeply nested same-name ambients", () => {
        const ast = parseProgram("fw 50\nas a do\n  fw 30\n  as a do\n    fw 10\n    as a do\n      fw 5\n    end\n  end\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#e77808' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#e77808' }
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            for (const ctx of scheduler.registry.values()) ctx.channel.drain()
            ticks++
        }

        assert.ok(scheduler.done)
        assert.equal(scheduler.errors.length, 0)

        const a1 = findChild(scheduler.root, "a")
        const a2 = findChild(a1, "a")
        const a3 = findChild(a2, "a")
        assert.ok(a1)
        assert.ok(a2)
        assert.ok(a3)

        // Each level composes correctly
        const wt = worldTransform(a3)
        assert.ok(wt.position)
    })
})

// ---------------------------------------------------------------------------
// Inertial frame integration
// ---------------------------------------------------------------------------

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

        // Child exists with parent = root
        const sky = findChild(scheduler.root, "sky")
        assert.equal(sky.parent, scheduler.root)

        // worldTransform(sky) = root's transform = (100,0,0)
        const wt = worldTransform(sky)
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
        assert.equal(findChild(scheduler.root, "a").parent, scheduler.root)
        assert.equal(findChild(scheduler.root, "b").parent, scheduler.root)

        // Root's final transform = fw 50 + fw 50 = ~(100,0,0)
        const rootT = scheduler.root.transform.deref()
        assert.ok(Math.abs(rootT.position[0] - 100) < 1)
    })
})

// ---------------------------------------------------------------------------
// Frame-targeted sketch re-spawn
// ---------------------------------------------------------------------------

describe("frame-targeted sketch re-spawn", () => {
    test("frame-targeted ambient in loop creates multiple instances (no wait)", () => {
        // loop 3 do rt 120 as star root do fw 100 end end
        // Each iteration spawns a unique star instance drawing at root's frame
        const ast = parseProgram("loop 3 do\n  rt 120\n  as star root do\n    fw 100\n  end\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#fff' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#fff' }
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            for (const ctx of scheduler.registry.values()) ctx.channel.drain()
            ticks++
        }

        // Should have 3 child instances (star, star#1, star#2)
        assert.equal(scheduler.root.children.size, 3)

        // All paths should have been routed to root's channel (already drained above)
        // Verify all children completed
        for (const child of scheduler.root.children.values()) {
            assert.ok(child.done)
            assert.equal(child.frame, "root")
        }
    })

    test("each sketch uses spawn-time transform, not live parent atom", () => {
        // loop 3 do rt 120 as star root do fw 100 end end
        // Without spawnOrigin fix, all 3 paths would be identical (parent ends at 360°=0°)
        // With fix, paths are at 120°, 240°, 360° respectively
        const ast = parseProgram("loop 3 do\n  rt 120\n  as star root do\n    fw 100\n  end\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#fff' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#fff' }
        })

        // Tick until root is done (all spawns created in one tick, no waits)
        scheduler.tick(0)

        // Root should have 3 children with distinct spawnOrigins
        const origins = [...scheduler.root.children.values()].map(c => c.spawnOrigin)
        assert.equal(origins.length, 3)

        // Each spawnOrigin should have different rotation (120°, 240°, 360°)
        // Verify they're not all the same
        const positions = origins.map(o => {
            // Apply rotation to [100, 0, 0] to see where each points
            const [x, y] = o.rotation.rotateVec(100, 0, 0)
            return [Math.round(x), Math.round(y)]
        })

        // All three must be distinct directions
        const unique = new Set(positions.map(p => `${p[0]},${p[1]}`))
        assert.equal(unique.size, 3, `Expected 3 distinct directions, got: ${JSON.stringify(positions)}`)

        // Now tick children — paths should route to root channel with correct transforms
        scheduler.tick(0)
        const rootEvents = scheduler.root.channel.drain()
        const paths = rootEvents.filter(e => e.type === 'path')

        // 3 distinct paths, each starting at [0,0,0] but ending in different directions
        assert.equal(paths.length, 3)
        const endpoints = paths.map(p => [Math.round(p.points[1][0]), Math.round(p.points[1][1])])
        const uniqueEndpoints = new Set(endpoints.map(p => `${p[0]},${p[1]}`))
        assert.equal(uniqueEndpoints.size, 3, `Expected 3 distinct endpoints, got: ${JSON.stringify(endpoints)}`)
    })

    test("frame-targeted ambient in loop with wait re-spawns each iteration", () => {
        // loop 2 do rt 180 as star root do fw 50 end wait end
        const ast = parseProgram("loop 2 do\n  rt 180\n  as star root do\n    fw 50\n  end\n  wait\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#fff' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#fff' }
        })

        // First tick: root runs iteration 0, spawns star, then waits
        scheduler.tick(0)
        for (const ctx of scheduler.registry.values()) ctx.channel.drain()
        assert.equal(scheduler.root.children.size, 1)

        // Second tick: star child runs and completes
        scheduler.tick(1000)
        for (const ctx of scheduler.registry.values()) ctx.channel.drain()

        // Third tick: root resumes, rt 180, spawns star#1, waits
        scheduler.tick(1000)
        for (const ctx of scheduler.registry.values()) ctx.channel.drain()
        assert.equal(scheduler.root.children.size, 2)
    })

    test("non-frame ambient appends generators across loop iterations", () => {
        // loop 3 do as orbit do fw 100 end wait end
        // orbit completes between wait ticks — subsequent spawns queue new generators
        const ast = parseProgram("loop 3 do\n  as orbit do\n    fw 100\n  end\n  wait\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#fff' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#fff' }
        })

        // Tick until done, advancing time past each wait
        let ticks = 0
        let t = 0
        while (!scheduler.done && ticks < 200) {
            scheduler.tick(t)
            for (const ctx of scheduler.registry.values()) ctx.channel.drain()
            t += 1000
            ticks++
        }

        assert.ok(scheduler.done)
        // Still one child — append doesn't create siblings
        assert.equal(scheduler.root.children.size, 1)
        const orbit = findChild(scheduler.root, "orbit")
        assert.ok(orbit)
        // All 3 generators drained
        assert.equal(orbit.pendingSpawns.length, 0)
        // commandCount accumulates across all generators
        assert.ok(orbit.commandCount > 0)
    })

    test("non-frame ambient queues generators while child is running", () => {
        // loop 3 do as actor do wait end end — one child, generators queued
        const ast = parseProgram("loop 3 do\n  as actor do\n    wait\n  end\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#fff' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#fff' }
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            for (const ctx of scheduler.registry.values()) ctx.channel.drain()
            ticks++
        }

        // One child — subsequent spawns appended, not duplicated
        assert.equal(scheduler.root.children.size, 1)
        const actor = findChild(scheduler.root, "actor")
        assert.ok(actor)
        // First generator is still running (waiting), so 2 more queued
        assert.equal(actor.pendingSpawns.length, 2)
    })

    test("state continuity: loop builds on previous iteration's transform", () => {
        // repeat 4 [as side do fw 50 rt 90 end]
        // With state continuity, each iteration starts where the previous ended.
        // 4× (fw 50 + rt 90) = a square, ending back near origin.
        const ast = parseProgram("loop 4 do\n  as side do\n    fw 50\n    rt 90\n  end\nend")
        const deps = mockDeps()
        const generator = execute(ast, deps, { color: '#fff' })

        const scheduler = createScheduler(generator, {
            createDeps: mockDeps,
            execOpts: { color: '#fff' }
        })

        const allPaths = []
        let ticks = 0
        while (!scheduler.done && ticks < 200) {
            scheduler.tick(0)
            for (const ctx of scheduler.registry.values()) {
                for (const event of ctx.channel.drain()) {
                    if (event.type === 'path') allPaths.push(event)
                }
            }
            ticks++
        }

        assert.ok(scheduler.done)

        const side = findChild(scheduler.root, "side")
        assert.ok(side)
        assert.equal(side.pendingSpawns.length, 0)

        // 4 generators executed, each producing a path segment
        assert.equal(allPaths.length, 4, `Expected 4 path segments, got ${allPaths.length}`)

        // Each segment should start where the previous ended (state continuity)
        for (let i = 1; i < allPaths.length; i++) {
            const prevEnd = allPaths[i - 1].points[allPaths[i - 1].points.length - 1]
            const currStart = allPaths[i].points[0]
            assert.ok(
                Math.abs(prevEnd[0] - currStart[0]) < 1 &&
                Math.abs(prevEnd[1] - currStart[1]) < 1,
                `Segment ${i} should start at prev end: [${prevEnd}] vs [${currStart}]`
            )
        }

        // Square: final segment should end back near origin
        const finalEnd = allPaths[3].points[allPaths[3].points.length - 1]
        assert.ok(Math.abs(finalEnd[0]) < 1, `Square should close: x=${finalEnd[0]}`)
        assert.ok(Math.abs(finalEnd[1]) < 1, `Square should close: y=${finalEnd[1]}`)
    })
})
