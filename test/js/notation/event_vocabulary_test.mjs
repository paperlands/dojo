// THE WIRE'S VOCABULARY — pinned the way this tree pins vocabularies: one row per kind,
// a literal list a witness can read. (Same shape as weave/queries KINDS, and for the
// same reason: a table that must agree with three places is a place they can disagree.)
//
// THREE KEEPERS, one list each, and a decision at every join:
//   · the PRODUCER yields a kind — an executor `yield`, or a put the scheduler makes
//     itself (`error`, `head`, `view`, `clear`, `notice`);
//   · the SCHEDULER routes it, or DEPOSITS it — a deposited kind still reaches the
//     channel with credit; the deposit default is what makes that safe;
//   · the RENDERER draws it, or does not — a kind absent from MATERIALIZERS is the
//     compositor's or the scheduler's business, never an oversight by default.
//
// A kind nobody routes IS a silent loss, so adding one is a deliberate edit here.
// Run: node --test test/js/notation/event_vocabulary_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { EFFECTS } from "../../../assets/js/turtling/scheduler.js"
import { MATERIALIZERS, materialize } from "../../../assets/js/turtling/materializer.js"

describe("the wire's vocabulary", () => {
    test("the scheduler routes exactly these verbs — a new one is an edit here", () => {
        assert.deepEqual(Object.keys(EFFECTS).sort(), [
            "birth", "blocked", "breath", "law", "limitMailbox", "motion",
            "motionUnresolved", "notice", "parameter", "scalar", "shout", "spawn",
            "wait", "yield",
        ])
    })

    test("the renderer draws exactly these kinds — a new one is an edit here", () => {
        assert.deepEqual(Object.keys(MATERIALIZERS).sort(),
            ["grid", "head", "label", "path", "view", "wait"])
    })

    // One deliberate overlap. `wait` is a temporal marker: the scheduler advances the
    // clock (so it is routed) and the renderer draws nothing (so it has a row saying
    // so). A SECOND overlap would mean a kind that both changes the frame and draws —
    // a decision to take on purpose, not to discover.
    test("routed and drawn overlap only at `wait`", () => {
        const routed = new Set(Object.keys(EFFECTS))
        const both = Object.keys(MATERIALIZERS).filter((kind) => routed.has(kind))
        assert.deepEqual(both, ["wait"])
    })

    // THE CONTRACT THE COMPOSITOR RELIES ON. The channel carries kinds the renderer does
    // not draw — `error`, `beat`, `notice`, `clear`, and every frame/world message — and
    // the renderer must ignore them rather than choke. This is what makes a new kind
    // safe to add: its silence is a decision, not an accident. (Before this, absence
    // from a switch body was the only thing standing between them and a throw.)
    test("an undrawn kind is IGNORED, not fatal", () => {
        for (const kind of ["error", "beat", "notice", "clear", "spawn", "birth", "something-new"]) {
            assert.doesNotThrow(() => materialize({ type: kind }, {}, {}), kind)
        }
    })

    test("a drawn kind tolerates a bare event — the ledger's early frames carry no geometry", () => {
        assert.doesNotThrow(() => materialize({ type: "path" }, { pathGroup: null }, {}))
        assert.doesNotThrow(() => materialize({ type: "wait" }, {}, {}))
    })
})
