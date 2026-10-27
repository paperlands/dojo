// The recovery mirror, pure: no DOM, no storage, no clock, no source.
// Run with: node --test test/js/shell/outer_recovery_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createOuterRecovery, selectorFor } from "../../../assets/js/hooks/shell/outer-recovery.js"

const selector = { addr: "a1", view: "watch", draft_live: true, follow_peer: true }

describe("outer recovery — server selector mirror only", () => {
    test("whitelists selector/chrome; a document never crosses", () => {
        const sent = []
        const recovery = createOuterRecovery({ send: (d) => sent.push(d) })

        recovery.mirror({
            ...selector,
            source: "fw 50",
            commands: [{ op: "fw" }],
            path: "frames/x.png",
            diagnostics: [{ message: "boom" }],
            name: "wren",
            root: "root-a",
        })
        recovery.restore({ visibleAddr: "a1" })

        assert.deepEqual(sent, [
            { addr: "a1", view: "watch", draft_live: true, follow_peer: true, name: "wren", root: "root-a" },
        ])
    })

    test("the mirror is a clone; caller mutation cannot alias it", () => {
        const sent = []
        const recovery = createOuterRecovery({ send: (d) => sent.push(d) })
        const input = { ...selector, name: "wren" }

        recovery.mirror(input)
        input.addr = "evil"
        input.view = "draft"

        recovery.restore({ visibleAddr: "a1" })
        assert.equal(sent[0].addr, "a1")
        assert.equal(sent[0].view, "watch")
    })

    test("draft overlay only when the visible peer is the selected peer", () => {
        const sent = []
        const recovery = createOuterRecovery({ send: (d) => sent.push(d) })
        recovery.mirror({ ...selector, addr: "old", name: "old-name" })

        recovery.restore({ visibleAddr: "new", drafting: true, draftLive: true, name: "new-name" })
        assert.deepEqual(sent[0], { addr: "old", view: "watch", draft_live: true, follow_peer: true, name: "old-name" })

        recovery.restore({ visibleAddr: "old", drafting: true, draftLive: false, name: "new-name" })
        assert.deepEqual(sent[1], { addr: "old", view: "draft", draft_live: false, follow_peer: true, name: "new-name" })
    })

    test("no draft overlay when not drafting; frozen stays false", () => {
        const sent = []
        const recovery = createOuterRecovery({ send: (d) => sent.push(d) })
        recovery.mirror({ ...selector, view: "draft", draft_live: false })

        recovery.restore({ visibleAddr: "a1", drafting: false, draftLive: true })
        assert.deepEqual(sent[0], { addr: "a1", view: "draft", draft_live: false, follow_peer: true })
    })

    test("malformed descriptor preserves the prior valid selection", () => {
        const sent = []
        const recovery = createOuterRecovery({ send: (d) => sent.push(d) })
        recovery.mirror(selector)

        assert.equal(recovery.mirror({ ...selector, view: "bogus" }), false)
        assert.equal(recovery.mirror({ ...selector, addr: "" }), false)
        assert.equal(recovery.mirror({ view: "watch" }), false)

        assert.equal(recovery.restore({ visibleAddr: "a1" }), true)
        assert.deepEqual(sent, [selector])
    })

    test("explicit close clears; malformed does not", () => {
        const recovery = createOuterRecovery({ send: () => assert.fail("no send") })

        recovery.mirror(selector)
        assert.equal(recovery.mirror({ addr: null }), true)
        assert.equal(recovery.restore({ visibleAddr: "a1" }), false)

        recovery.mirror(selector)
        assert.equal(recovery.mirror(null), true)
        assert.equal(recovery.restore({ visibleAddr: "a1" }), false)
    })

    test("clear (close) may be replaced; release is permanent", () => {
        const sent = []
        const recovery = createOuterRecovery({ send: (d) => sent.push(d) })

        recovery.mirror(selector)
        recovery.clear()
        assert.equal(recovery.restore(), false)
        assert.equal(recovery.mirror({ ...selector, addr: "a2" }), true)
        recovery.restore({ visibleAddr: "a2" })
        assert.equal(sent[0].addr, "a2")

        recovery.release()
        assert.equal(recovery.mirror(selector), false)
        assert.equal(recovery.restore(), false)
        assert.equal(sent.length, 1)
    })
    test("selectorFor accepts the canonical closed shape and exact address", () => {
        const closed = { addr: null, view: "watch", draft_live: true, follow_peer: true }
        assert.deepEqual(selectorFor(closed, null), closed)
        assert.equal(selectorFor({ ...closed, view: "bogus" }, null), null)
        assert.equal(selectorFor({ ...closed, addr: "a1" }, null), null)
        assert.deepEqual(selectorFor(selector, "a1"), selector)
    })

})
