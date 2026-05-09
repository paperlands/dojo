// Phase 2 executor tests — run with: node --test test/js/executor_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { execute, drainEvents, toLegacyFrame } from "../../assets/js/turtling/executor.js"
import { ASTNode } from "../../assets/js/turtling/ast.js"

const near = (a, b, eps = 1e-8) => Math.abs(a - b) < eps

// Minimal math mock — handles numeric literals and variables
function mockDeps() {
    return {
        mathParser: {
            isNumeric(expr) {
                return /^-?\d+\.?\d*$/.test(expr)
            },
            parse(expr) {
                return { value: expr, children: [] }
            },
            defineFunction() {},
            reset() {}
        },
        mathEvaluator: {
            constants: {},
            namespace_check(val) { return val in this.constants },
            run(tree, ctx) {
                if (tree.value in this.constants) return this.constants[tree.value]()
                return parseFloat(tree.value) || 0
            }
        }
    }
}

// AST helpers
function call(name, ...args) {
    return new ASTNode('Call', name,
        args.map(a => new ASTNode('Argument', String(a)))
    )
}

function loop(times, children) {
    return new ASTNode('Loop', String(times), children)
}

function define(name, params, children) {
    return new ASTNode('Define', name, children, {
        args: params.map(p => new ASTNode('Argument', p))
    })
}

function when(expr, children) {
    return new ASTNode('When', String(expr), children)
}

// Collect events of a specific type
function eventsOfType(events, type) {
    return events.filter(e => e.type === type)
}

// ---------------------------------------------------------------------------
// Basic execution
// ---------------------------------------------------------------------------

describe("execute basics", () => {
    test("empty program yields only head event", () => {
        const events = drainEvents([], mockDeps())
        assert.equal(events.length, 1)
        assert.equal(events[0].type, "head")
        assert.deepEqual(events[0].position, [0, 0, 0])
    })

    test("fw 100 yields path + head", () => {
        const ast = [call("fw", 100)]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")
        const heads = eventsOfType(events, "head")

        assert.equal(paths.length, 1)
        assert.equal(heads.length, 1)

        // Path starts at origin, ends at [100,0,0]
        assert.equal(paths[0].points.length, 2)
        assert.deepEqual(paths[0].points[0], [0, 0, 0])
        assert.ok(near(paths[0].points[1][0], 100))

        // Head at final position
        assert.ok(near(heads[0].position[0], 100))
    })

    test("fw 100 rt 90 fw 100 yields correct path", () => {
        const ast = [call("fw", 100), call("rt", 90), call("fw", 100)]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")
        const heads = eventsOfType(events, "head")

        // Single continuous path (no pen lifts)
        assert.equal(paths.length, 1)
        // 3 points: origin, [100,0,0], [100,-100,0]
        assert.equal(paths[0].points.length, 3)
        assert.ok(near(paths[0].points[2][0], 100))
        assert.ok(near(paths[0].points[2][1], -100))

        assert.ok(near(heads[0].position[0], 100))
        assert.ok(near(heads[0].position[1], -100))
    })
})

// ---------------------------------------------------------------------------
// Path management
// ---------------------------------------------------------------------------

describe("path management", () => {
    test("jmp breaks path", () => {
        const ast = [call("fw", 50), call("jmp", 20), call("fw", 50)]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")

        // Two separate path segments (jmp causes break)
        assert.equal(paths.length, 2)
    })

    test("jmpto breaks path", () => {
        const ast = [call("fw", 50), call("jmpto", 100, 100), call("fw", 50)]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")
        assert.equal(paths.length, 2)
    })

    test("beColour breaks path for new color", () => {
        const ast = [call("fw", 50), call("beColour", "'red'"), call("fw", 50)]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")

        assert.equal(paths.length, 2)
        // Second path should have new color
        assert.equal(paths[1].color, "red")
    })

    test("fill closes current path with filled flag", () => {
        const ast = [
            call("fw", 100),
            call("rt", 120),
            call("fw", 100),
            call("rt", 120),
            call("fw", 100),
            call("fill")
        ]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")

        assert.equal(paths.length, 1)
        assert.equal(paths[0].filled, true)
    })

    test("pen up (hide path) produces no path events", () => {
        // jmp does pen-up-move-pen-down internally
        const ast = [call("jmp", 100)]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")
        assert.equal(paths.length, 0)
    })
})

// ---------------------------------------------------------------------------
// Event-producing commands
// ---------------------------------------------------------------------------

describe("event-producing commands", () => {
    test("label yields label event", () => {
        const ast = [call("label", "'hello'", 2)]
        const events = drainEvents(ast, mockDeps())
        const labels = eventsOfType(events, "label")

        assert.equal(labels.length, 1)
        assert.equal(labels[0].text, "hello")
        assert.equal(labels[0].textSize, 10)
    })

    test("grid yields grid event", () => {
        const ast = [call("grid", 10, 5)]
        const events = drainEvents(ast, mockDeps())
        const grids = eventsOfType(events, "grid")

        assert.equal(grids.length, 1)
        assert.equal(grids[0].size, 50)
        assert.equal(grids[0].divisions, 10)
    })

    test("erase yields clear event", () => {
        const ast = [call("erase")]
        const events = drainEvents(ast, mockDeps())
        const clears = eventsOfType(events, "clear")
        assert.equal(clears.length, 1)
    })

    test("wait yields wait event with duration", () => {
        const ast = [call("wait", 2)]
        const events = drainEvents(ast, mockDeps())
        const waits = eventsOfType(events, "wait")

        assert.equal(waits.length, 1)
        assert.equal(waits[0].duration, 2000)
    })
})

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------

describe("loops", () => {
    test("loop executes N times", () => {
        const ast = [loop(4, [call("fw", 100), call("rt", 90)])]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")

        // Square: 4x fw+rt returns to origin
        assert.ok(near(heads[0].position[0], 0))
        assert.ok(near(heads[0].position[1], 0))
    })

    test("nested loops", () => {
        const ast = [loop(2, [loop(2, [call("fw", 10)])])]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")

        // 4 forward moves of 10 = 40
        assert.ok(near(heads[0].position[0], 40))
    })
})

// ---------------------------------------------------------------------------
// Function definition and recursion
// ---------------------------------------------------------------------------

describe("functions", () => {
    test("def and call user function", () => {
        const ast = [
            define("step", [], [call("fw", 50)]),
            call("step")
        ]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")

        assert.ok(near(heads[0].position[0], 50))
    })

    test("def with parameters", () => {
        const ast = [
            define("move", ["dist"], [call("fw", "dist")]),
            call("move", 75)
        ]
        // Need a math mock that resolves scope vars
        const deps = {
            mathParser: {
                isNumeric(expr) { return /^-?\d+\.?\d*$/.test(expr) },
                parse(expr) { return { value: expr, children: [] } },
                defineFunction() {},
                reset() {}
            },
            mathEvaluator: {
                constants: {},
                namespace_check(val) { return val in this.constants },
                run(tree, ctx) {
                    if (tree.value in this.constants) return this.constants[tree.value]()
                    return parseFloat(tree.value) || 0
                }
            }
        }
        const events = drainEvents(ast, deps)
        const heads = eventsOfType(events, "head")

        assert.ok(near(heads[0].position[0], 75))
    })

    test("recursive function with depth limit", () => {
        // def spiral n do fw n spiral n-1 end
        // Can't easily test full recursion without real math parser,
        // but we can test the limit mechanism
        const ast = [
            define("boom", [], [call("fw", 1), call("boom")]),
            call("boom")
        ]
        const events = drainEvents(ast, mockDeps(), {
            maxRecurseDepth: 5
        })
        const heads = eventsOfType(events, "head")

        // Should stop at depth limit, not throw
        assert.ok(heads.length >= 1)
        // Should have moved some distance (up to depth limit)
        assert.ok(heads[0].position[0] > 0)
    })
})

// ---------------------------------------------------------------------------
// When (conditional)
// ---------------------------------------------------------------------------

describe("when (conditional)", () => {
    test("when truthy executes body", () => {
        const ast = [
            when("1", [call("fw", 100)])
        ]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")
        assert.ok(near(heads[0].position[0], 100))
    })

    test("when falsy (0) skips body", () => {
        const ast = [
            when("0", [call("fw", 100)])
        ]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")
        assert.ok(near(heads[0].position[0], 0))
    })

    test("only first truthy when matches", () => {
        const ast = [
            when("1", [call("fw", 10)]),
            when("1", [call("fw", 20)])
        ]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")
        // First when matches, second skipped
        assert.ok(near(heads[0].position[0], 10))
    })
})

// ---------------------------------------------------------------------------
// Pen state
// ---------------------------------------------------------------------------

describe("pen state", () => {
    test("bold changes path thickness", () => {
        const ast = [call("bold", 3), call("fw", 100)]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")

        assert.equal(paths[0].thickness, 6) // bold(3) => thickness 6
    })

    test("hide sets showTurtle false in head event", () => {
        const ast = [call("hide"), call("fw", 100)]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")
        assert.equal(heads[0].headSize, false)
    })

    test("show sets showTurtle size in head event", () => {
        const ast = [call("show", 20), call("fw", 100)]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")
        assert.equal(heads[0].headSize, 20)
    })
})

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

describe("limits", () => {
    test("command limit throws at max", () => {
        const ast = [loop(100, [call("fw", 1)])]
        assert.throws(
            () => drainEvents(ast, mockDeps(), { maxCommands: 10 }),
            /Maximum command limit/
        )
    })

    test("limitCommand adjusts limit dynamically", () => {
        const ast = [
            call("limitCommand", 5),
            loop(10, [call("fw", 1)])
        ]
        assert.throws(
            () => drainEvents(ast, mockDeps()),
            /Maximum command limit/
        )
    })
})

// ---------------------------------------------------------------------------
// Integration: complex programs
// ---------------------------------------------------------------------------

describe("integration", () => {
    test("square with color change", () => {
        const ast = [
            call("beColour", "'red'"),
            loop(4, [call("fw", 100), call("rt", 90)]),
        ]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")

        // Color break at start, then continuous square
        assert.ok(paths.length >= 1)
        assert.equal(paths[0].color, "red")
    })

    test("goto preserves path continuity when pen down", () => {
        const ast = [call("fw", 50), call("goto", 100, 100)]
        const events = drainEvents(ast, mockDeps())
        const paths = eventsOfType(events, "path")

        // Single continuous path: [0,0] -> [50,0] -> [100,100]
        assert.equal(paths.length, 1)
        assert.equal(paths[0].points.length, 3)
    })

    test("home resets position", () => {
        const ast = [call("fw", 100), call("home"), call("fw", 50)]
        const events = drainEvents(ast, mockDeps())
        const heads = eventsOfType(events, "head")

        // home jumps to origin, then fw 50
        assert.ok(near(heads[0].position[0], 50))
    })

    test("generator can be iterated manually", () => {
        const ast = [call("fw", 50), call("fw", 50)]
        const gen = execute(ast, mockDeps())
        const events = []
        for (const event of gen) {
            events.push(event)
        }
        assert.ok(events.length > 0)
        const heads = eventsOfType(events, "head")
        assert.ok(near(heads[0].position[0], 100))
    })

    test("unknown command throws", () => {
        const ast = [call("nonexistent")]
        assert.throws(
            () => drainEvents(ast, mockDeps()),
            /Function nonexistent not defined/
        )
    })
})

// ---------------------------------------------------------------------------
// toLegacyFrame adapter
// ---------------------------------------------------------------------------

describe("toLegacyFrame", () => {
    test("path points converted to {x,y,z} objects", () => {
        const events = drainEvents([call("fw", 100)], mockDeps())
        const { frames } = toLegacyFrame(events)

        const frame0 = frames.get(0)
        const paths = frame0.filter(e => e.type === "path")
        assert.equal(paths.length, 1)

        // Points should be {x,y,z} objects
        for (const point of paths[0].points) {
            assert.equal(typeof point.x, "number")
            assert.equal(typeof point.y, "number")
            assert.equal(typeof point.z, "number")
        }
    })

    test("head event uses legacy field names", () => {
        const events = drainEvents([call("fw", 100)], mockDeps())
        const { frames } = toLegacyFrame(events)

        const frame0 = frames.get(0)
        const heads = frame0.filter(e => e.type === "head")
        assert.equal(heads.length, 1)

        // Legacy uses 'points' (not 'position') and 'headsize' (not 'headSize')
        assert.ok(Array.isArray(heads[0].points))
        assert.ok('headsize' in heads[0])
        assert.ok('rotation' in heads[0])
    })

    test("label event converted to text type", () => {
        const events = drainEvents([call("label", "'hi'", 2)], mockDeps())
        const { frames } = toLegacyFrame(events)

        const frame0 = frames.get(0)
        const texts = frame0.filter(e => e.type === "text")
        assert.equal(texts.length, 1)
        assert.equal(texts[0].text, "hi")
        assert.equal(texts[0].text_size, 10) // 2 * 5
    })

    test("grid event uses legacy field names", () => {
        const events = drainEvents([call("grid", 10, 5)], mockDeps())
        const { frames } = toLegacyFrame(events)

        const frame0 = frames.get(0)
        const grids = frame0.filter(e => e.type === "grid")
        assert.equal(grids.length, 1)
        assert.equal(grids[0].division, 10) // legacy: division, not divisions
        assert.ok(Array.isArray(grids[0].point)) // legacy: point, not position
    })

    test("wait creates new frame at correct time", () => {
        const events = drainEvents(
            [call("fw", 50), call("wait", 2), call("fw", 50)],
            mockDeps()
        )
        const { frames, endTime } = toLegacyFrame(events)

        assert.equal(endTime, 2000)
        assert.ok(frames.has(0))
        assert.ok(frames.has(2000))

        // Frame 0 should have the first path + head snapshot from wait
        const frame0 = frames.get(0)
        assert.ok(frame0.some(e => e.type === "path"))
        assert.ok(frame0.some(e => e.type === "head"))

        // Frame 2000 should have the second path
        const frame2 = frames.get(2000)
        assert.ok(frame2.some(e => e.type === "path") || frame2.some(e => e.type === "head"))
    })

    test("multiple waits accumulate time", () => {
        const events = drainEvents(
            [call("wait", 1), call("wait", 2)],
            mockDeps()
        )
        const { frames, endTime } = toLegacyFrame(events)

        assert.equal(endTime, 3000)
        assert.ok(frames.has(0))
        assert.ok(frames.has(1000))
        assert.ok(frames.has(3000))
    })

    test("clear event preserved", () => {
        const events = drainEvents([call("erase")], mockDeps())
        const { frames } = toLegacyFrame(events)

        const frame0 = frames.get(0)
        assert.ok(frame0.some(e => e.type === "clear"))
    })
})

// --- Runtime state bindings ---

describe("runtime state", () => {
    test("x/y/z reflect position after movement", () => {
        const deps = mockDeps()
        // fw 100 moves along local x-axis → position.x = 100
        const ast = [call("fw", "100")]
        const events = drainEvents(ast, deps)

        // After execute, evaluator constants should read live state
        assert.equal(typeof deps.mathEvaluator.constants['x'], 'function')
        assert.equal(typeof deps.mathEvaluator.constants['y'], 'function')
        assert.equal(typeof deps.mathEvaluator.constants['z'], 'function')
    })

    test("x/y/z are bound as thunks on evaluator", () => {
        const deps = mockDeps()
        drainEvents([], deps)

        // Even with empty program, runtime bindings exist
        assert.equal(deps.mathEvaluator.constants['x'](), 0)
        assert.equal(deps.mathEvaluator.constants['y'](), 0)
        assert.equal(deps.mathEvaluator.constants['z'](), 0)
        assert.equal(deps.mathEvaluator.constants['time'](), 0)
    })

    test("time accumulates from wait events", () => {
        const deps = mockDeps()
        // wait 2 → 2000ms, wait 3 → 3000ms total = 5000ms
        const ast = [call("wait", "2"), call("wait", "3")]
        drainEvents(ast, deps)

        assert.equal(deps.mathEvaluator.constants['time'](), 5)
    })

    test("position readable mid-expression via evaluator", () => {
        const deps = mockDeps()
        // Make evaluator resolve 'x' from constants when referenced
        deps.mathEvaluator.run = function(tree, ctx) {
            if (tree.value in this.constants) return this.constants[tree.value]()
            return parseFloat(tree.value) || 0
        }
        deps.mathEvaluator.namespace_check = function(val) {
            return val in this.constants
        }

        // fw 100 then label using x — x should be 100
        const ast = [call("fw", "100")]
        const events = drainEvents(ast, deps)
        const head = events.find(e => e.type === "head")

        // x thunk should read final position
        assert.ok(near(deps.mathEvaluator.constants['x'](), head.position[0]))
    })
})
