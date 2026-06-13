// One Address — Phase 1 of the tilling (specs/groundwork.org id:gw-development).
// Run with: node --test test/js/identity_test.mjs
//
// The stable address (frameAddress: top registration key + name path) is the one
// cross-eval identity register: shout de-dup, focus, and keys route on it.
// frame.id remains per-LIFETIME render plumbing (layers, deposit GC) — a re-eval
// mints a new id (clearing old ink) but keeps the address (keeping identity).

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
    createScheduler, metaRoot, frameAddress, deliverShout
} from "../../assets/js/turtling/scheduler.js"
import { createFocus, resolveAddress } from "../../assets/js/turtling/focus.js"
import { parseProgram } from "../../assets/js/turtling/parse.js"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"

function makeScheduler() {
    return createScheduler(metaRoot(), {
        createDeps: () => ({
            mathParser: new Parser(),
            mathEvaluator: new Evaluator()
        }),
        execOpts: { color: '#e77808' }
    })
}

function fork(name, code) {
    return {
        name,
        code: { ast: parseProgram(code), functions: null },
        style: { color: '#e77808' },
        env: null
    }
}


describe("frameAddress — the one cross-eval register", () => {
    test("a top-level ambient's address is its registration key, not its name", () => {
        const s = makeScheduler()
        const child = s.hotSwapChild("buf-1", fork("spiral", "fw 10"))
        assert.equal(child.address, "buf-1")
        assert.equal(frameAddress(s.root, child), "buf-1")
    })

    test("address survives re-eval; id does not (per-lifetime plumbing)", () => {
        const s = makeScheduler()
        const first = s.hotSwapChild("buf-1", fork("spiral", "fw 10"))
        const second = s.hotSwapChild("buf-1", fork("spiral", "fw 20"))
        assert.notEqual(second.id, first.id)
        assert.equal(second.address, first.address)
    })

    test("rename changes display only — address holds", () => {
        const s = makeScheduler()
        const first = s.hotSwapChild("buf-1", fork("spiral", "fw 10"))
        const renamed = s.hotSwapChild("buf-1", fork("coil", "fw 10"))
        assert.equal(renamed.name, "coil")
        assert.equal(renamed.address, first.address)
    })

    test("a nested ambient's address is the path under its tab's key", () => {
        const s = makeScheduler()
        s.hotSwapChild("buf-1", fork("tab", "as sky do\nfw 5\nend"))
        const tab = s.root.children.get("buf-1")
        const sky = tab.children.get("sky")
        assert.ok(sky, "nested ambient spawned")
        assert.equal(sky.address, "buf-1/sky")
    })

    test("same nested name under sibling tabs never collides", () => {
        const s = makeScheduler()
        s.hotSwapChild("buf-1", fork("a", "as sky do\nfw 5\nend"))
        s.hotSwapChild("buf-2", fork("b", "as sky do\nfw 5\nend"))
        const sky1 = s.root.children.get("buf-1").children.get("sky")
        const sky2 = s.root.children.get("buf-2").children.get("sky")
        assert.notEqual(sky1.address, sky2.address)
    })
})

describe("shout de-dup — keyed on address, not the re-minted id", () => {
    test("a shout delivers once to a frame", () => {
        const s = makeScheduler()
        const a = s.hotSwapChild("buf-a", fork("a", "fw 1"))
        const b = s.hotSwapChild("buf-b", fork("b", "fw 1"))
        const shout = { from: a, name: "ping", payload: 1 }
        deliverShout(shout, b)
        deliverShout(shout, b)
        assert.equal(b.mailbox.filter(m => m.name === "ping").length, 1)
    })

    test("a re-eval'd receiver is never re-delivered (same address, new id)", () => {
        const s = makeScheduler()
        const a = s.hotSwapChild("buf-a", fork("a", "fw 1"))
        const b1 = s.hotSwapChild("buf-b", fork("b", "fw 1"))
        const shout = { from: a, name: "ping", payload: 1 }
        deliverShout(shout, b1)
        const b2 = s.hotSwapChild("buf-b", fork("b", "fw 1"))
        assert.notEqual(b2.id, b1.id)
        deliverShout(shout, b2)
        assert.equal(b2.mailbox.filter(m => m.name === "ping").length, 0,
            "the address already received this shout in its previous life")
    })

    test("a shout never returns to its emitter, even reborn", () => {
        const s = makeScheduler()
        const a1 = s.hotSwapChild("buf-a", fork("a", "fw 1"))
        const shout = { from: a1, name: "echo", payload: null }
        const a2 = s.hotSwapChild("buf-a", fork("a", "fw 1"))
        deliverShout(shout, a2)
        assert.equal(a2.mailbox.filter(m => m.name === "echo").length, 0,
            "emitter's address must not receive its own shout")
    })

    test("interleaved shouts still deliver across ambients (behaviour preserved)", () => {
        const s = makeScheduler()
        s.hotSwapChild("buf-a", fork("a", "shout 'tick' 1"))
        const b = s.root.children.get("buf-a")
        assert.ok(b.mailbox.some(m => m.name === "tick"), "self-delivery at emission")
    })
})

describe("focus — one address register; the name is a view", () => {
    test("focus survives re-eval and rename; the name view derives display", () => {
        const s = makeScheduler()
        const f = createFocus(s)
        s.hotSwapChild("buf-1", fork("spiral", "fw 10"))
        f.address = "buf-1"
        assert.equal(f.name, "spiral")

        // live rename (opBuffer rename mutates child.name without re-eval)
        s.root.children.get("buf-1").name = "coil"
        assert.equal(f.address, "buf-1", "rename changes display only")
        assert.equal(f.name, "coil", "the name view follows the address")

        // re-eval
        s.hotSwapChild("buf-1", fork("coil", "fw 20"))
        assert.equal(f.address, "buf-1", "focus survives re-eval")
        assert.equal(f.name, "coil")
        assert.ok(f.isFocused(s.root.children.get("buf-1")))
    })

    test("two tabs sharing a display name cannot steal each other's focus", () => {
        const s = makeScheduler()
        const f = createFocus(s)
        s.hotSwapChild("buf-1", fork("sky", "fw 10"))
        s.hotSwapChild("buf-2", fork("sky", "fw 10"))
        f.address = "buf-2"
        assert.equal(f.name, "sky")
        assert.ok(!f.isFocused(s.root.children.get("buf-1")))
        assert.ok(f.isFocused(s.root.children.get("buf-2")))
    })

    test("a nested lens is in the focused subtree when its tab is focused", () => {
        const s = makeScheduler()
        const f = createFocus(s)
        s.hotSwapChild("buf-1", fork("tab", "as sky do\nfw 5\nend"))
        const sky = s.root.children.get("buf-1").children.get("sky")
        f.address = "buf-1"
        assert.ok(f.inFocusedSubtree(sky))
        assert.ok(!f.isFocused(sky), "strict match stays strict")
    })

    test("the name view is null when nothing is focused", () => {
        const s = makeScheduler()
        const f = createFocus(s)
        assert.equal(f.name, null)
    })
})

describe("resolveAddress — names resolve through the address", () => {
    test("a registration key resolves to itself", () => {
        const s = makeScheduler()
        s.hotSwapChild("buf-1", fork("spiral", "fw 10"))
        assert.equal(resolveAddress(s, "buf-1"), "buf-1")
    })

    test("a display name resolves to its frame's address", () => {
        const s = makeScheduler()
        s.hotSwapChild("buf-1", fork("spiral", "fw 10"))
        assert.equal(resolveAddress(s, "spiral"), "buf-1")
    })

    test("a nested name resolves to its path address", () => {
        const s = makeScheduler()
        s.hotSwapChild("buf-1", fork("tab", "as sky do\nfw 5\nend"))
        assert.equal(resolveAddress(s, "sky"), "buf-1/sky")
        assert.equal(resolveAddress(s, "buf-1/sky"), "buf-1/sky")
    })

    test("an unknown reference resolves to null", () => {
        const s = makeScheduler()
        s.hotSwapChild("buf-1", fork("spiral", "fw 10"))
        assert.equal(resolveAddress(s, "ghost"), null)
        assert.equal(resolveAddress(s, null), null)
    })
})
