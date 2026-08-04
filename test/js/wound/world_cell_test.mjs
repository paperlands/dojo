// The world cell's contract (weave/world.js, id:cmp-query-cell). Run with:
//   node --test test/js/wound/world_cell_test.mjs
//
// What this pins — the contract the portal-organs stash preserved when the
// implementation was lost: world() answers null before any registration;
// registerWorld returns an unregister only its owner may exercise (a later
// mount wins — the stage-cell idiom); registering and unregistering breathe;
// watchers unhear cleanly; the breath carries NOTHING (the signal law); and
// a face the registrant never spoke degrades by optional chain — the cell
// enumerates nothing.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { registerWorld, world, watchWorld, worldChanged } from "../../../assets/js/weave/world.js"

describe("the empty center — registration and degrade", () => {
    test("nobody home answers null; an unspoken face degrades by chain", () => {
        assert.equal(world(), null)
        assert.equal(world()?.diagnostics?.("buf") ?? null, null)
    })

    test("the registrant's faces answer; unregistering empties the cell", () => {
        const unregister = registerWorld({ vitals: (name) => ({ name }) })
        assert.deepEqual(world().vitals("coil"), { name: "coil" })
        assert.equal(world()?.diagnostics?.("buf") ?? null, null,
            "a face never spoken degrades, the cell enumerates nothing")
        unregister()
        assert.equal(world(), null)
    })

    test("a later mount wins; the earlier unregister is a no-op", () => {
        const first = registerWorld({ who: () => "first" })
        const second = registerWorld({ who: () => "second" })
        first()                                     // stale owner — may not evict
        assert.equal(world().who(), "second")
        second()
        assert.equal(world(), null)
    })
})

describe("the breath — says only ask again", () => {
    test("registering and unregistering breathe; the breath carries nothing", () => {
        const breaths = []
        const unwatch = watchWorld((...args) => breaths.push(args))
        const unregister = registerWorld({})
        unregister()
        assert.equal(breaths.length, 2)
        assert.deepEqual(breaths, [[], []], "no payload, ever — the signal law")
        unwatch()
    })

    test("watchers unhear cleanly", () => {
        let heard = 0
        const unwatch = watchWorld(() => heard++)
        worldChanged()
        unwatch()
        worldChanged()
        assert.equal(heard, 1)
    })
})
