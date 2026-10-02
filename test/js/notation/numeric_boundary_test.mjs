// Numeric admission must hold after conversion, not just before it.
import { test } from "node:test"
import assert from "node:assert/strict"
import { drainEvents, createActorState } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { ASTNode } from "../../../assets/js/turtling/ast.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { COMMANDS, DEFAULT_STYLE } from "../../../assets/js/turtling/commands.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { unit, directionBetween, INVALID } from "../../../assets/js/turtling/laws/vec3.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { format } from "../../../assets/js/turtling/numerics.js"
import { buildWorld, fork, drive, ends } from "../laws/harness.mjs"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const run = (src, opts = {}) => drainEvents(parseProgram(src), deps(), opts)

for (const value of [null, undefined]) {
    test(`an explicit ${value} takes the callable default, including absolute placement`, () => {
        const ast = [new ASTNode("Call", "goto", [new ASTNode("Value", value)]),
            ...parseProgram("fw 3")]
        const actorState = createActorState()
        actorState.transform.position = [10, 0, 0]
        const events = drainEvents(ast, deps(), { actorState })
        assert.equal(events.filter(e => e.type === "notice").length, 0)
        assert.deepEqual(actorState.transform.position, [3, 0, 0])
    })
}

for (const [src, type, field] of [
    ["label hi 1e308", "label", "textSize"],
    ["grid 10 1e308", "grid", "size"],
    ["wait 1e308", "wait", "duration"],
    ["bold 1e308", "path", "thickness"],
]) {
    test(`${src}: conversion overflow is told once and never published`, () => {
        const events = run(`${src}\nfw 3`)
        const notices = events.filter(e => e.type === "notice")
        assert.equal(notices.length, 1)
        assert.equal(notices[0].kind, "infinite")
        assert.equal(notices[0].span?.line, 1, "the refusal belongs to the statement")
        assert.ok(events.filter(e => e.type === type).every(e => Number.isFinite(e[field])))
        assert.deepEqual(events.find(e => e.type === "path").points.at(-1), [3, 0, 0])
    })
}

for (const command of ["bold 'bad'", "show 0/0", "grid 1/0 10", "label hi 0/0", "wait 1/0"]) {
    test(`${command}: numeric holes share the walk's admission and report`, () => {
        const events = run(`${command}\nfw 3`)
        assert.equal(events.filter(e => e.type === "notice").length, 1)
        assert.deepEqual(events.find(e => e.type === "path").points.at(-1), [3, 0, 0])
    })
}

for (const scale of [1e-200, 1e-15, 1, 1e200]) {
    test(`faceto has the same bearing at scale ${scale}`, () => {
        const transform = COMMANDS.get("faceto")({ transform: SE3.identity(), style: DEFAULT_STYLE }, scale, scale, scale).transform
        assert.ok(transform)
        const dir = transform.rotation.rotateVec(1, 0, 0)
        assert.ok(dir.every(x => Math.abs(x - 1 / Math.sqrt(3)) < 1e-14), String(dir))
    })
}

test("an overflowed displacement cannot replace a valid pose or rotation", () => {
    const actorState = createActorState()
    const events = run("goto -1e308 0\nfaceto 1e308 1e308\nfw 3", { actorState })
    assert.equal(events.filter(e => e.type === "notice").length, 1)
    assert.ok(SE3.isValid(actorState.transform))
    assert.equal(actorState.transform.rotation.w, 1)
})

test("a live walk reports result overflow and carries on at the held pose", () => {
    const scheduler = buildWorld()
    scheduler.hotSwapChild("host", fork("host", "wait 1e308\nfw 3"))
    const trace = drive(scheduler)
    assert.equal((trace.get("host") ?? []).filter(e => e.type === "notice").length, 1)
    assert.deepEqual(ends(trace, "host").at(-1), [3, 0, 0])
})
test("two finite waits cannot overflow the accumulated clock", () => {
    const actorState = createActorState()
    const events = run("wait 1e305\nwait 1e305\nfw 3", { actorState })
    assert.equal(events.filter(e => e.type === "wait").length, 1)
    assert.equal(events.filter(e => e.type === "notice").length, 1)
    assert.ok(Number.isFinite(actorState.elapsedTime))
    assert.deepEqual(actorState.transform.position, [3, 0, 0])
})


test("pose validity does not coerce absent coordinates or accept a NaN rotation", () => {
    assert.equal(SE3.isValid(null), false)
    for (const position of [[Infinity, 0, 0], [null, 0, 0], ["0", 0, 0], new Array(3)]) {
        assert.equal(SE3.isValid({ ...SE3.identity(), position }), false)
    }
    assert.equal(SE3.isValid({ position: [0, 0, 0], rotation: { w: NaN, x: 0, y: 0, z: 0 } }), false)
})

test("direction normalization refuses non-finite and malformed tuples", () => {
    for (const v of [[Infinity, 0, 0], [null, 0, 0], ["1", 0, 0], new Array(3)]) {
        assert.equal(unit(v), null)
    }
})

test("an invalid question is not a coincident pair", () => {
    // The coincident answer licenses a caller's stated fallback (+x). Invalid input
    // may never borrow that license. (P2)
    for (const v of [[Infinity, 0, 0], [NaN, 0, 0], [null, 0, 0], ["1", 0, 0], new Array(3)]) {
        assert.equal(directionBetween([0, 0, 0], v), INVALID, `toward ${String(v)}`)
        assert.equal(directionBetween(v, [0, 0, 0]), INVALID, `from ${String(v)}`)
    }
    assert.equal(directionBetween([0, 0, 0], [0, 0, 0]), null, "coincidence is its own answer")
})

test("a failed normalization is not a coincidence", () => {
    // [1.7e308, 1.7e308, 1.7e308] has a perfectly defined direction; only its length
    // overflows. Scale the components before taking their norm. (P2)
    const diag = 1 / Math.sqrt(3)
    for (const dir of [unit([1.7e308, 1.7e308, 1.7e308]),
        directionBetween([0, 0, 0], [1.7e308, 1.7e308, 1.7e308])]) {
        assert.ok(dir, "a direction, not null")
        for (const i of [0, 1, 2]) assert.ok(Math.abs(dir[i] - diag) < 1e-15, `component ${i} of ${dir}`)
    }
    // Tiny nonzero components used to die at the reciprocal — same fix, same answer.
    assert.deepEqual(directionBetween([0, 0, 0], [1e-310, 0, 0]), [1, 0, 0])
    // Endpoints finite but their difference overflowing: the direction still exists.
    assert.deepEqual(directionBetween([-1.7e308, 0, 0], [1.7e308, 0, 0]), [1, 0, 0])
})

test("the overflow repair keeps components the subtraction already resolved", () => {
    // Mixed range: x overflows while y is resolved exactly by its subtraction. The
    // repair must keep that y — divided by the scale, never multiplied away by its
    // subnormal reciprocal — while the scaled endpoints repair only x.
    const m = 1.7e308
    const dir = directionBetween([-m, m, 0], [m, m - 2e292, 0])
    assert.ok(Math.abs(dir[0] - 1) < 1e-15, `x of ${dir}`)
    assert.ok(Math.abs(dir[1] + 5.870118557455059e-17) < 1e-28, `y of ${dir}`)
    assert.equal(dir[2], 0)
})

test("an extreme finite axis turns exactly like the unit axis it defines", () => {
    // fromAxisAngle normalized through a norm that could overflow: a 90-degree turn
    // about the finite diagonal came back half a rotation. (P2)
    const q = Versor.fromAxisAngle({ x: 1.7e308, y: 1.7e308, z: 1.7e308 }, 90)
    const exact = Versor.fromAxisAngle({ x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) }, 90)
    assert.ok(Math.abs(Math.hypot(q.w, q.x, q.y, q.z) - 1) < 1e-15, "a unit rotation")
    for (const k of ["w", "x", "y", "z"]) {
        assert.ok(Math.abs(q[k] - exact[k]) < 1e-12, `${k}: ${q[k]} vs ${exact[k]}`)
    }
})

test("faceto's bearing survives translation, like the direction it asks for", () => {
    // The review's witness: half a unit apart at [1e12, 1e12, 0]. The aim at the
    // origin and the aim after translation are the same +y. (P1)
    for (const [pos, x, y] of [[[0, 0, 0], 0, 0.5], [[1e12, 1e12, 0], 1e12, 1e12 + 0.5]]) {
        const { transform } = COMMANDS.get("faceto")(
            { transform: { ...SE3.identity(), position: pos }, style: DEFAULT_STYLE }, x, y)
        assert.ok(transform, `the half-unit displacement aims at ${pos}`)
        const dir = transform.rotation.rotateVec(1, 0, 0)
        assert.ok(Math.abs(dir[0]) < 1e-12 && Math.abs(dir[1] - 1) < 1e-12 && Math.abs(dir[2]) < 1e-12,
            `+y at ${pos}, got ${dir}`)
    }
})

test("display names a non-finite value without losing its sign", () => {
    assert.equal(format(-Infinity), "-infinity")
    assert.equal(format(Infinity), "infinity")
    assert.equal(format(NaN), "not a number")
})
