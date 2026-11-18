// THE WIRE'S VOCABULARY — pinned the way this tree pins vocabularies: one row per kind,
// a literal list a witness can read. (Same shape as weave/queries KINDS, and for the
// same reason: a table that must agree with three places is a place they can disagree.)
//
// THREE KEEPERS, one list each, and a decision at every join:
//   · the PRODUCER yields a kind — an executor `yield`, or a put the scheduler makes
//     itself (`error`, `head`, `view`, `clear`, `notice`, and a declared object's
//     `vector` on the current-state slot);
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
import { nameAnchor } from "../../../assets/js/turtling/laws/pin.js"

describe("the wire's vocabulary", () => {
    test("the scheduler routes exactly these verbs — a new one is an edit here", () => {
        assert.deepEqual(Object.keys(EFFECTS).sort(), [
            "birth", "blocked", "breath", "construct", "law", "limitMailbox", "motion",
            "motionUnresolved", "notice", "parameter", "scalar", "shout", "spawn",
            "wait", "yield",
        ])
    })

    test("the renderer draws exactly these kinds — a new one is an edit here", () => {
        assert.deepEqual(Object.keys(MATERIALIZERS).sort(),
            ["grid", "head", "label", "path", "vector", "view", "wait"])
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

    // A head with a camera but nothing to drive must cost the FOLLOW, never the pass.
    // `desire: 'track'` with a targetless `controls` threw
    // `can't access property "x", … is undefined` out of `advance`, which the turtle
    // catches into one console line — and the figure silently freezes. (Fixed 2026-10-02;
    // this reproduces the original error exactly.)
    test("a camera that cannot be driven does not take the compositor pass with it", () => {
        const camera = { desire: "track", position: { x: 0, y: 0, z: 250 } }
        const head = { type: "head", position: [0, 0, 0], headSize: 10, color: "silver" }
        for (const controls of [null, {}, { target: null }]) {
            assert.doesNotThrow(() => materialize(head, {}, { camera, controls }),
                `controls: ${JSON.stringify(controls)}`)
        }
        // And a pan through a targetless controls is the same class.
        assert.doesNotThrow(() => materialize(head, {}, { camera: { desire: "pan" }, controls: {} }))
    })

    // A vector is an OBJECT: it draws its world geometry and keeps its event, keyed by
    // name, for the overlay to name. Its name is NOT layer label ink.
    // (id:notation-coordinate-vector, id:laws-decl-interface)
    // The layer carries the DECLARING frame — the compositor seats each layer group at
    // its ambient's world pose — so an arrow's local points land in the frame by
    // construction. The shell is the judge for that seating; this pins the shape the
    // materializer is handed, which is what the layer then places.
    // (id:notation-coordinate-vector)
    test("a vector's arrow is placed at its tip, in the frame's own coordinates", () => {
        const added = []
        const groups = { pathGroup: { add(mesh) { added.push(mesh) } } }
        const ctx = {
            vectors: new Map(),
            labels: { write() {} },
            materials: { get: () => ({}) },
            requestRender() {},
        }
        materialize({
            type: "vector", name: "A", from: [10, 0, 0], to: [50, 0, 0],
            rotation: { w: 1, x: 0, y: 0, z: 0 }, color: "silver", thickness: 2, textSize: 5,
        }, groups, ctx)
        const head = added.find((m) => m.isGroup)
        assert.ok(head, "an arrowhead object was added")
        assert.deepEqual(head.position.toArray(), [50, 0, 0], "the tip is the point reached")
        assert.equal(head.visible, true)
    })
    // A declared object's name belongs to the OVERLAY, beside a pin's, not to the
    // layer's label ink: the materializer builds world geometry keyed by the name and
    // deposits no label. (id:notation-coordinate-vector, id:laws-decl-interface)
    test("a named vector is one keyed object; its name is the overlay's, not label ink", () => {
        const written = []
        const groups = { pathGroup: { add() {} } }
        const ctx = {
            vectors: new Map(),
            labels: { write: (event) => written.push(event) },
            materials: { get: () => ({}) },
            requestRender() {},
        }
        materialize({
            type: "vector", name: "A", from: [0, 0, 0], to: [80, 60, 0],
            rotation: { w: 1, x: 0, y: 0, z: 0 }, color: "silver", thickness: 2, textSize: 5,
        }, groups, ctx)
        assert.equal(ctx.vectors.size, 1, "one keyed object")
        assert.equal(ctx.vectors.get("A").event.to[0], 80, "the entry keeps the event for the overlay")
        assert.equal(written.length, 0, "a name is not deposited label ink")
    })
    test("a name anchor sits beyond the tip, along the object's screen direction", () => {
        const a = nameAnchor({ x: 0, y: 0 }, { x: 100, y: 0 })
        assert.ok(a.x > 100 && Math.abs(a.y) < 1e-9, "padded past the tip, not at it")
        assert.deepEqual(nameAnchor(null, { x: 5, y: 5 }), { x: 17, y: 5 })
    })
})
