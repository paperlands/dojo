// Nerve signal store — the single source of truth for all nerve signals.
// Run with: node --test test/js/nerve/nerve_test.mjs
//
// Guards the contract that the outershell's remote zone respects: a watched
// friend's signals are first-class store signals (stamped with epoch, fanned to
// subscribers), NOT a storeless shadow fed straight to a DOM mutator.
//
// What is NOT a signal: their document's HEALTH. A wound has no lifetime of its
// own, so it is pulled by the seat's base layer, not pushed (nerve/seat.js).

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createSignalStore, signals as S, CHANNELS } from "../../../assets/js/nerve/store.js"

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

describe("nerve store: a friend's voice is health, not a signal", () => {
    test("their SHOUTS still flow through push, addressed by source", () => {
        const store = createSignalStore()
        const seen = []
        store.subscribe((s) => seen.push(s))

        store.push(S.shout("kai", "over here", null))
        assert.equal(seen.length, 1)
        assert.equal(seen[0].source, "kai")
        assert.equal(CHANNELS.shout.zone, "chat")
        assert.equal(CHANNELS.output.zone, "status")
    })

    test("their WOUND does not — no remote constructor, no error channel", () => {
        // A watched friend's fault is their document's standing health, and it
        // reaches their panel's seat as the pulled base layer (nerve/seat.js).
        // As a signal it needed a 10-minute fade and still lost the slot to
        // whatever pushed next.
        assert.equal(S.remote, undefined)
        assert.equal(S.error, undefined)
        assert.equal(CHANNELS.error, undefined)
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
        assert.ok(toResidual(S.shout("kai", "boom", null)))
    })

    test("claiming kai routes kai's signals to the panel, core stays local", () => {
        const store = createSignalStore()
        store.claim("kai")
        const toResidual = residual(store)
        const toKai = claimant("kai")

        const coreShout = S.shout("sky", "tick", 1)      // your own ambient
        const friendShout = S.shout("kai", "beat", 2)    // kai's ambient (local run)
        const friendChat = S.chat("kai", "hello", null)  // kai, another producer
        const systemOut = S.output("☀︎", 3)              // your render result

        // The bug, inverted: core shouts NEVER reach the kai panel...
        assert.ok(!toKai(coreShout))
        assert.ok(toResidual(coreShout))
        assert.ok(toResidual(systemOut))   // source 'system', unclaimed → local
        // ...and kai's signals (both producers) reach the panel, not the corner.
        assert.ok(toKai(friendShout))
        assert.ok(toKai(friendChat))
        assert.ok(!toResidual(friendShout))
        assert.ok(!toResidual(friendChat))
    })
})

describe("nerve store: the clock law (gw-t-clock)", () => {
    test("a boundary-crossing signal keeps its source's ts", () => {
        const store = createSignalStore()
        store.push({ msg: "hello", source: "kai", kind: "chat", ts: 12345 })
        assert.equal(store.signals[0].ts, 12345, "ts belongs to the source — never replaced")
    })

    test("a locally-born signal (no ts) is stamped here", () => {
        const store = createSignalStore()
        const before = performance.now()
        store.push(S.shout("sky", "tick", 1))
        assert.ok(store.signals[0].ts >= before, "local signals get the local clock")
    })
})

// THE TALLY — the next thing to fix, then what is still open (R1). One sentence
// for a learner (Elm narrows on purpose; twelve messages make a beginner quit),
// and a count so narrowing loses nothing.
// It rides on the HEALTH ANSWER now, beside the sentence, because both surfaces
// PULL it — see seat_probe_test ("the tally moves without a re-arm"). The old
// sentence-keyed gate had to smuggle the count into its own key to notice three
// faults becoming two; a pulled layer just reads what stands.
describe("the tally rides beside the sentence", () => {
    test("the store still carries one whole when a signal has it", () => {
        const store = createSignalStore()
        store.push({ ...S.output("☀︎", 4), tally: 4 })
        assert.equal(store.signals.at(-1).tally, 4)
    })

    test("and defaults to none", () => {
        const store = createSignalStore()
        store.push(S.output("☀︎", 4))
        assert.equal(store.signals.at(-1).tally, 0)
    })
})
