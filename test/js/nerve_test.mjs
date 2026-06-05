// Nerve signal store — the single source of truth for all nerve signals.
// Run with: node --test test/js/nerve_test.mjs
//
// Guards the contract that the outershell's remote zone respects: a watched
// friend's signals are first-class store signals (stamped with epoch, fanned to
// subscribers), NOT a storeless shadow fed straight to a DOM mutator. The
// `signals.remote()` atom must flow through push() like every other kind.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createSignalStore, signals as S, CHANNELS } from "../../assets/js/nerve/store.js"

describe("nerve store: push is the only way in", () => {
    test("push stamps id/epoch/ts and fans out to subscribers", () => {
        const store = createSignalStore()
        const seen = []
        store.subscribe((s) => seen.push(s))

        store.push(S.output("☀︎", 12))

        assert.equal(seen.length, 1)
        const sig = seen[0]
        assert.equal(sig.kind, "output")
        assert.equal(sig.source, "system")
        assert.equal(sig.epoch, 0)
        assert.equal(sig.id, 1)
        assert.equal(typeof sig.ts, "number")
    })

    test("run() bumps the epoch boundary for subsequent signals", () => {
        const store = createSignalStore()
        const epochs = []
        store.subscribe((s) => epochs.push(s.epoch))

        store.push(S.output("a", 1))   // epoch 0
        store.run()
        store.push(S.output("b", 2))   // epoch 1

        assert.deepEqual(epochs, [0, 1])
    })

    test("MAX cap keeps the most recent signals", () => {
        const store = createSignalStore({ maxSignals: 3 })
        for (let i = 0; i < 5; i++) store.push(S.output("n", i))
        // newest-first, capped at 3
        assert.equal(store.signals.length, 3)
        assert.deepEqual(store.signals.map((s) => s.payload), ["4", "3", "2"])
    })
})

describe("nerve store: remote is a first-class atom (no bypass)", () => {
    test("a watched friend's signal flows through push, routed by kind", () => {
        const store = createSignalStore()
        const seen = []
        store.subscribe((s) => seen.push(s))

        store.push(S.remote("kai", "error", "boom", "error"))
        store.push(S.remote("kai", "☀︎", null, "output"))

        assert.equal(seen.length, 2)
        assert.equal(seen[0].source, "kai")
        assert.equal(seen[0].kind, "error")
        assert.equal(seen[1].kind, "output")
        // The kinds resolve to real channels (so the HUD routes them to a zone):
        assert.equal(CHANNELS.error.zone, "status")
        assert.equal(CHANNELS.output.zone, "status")
        assert.equal(CHANNELS.shout.zone, "chat")
    })

    test("muting a kind is observable on the store (HUD honours it)", () => {
        const store = createSignalStore()
        store.mute("shout")
        assert.ok(store.muted.has("shout"))
        store.unmute("shout")
        assert.ok(!store.muted.has("shout"))
    })
})

describe("nerve store: address claims route by source (read-side routing)", () => {
    // The store holds claims; projections route on them. These predicates are
    // exactly what nerve.js's residual and claimant projections apply.
    const residual = (store) => (s) => !store.claims.has(s.source)
    const claimant = (addr) => (s) => s.source === addr

    test("claim / release manage the address registry", () => {
        const store = createSignalStore()
        assert.ok(!store.claims.has("kai"))
        store.claim("kai")
        assert.ok(store.claims.has("kai"))
        store.release("kai")
        assert.ok(!store.claims.has("kai"))
        store.claim(null) // null address is inert, never claimed
        assert.equal(store.claims.size, 0)
    })

    test("an unclaimed friend's signals fall to the residual (local) projection", () => {
        const store = createSignalStore()
        const toResidual = residual(store)
        // No panel open: a core shout AND a stray friend signal both go local.
        assert.ok(toResidual(S.shout("sky", "tick", 1)))
        assert.ok(toResidual(S.remote("kai", "error", "boom", "error")))
    })

    test("claiming kai routes kai's signals to the panel, core stays local", () => {
        const store = createSignalStore()
        store.claim("kai")
        const toResidual = residual(store)
        const toKai = claimant("kai")

        const coreShout = S.shout("sky", "tick", 1)      // your own ambient
        const friendShout = S.shout("kai", "beat", 2)    // kai's ambient (local run)
        const friendStatus = S.remote("kai", "error", "x", "error") // kai via server
        const systemOut = S.output("☀︎", 3)              // your render result

        // The bug, inverted: core shouts NEVER reach the kai panel...
        assert.ok(!toKai(coreShout))
        assert.ok(toResidual(coreShout))
        assert.ok(toResidual(systemOut))   // source 'system', unclaimed → local
        // ...and kai's signals (both producers) reach the panel, not the corner.
        assert.ok(toKai(friendShout))
        assert.ok(toKai(friendStatus))
        assert.ok(!toResidual(friendShout))
        assert.ok(!toResidual(friendStatus))
    })
})
