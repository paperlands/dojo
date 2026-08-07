// Kernel primitives — cell, observable, arena.
// Run with: node --test test/js/kernel/kernel_test.mjs
//
// wound/world_cell_test.mjs pins the world cell's public contract UNCHANGED.
// This file pins the generics themselves, so a drift in the law is local.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createObservable, createAtom } from "../../../assets/js/kernel/observable.js"
import { createCell } from "../../../assets/js/kernel/cell.js"
import { createArena } from "../../../assets/js/kernel/arena.js"
import { attach } from "../../../assets/js/kernel/attach.js"

describe("createObservable — one watch/notify", () => {
    test("watch then notify delivers; unwatch stops delivery", () => {
        const obs = createObservable()
        const seen = []
        const un = obs.watch((x) => seen.push(x))
        obs.notify("a")
        un()
        obs.notify("b")
        assert.deepEqual(seen, ["a"])
    })

    test("unwatch mid-fan does not skip a sibling", () => {
        const obs = createObservable()
        const order = []
        let unB
        obs.watch(() => {
            order.push("a")
            unB()
        })
        unB = obs.watch(() => order.push("b"))
        obs.notify()
        assert.deepEqual(order, ["a", "b"], "b was already on the snapshot")
    })

    test("a watcher born mid-fan does not hear the breath it was born into", () => {
        const obs = createObservable()
        const heard = []
        obs.watch(() => {
            heard.push("a")
            obs.watch(() => heard.push("late"))
        })
        obs.notify()
        assert.deepEqual(heard, ["a"], "the snapshot is what this buys")
        obs.notify()
        assert.deepEqual(heard, ["a", "a", "late"])
    })

    test("notify carries args; cell-style breath may carry none", () => {
        const obs = createObservable()
        let args
        obs.watch((...a) => { args = a })
        obs.notify()
        assert.deepEqual(args, [])
        obs.notify(1, 2)
        assert.deepEqual(args, [1, 2])
    })
})

describe("createAtom — value over the one observable", () => {
    test("deref / swap / keyed watch", () => {
        const atom = createAtom(1)
        assert.equal(atom.deref(), 1)
        const seen = []
        atom.watch("k", (old, next) => seen.push([old, next]))
        atom.swap((n) => n + 1)
        assert.equal(atom.deref(), 2)
        assert.deepEqual(seen, [[1, 2]])
        atom.unwatch("k")
        atom.swap((n) => n + 1)
        assert.deepEqual(seen, [[1, 2]])
    })

    test("re-watch same key replaces the previous watcher", () => {
        const atom = createAtom(0)
        let a = 0, b = 0
        atom.watch("k", () => a++)
        atom.watch("k", () => b++)
        atom.swap((n) => n + 1)
        assert.equal(a, 0)
        assert.equal(b, 1)
    })

    test("re-watch REPLACES IN PLACE — the key keeps its turn in the fan", () => {
        const atom = createAtom(0)
        const order = []
        atom.watch("first", () => order.push("first"))
        atom.watch("second", () => order.push("second"))
        atom.watch("first", () => order.push("first again"))
        atom.swap((n) => n + 1)
        assert.deepEqual(order, ["first again", "second"],
            "the key is the identity; re-watching must not move it to the back")
    })
})

describe("createCell — registry-of-one", () => {
    test("empty cell answers null; register and get round-trip", () => {
        const cell = createCell()
        assert.equal(cell.get(), null)
        const face = { who: () => "me" }
        cell.register(face)
        assert.equal(cell.get(), face)
    })

    test("later mount wins; earlier unregister is a no-op", () => {
        const cell = createCell()
        const first = cell.register({ n: 1 })
        const second = cell.register({ n: 2 })
        first()
        assert.equal(cell.get().n, 2)
        second()
        assert.equal(cell.get(), null)
    })

    test("register and release each breathe once; payload none", () => {
        const cell = createCell()
        const breaths = []
        cell.watch((...args) => breaths.push(args))
        const un = cell.register({})
        un()
        assert.deepEqual(breaths, [[], []], "no payload, ever — the signal law")
    })

    test("registering nothing still hands back an unregister that fires", () => {
        const cell = createCell()
        cell.register({ n: 1 })
        const un = cell.register(undefined)
        assert.equal(cell.get(), null, "nothing displaces the occupant")
        let heard = 0
        cell.watch(() => heard++)
        un()
        assert.equal(heard, 1, "the release breathes — it is not a dead closure")
    })

    test("owner guard: only the live registrant clears the cell", () => {
        const cell = createCell()
        const a = {}
        const b = {}
        const unA = cell.register(a)
        cell.register(b)
        unA()
        assert.equal(cell.get(), b)
    })
})

describe("createArena — one lifetime, no individual free", () => {
    test("destroy is idempotent", () => {
        const a = createArena()
        a.destroy()
        a.destroy()
        assert.equal(a.alive, false)
    })

    test("cleanups run LIFO — reverse registration order", () => {
        const a = createArena()
        const order = []
        a.add(() => order.push(1))
        a.add(() => order.push(2))
        a.add(() => order.push(3))
        a.destroy()
        assert.deepEqual(order, [3, 2, 1])
    })

    test("child is destroyed before the parent's own cleanups", () => {
        const parent = createArena()
        const order = []
        parent.add(() => order.push("parent"))
        const child = parent.child()
        child.add(() => order.push("child"))
        parent.destroy()
        assert.deepEqual(order, ["child", "parent"])
    })

    test("registering on a destroyed arena throws (zombie-mount case)", () => {
        const a = createArena()
        a.destroy()
        assert.throws(() => a.add(() => {}), /use after destroy/)
        assert.throws(() => a.child(), /use after destroy/)
        assert.throws(() => a.clear(), /use after destroy/)
    })

    test("clear resets without destroying — arena stays alive for reuse", () => {
        const a = createArena()
        const order = []
        a.add(() => order.push("first"))
        a.clear()
        assert.equal(a.alive, true)
        a.add(() => order.push("second"))
        a.destroy()
        assert.deepEqual(order, ["first", "second"])
        assert.equal(a.alive, false)
    })

    test("on() pairs addEventListener with removeEventListener on destroy", () => {
        const a = createArena()
        const calls = []
        const el = {
            addEventListener(type, fn, opts) { calls.push(["add", type, fn, opts]) },
            removeEventListener(type, fn, opts) { calls.push(["rem", type, fn, opts]) },
        }
        const fn = () => {}
        a.on(el, "click", fn, { passive: true })
        assert.equal(calls.length, 1)
        assert.equal(calls[0][0], "add")
        a.destroy()
        assert.equal(calls[1][0], "rem")
        assert.equal(calls[1][2], fn)
        assert.deepEqual(calls[1][3], { passive: true })
    })

    test("nested grandchild dies with parent; order is outside-in of children first", () => {
        const root = createArena()
        const order = []
        root.add(() => order.push("root"))
        const mid = root.child()
        mid.add(() => order.push("mid"))
        const leaf = mid.child()
        leaf.add(() => order.push("leaf"))
        root.destroy()
        // mid.destroy runs before root's cleanups; leaf before mid's.
        assert.deepEqual(order, ["leaf", "mid", "root"])
    })
})

describe("attach — a claim that lives exactly as long as the occupant", () => {
    test("an empty seat binds nothing; the occupant's arrival binds once", () => {
        const cell = createCell()
        const bound = []
        attach(cell, (o) => { bound.push(o.n) })
        assert.deepEqual(bound, [], "nothing to claim yet")
        cell.register({ n: 1 })
        assert.deepEqual(bound, [1])
    })

    test("a standing occupant is bound immediately, before any breath", () => {
        const cell = createCell()
        cell.register({ n: 1 })
        const bound = []
        attach(cell, (o) => { bound.push(o.n) })
        assert.deepEqual(bound, [1])
    })

    test("a reseating releases the old claim BEFORE binding the new", () => {
        const cell = createCell()
        const log = []
        cell.register({ n: 1 })
        attach(cell, (o) => {
            log.push(`bind ${o.n}`)
            return () => log.push(`release ${o.n}`)
        })
        cell.register({ n: 2 })
        assert.deepEqual(log, ["bind 1", "release 1", "bind 2"],
            "a claim never stacks — the departing one is dropped first")
    })

    test("emptying the seat releases the claim and binds nothing", () => {
        const cell = createCell()
        const log = []
        const un = cell.register({ n: 1 })
        attach(cell, (o) => {
            log.push(`bind ${o.n}`)
            return () => log.push(`release ${o.n}`)
        })
        un()
        assert.deepEqual(log, ["bind 1", "release 1"])
    })

    test("the returned release ends the claim and stops listening", () => {
        const cell = createCell()
        const log = []
        cell.register({ n: 1 })
        const detach = attach(cell, (o) => {
            log.push(`bind ${o.n}`)
            return () => log.push(`release ${o.n}`)
        })
        detach()
        assert.deepEqual(log, ["bind 1", "release 1"])
        cell.register({ n: 2 })
        assert.deepEqual(log, ["bind 1", "release 1"], "a dead attach hears nothing")
        detach()
        assert.deepEqual(log, ["bind 1", "release 1"], "idempotent")
    })

    test("a bind that returns nothing is legal — nothing to give back", () => {
        const cell = createCell()
        let binds = 0
        const detach = attach(cell, () => { binds++ })
        cell.register({})
        cell.register({})
        detach()
        assert.equal(binds, 2)
    })
})
