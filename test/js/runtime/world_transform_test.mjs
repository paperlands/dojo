// The world transform must be FRESH — a cached one that outlives its inputs
// seats a whole subtree at a place it left.
// Run: node --test test/js/runtime/world_transform_test.mjs
//
// worldTransform(f) composes the `origin` of f and of every ancestor. The cache
// is kept honest by an invariant that is REAL but implicit, so it is pinned
// here: an origin assignment is always immediately preceded by a swap of that
// same frame's transform atom (scheduler.js — `ctx.transform.swap(() =>
// value.origin)` sits one line above `existing.origin = value.origin`). A
// parent's swap fires every child's watcher, so the subtree learns.
//
// The case that looks like a hole and is not: a parent re-spawned while still
// RUNNING takes a new origin and is not rewired, so it never re-spawns its own
// children — and those children may already be finished, never touching their
// own transform again. They are still correct, because the grandparent's swap
// dirtied them. Break the swap-before-assign ordering and these tests fall.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { ASTNode } from "../../../assets/js/turtling/ast.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

function* genFromEvents(events) {
    for (const event of events) yield event
}

function call(name, ...args) {
    return new ASTNode('Call', name, args.map(a => new ASTNode('Argument', String(a))))
}

function ambient(name, children) {
    return new ASTNode('Ambient', name, children)
}

function spawnEvent(name, ast, origin) {
    return {
        type: "spawn",
        name,
        code: { ast, functions: {} },
        origin,
        style: { color: '#e77808', thickness: 2, down: true, showTurtle: 10 },
        frame: null,
        env: { userspace: new Map(), loopCounter: 0 },
    }
}

const at = (x, y, z) => ({ rotation: SE3.identity().rotation, position: [x, y, z] })

// root ──▶ a (keeps waiting)
//            └──▶ b (draws once, finishes)
// Root re-spawns `a` at a new origin while `a` is still waiting.
function movedParent() {
    const bodyOfA = [ambient("b", [call("fw", 10)]), call("wait", 100000)]
    const scheduler = createScheduler(
        genFromEvents([
            spawnEvent("a", bodyOfA, at(0, 0, 0)),
            spawnEvent("a", bodyOfA, at(10, 0, 0)),
        ]),
        { createDeps: realDeps, execOpts: { color: '#e77808' } }
    )
    scheduler.tick(0)
    const a = scheduler.root.children.get("a")
    const b = a.children.get("b")
    return { scheduler, a, b }
}

describe("world transform freshness", () => {
    test("a running parent takes its new origin", () => {
        const { a } = movedParent()
        assert.ok(!a.done, "the parent is still waiting — it was not rewired")
        assert.deepEqual(a.origin.position, [10, 0, 0])
        assert.deepEqual(worldTransform(a).position, [10, 0, 0])
    })

    test("a FINISHED child rides its parent's new origin", () => {
        const { b } = movedParent()
        assert.ok(b.done, "the child drew once and finished")
        // b was born at a's local origin (a had not moved), so b's world place
        // IS a's origin. When a moves, b moves.
        assert.deepEqual(worldTransform(b).position, [10, 0, 0],
            "the finished child is seated where its parent now stands")
    })

    test("a deeper finished descendant rides it too", () => {
        const bodyOfA = [
            ambient("b", [ambient("c", [call("fw", 10)]), call("wait", 100000)]),
            call("wait", 100000),
        ]
        const scheduler = createScheduler(
            genFromEvents([
                spawnEvent("a", bodyOfA, at(0, 0, 0)),
                spawnEvent("a", bodyOfA, at(0, 7, 0)),
            ]),
            { createDeps: realDeps, execOpts: { color: '#e77808' } }
        )
        scheduler.tick(0)
        const c = scheduler.root.children.get("a").children.get("b").children.get("c")
        assert.ok(c.done)
        assert.deepEqual(worldTransform(c).position, [0, 7, 0])
    })
})
