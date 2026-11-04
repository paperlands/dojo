// Automatic work selection needs evidence; exact bytes remain borrowable.
import { test } from "node:test"
import assert from "node:assert/strict"
import { forkRef } from "../../../assets/js/link.js"
import { createJournal } from "../../../assets/js/keep/journal.js"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { writeSnap } from "../../../assets/js/keep/kinds/snap.js"
import { name } from "../../../assets/js/keep/entry.js"
import { createMemoryIDB } from "../keep/idb_memory.mjs"

async function fixture({ foreign = false, originProof = true } = {}) {
    const { idb, KeyRange } = createMemoryIDB()
    const author = createEngine({ idb, KeyRange, dbName: "author" })
    const root = name(await author.genesis())
    const origin = writeSnap({ root, source: "fw 1", ts: { t: 1, n: 0 } })
    const work = await author.put(origin, { source: "fw 1", authored: originProof })
    const child = writeSnap({ root, work_id: work, source: "fw 2", ts: { t: 2, n: 0 } })
    await author.put(child, { source: "fw 2", authored: true })
    const reader = foreign ? createEngine({ idb, KeyRange, dbName: "reader" }) : author
    const door = createJournal({ engine: reader })
    await door.root()
    if (foreign) {
        for (const [bytes, source] of [[origin, "fw 1"], [child, "fw 2"]]) {
            const proof = bytes === origin && !originProof ? null : await author.proof(bytes)
            await door.put(bytes, { source, ...(proof ? { proof } : {}) })
        }
    }
    const calls = []
    const notes = []
    const term = {
        forkKeep: ask => { calls.push({ kind: "same", ...ask }); return "same" },
        forkBuffer: ask => { calls.push({ kind: "fork", ...ask }); return "fork" },
    }
    return {
        author, door, root, origin, work, child, calls, notes,
        message: (source, t) => writeSnap({ root, work_id: work, source, ts: { t, n: 0 } }),
        open: (ref = `work:${work}`, extra = {}) => forkRef(ref, {
            door, term, say: (...args) => notes.push(args.map(String).join(" ")), ...extra,
        }),
        async close() {
            await door.close()
            if (foreign) await author.close()
        },
    }
}

test("an unproven newer local claim does not supplant a proven work member", async () => {
    const f = await fixture()
    try {
        const unproven = f.message("fw 999", 999)
        await f.door.put(unproven, { source: "fw 999" })
        await assert.rejects(f.door.proof(unproven), /no retained proof/)
        assert.equal(await f.open(), "same")
        assert.equal(f.calls[0].source, "fw 2")
        assert.equal(f.calls[0].base_id, name(f.child))
        assert.equal(await f.door.get(name(unproven)), unproven, "selection does not erase evidence")
    } finally { await f.close() }
})

test("an exact unproven same-root moment opens as a fork, not an authenticated rejoin", async () => {
    const f = await fixture()
    try {
        const unproven = f.message("fw 999", 999)
        await f.door.put(unproven, { source: "fw 999" })
        assert.equal(await f.open(`keep:${name(unproven)}`), "fork")
        assert.equal(f.calls[0].source, "fw 999")
        assert.equal(f.calls[0].base_id, name(unproven))
        assert.equal(f.calls[0].work_id, undefined)
        await assert.rejects(f.door.proof(unproven), /no retained proof/)
    } finally { await f.close() }
})

for (const proof of [undefined, {}]) {
    test(`a newer room claim with ${proof ? "invalid" : "missing"} proof cannot advance a work`, async () => {
        const f = await fixture()
        try {
            const unproven = f.message("fw 1000", 1000)
            await f.open(`work:${f.work}`, {
                pullWork: async () => ({ id: name(unproven), message: unproven, source: "fw 1000", proof }),
            })
            assert.equal(f.calls[0].source, "fw 2")
            assert.equal(f.calls[0].base_id, name(f.child))
            await assert.rejects(f.door.proof(unproven), /no retained proof/)
        } finally { await f.close() }
    })
}

test("a valid room proof still advances a work and remains the original retained evidence", async () => {
    const f = await fixture({ foreign: true })
    try {
        const bytes = f.message("fw 3", 3)
        await f.author.put(bytes, { source: "fw 3", authored: true })
        const proof = await f.author.proof(bytes)
        assert.equal(await f.open(`work:${f.work}`, {
            pullWork: async () => ({ id: name(bytes), message: bytes, source: "fw 3", proof }),
        }), "fork")
        assert.equal(f.calls[0].source, "fw 3")
        assert.equal(f.calls[0].base_id, name(bytes))
        assert.deepEqual(await f.door.proof(bytes), proof)
    } finally { await f.close() }
})

test("a signed child does not authenticate an unproven origin; explicit enrichment can later establish it", async () => {
    const f = await fixture({ originProof: false })
    try {
        assert.equal(await f.open(), null)
        assert.equal(f.calls.length, 0)
        await f.door.put(f.origin, { authored: true })
        assert.equal(await f.open(), "same")
        assert.equal(f.calls[0].base_id, name(f.child))
    } finally { await f.close() }
})

for (const roomBehind of [false, true]) {
    test(`an origin-less legacy alias remains borrowable from local bytes${roomBehind ? " when the room is behind" : " offline"}`, async () => {
        const f = await fixture()
        try {
            const alias = "d".repeat(64)
            const bytes = writeSnap({ root: f.root, work_id: alias, source: "fw 42", ts: { t: 42, n: 0 } })
            await f.door.put(bytes, { source: "fw 42" })
            const older = writeSnap({ root: f.root, work_id: alias, source: "fw 41", ts: { t: 41, n: 0 } })
            const result = await f.open(alias, roomBehind ? {
                pullLegacy: async () => ({ id: name(older), message: older, source: "fw 41" }),
            } : {})
            assert.equal(result, "fork")
            assert.equal(f.calls[0].source, "fw 42")
            assert.equal(f.calls[0].addr, alias)
            assert.equal(f.calls[0].base_id, name(bytes))
            assert.equal(f.calls[0].work_id, undefined)
            assert.equal(await f.door.get(name(bytes)), bytes)
            await assert.rejects(f.door.proof(bytes), /no retained proof/)
        } finally { await f.close() }
    })
}

test("an exact retained moment remains readable when the reader cannot create a signing hand", async () => {
    const { idb, KeyRange } = createMemoryIDB()
    const engine = createEngine({ idb, KeyRange, crypto: {} })
    const bytes = writeSnap({ root: "a".repeat(64), source: "fw 4", ts: { t: 1, n: 0 } })
    await engine.put(bytes, { source: "fw 4" })
    const door = createJournal({ engine })
    let selected
    try {
        const result = await forkRef(`keep:${name(bytes)}`, {
            door,
            term: { forkBuffer: ask => { selected = ask; return "opened" }, forkKeep: () => assert.fail("no reader hand") },
            say: () => {},
        })
        assert.equal(result, "opened")
        assert.equal(selected.source, "fw 4")
        assert.equal(selected.base_id, name(bytes))
        assert.equal(await door.get(name(bytes)), bytes)
        await assert.rejects(engine.genesis(), /secure context/)
    } finally { await door.close() }
})
