// term-cell's role-keyed registry (id:lex-unmarked, id:gw-t-dom-registry). Run:
//   node --test test/js/shell/term_cell_test.mjs
//
// What this pins: register/get take role as data (coreshell, outershell);
// each role's cell is independent; a later mount wins per role (the
// stage-cell idiom, id:cmp-query-cell); an unknown role throws instead of
// silently registering as coreshell — the new guarantee this collapse buys,
// where the old wireRegistry(role = "inner") ternary defaulted any other
// role to inner.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { register, get, outerDrafting } from "../../../assets/js/hooks/shell/term-cell.js"

describe("role is data — two independent cells", () => {
    test("nobody home answers null for both roles", () => {
        assert.equal(get("coreshell"), null)
        assert.equal(get("outershell"), null)
    })

    test("registering one role never touches the other", () => {
        const unregister = register("coreshell", { name: "core-term" })
        assert.deepEqual(get("coreshell"), { name: "core-term" })
        assert.equal(get("outershell"), null)
        unregister()
        assert.equal(get("coreshell"), null)
    })

    test("a later mount wins, per role", () => {
        const first = register("outershell", { id: "first" })
        const second = register("outershell", { id: "second" })
        first() // stale owner — may not evict
        assert.deepEqual(get("outershell"), { id: "second" })
        second()
        assert.equal(get("outershell"), null)
    })

    // The fault names itself: reaching cells[role] blind would die with
    // "cannot read properties of undefined", which teaches nothing.
    test("an unknown role throws, and the error names the role", () => {
        assert.throws(() => register("innr", {}), /no role "innr"/)
        assert.throws(() => get("innr"), /no role "innr"/)
    })
})

describe("the keystroke-path reader", () => {
    test("outerDrafting reads outershell.drafting() with no DOM walk", () => {
        assert.equal(outerDrafting(), false)
        const unregister = register("outershell", { drafting: () => true })
        assert.equal(outerDrafting(), true)
        unregister()
    })
})
