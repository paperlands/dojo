// Cross-ambient observation: world coordinates + fn capture
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { createScheduler, resolveBinding } from "../../assets/js/turtling/scheduler.js"
import { execute } from "../../assets/js/turtling/executor.js"
import { parseProgram } from "../../assets/js/turtling/parse.js"

function realDeps() {
    return { mathParser: new Parser(), mathEvaluator: new Evaluator() }
}
function findChild(root, name) { return root.children.get(name) || null }

describe("SPATIAL reads world coordinates", () => {
    test(".x returns world-space x for offset child", () => {
        const ast = parseProgram("fw 100\nas kid do\n  fw 10\nend")
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        for (let i = 0; i < 10; i++) { sched.tick(0); if (sched.done) break }

        const x = resolveBinding(sched.root, 'kid.x')
        assert.equal(x, 110, `kid.x should be world-space 110, got ${x}`)
    })

    test(".x and .y reflect heading in world space", () => {
        // Root moves fw 100, rt 90, spawns child who does fw 50
        // In world space child moves in -Y direction
        // World: child at (100, -50, 0)
        const ast = parseProgram("fw 100\nrt 90\nas kid do\n  fw 50\nend")
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        for (let i = 0; i < 10; i++) { sched.tick(0); if (sched.done) break }

        const x = resolveBinding(sched.root, 'kid.x')
        const y = resolveBinding(sched.root, 'kid.y')
        assert.ok(Math.abs(x - 100) < 0.001, `kid.x should be ~100, got ${x}`)
        assert.ok(Math.abs(y - (-50)) < 0.001, `kid.y should be ~-50, got ${y}`)
    })

    test(".x updates across ticks with world coords", () => {
        const ast = parseProgram(
            "fw 100\nrt 90\n" +
            "as kid do\n  loop 3 do\n    fw 10\n    wait 1\n  end\nend"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        sched.tick(0)

        const yValues = []
        for (let tick = 1; tick <= 3; tick++) {
            sched.tick(tick * 1000)
            yValues.push(resolveBinding(sched.root, 'kid.y'))
        }

        assert.ok(yValues[0] < 0, `y should be negative after first tick: ${yValues[0]}`)
        assert.ok(yValues[1] < yValues[0], `y should decrease: ${yValues}`)
        // Third tick: loop completes, no more fw — value plateaus
        assert.ok(yValues[2] <= yValues[1], `y should not increase: ${yValues}`)
    })
})

describe("RELATIONAL uses world coordinates", () => {
    test("distance computed in world space", () => {
        const ast = parseProgram(
            "fw 100\nas a do\n  fw 0\nend\n" +
            "home\nas b do\n  fw 0\nend"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        for (let i = 0; i < 10; i++) { sched.tick(0); if (sched.done) break }

        const dist = resolveBinding(findChild(sched.root, 'b'), 'a.distance')
        assert.ok(Math.abs(dist - 100) < 0.001, `distance should be ~100, got ${dist}`)
    })
})

describe("fn captures evaluator constants at definition time", () => {
    test("fn count is frozen at definition time across inner loops", () => {
        const ast = parseProgram(
            "loop 2 do\n" +
            "  as 'c[count]' do\n" +
            "    fn myid [count]\n" +
            "    loop 3 do\n" +
            "      wait 0\n" +
            "    end\n" +
            "  end\n" +
            "end"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        for (let i = 0; i < 50; i++) { sched.tick(i * 100); if (sched.done) break }

        assert.equal(resolveBinding(sched.root, 'c0.myid'), 0, 'c0 should capture count=0')
        assert.equal(resolveBinding(sched.root, 'c1.myid'), 1, 'c1 should capture count=1')
    })

    test("fn follow [count+1]//2 is stable across inner loop iterations", () => {
        const ast = parseProgram(
            "loop 2 do\n" +
            "  as 'mice[count]' do\n" +
            "    fn follow [count+1]//2\n" +
            "    loop 3 do\n" +
            "      wait 0\n" +
            "    end\n" +
            "  end\n" +
            "end"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        for (let i = 0; i < 50; i++) { sched.tick(i * 100); if (sched.done) break }

        assert.equal(resolveBinding(sched.root, 'mice0.follow'), 1, 'mice0 follow=1')
        assert.equal(resolveBinding(sched.root, 'mice1.follow'), 0, 'mice1 follow=0')
    })
})

// --- Yield and auto-yield tests ---

describe("explicit yield command", () => {
    test("yield gives other ambients a turn without advancing time", () => {
        // Two ambients: a moves fw 10 per step, b reads a.x with yield
        const ast = parseProgram(
            "as a do\n  loop 3 do\n    fw 10\n    yield\n  end\nend\n" +
            "as b do\n  loop 3 do\n    fw a.x\n    yield\n  end\nend"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        // All at t=0 — yield doesn't introduce time
        for (let i = 0; i < 100; i++) { sched.tick(0); if (sched.done) break }

        const aTime = resolveBinding(sched.root, 'a.time')
        const bTime = resolveBinding(sched.root, 'b.time')
        assert.equal(aTime, 0, `yield should not advance time, got a.time=${aTime}`)
        assert.equal(bTime, 0, `yield should not advance time, got b.time=${bTime}`)
    })

    test("yield creates interleaving between siblings", () => {
        // a: fw 10, yield, fw 10, yield, fw 10 — ends at x=30
        // b: reads a.x each step with yield — should see a.x change between steps
        const ast = parseProgram(
            "as a do\n  loop 3 do\n    fw 10\n    yield\n  end\nend\n" +
            "as b do\n  loop 3 do\n    fw a.x\n    yield\n  end\nend"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        for (let i = 0; i < 100; i++) { sched.tick(0); if (sched.done) break }

        // b moved fw by a.x at each step. If interleaved:
        // step 1: a.x=10, b moves 10 → b.x=10
        // step 2: a.x=20, b moves 20 → b.x=30
        // step 3: a.x=30, b moves 30 → b.x=60
        // If NOT interleaved (stale): b would read a.x=10 three times → b.x=30
        const bx = resolveBinding(sched.root, 'b.x')
        assert.ok(bx > 30, `b.x should be > 30 (interleaved), got ${bx}`)
    })
})

describe("auto-yield on cross-ambient observation", () => {
    test("loop with cross-ambient read auto-yields between iterations", () => {
        // Same as above but WITHOUT explicit yield — auto-yield should kick in
        const ast = parseProgram(
            "as a do\n  loop 3 do\n    fw 10\n  end\nend\n" +
            "as b do\n  loop 3 do\n    fw a.x\n  end\nend"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        for (let i = 0; i < 100; i++) { sched.tick(0); if (sched.done) break }

        // With auto-yield, b should see a.x update between iterations
        const bx = resolveBinding(sched.root, 'b.x')
        assert.ok(bx > 30, `auto-yield: b.x should be > 30 (interleaved), got ${bx}`)
    })

    test("no auto-yield without cross-ambient read", () => {
        // Pure loop with no sibling reads — should complete in one tick
        const ast = parseProgram(
            "as a do\n  loop 100 do\n    fw 1\n  end\nend"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        sched.tick(0)
        // After one tick, ambient should be done (no yields to slow it down)
        const a = findChild(sched.root, 'a')
        assert.ok(a.done, `pure loop should complete in one tick pass`)
    })

    test("no auto-yield on self-read (own x/y)", () => {
        // Reading own coordinates is not cross-ambient — should not yield
        const ast = parseProgram(
            "as a do\n  loop 100 do\n    fw 1\n    rt x\n  end\nend"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        sched.tick(0)
        const a = findChild(sched.root, 'a')
        // x/y/count are evaluator constants, not dotted ambient reads
        assert.ok(a.done, `self-read loop should complete in one tick pass`)
    })

    test("pursuit curve: mice converge without explicit wait or yield", () => {
        // 4 mice chasing each other in a square — should converge toward center
        const ast = parseProgram(
            "loop 4 do\n" +
            "  fw 100\n" +
            "  rt 90\n" +
            "  as 'mice[count]' do\n" +
            "    fn follow [count+1]//4\n" +
            "    loop 50 do\n" +
            "      fw 1\n" +
            "      faceto 'mice[follow]'.x 'mice[follow]'.y\n" +
            "    end\n" +
            "  end\n" +
            "end"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        for (let i = 0; i < 2000; i++) { sched.tick(0); if (sched.done) break }

        // All 4 mice should converge toward the center (0,0)
        // With interleaving, distance to center should decrease
        const positions = []
        for (let m = 0; m < 4; m++) {
            const mx = resolveBinding(sched.root, `mice${m}.x`)
            const my = resolveBinding(sched.root, `mice${m}.y`)
            positions.push({ x: mx, y: my })
        }

        // Distance between mice0 and mice2 (diagonally opposite) should be
        // much less than initial 200 (they started 100 apart on each axis)
        const dx = positions[0].x - positions[2].x
        const dy = positions[0].y - positions[2].y
        const diagDist = Math.sqrt(dx * dx + dy * dy)
        assert.ok(diagDist < 100,
            `mice should converge (diagonal distance ${diagDist.toFixed(1)} should be < 100)`)
    })
})

describe("mice program: world-space values update across ticks", () => {
    test("cross-ambient .x and .y reflect world-space movement", () => {
        const ast = parseProgram(
            "loop 2 do\n" +
            "  fw 1000\n" +
            "  rt 90\n" +
            "  as 'mice[count]' do\n" +
            "    fn follow [count+1]//2\n" +
            "    loop 5 do\n" +
            "      wait 1\n" +
            "      fw 10\n" +
            "    end\n" +
            "  end\n" +
            "end"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const sched = createScheduler(gen, {
            createDeps: realDeps, execOpts: { color: '#fff' }, rootDeps: deps
        })
        sched.tick(0)

        const mice0 = findChild(sched.root, 'mice0')
        const mice1 = findChild(sched.root, 'mice1')
        assert.ok(mice0 && mice1, 'both mice should exist')

        // mice0 origin at (1000, 0, 0) heading -Y in world
        // mice1 origin at (1000, -1000, 0) heading -X in world
        const xValues = []
        const yValues = []
        for (let tick = 1; tick <= 5; tick++) {
            sched.tick(tick * 1000)
            xValues.push(resolveBinding(sched.root, 'mice0.x'))
            yValues.push(resolveBinding(sched.root, 'mice0.y'))
        }

        // mice0 moves in -Y direction (world), so x stays ~1000, y decreases
        assert.ok(Math.abs(xValues[0] - 1000) < 0.001,
            `mice0 world x should be ~1000, got ${xValues[0]}`)
        assert.ok(yValues[0] < 0,
            `mice0 world y should be negative: ${yValues[0]}`)
        assert.ok(yValues[4] < yValues[0],
            `mice0 world y should decrease over time: ${yValues}`)

        console.log(`mice0 world x: ${xValues}`)
        console.log(`mice0 world y: ${yValues}`)
    })
})
