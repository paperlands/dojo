// The VOICE (weave/voice.js) — the rhythm of a wound. Run:
//   node --test test/js/voice_test.mjs
//
// What this pins: a standing wound is ONE FACT, not a drumbeat. A friend hatches
// on every keystroke and a live draft re-runs as fast as it is typed, so every
// surface learns the same wound dozens of times; without a rhythm each learning
// becomes a shout. It heals and returns → news again, because the ledger is
// rebuilt from the living set each pass and never appended to.
//
// And `forget()`, which is the whole reason this is an organ and not a Set: two
// runtimes can show through one surface (the author's on the wire, ours in a
// live draft), and a wound heard from one must never silence the identical wound
// arriving from the other.

import { test, describe as suite } from "node:test"
import assert from "node:assert/strict"

import { sayOnce } from "../../assets/js/weave/voice.js"

// The utterance ledger: what a surface would have pushed.
const heard = (voice, wounds) => {
    const out = []
    voice.say(wounds, (w) => out.push(w.message))
    return out
}

const wound = (message, line = 1, address = "b1", kind = "walk") =>
    ({ kind, message, address, span: { line } })

suite("said once while it stands", () => {
    test("a wound speaks when it arrives", () => {
        const v = sayOnce()
        assert.deepEqual(heard(v, [wound("boom")]), ["boom"])
    })

    test("and stays quiet on every pass after", () => {
        const v = sayOnce()
        heard(v, [wound("boom")])
        assert.deepEqual(heard(v, [wound("boom")]), [], "one fact, not a drumbeat")
        assert.deepEqual(heard(v, [wound("boom")]), [])
    })

    test("a NEW wound beside a standing one speaks alone", () => {
        const v = sayOnce()
        heard(v, [wound("boom")])
        assert.deepEqual(heard(v, [wound("boom"), wound("crack", 9)]), ["crack"])
    })

    test("a wound that heals and returns is news again", () => {
        const v = sayOnce()
        heard(v, [wound("boom")])
        assert.deepEqual(heard(v, []), [], "healing says nothing")
        assert.deepEqual(heard(v, [wound("boom")]), ["boom"],
            "the ledger is rebuilt from the living set, never appended to")
    })
})

// Not object identity: every ask rebuilds the list, so the same wound is a new
// object each pass. The four facts a reader could tell apart.
suite("what makes two wounds the same wound", () => {
    test("same kind, address, words and line — one wound", () => {
        const v = sayOnce()
        heard(v, [wound("boom", 4, "b1")])
        assert.deepEqual(heard(v, [wound("boom", 4, "b1")]), [])
    })

    test("the same words on another line are another wound", () => {
        const v = sayOnce()
        heard(v, [wound("boom", 4)])
        assert.deepEqual(heard(v, [wound("boom", 4), wound("boom", 5)]), ["boom"])
    })

    test("the same words in another frame are another wound", () => {
        const v = sayOnce()
        heard(v, [wound("boom", 4, "b1#1.a")])
        assert.deepEqual(heard(v, [wound("boom", 4, "b1#1.a"), wound("boom", 4, "b1#1.b")]),
            ["boom"], "a page breaks at its CELL, so each cell's death is its own")
    })

    test("the same place hurting a different way is another wound", () => {
        const v = sayOnce()
        heard(v, [wound("boom", 4, "b1", "walk")])
        assert.deepEqual(heard(v, [wound("boom", 4, "b1", "rehearsal")]), ["boom"])
    })

    test("a placeless wound is still a wound, and still said once", () => {
        const v = sayOnce()
        const w = { kind: "walk", message: "boom", address: "b1", span: null }
        assert.deepEqual(heard(v, [w]), ["boom"])
        assert.deepEqual(heard(v, [{ ...w }]), [])
    })
})

// THE REASON THIS IS AN ORGAN. One surface, two runtimes: the review panel inks
// the author's wounds while watching and its own while drafting live. Crossing
// between them, the ledger must re-arm — otherwise the friend's "f not defined"
// silences the identical fault in the draft you just wrote, and the draft looks
// healthy because someone else's page was not.
suite("forget — a wound from one runtime cannot silence another's", () => {
    test("the same wound speaks again after the source changes hands", () => {
        const v = sayOnce()
        assert.deepEqual(heard(v, [wound("f not defined")]), ["f not defined"])
        v.forget()
        assert.deepEqual(heard(v, [wound("f not defined")]), ["f not defined"])
    })

    test("forgetting an empty ledger is not an error", () => {
        const v = sayOnce()
        v.forget()
        assert.deepEqual(heard(v, []), [])
    })

    test("two voices keep their own ledgers", () => {
        const a = sayOnce(), b = sayOnce()
        heard(a, [wound("boom")])
        assert.deepEqual(heard(b, [wound("boom")]), ["boom"],
            "the child's HUD and a friend's panel each hold their own rhythm")
    })
})

suite("nothing to say", () => {
    test("an empty pass utters nothing", () => {
        assert.deepEqual(heard(sayOnce(), []), [])
    })

    test("a missing list is an empty one — no surface has to guard the call", () => {
        assert.deepEqual(heard(sayOnce(), null), [])
        assert.deepEqual(heard(sayOnce(), undefined), [])
    })
})
