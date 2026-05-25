// Inter-ambient communication tests
// Run with: node --test test/js/communication_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Lexer } from "../../assets/js/turtling/mafs/lexer.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { createScheduler, createFrame, resolveBinding } from "../../assets/js/turtling/scheduler.js"
import { createRingBuffer } from "../../assets/js/turtling/ring-buffer.js"
import { execute, drainEvents } from "../../assets/js/turtling/executor.js"
import { parseProgram } from "../../assets/js/turtling/parse.js"
import { ASTNode } from "../../assets/js/turtling/ast.js"
import { SE3 } from "../../assets/js/turtling/se3.js"

// ============================================================================
// Phase 1: Lexer dotted identifiers + Evaluator resolveExternal
// ============================================================================

describe("Phase 1: lexer dotted identifiers", () => {
    const lexer = new Lexer()

    test("leader.x tokenizes as single IDENTIFIER", () => {
        const tokens = lexer.tokenize("leader.x")
        assert.equal(tokens.length, 1)
        assert.equal(tokens[0].type, "IDENTIFIER")
        assert.equal(tokens[0].value, "leader.x")
    })

    test("leader.speed tokenizes as single IDENTIFIER", () => {
        const tokens = lexer.tokenize("leader.speed")
        assert.equal(tokens.length, 1)
        assert.equal(tokens[0].type, "IDENTIFIER")
        assert.equal(tokens[0].value, "leader.speed")
    })

    test("deep dotted path: world.ball.x", () => {
        const tokens = lexer.tokenize("world.ball.x")
        assert.equal(tokens.length, 1)
        assert.equal(tokens[0].type, "IDENTIFIER")
        assert.equal(tokens[0].value, "world.ball.x")
    })

    test("3.14 still tokenizes as NUMBER", () => {
        const tokens = lexer.tokenize("3.14")
        assert.equal(tokens.length, 1)
        assert.equal(tokens[0].type, "NUMBER")
        assert.equal(tokens[0].value, "3.14")
    })

    test("leader.x - x tokenizes as IDENTIFIER OPERATOR IDENTIFIER", () => {
        const tokens = lexer.tokenize("leader.x - x")
        assert.equal(tokens.length, 3)
        assert.equal(tokens[0].type, "IDENTIFIER")
        assert.equal(tokens[0].value, "leader.x")
        assert.equal(tokens[1].type, "OPERATOR")
        assert.equal(tokens[1].value, "-")
        assert.equal(tokens[2].type, "IDENTIFIER")
        assert.equal(tokens[2].value, "x")
    })

    test("3.14 + leader.x is NUMBER OPERATOR IDENTIFIER", () => {
        const tokens = lexer.tokenize("3.14 + leader.x")
        assert.equal(tokens.length, 3)
        assert.equal(tokens[0].type, "NUMBER")
        assert.equal(tokens[0].value, "3.14")
        assert.equal(tokens[1].type, "OPERATOR")
        assert.equal(tokens[2].type, "IDENTIFIER")
        assert.equal(tokens[2].value, "leader.x")
    })

    test("bare identifier still works", () => {
        const tokens = lexer.tokenize("speed")
        assert.equal(tokens.length, 1)
        assert.equal(tokens[0].type, "IDENTIFIER")
        assert.equal(tokens[0].value, "speed")
    })

    test("dotted in expression context: sin(leader.x)", () => {
        const tokens = lexer.tokenize("sin(leader.x)")
        assert.equal(tokens.length, 4) // sin ( leader.x )
        assert.equal(tokens[0].value, "sin")
        assert.equal(tokens[2].type, "IDENTIFIER")
        assert.equal(tokens[2].value, "leader.x")
    })
})

describe("Phase 1: evaluator resolveExternal", () => {
    test("resolveExternal is called for unknown variables", () => {
        const evaluator = new Evaluator()
        let calledWith = null
        evaluator.resolveExternal = (variable) => {
            calledWith = variable
            return 42
        }
        const result = evaluator.resolveContext("gravity", {})
        assert.equal(calledWith, "gravity")
        assert.equal(result, 42)
    })

    test("resolveExternal receives dotted variable name", () => {
        const evaluator = new Evaluator()
        let calledWith = null
        evaluator.resolveExternal = (variable) => {
            calledWith = variable
            return 100
        }
        const result = evaluator.resolveContext("leader.x", {})
        assert.equal(calledWith, "leader.x")
        assert.equal(result, 100)
    })

    test("context variables take priority over resolveExternal", () => {
        const evaluator = new Evaluator()
        evaluator.resolveExternal = () => 999
        const result = evaluator.resolveContext("x", { x: 50 })
        assert.equal(result, 50)
    })

    test("throws when no resolveExternal and variable unknown", () => {
        const evaluator = new Evaluator()
        assert.throws(
            () => evaluator.resolveContext("unknown", {}),
            /Undefined variable/
        )
    })

    test("resolveExternal works in full expression evaluation", () => {
        const evaluator = new Evaluator()
        const lexer = new Lexer()
        const parser = new Parser(lexer)

        evaluator.resolveExternal = (variable) => {
            if (variable === "leader.x") return 100
            throw new Error(`Undefined variable: ${variable}`)
        }

        const tree = parser.parse("leader.x")
        const result = evaluator.run(tree, {})
        assert.equal(result, 100)
    })

    test("dotted access in arithmetic expression", () => {
        const evaluator = new Evaluator()
        const lexer = new Lexer()
        const parser = new Parser(lexer)

        evaluator.resolveExternal = (variable) => {
            if (variable === "leader.x") return 100
            throw new Error(`Undefined variable: ${variable}`)
        }
        evaluator.constants["x"] = () => 30

        const tree = parser.parse("leader.x - x")
        const result = evaluator.run(tree, {})
        assert.equal(result, 70)
    })
})

// ============================================================================
// Phase 2: Sibling observation + ancestor fn inheritance
// ============================================================================

// Real deps factory — uses actual Parser/Evaluator for fn binding tests
function realDeps() {
    return {
        mathParser: new Parser(),
        mathEvaluator: new Evaluator()
    }
}

// Helper: find child by name
function findChild(root, name) {
    return root.children.get(name) || null
}

describe("Phase 2: resolveBinding — sibling observation", () => {
    test("leader.x resolves sibling transform position", () => {
        // Set up: root with two children (leader and follower)
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.transform.swap(() => ({ position: [100, 0, 0], rotation: { w: 1, x: 0, y: 0, z: 0 } }))
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        // follower reads leader.x
        const x = resolveBinding(follower, 'leader.x')
        assert.equal(x, 100)
    })

    test("leader.y and leader.z resolve correct axes", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.transform.swap(() => ({ position: [10, 20, 30], rotation: { w: 1, x: 0, y: 0, z: 0 } }))
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        assert.equal(resolveBinding(follower, 'leader.y'), 20)
        assert.equal(resolveBinding(follower, 'leader.z'), 30)
    })

    test("leader.done resolves completion state", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        assert.equal(resolveBinding(follower, 'leader.done'), 0)
        leader.done = true
        assert.equal(resolveBinding(follower, 'leader.done'), 1)
    })

    test("leader.heading resolves rotation as degrees", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        // 90 degree Y rotation: w=cos(45°), y=sin(45°)
        const a = Math.PI / 4
        leader.transform.swap(() => ({
            position: [0, 0, 0],
            rotation: { w: Math.cos(a), x: 0, y: Math.sin(a), z: 0 }
        }))
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        const heading = resolveBinding(follower, 'leader.heading')
        assert.ok(Math.abs(heading - 90) < 0.001, `expected ~90, got ${heading}`)
    })

    test("undefined sibling throws", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const child = createFrame('child', (function*(){})(), { parent: root })
        root.children.set('child', child)

        assert.throws(
            () => resolveBinding(child, 'ghost.x'),
            /Undefined ambient: ghost/
        )
    })

    test("undefined property on sibling throws", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.deps = realDeps() // no fn bindings
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        assert.throws(
            () => resolveBinding(follower, 'leader.nonexistent'),
            /Undefined property/
        )
    })

    test("leader.speed resolves sibling fn binding", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        const leaderDeps = realDeps()
        // fn speed 5 → defines 'speed:0' in userspace
        leaderDeps.mathParser.defineFunction('speed', '5', {})
        leader.deps = leaderDeps
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        const speed = resolveBinding(follower, 'leader.speed')
        assert.equal(speed, 5)
    })
})

describe("Phase 2b: resolveBinding — temporal observation", () => {
    test("leader.time resolves accumulated wait-seconds", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.elapsedTime = 0
        leader.commandCount = 0
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        assert.equal(resolveBinding(follower, 'leader.time'), 0)
        leader.elapsedTime = 2.5
        assert.equal(resolveBinding(follower, 'leader.time'), 2.5)
    })

    test("leader.commands resolves command count", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.elapsedTime = 0
        leader.commandCount = 42
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        assert.equal(resolveBinding(follower, 'leader.commands'), 42)
    })

    test("leader.done works via TEMPORAL (migrated from special case)", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        root.children.set('follower', follower)

        assert.equal(resolveBinding(follower, 'leader.done'), 0)
        leader.done = true
        assert.equal(resolveBinding(follower, 'leader.done'), 1)
    })
})

describe("Phase 2c: resolveBinding — relational observation", () => {
    test("leader.distance resolves Euclidean distance between observer and target", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.transform.swap(() => ({ position: [30, 40, 0], rotation: { w: 1, x: 0, y: 0, z: 0 } }))
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        follower.transform.swap(() => ({ position: [0, 0, 0], rotation: { w: 1, x: 0, y: 0, z: 0 } }))
        root.children.set('follower', follower)

        const dist = resolveBinding(follower, 'leader.distance')
        assert.equal(dist, 50) // 3-4-5 triangle scaled by 10
    })

    test("leader.distance works in 3D", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.transform.swap(() => ({ position: [1, 2, 2], rotation: { w: 1, x: 0, y: 0, z: 0 } }))
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        follower.transform.swap(() => ({ position: [0, 0, 0], rotation: { w: 1, x: 0, y: 0, z: 0 } }))
        root.children.set('follower', follower)

        const dist = resolveBinding(follower, 'leader.distance')
        assert.equal(dist, 3) // sqrt(1+4+4) = 3
    })

    test("leader.bearing resolves angular direction from observer to target", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        // Target directly to the right (+x) of observer at origin facing up (+y)
        leader.transform.swap(() => ({ position: [100, 0, 0], rotation: { w: 1, x: 0, y: 0, z: 0 } }))
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        // Observer at origin, heading 0 (facing +y, identity quaternion)
        follower.transform.swap(() => ({ position: [0, 0, 0], rotation: { w: 1, x: 0, y: 0, z: 0 } }))
        root.children.set('follower', follower)

        const bearing = resolveBinding(follower, 'leader.bearing')
        assert.ok(Math.abs(bearing - 90) < 0.001, `expected ~90, got ${bearing}`)
    })

    test("leader.sync resolves wait delta needed to catch up", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.elapsedTime = 3.5
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        follower.elapsedTime = 1.0
        root.children.set('follower', follower)

        // follower needs to wait 2.5s to sync with leader
        assert.equal(resolveBinding(follower, 'leader.sync'), 2.5)
    })

    test("leader.sync clamps to zero when observer is ahead", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const leader = createFrame('leader', (function*(){})(), { parent: root })
        leader.elapsedTime = 1.0
        root.children.set('leader', leader)

        const follower = createFrame('follower', (function*(){})(), { parent: root })
        follower.elapsedTime = 3.0
        root.children.set('follower', follower)

        // follower is already ahead — no wait needed
        assert.equal(resolveBinding(follower, 'leader.sync'), 0)
    })
})

describe("Phase 2d: resolveBinding — ancestor fn inheritance", () => {
    test("unqualified fn resolves from parent", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const rootDeps = realDeps()
        rootDeps.mathParser.defineFunction('gravity', '9.8', {})
        root.deps = rootDeps

        const child = createFrame('child', (function*(){})(), { parent: root })
        root.children.set('child', child)

        const gravity = resolveBinding(child, 'gravity')
        assert.ok(Math.abs(gravity - 9.8) < 0.001)
    })

    test("fn resolves from grandparent", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const rootDeps = realDeps()
        rootDeps.mathParser.defineFunction('gravity', '9.8', {})
        root.deps = rootDeps

        const child = createFrame('child', (function*(){})(), { parent: root })
        child.deps = realDeps() // no gravity here
        root.children.set('child', child)

        const grandchild = createFrame('gc', (function*(){})(), { parent: child })
        child.children.set('gc', grandchild)

        const gravity = resolveBinding(grandchild, 'gravity')
        assert.ok(Math.abs(gravity - 9.8) < 0.001)
    })

    test("child fn shadows parent fn", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        const rootDeps = realDeps()
        rootDeps.mathParser.defineFunction('speed', '5', {})
        root.deps = rootDeps

        const child = createFrame('child', (function*(){})(), { parent: root })
        const childDeps = realDeps()
        childDeps.mathParser.defineFunction('speed', '10', {})
        child.deps = childDeps

        const grandchild = createFrame('gc', (function*(){})(), { parent: child })
        child.children.set('gc', grandchild)

        // grandchild sees child's speed (10), not root's (5)
        assert.equal(resolveBinding(grandchild, 'speed'), 10)
    })

    test("undefined unqualified variable returns undefined", () => {
        const root = createFrame('root', (function*(){})(), { channelCapacity: 64 })
        root.deps = realDeps()

        const child = createFrame('child', (function*(){})(), { parent: root })
        root.children.set('child', child)

        assert.equal(resolveBinding(child, 'nonexistent'), undefined)
    })
})

describe("Phase 2: end-to-end observation via scheduler", () => {
    test("child reads sibling position via dotted access", () => {
        // as leader do fw 100 end
        // as follower do fw leader.x end
        const ast = parseProgram("as leader do\n  fw 100\nend\nas follower do\n  fw leader.x\nend")
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })

        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        // Tick until done
        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        assert.ok(scheduler.done, `scheduler should complete, took ${ticks} ticks`)

        const leader = findChild(scheduler.root, 'leader')
        const follower = findChild(scheduler.root, 'follower')
        assert.ok(leader)
        assert.ok(follower)

        // leader moved fw 100 → x=100
        const lt = leader.transform.deref()
        assert.ok(Math.abs(lt.position[0] - 100) < 0.001)

        // follower moved fw leader.x (100) → x=100
        const ft = follower.transform.deref()
        assert.ok(Math.abs(ft.position[0] - 100) < 0.001, `follower x should be ~100, got ${ft.position[0]}`)
    })

    test("child inherits parent fn binding", () => {
        const ast = parseProgram("fn speed 50\nas child do\n  fw speed\nend")
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })

        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        assert.ok(scheduler.done)
        const child = findChild(scheduler.root, 'child')
        const ct = child.transform.deref()
        assert.ok(Math.abs(ct.position[0] - 50) < 0.001, `child x should be ~50, got ${ct.position[0]}`)
    })

    test("child calls parent fn with arity via dotted access", () => {
        // as sky do fn sine[x] sin[x] end  — child calls sky.sine[20]
        const ast = parseProgram(
            "as sky do\n  fn sine[x] sin[x]\n  as telos do\n    fw sky.sine[20]\n  end\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        const sky = findChild(scheduler.root, 'sky')
        const telos = sky.children.get('telos')
        const expected = Math.sin(20 * Math.PI / 180)
        assert.ok(Math.abs(telos.transform.deref().position[0] - expected) < 0.001,
            `sky.sine[20] should resolve to sin(20°)`)
    })

    test("sibling calls sibling fn with arity", () => {
        const ast = parseProgram(
            "as lib do\n  fn double[x] x*2\nend\n" +
            "as user do\n  fw lib.double[25]\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        const user = findChild(scheduler.root, 'user')
        assert.ok(Math.abs(user.transform.deref().position[0] - 50) < 0.001,
            `lib.double[25] should resolve to 50`)
    })
})

// ============================================================================
// Phase 3: Frame mailbox + shout directive
// ============================================================================

describe("Phase 3: frame mailbox", () => {
    test("frame has empty mailbox on creation", () => {
        const frame = createFrame('test', (function*(){})(), { channelCapacity: 64 })
        assert.ok(Array.isArray(frame.mailbox))
        assert.equal(frame.mailbox.length, 0)
    })
})

describe("Phase 3: shout directive", () => {
    test("executor yields shout directive for shout command", () => {
        const ast = parseProgram("shout 'beat' 120")
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const events = []
        for (const e of gen) events.push(e)
        const shouts = events.filter(e => e.type === 'shout')
        assert.equal(shouts.length, 1)
        assert.equal(shouts[0].name, 'beat')
        assert.equal(shouts[0].payload, 120)
    })

    test("shout with fn binding as payload", () => {
        const ast = parseProgram("fn bpm 120\nshout 'beat' bpm")
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const events = []
        for (const e of gen) events.push(e)
        const shouts = events.filter(e => e.type === 'shout')
        assert.equal(shouts.length, 1)
        assert.equal(shouts[0].payload, 120)
    })

    test("shout with string payload", () => {
        const ast = parseProgram("shout 'color' 'red'")
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const events = []
        for (const e of gen) events.push(e)
        const shouts = events.filter(e => e.type === 'shout')
        assert.equal(shouts[0].name, 'color')
        assert.equal(shouts[0].payload, 'red')
    })

    test("shout without payload yields undefined payload", () => {
        const ast = parseProgram("shout 'go'")
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const events = []
        for (const e of gen) events.push(e)
        const shouts = events.filter(e => e.type === 'shout')
        assert.equal(shouts[0].name, 'go')
        assert.equal(shouts[0].payload, undefined)
    })
})

describe("Phase 3: scheduler shout routing", () => {
    test("shout delivers to all other ambients", () => {
        // Root spawns two children. Child A shouts. Both root and child B should receive.
        const ast = parseProgram(
            "as a do\n  shout 'hello' 42\nend\n" +
            "as b do\n  fw 1\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        // Child A should NOT have the event in its own mailbox
        const a = findChild(scheduler.root, 'a')
        assert.equal(a.mailbox.length, 0, "sender should not receive own shout")

        // Root and child B should have it
        assert.ok(scheduler.root.mailbox.length > 0, "root should receive shout")
        assert.equal(scheduler.root.mailbox[0].name, 'hello')
        assert.equal(scheduler.root.mailbox[0].payload, 42)

        const b = findChild(scheduler.root, 'b')
        assert.ok(b.mailbox.length > 0, "sibling should receive shout")
        assert.equal(b.mailbox[0].name, 'hello')
    })

    test("shout with fn-bound message name", () => {
        const ast = parseProgram(
            "as sender do\n  fn msg 'ping'\n  shout msg 99\nend\n" +
            "as receiver do\n  fw 1\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        let ticks = 0
        while (!scheduler.done && ticks < 100) {
            scheduler.tick(0)
            ticks++
        }

        const receiver = findChild(scheduler.root, 'receiver')
        assert.ok(receiver.mailbox.length > 0, "receiver should get the shout")
        assert.equal(receiver.mailbox[0].name, 'ping')
        assert.equal(receiver.mailbox[0].payload, 99)
    })
})

// ============================================================================
// Phase 4: when event mode + prefix matching + payload binding
// ============================================================================

describe("Phase 4: parser — when event mode", () => {
    test("when with string literal parses as event handler", () => {
        const ast = parseProgram("when 'go' do\n  fw 10\nend")
        assert.equal(ast[0].type, 'When')
        assert.equal(ast[0].value, "'go'")
        assert.equal(ast[0].meta.event, true)
        assert.equal(ast[0].meta.binding, undefined)
    })

    test("when with string literal and binding var", () => {
        const ast = parseProgram("when 'beat' tempo do\n  fw tempo\nend")
        assert.equal(ast[0].type, 'When')
        assert.equal(ast[0].value, "'beat'")
        assert.equal(ast[0].meta.event, true)
        assert.equal(ast[0].meta.binding, 'tempo')
    })

    test("when with expression parses as conditional guard", () => {
        const ast = parseProgram("when x > 100 do\n  fw 10\nend")
        assert.equal(ast[0].type, 'When')
        assert.equal(ast[0].value, 'x > 100')
        assert.equal(ast[0].meta.event, undefined)
    })
})

describe("Phase 4: executor — matchPattern", () => {
    test("exact match fires (no brackets)", () => {
        const ast = parseProgram("when 'go' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'go', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        assert.ok(events.some(e => e.type === 'head'), "should execute body on exact match")
        assert.equal(mailbox.length, 0, "consumed event should be removed from mailbox")
    })

    test("exact match without brackets does NOT prefix match", () => {
        const ast = parseProgram("when 'dancer' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'dancer.go', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const paths = events.filter(e => e.type === 'path')
        assert.equal(paths.length, 0, "bare string should not prefix match")
        assert.equal(mailbox.length, 1, "event should remain unconsumed")
    })

    test("bracket capture matches — 'dancer.[action]'", () => {
        const ast = parseProgram("when 'dancer.[action]' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'dancer.go', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        assert.ok(events.some(e => e.type === 'head'), "should match with bracket capture")
        assert.equal(mailbox.length, 0)
    })

    test("capture binds to scope variable", () => {
        const ast = parseProgram("when 'step.[n]' do\n  fw n\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'step.25', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0] - 25) < 0.001,
            `capture should bind n=25, got x=${head.position[0]}`)
    })

    test("catch-all [msg] matches any event name", () => {
        const ast = parseProgram("when '[msg]' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'dancer.go.fast', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        assert.ok(events.some(e => e.type === 'head'), "catch-all should match any event")
        assert.equal(mailbox.length, 0)
    })

    test("dot-free pattern — 'step[n]' matches 'step3'", () => {
        const ast = parseProgram("when 'step[n]' do\n  fw n\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'step3', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0] - 3) < 0.001,
            `dot-free capture, expected x~3 got ${head.position[0]}`)
    })

    test("[who].go captures prefix", () => {
        const ast = parseProgram("when '[who].go' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'dancer.go', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        assert.ok(events.some(e => e.type === 'head'), "should match [who].go")
        assert.equal(mailbox.length, 0)
    })

    test("trailing literal rejects unmatched suffix", () => {
        const ast = parseProgram("when '[who].go' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'dancer.go.fast', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const paths = events.filter(e => e.type === 'path')
        assert.equal(paths.length, 0, "trailing literal must end the string")
        assert.equal(mailbox.length, 1)
    })

    test("trailing capture is greedy — consumes rest of string", () => {
        const ast = parseProgram("when 'ns.[rest]' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'ns.a.b.c', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        assert.ok(events.some(e => e.type === 'head'), "trailing capture should be greedy")
        assert.equal(mailbox.length, 0)
    })

    test("[_] discard matches but does not bind", () => {
        const ast = parseProgram("when 'step.[_]' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'step.99', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        assert.ok(events.some(e => e.type === 'head'), "[_] should match")
        assert.equal(mailbox.length, 0)
    })

    test("no match leaves mailbox intact", () => {
        const ast = parseProgram("when 'stop' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'go', payload: 42 }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        assert.equal(mailbox.length, 1, "unmatched event stays in mailbox")
        assert.equal(mailbox[0].name, 'go')
    })

    test("numeric capture coerces to number", () => {
        const ast = parseProgram("when 'lane.[n]' do\n  fw n\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'lane.42', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0] - 42) < 0.001,
            `numeric capture should coerce, got x=${head.position[0]}`)
    })

    test("captures + payload binding together", () => {
        const ast = parseProgram("when 'dancer.[action]' data do\n  fw data\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'dancer.go', payload: 60 }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0] - 60) < 0.001,
            `payload binding should work alongside captures, got x=${head.position[0]}`)
    })

    test("multiple captures — '[a]-[b]' matches 'hello-world'", () => {
        const ast = parseProgram("when '[a]-[b]' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'hello-world', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        assert.ok(events.some(e => e.type === 'head'), "multi-capture should match")
        assert.equal(mailbox.length, 0)
    })
})

describe("Phase 4: executor — payload binding", () => {
    test("when binds payload to scope variable", () => {
        // when 'move' dist do fw dist end — payload becomes dist
        const ast = parseProgram("when 'move' dist do\n  fw dist\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'move', payload: 75 }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)

        // fw 75 should produce a head at x=75
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(head)
        assert.ok(Math.abs(head.position[0] - 75) < 0.001, `expected x~75, got ${head.position[0]}`)
    })

    test("when without binding var ignores payload", () => {
        const ast = parseProgram("when 'go' do\n  fw 10\nend")
        const deps = realDeps()
        const mailbox = [{ name: 'go', payload: 999 }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0] - 10) < 0.001, "should fw 10 regardless of payload")
    })
})

describe("Phase 4: executor — event when independence from matched flag", () => {
    test("multiple event whens are independent (not mutually exclusive)", () => {
        // Two event handlers at same level should both fire if both events present
        const ast = parseProgram(
            "when 'a' do\n  fw 10\nend\n" +
            "when 'b' do\n  fw 20\nend"
        )
        const deps = realDeps()
        const mailbox = [
            { name: 'a', payload: undefined },
            { name: 'b', payload: undefined }
        ]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        // Both handlers fire: fw 10 + fw 20 = 30
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0] - 30) < 0.001,
            `both handlers should fire, expected x~30 got ${head.position[0]}`)
        assert.equal(mailbox.length, 0, "both events consumed")
    })

    test("conditional whens are mutually exclusive (first-match-wins)", () => {
        // Two conditional guards — only first true one fires
        const ast = parseProgram(
            "when 1 do\n  fw 10\nend\n" +
            "when 1 do\n  fw 20\nend"
        )
        const deps = realDeps()
        const gen = execute(ast, deps, { color: '#fff' })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        // Only first fires: fw 10
        assert.ok(Math.abs(head.position[0] - 10) < 0.001,
            `only first conditional should fire, expected x~10 got ${head.position[0]}`)
    })

    test("event when and conditional when compose orthogonally", () => {
        // Event handler fires independently of conditional matched flag
        const ast = parseProgram(
            "when 1 do\n  fw 10\nend\n" +
            "when 'go' do\n  fw 20\nend"
        )
        const deps = realDeps()
        const mailbox = [{ name: 'go', payload: undefined }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        // Both fire: conditional fw 10 + event fw 20 = 30
        assert.ok(Math.abs(head.position[0] - 30) < 0.001,
            `both should fire, expected x~30 got ${head.position[0]}`)
    })
})

describe("Phase 4: scheduler — end-to-end shout/when", () => {
    test("child A shouts, child B receives via when handler", () => {
        const ast = parseProgram(
            "as sender do\n  shout 'ping' 42\nend\n" +
            "as receiver do\n  loop 20 do\n    when 'ping' val do\n      fw val\n    end\n    wait 0.01\n  end\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 200; i++) {
            scheduler.tick(10)
            if (scheduler.done) break
        }

        const receiver = findChild(scheduler.root, 'receiver')
        assert.ok(receiver)
        const rt = receiver.transform.deref()
        assert.ok(Math.abs(rt.position[0] - 42) < 0.001,
            `receiver should have moved fw 42, got x=${rt.position[0]}`)
    })

    test("bracket pattern matching works end-to-end", () => {
        const ast = parseProgram(
            "as sender do\n  shout 'dancer.go' 10\nend\n" +
            "as listener do\n  loop 20 do\n    when 'dancer.[_]' dist do\n      fw dist\n    end\n    wait 0.01\n  end\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 200; i++) {
            scheduler.tick(10)
            if (scheduler.done) break
        }

        const listener = findChild(scheduler.root, 'listener')
        const lt = listener.transform.deref()
        assert.ok(Math.abs(lt.position[0] - 10) < 0.001,
            `listener should have moved fw 10 via bracket pattern, got x=${lt.position[0]}`)
    })

    test("shout consumed by first matching when — not duplicated", () => {
        // Two when handlers for same event at same level: first match wins (top-to-bottom)
        const ast = parseProgram(
            "as sender do\n  shout 'go' 5\nend\n" +
            "as receiver do\n  loop 20 do\n    when 'go' v do\n      fw v\n    end\n    when 'go' v do\n      fw v\n    end\n    wait 0.01\n  end\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 200; i++) {
            scheduler.tick(10)
            if (scheduler.done) break
        }

        const receiver = findChild(scheduler.root, 'receiver')
        const rt = receiver.transform.deref()
        // Only first handler fires, consuming the event. fw 5 once, not twice.
        assert.ok(Math.abs(rt.position[0] - 5) < 0.001,
            `event consumed by first handler only, expected x~5 got ${rt.position[0]}`)
    })
})

// ============================================================================
// Phase 5: Integration — expressiveness scenarios from the spec
// ============================================================================

describe("Phase 5: observation — follow me", () => {
    test("follower tracks leader position via dotted access", () => {
        // as leader do fw 80 end
        // as follower do fw leader.x end
        const ast = parseProgram(
            "as leader do\n  fw 80\nend\n" +
            "as follower do\n  fw leader.x\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 100; i++) {
            scheduler.tick(0)
            if (scheduler.done) break
        }

        const leader = findChild(scheduler.root, 'leader')
        const follower = findChild(scheduler.root, 'follower')
        const lx = leader.transform.deref().position[0]
        const fx = follower.transform.deref().position[0]
        assert.ok(Math.abs(lx - 80) < 0.001)
        assert.ok(Math.abs(fx - 80) < 0.001,
            `follower should track leader, expected x~80 got ${fx}`)
    })
})

describe("Phase 5: inheritance — same rules", () => {
    test("children inherit parent fn binding", () => {
        // fn speed 30
        // as a do fw speed end
        // as b do fw speed end
        const ast = parseProgram(
            "fn speed 30\n" +
            "as a do\n  fw speed\nend\n" +
            "as b do\n  fw speed\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 100; i++) {
            scheduler.tick(0)
            if (scheduler.done) break
        }

        const a = findChild(scheduler.root, 'a')
        const b = findChild(scheduler.root, 'b')
        assert.ok(Math.abs(a.transform.deref().position[0] - 30) < 0.001,
            `a should inherit speed=30`)
        assert.ok(Math.abs(b.transform.deref().position[0] - 30) < 0.001,
            `b should inherit speed=30`)
    })
})

describe("Phase 5: events — dance together", () => {
    test("leader shouts beat, dancers react via when", () => {
        // leader shouts 'beat', dancer listens and moves
        const ast = parseProgram(
            "as leader do\n  shout 'beat' 15\nend\n" +
            "as dancer do\n  loop 30 do\n    when 'beat' dist do\n      fw dist\n    end\n    wait 0.01\n  end\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 300; i++) {
            scheduler.tick(10)
            if (scheduler.done) break
        }

        const dancer = findChild(scheduler.root, 'dancer')
        const dx = dancer.transform.deref().position[0]
        assert.ok(Math.abs(dx - 15) < 0.001,
            `dancer should move fw 15 on beat, got x=${dx}`)
    })
})

describe("Phase 5: nested guard composition", () => {
    test("event when wrapping conditional when — payload dispatch", () => {
        // when 'move' dir do
        //   when dir = 1 do fw 10 end
        //   when dir = 2 do fw 20 end
        // end
        const ast = parseProgram(
            "when 'move' dir do\n" +
            "  when dir == 1 do\n    fw 10\n  end\n" +
            "  when dir == 2 do\n    fw 20\n  end\n" +
            "end"
        )
        const deps = realDeps()

        // Test with dir=2 — should fw 20
        const mailbox = [{ name: 'move', payload: 2 }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0] - 20) < 0.001,
            `payload dispatch: dir=2 should fw 20, got x=${head.position[0]}`)
    })

    test("conditional guard wrapping event handler — gated listening", () => {
        // when 1 do
        //   when 'boost' amt do fw amt end
        // end
        const ast = parseProgram(
            "when 1 do\n" +
            "  when 'boost' amt do\n    fw amt\n  end\n" +
            "end"
        )
        const deps = realDeps()
        const mailbox = [{ name: 'boost', payload: 50 }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0] - 50) < 0.001,
            `gated event: should fw 50 when guard true, got x=${head.position[0]}`)
    })

    test("false guard prevents event handler from firing", () => {
        // when 0 do
        //   when 'boost' amt do fw amt end
        // end
        const ast = parseProgram(
            "when 0 do\n" +
            "  when 'boost' amt do\n    fw amt\n  end\n" +
            "end"
        )
        const deps = realDeps()
        const mailbox = [{ name: 'boost', payload: 50 }]
        const gen = execute(ast, deps, { color: '#fff', mailbox })
        const events = []
        for (const e of gen) events.push(e)
        const head = events.filter(e => e.type === 'head').pop()
        assert.ok(Math.abs(head.position[0]) < 0.001,
            `false guard should prevent event handler, got x=${head.position[0]}`)
        assert.equal(mailbox.length, 1, "event unconsumed when guard is false")
    })
})

describe("Phase 5: observation + events combined", () => {
    test("sibling reads fn binding + reacts to shout", () => {
        // as config do fn speed 25 end
        // as sender do shout 'go' end
        // as mover do
        //   loop 30 do
        //     when 'go' do fw config.speed end
        //     wait 0.01
        //   end
        // end
        const ast = parseProgram(
            "as config do\n  fn speed 25\nend\n" +
            "as sender do\n  shout 'go'\nend\n" +
            "as mover do\n  loop 30 do\n    when 'go' do\n      fw config.speed\n    end\n    wait 0.01\n  end\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 300; i++) {
            scheduler.tick(10)
            if (scheduler.done) break
        }

        const mover = findChild(scheduler.root, 'mover')
        const mx = mover.transform.deref().position[0]
        assert.ok(Math.abs(mx - 25) < 0.001,
            `mover should fw config.speed (25) on 'go', got x=${mx}`)
    })
})

describe("Observation timing — no wait needed", () => {
    test("sibling state observable immediately after spawn (no wait)", () => {
        // as mice do fw 1000 end
        // label mice.x   ← should see 1000, not 0
        const ast = parseProgram(
            "as mice do\n  fw 1000\nend\n" +
            "label mice.x"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 100; i++) {
            scheduler.tick(0)
            if (scheduler.done) break
        }

        const mice = findChild(scheduler.root, 'mice')
        assert.ok(mice, 'mice should exist')
        const mx = mice.transform.deref().position[0]
        assert.ok(Math.abs(mx - 1000) < 0.001,
            `mice.x should be 1000, got ${mx}`)
    })

    test("multiple children observable without wait between spawns", () => {
        // as a do fw 100 end
        // as b do fw 200 end
        // label a.x    ← should see 100
        // label b.x    ← should see 200
        const ast = parseProgram(
            "as a do\n  fw 100\nend\n" +
            "as b do\n  fw 200\nend\n" +
            "label a.x\n" +
            "label b.x"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 100; i++) {
            scheduler.tick(0)
            if (scheduler.done) break
        }

        const a = findChild(scheduler.root, 'a')
        const b = findChild(scheduler.root, 'b')
        assert.ok(Math.abs(a.transform.deref().position[0] - 100) < 0.001,
            `a.x should be 100`)
        assert.ok(Math.abs(b.transform.deref().position[0] - 200) < 0.001,
            `b.x should be 200`)
    })

    test("child with nested children — grandchild observable", () => {
        // as parent do
        //   as child do fw 50 end
        //   label child.x
        // end
        const ast = parseProgram(
            "as parent do\n  as child do\n    fw 50\n  end\n  label child.x\nend"
        )
        const deps = realDeps()
        const generator = execute(ast, deps, { color: '#fff' })
        const scheduler = createScheduler(generator, {
            createDeps: realDeps,
            execOpts: { color: '#fff' },
            rootDeps: deps
        })

        for (let i = 0; i < 100; i++) {
            scheduler.tick(0)
            if (scheduler.done) break
        }

        const parent = findChild(scheduler.root, 'parent')
        const child = findChild(parent, 'child')
        assert.ok(child, 'child should exist')
        assert.ok(Math.abs(child.transform.deref().position[0] - 50) < 0.001,
            `child.x should be 50`)
    })
})
