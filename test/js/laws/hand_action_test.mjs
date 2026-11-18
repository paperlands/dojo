import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, resolveBinding } from "../../../assets/js/turtling/scheduler.js"
import { ASTNode } from "../../../assets/js/turtling/ast.js"

const near = (actual, expected) => assert.ok(Math.hypot(...actual.map((x, i) => x - expected[i])) < 1e-8, `${actual} != ${expected}`)
const move = (s, a, position) => {
    const verdict = s.requestMotion(a, { ...a.transform.deref(), position }, s.motionRevision)
    assert.equal(verdict.kind, "accept", verdict.message)
    return verdict
}
const seat = (s, source, options = {}, key = "host") => {
    const spec = fork(key, source)
    const ast = JSON.stringify(spec.code.ast)
    const host = s.hotSwapChild(key, spec, options)
    drive(s)
    assert.equal(JSON.stringify(spec.code.ast), ast, "hand actions never mutate the AST")
    assert.equal(s.errors.length, 0, JSON.stringify(s.errors))
    return { host, a: host.children.get("a") }
}

test("a translated hand follows edited program placement and fresh reruns without drift", () => {
    const s = buildWorld()
    let { a } = seat(s, "goto 2 1\nlet a")
    move(s, a, [1, 2, 0])
    near(frameWorldTransform(a).position, [3, 3, 0])
    const old = a
    ;({ a } = seat(s, "goto 10 20\nlet a"))
    assert.notEqual(a, old, "an input survives, not a retired frame's authority")
    near(frameWorldTransform(a).position, [11, 22, 0])
    for (let i = 0; i < 8; i++) {
        ;({ a } = seat(s, "goto 10 20\nlet a", { fresh: true }))
        near(frameWorldTransform(a).position, [11, 22, 0])
    }
    move(s, a, s.handHome(a).position)
    near(frameWorldTransform(a).position, [10, 20, 0])
    ;({ a } = seat(s, "goto 30 40\nlet a"))
    near(frameWorldTransform(a).position, [30, 40, 0])
})

test("a sphere retains a quarter-turn as its source radius changes, before a consumer reads it", () => {
    const s = buildWorld()
    let { a } = seat(s, "let a\nlet a.distance = 5\nlet y = a.y")
    move(s, a, [0, 5, 0])
    const { host, a: next } = seat(s, "let a\nlet a.distance = 10\nlet y = a.y")
    a = next
    near(frameWorldTransform(a).position, [0, 10, 0])
    near(s.handHome(a).position, [10, 0, 0])
    assert.ok(Math.abs(resolveBinding(host, "y") - 10) < 1e-8, "the consumer sees the adjusted source result")
    for (let i = 0; i < 5; i++) {
        ;({ a } = seat(s, "let a\nlet a.distance = 10\nlet y = a.y", { fresh: true }))
        near(frameWorldTransform(a).position, [0, 10, 0])
    }
    move(s, a, s.handHome(a).position)
    near(frameWorldTransform(a).position, [10, 0, 0])
})

test("the same slot re-reached by the program rebases once, rather than dropping or accumulating the hand", () => {
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", "let a\nwait 1\ngoto 2 0\nlet a"))
    const a = host.children.get("a")
    move(s, a, [1, 0, 0])
    drive(s)
    near(a.transform.deref().position, [3, 0, 0])
    near(s.handHome(a).position, [2, 0, 0])
    move(s, a, s.handHome(a).position)
    near(a.transform.deref().position, [2, 0, 0])
})

test("a scoped input cannot leak into a namesake, removed slot, or a removed seat", () => {
    const s = buildWorld()
    const { a } = seat(s, "let a")
    move(s, a, [2, 3, 0])
    const { a: other } = seat(s, "let a", {}, "other")
    near(other.transform.deref().position, [0, 0, 0])
    seat(s, "let b")
    const { a: reintroduced } = seat(s, "let a")
    near(reintroduced.transform.deref().position, [0, 0, 0])
    move(s, reintroduced, [2, 0, 0])
    s.removeChild("host")
    const { a: newSeat } = seat(s, "let a")
    near(newSeat.transform.deref().position, [0, 0, 0])
})

test("a refused or obsolete request cannot replace the retained action", () => {
    let refuse = false
    const s = buildWorld({ validate: () => !refuse })
    let { a } = seat(s, "let a")
    move(s, a, [2, 0, 0])
    refuse = true
    assert.notEqual(s.requestMotion(a, { ...a.transform.deref(), position: [9, 0, 0] }, s.motionRevision).kind, "accept")
    refuse = false
    const old = a
    ;({ a } = seat(s, "let a", { fresh: true }))
    near(a.transform.deref().position, [2, 0, 0])
    assert.equal(s.requestMotion(old, { ...old.transform.deref(), position: [9, 0, 0] }, s.motionRevision).kind, "stale")
    near(a.transform.deref().position, [2, 0, 0])
})


test("a hand action follows a changed declaring orientation, including a same-identity re-reach", () => {
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", "let a\nwait 1\nrt 90\nlet a"))
    const a = host.children.get("a")
    move(s, a, [2, 0, 0])
    drive(s)
    near(frameWorldTransform(a).position, [0, -2, 0])
    const { a: next } = seat(s, "rt 180\nlet a")
    near(frameWorldTransform(next).position, [-2, 0, 0])
})

test("a driven coordinate recomputes its baseline without accumulating the retained translation", () => {
    const s = buildWorld()
    const { host, a } = seat(s, "let r\nlet a\nlet a.x = r.x + 5")
    move(s, a, [5, 3, 0])
    const action = a.handBase
    for (const radius of [10, 6, 12, 5]) {
        move(s, host.children.get("r"), [radius - 5, 0, 0])
        drive(s)
        near(a.transform.deref().position, [radius, 3, 0])
        near(s.handHome(a).position, [radius, 0, 0])
    }
    assert.ok(action, "the neutral source baseline is retained separately")
})

test("constraint projection never overwrites the retained hand input", () => {
    const s = buildWorld()
    let { a } = seat(s, "let a")
    move(s, a, [2, 3, 0])
    for (let i = 0; i < 4; i++) {
        ;({ a } = seat(s, "let a\nlet a.x = 10", { fresh: true }))
        near(a.transform.deref().position, [10, 3, 0])
    }
    ;({ a } = seat(s, "let a"))
    near(a.transform.deref().position, [2, 3, 0])
})

test("circle phase and cone phase/height survive source shape changes", () => {
    const s = buildWorld()
    let { a } = seat(s, "let a\nlet a.distance = 5\nlet a.z = 0")
    move(s, a, [0, 5, 0])
    ;({ a } = seat(s, "let a\nlet a.distance = 10\nlet a.z = 0"))
    near(a.transform.deref().position, [0, 10, 0])
    const cone = buildWorld()
    let seated = seat(cone, "goto 5 1 0\nlet a\nlet a.tilt = 30")
    const home = frameWorldTransform(seated.a).position
    const height = home[0]
    const target = [height + 2, 0, (height + 2) * Math.tan(Math.PI / 6)]
    move(cone, seated.a, [target[0] - 5, target[1] - 1, target[2]])
    seated = seat(cone, "goto 8 1 0\nlet a\nlet a.tilt = 45")
    const control = seat(buildWorld(), "goto 8 1 0\nlet a\nlet a.tilt = 45")
    const h = frameWorldTransform(control.a).position[0] + 2
    near(frameWorldTransform(seated.a).position, [h, 0, h])
})

test("quoted names containing a slash cannot alias a nested slot", () => {
    const s = buildWorld()
    const { host } = seat(s, 'let "left/a"\nas left do\n  let a\nend')
    move(s, host.children.get("left/a"), [3, 4, 0])
    const next = seat(s, 'let "left/a"\nas left do\n  let a\nend', { fresh: true }).host
    near(next.children.get("left/a").transform.deref().position, [3, 4, 0])
    near(next.children.get("left").children.get("a").transform.deref().position, [0, 0, 0])
})


test("a constructed AST point reapplies its action before the single publication gate", () => {
    const s = buildWorld()
    const construct = radius => {
        const spec = fork("host", "")
        spec.code.ast = [new ASTNode("Construct", "a", [], {
            seed: [radius, 0, 0],
            obligations: [{ feature: "distance", term: id => ({ type: "distance", references: [id, { value: [0, 0, 0] }], radius }) }],
        })]
        const host = s.hotSwapChild("host", spec, { fresh: true })
        drive(s)
        assert.deepEqual(s.errors, [])
        return host.children.get("a")
    }
    let a = construct(5)
    move(s, a, [-5, 5, 0])
    near(frameWorldTransform(a).position, [0, 5, 0])
    a = construct(10)
    near(frameWorldTransform(a).position, [0, 10, 0])
    move(s, a, s.handHome(a).position)
    near(frameWorldTransform(a).position, [10, 0, 0])
    a = construct(20)
    near(frameWorldTransform(a).position, [20, 0, 0])
})

test("an edit in a seat with no retained input scans no foreign frame", () => {
    const s = buildWorld()
    const width = 64
    const program = Array.from({ length: width }, (_, i) => `goto ${i} 0\nlet p${i}`).join("\n")
    const host = s.hotSwapChild("a", fork("a", program))
    drive(s)
    const p0 = host.children.get("p0")
    move(s, p0, [0, 3, 0])

    // One retained input lives in seat a. Count what an edit of untouched seat b costs.
    const map = s.registry
    const rawValues = Map.prototype.values
    const rawStringify = JSON.stringify
    let entries = 0, stringified = 0
    map.values = function () {
        const it = rawValues.call(this)
        return {
            next() { const r = it.next(); if (!r.done) entries++; return r },
            [Symbol.iterator]() { return this },
        }
    }
    JSON.stringify = function (...args) { stringified++; return rawStringify.apply(this, args) }
    try {
        s.hotSwapChild("b", fork("b", "let q"))
    } finally {
        delete map.values
        JSON.stringify = rawStringify
    }
    assert.equal(entries, 0, "an untouched seat must not enumerate the registry")
    assert.ok(stringified <= 3, `slot work grew with the scene: ${stringified}`)
    assert.deepEqual(s.errors, [])
    near(frameWorldTransform(p0).position, [0, 3, 0])
})

test("a retained slot whose node is still in the tree but left the registry is pruned", () => {
    const run = (unregister) => {
        const s = buildWorld()
        const host = s.hotSwapChild("host", fork("host", "let r\nlet a\nlet a.x = r.x + 5"))
        drive(s)
        const a = host.children.get("a"), r = host.children.get("r")
        near(a.transform.deref().position, [5, 0, 0])
        move(s, a, [5, 3, 0])
        if (unregister) s.registry.delete(a.id)
        // A pending seat makes the next slice productive, so settlement prunes globally.
        s.hotSwapChild("probe", fork("probe", "wait 1"))
        s.tick(1000)                    // participation is not liveness
        if (unregister) s.registry.set(a.id, a)
        move(s, r, [5, 0, 0])           // a's driven baseline moves; prepare replays the input
        drive(s)
        return a.transform.deref().position
    }
    near(run(false), [10, 3, 0])        // control: participation intact, the input is retained
    near(run(true), [10, 0, 0])         // in the tree, out of the registry: the input is gone
})

test("an unchanged request retains the input; an explicit reset clears it", () => {
    // A driven x clamps the retained translation, so the accepted pose equals its baseline.
    const setup = () => {
        const s = buildWorld()
        let { a } = seat(s, "let a")
        move(s, a, [2, 0, 0])
        ;({ a } = seat(s, "let a\nlet a.x = 10"))
        near(a.transform.deref().position, [10, 0, 0])
        return { s, a }
    }
    {
        const { s, a } = setup()
        assert.equal(s.requestMotion(a, { ...a.transform.deref() }, s.motionRevision).kind, "accept")
        assert.ok(a.handBase, "an unchanged request is a no-op, not a reset")
        near(seat(s, "let a").a.transform.deref().position, [2, 0, 0])
    }
    {
        const { s, a } = setup()
        assert.equal(s.requestMotion(a, { ...a.transform.deref() }, s.motionRevision, null, { reset: true }).kind, "accept")
        assert.equal(a.handBase, null, "explicit reset intent clears the retained input")
        near(seat(s, "let a").a.transform.deref().position, [0, 0, 0])
    }
})

test("a failed run is not proof that a slot was removed", () => {
    const swap = (s, source) => { s.hotSwapChild("host", fork("host", source)); drive(s); return s.root.children.get("host") }
    const run = (next) => {
        const s = buildWorld()
        let { a } = seat(s, "let a")
        move(s, a, [2, 0, 0])
        swap(s, next)
        return seat(s, "let a").a.transform.deref().position
    }
    near(run("let q\nlet q.x = nope\nlet a"), [2, 0, 0])   // failed BEFORE the declaration: kept
    near(run("let a\nlet q\nlet q.x = nope"), [2, 0, 0])   // failed after it: kept
    near(run("let b"), [0, 0, 0])                          // healthy absence: pruned
})

test("a broken seat does not inhibit healthy cleanup in another", () => {
    const swap = (s, source, key = "host") => { s.hotSwapChild(key, fork(key, source)); drive(s); return s.root.children.get(key) }
    const s = buildWorld()
    const p = seat(s, "let p").host.children.get("p")
    move(s, p, [2, 0, 0])
    const q = seat(s, "let q", {}, "other").host.children.get("q")
    move(s, q, [5, 0, 0])
    swap(s, "let q\nlet q.x = nope")        // host is broken before declaring p
    swap(s, "let r", "other")               // other is healthy and removes q
    near(seat(s, "let p").host.children.get("p").transform.deref().position, [2, 0, 0])   // kept: unproven absence
    near(seat(s, "let q", {}, "other").host.children.get("q").transform.deref().position, [0, 0, 0])   // pruned
})

test("admission cannot relabel the hand's frame or invent reset intent", () => {
    let hostile = null
    const s = buildWorld({ admit: (request) => {
        // A responder writing the request it was handed must not become the destination.
        if (hostile) { request.frame = hostile; request.reset = true }
        return { accepted: true, transform: request.requested }
    } })
    let { a } = seat(s, "let a")
    move(s, a, [2, 0, 0])
    const b = seat(s, "let b", {}, "other").host.children.get("b")
    move(s, b, [5, 0, 0])
    ;({ a } = seat(s, "let a\nlet a.x = 10"))      // a is clamped at its neutral baseline
    hostile = b
    assert.equal(s.requestMotion(a, { ...a.transform.deref() }, s.motionRevision).kind, "accept")
    assert.ok(a.handBase, "the original point keeps its input")
    assert.ok(b.handBase, "the relabelled point keeps its own input")
    near(seat(s, "let a").a.transform.deref().position, [2, 0, 0])
    near(seat(s, "let b", {}, "other").host.children.get("b").transform.deref().position, [5, 0, 0])
})

test("the host validator cannot relabel the hand's frame or invent reset intent", () => {
    let hostile = null
    const s = buildWorld({ validate: ({ request }) => {
        // The callback gets a shell; the captured attempt stays authoritative.
        if (hostile) { request.frame = hostile; request.reset = true }
        return true
    } })
    let { a } = seat(s, "let a")
    move(s, a, [2, 0, 0])
    const b = seat(s, "let b", {}, "other").host.children.get("b")
    move(s, b, [5, 0, 0])
    ;({ a } = seat(s, "let a\nlet a.x = 10"))      // a is clamped at its neutral baseline
    hostile = b
    assert.equal(s.requestMotion(a, { ...a.transform.deref() }, s.motionRevision).kind, "accept")
    assert.ok(a.handBase, "the original point keeps its input")
    assert.ok(b.handBase, "the relabelled point keeps its own input")
    near(seat(s, "let a").a.transform.deref().position, [2, 0, 0])
    near(seat(s, "let b", {}, "other").host.children.get("b").transform.deref().position, [5, 0, 0])
})
