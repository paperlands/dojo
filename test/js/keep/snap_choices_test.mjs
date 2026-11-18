// The snap body carries the plain offered choices as one value beside source_id.
// No schema change: write/read round-trips arbitrary body fields.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mintSnap, writeSnap } from "../../../assets/js/keep/kinds/snap.js"
import { name, read } from "../../../assets/js/keep/entry.js"

const ROOT = "a".repeat(64)
const SRC = "goto 5 0\nlet p"
const CAP = {
    v: 1,
    inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 3, 0] } }],
}
const ts = { t: 1, n: 0 }

test("choices ride the snap body beside the existing source_id", () => {
    const bytes = writeSnap({ root: ROOT, source: SRC, choices: CAP, ts })
    const body = read(bytes)
    assert.equal(body.source_id, name(SRC))
    assert.deepEqual(body.choices, CAP)
    assert.equal(body.kind, "snap")
})

test("different choices change the keep name without changing source identity", () => {
    const changed = {
        v: 1,
        inputs: [{ route: CAP.inputs[0].route, action: { kind: "translation", by: [0, 2, 0] } }],
    }
    const first = writeSnap({ root: ROOT, source: SRC, choices: CAP, ts })
    const second = writeSnap({ root: ROOT, source: SRC, choices: changed, ts })
    assert.notEqual(name(first), name(second))
    assert.equal(read(first).source_id, read(second).source_id)
})

test("the snap writer preserves future choice versions and fields as opaque data", () => {
    const future = { v: 2, inputs: CAP.inputs, future_context: { reference: "B" } }
    const bytes = writeSnap({ root: ROOT, source: SRC, choices: future, ts })
    assert.deepEqual(read(bytes).choices, future)
    assert.equal(read(bytes).source_id, name(SRC))
    const changed = writeSnap({
        root: ROOT, source: SRC, ts,
        choices: { ...future, future_context: { reference: "C" } },
    })
    assert.notEqual(name(bytes), name(changed))
})

test("no choices is absent, explicit empty is present", () => {
    const absent = read(writeSnap({ root: ROOT, source: SRC, ts }))
    assert.equal("choices" in absent, false)
    const empty = read(writeSnap({ root: ROOT, source: SRC, choices: { v: 1, inputs: [] }, ts }))
    assert.deepEqual(empty.choices, { v: 1, inputs: [] })
})

test("the capsule is copied by the caller, not given authority by the write", () => {
    const choices = { v: 1, inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 3, 0] } }] }
    const bytes = writeSnap({ root: ROOT, source: SRC, choices, ts })
    choices.inputs[0].action.by[0] = 99
    assert.deepEqual(read(bytes).choices.inputs[0].action.by, [0, 3, 0])
})

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

test("mintSnap opts the reflection's choices into the one put", async () => {
    const door = { root: async () => ROOT, put: async (bytes) => bytes }
    const bytes = await mintSnap(
        { title: "one construction" },
        { source: SRC, diagnostics: [], choices: CAP },
        { buffer_id: "b1" },
        door,
        PNG_1PX,
    )
    assert.ok(bytes)
    const body = read(bytes)
    assert.deepEqual(body.choices, CAP)
    assert.equal(body.source_id, name(SRC))
})

test("mintSnap without reflection choices keeps the field absent", async () => {
    const door = { root: async () => ROOT, put: async (bytes) => bytes }
    const bytes = await mintSnap(
        { title: "legacy" },
        { source: SRC, diagnostics: [] },
        { buffer_id: "b1" },
        door,
        PNG_1PX,
    )
    assert.equal("choices" in read(bytes), false)
})
