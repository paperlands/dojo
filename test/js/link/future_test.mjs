// Future envelopes are preserved, but never interpreted as the current shape.
// (id:keep-foundation-compatibility, id:la-fork-pull)
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { forkRef } from "../../../assets/js/link.js"
import { writeSnap } from "../../../assets/js/keep/kinds/snap.js"
import { name, read } from "../../../assets/js/keep/entry.js"

const ROOT = "a".repeat(64)
const SRC = "goto 5 0\nlet p"
const SOURCE_ID = name(SRC)
const CHOICES = {
    v: 1,
    inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 2, 0] } }],
}
const v1Bytes = writeSnap({
    root: ROOT,
    source: SRC,
    choices: CHOICES,
    title: "current",
    ts: { t: 1, n: 0 },
})
const current = read(v1Bytes)
const futureEnvelope = JSON.stringify({ ...current, v: 2 })
const futureChoices = JSON.stringify({
    ...current,
    choices: { v: 2, inputs: CHOICES.inputs, future_context: { reference: "B" } },
})
const aheadV1 = JSON.stringify({ ...current, ahead: true })
const stringV1 = JSON.stringify({ ...current, v: "1" })
const zeroV1 = JSON.stringify({ ...current, v: 0 })
const missingV1 = JSON.stringify(
    Object.fromEntries(Object.entries(current).filter(([key]) => key !== "v")),
)

const WORK = name(v1Bytes)
const PROOF = { v: 1, genesis: "c".repeat(64), signature: "ab".repeat(64) }
const unknownKind = JSON.stringify({ ...current, kind: "future-construction" })
const genesisKind = JSON.stringify({ ...current, kind: "genesis" })
const futureHeadEnvelope = JSON.stringify({
    ...current,
    target: WORK,
    v: 2,
    ts: { t: 2, n: 0 },
})
const futureHeadChoices = JSON.stringify({
    ...current,
    target: WORK,
    ts: { t: 2, n: 0 },
    choices: { v: 2, inputs: CHOICES.inputs },
})

function fixture(bytes) {
    const id = name(bytes)
    const records = new Map([[id, bytes]])
    const asks = []
    const notes = []
    const door = {
        root: async () => ROOT,
        get: async (ref) => records.get(ref) ?? null,
        list: async () => [...records.values()],
        source: async (sid) => (sid === SOURCE_ID ? SRC : null),
        proof: async () => null,
    }
    const term = {
        forkBuffer(ask) { asks.push({ kind: "buffer", ...ask }); return "buffer-landed" },
        forkKeep(ask) { asks.push({ kind: "keep", ...ask }); return "keep-landed" },
        createBuffer(...args) { asks.push({ kind: "create", args }); return "buffer-created" },
    }

    return { id, door, term, asks, notes, records, say: (...n) => notes.push(n.join(" ")) }
}

function workFixture(headBytes) {
    const records = new Map([
        [WORK, v1Bytes],
        [name(headBytes), headBytes],
    ])
    const asks = []
    const notes = []
    const door = {
        root: async () => ROOT,
        get: async (ref) => records.get(ref) ?? null,
        list: async () => [...records.values()],
        source: async (sid) => (sid === SOURCE_ID ? SRC : null),
        // Preverified journal evidence, not auth admission.
        proof: async () => PROOF,
    }
    const term = {
        forkBuffer(ask) { asks.push({ kind: "buffer", ...ask }); return "buffer-landed" },
        forkKeep(ask) { asks.push({ kind: "keep", ...ask }); return "keep-landed" },
        createBuffer(...args) { asks.push({ kind: "create", args }); return "buffer-created" },
    }
    return { work: WORK, door, term, asks, notes, records, say: (...n) => notes.push(n.join(" ")) }
}

describe("future compatibility at the reading owner", () => {
    test("a future envelope is preserved but not materialized as current", async () => {
        const f = fixture(futureEnvelope)
        assert.equal(await forkRef(`keep:${f.id}`, f), null)
        assert.equal(f.asks.length, 0)
        assert.match(f.notes.join(" "), /newer reader.*raw bytes preserved/)
        assert.equal(f.records.get(f.id), futureEnvelope)
    })

    test("a future envelope through the legacy bare reference is also blocked", async () => {
        const f = fixture(futureEnvelope)
        assert.equal(await forkRef(f.id, f), null)
        assert.equal(f.asks.length, 0)
        assert.match(f.notes.join(" "), /newer reader.*raw bytes preserved/)
    })

    test("future choices are retained but blocked without a null TypeError", async () => {
        const f = fixture(futureChoices)
        const result = await forkRef(`keep:${f.id}`, f)
        assert.equal(result, null)
        assert.equal(f.asks.length, 0)
        assert.match(f.notes.join(" "), /kept choices are unreadable/)
        assert.doesNotMatch(f.notes.join(" "), /TypeError/)
        assert.equal(f.records.get(f.id), futureChoices)
    })

    test("current v1 still opens with its source and choices", async () => {
        const f = fixture(v1Bytes)
        assert.equal(await forkRef(`keep:${f.id}`, f), "buffer-landed")
        assert.equal(f.asks.length, 1)
        assert.equal(f.asks[0].source, SRC)
        assert.deepEqual(f.asks[0].choices, CHOICES)
        assert.equal(f.asks[0].base_id, f.id)
    })

    test("a v1 body's own ahead marker cannot downgrade support", async () => {
        const f = fixture(aheadV1)
        assert.equal(await forkRef(`keep:${f.id}`, f), "buffer-landed")
        assert.equal(f.asks.length, 1)
        assert.equal(f.asks[0].source, SRC)
        assert.deepEqual(f.asks[0].choices, CHOICES)
        assert.doesNotMatch(f.notes.join(" "), /newer reader|unsupported keep envelope/)
    })

    test("missing or malformed catalog version is unsupported, not v1", async () => {
        for (const [label, bytes] of [
            ["string", stringV1],
            ["zero", zeroV1],
            ["missing", missingV1],
        ]) {
            const f = fixture(bytes)
            assert.equal(await forkRef(`keep:${f.id}`, f), null, label)
            assert.equal(f.asks.length, 0, label)
            assert.match(f.notes.join(" "), /unsupported keep envelope/, label)
            assert.equal(f.records.get(f.id), bytes, label)
        }
    })

    test("unknown or non-construction kinds do not run as snap", async () => {
        for (const [label, bytes] of [
            ["unknown", unknownKind],
            ["genesis", genesisKind],
        ]) {
            const f = fixture(bytes)
            assert.equal(await forkRef(`keep:${f.id}`, f), null, label)
            assert.equal(f.asks.length, 0, label)
            assert.match(f.notes.join(" "), /not a construction/, label)
            assert.equal(f.records.get(f.id), bytes, label)
        }
    })

    test("the work entrance reaches the same gate for future envelope and choices", async () => {
        for (const [label, head, expected] of [
            ["future envelope", futureHeadEnvelope, /newer reader/],
            ["future choices", futureHeadChoices, /kept choices are unreadable/],
        ]) {
            const f = workFixture(head)
            assert.equal(await forkRef(`work:${f.work}`, f), null, label)
            assert.equal(f.asks.length, 0, label)
            assert.match(f.notes.join(" "), expected, label)
            assert.equal(f.records.get(name(head)), head, label)
            assert.doesNotMatch(f.notes.join(" "), /TypeError/, label)
        }
    })
})
