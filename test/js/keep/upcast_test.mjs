// The fold exists before it is needed (id:kb-4, id:kc-p-fold) — pure, sync.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { V, write, read, name } from "../../../assets/js/keep/entry.js"
import { STEPS, upcast } from "../../../assets/js/keep/upcast.js"

const ctx = Object.freeze({
    root: "a".repeat(64),
    target: "b".repeat(64),
    ts: Object.freeze({ t: 1_700_000_000_000, n: 0 }),
})

describe("upcast: empty fold, ready for the first step", () => {
    test("STEPS starts empty — the first shape change is a one-line append", () => {
        assert.ok(Array.isArray(STEPS))
        assert.equal(STEPS.length, 0)
    })

    test("an entry at V passes through unchanged in substance", () => {
        const bytes = write("snap", { source: "fd 100" }, ctx)
        const value = read(bytes)
        assert.equal(value.v, V)
        const view = upcast(value)
        assert.equal(view.v, V)
        assert.equal(view.kind, "snap")
        assert.equal(view.source, "fd 100")
        assert.equal(view.ahead, undefined)
    })

    test("the output is a view — no id, and the name of the source still verifies", () => {
        // Fold over every entry → no write occurs, every name still verifies
        // (id:kc-verify). A view has no id; nobody can hand it to put.
        const bytes = write("snap", { source: "x" }, ctx)
        const view = upcast(read(bytes))
        assert.equal(view.id, undefined)
        assert.equal("id" in view, false)
        // The bytes on disk are untouched; their name still holds.
        assert.equal(name(bytes), name(write("snap", { source: "x" }, ctx)))
    })

    test("v newer than us degrades honestly — ahead, no throw, no guess", () => {
        // id:kc-verify: hand a reader v: 99 → renders what it knows and says
        // there is more. ahead is a view field; a view is never kept.
        const future = { v: 99, kind: "snap", root: ctx.root, ts: ctx.ts, target: ctx.target, source: "x" }
        const view = upcast(future)
        assert.equal(view.ahead, true)
        assert.equal(view.v, 99)
        assert.equal(view.source, "x")
        assert.equal(view.kind, "snap")
    })

    test("a missing STEPS[n] throws — a hole is a bug, not a soft degrade", () => {
        // id:kb-4 NOT: no guard for a missing step. We author at V; anything
        // below V without a step is broken infrastructure.
        const old = { v: 0, kind: "snap", root: null, ts: null, target: null }
        // V is 1 and STEPS is empty → STEPS[0] is undefined → throw.
        if (V > 0 && STEPS.length === 0) {
            assert.throws(() => upcast(old), TypeError)
        }
    })

    test("folding never rewrites the entry string", () => {
        const bytes = write("snap", { source: "stay" }, ctx)
        const before = bytes
        upcast(read(bytes))
        assert.equal(bytes, before)
        assert.equal(name(bytes), name(before))
    })
})
