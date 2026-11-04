import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { forkRef, shareForkRef, pullKeep, pullWork, pullLegacy, WORDS } from "../../../assets/js/link.js"
import { createLink } from "../../../assets/js/kernel/link.js"
import { writeSnap } from "../../../assets/js/keep/kinds/snap.js"
import { name } from "../../../assets/js/keep/entry.js"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { createJournal } from "../../../assets/js/keep/journal.js"
import { accept } from "../../../assets/js/keep/shared.js"
import { createMemoryIDB } from "../keep/idb_memory.mjs"
import { proofCases } from "../keep/proof_cases.mjs"

const ROOT = "a".repeat(64)
const OTHER = "b".repeat(64)
// Trusted retained evidence for the unit port; the real store verifies at put.
const PROOF = { v: 1, genesis: "c".repeat(64), signature: "ab".repeat(64) }
const origin = writeSnap({ root: ROOT, source: "fw 1", title: "birth", ts: { t: 1, n: 0 } })
const work = name(origin)
const child = writeSnap({ root: ROOT, work_id: work, prev: work, source: "fw 2", title: "continued", ts: { t: 2, n: 0 } })

function fixture(held = [], root = ROOT, { trusted = true } = {}) {
    const records = new Map(held.map(bytes => [name(bytes), bytes]))
    const sources = new Map([[name("fw 1"), "fw 1"], [name("fw 2"), "fw 2"]])
    const put = []
    const asks = []
    const notes = []
    const door = {
        root: async () => root,
        get: async id => records.get(id),
        list: async () => [...records.values()],
        source: async id => sources.get(id),
        put: async (bytes, extras) => {
            put.push({ bytes, extras })
            records.set(name(bytes), bytes)
            if (typeof extras?.source === "string") sources.set(name(extras.source), extras.source)
            return name(bytes)
        },
        share: async () => {},
        proof: async bytes => (trusted && records.has(name(bytes)) ? PROOF : null),
    }
    const term = {
        forkKeep(ask) { asks.push({ kind: "same", ...ask }); return typeof ask.source === "string" ? "same" : null },
        forkBuffer(ask) { asks.push({ kind: "foreign", ...ask }); return typeof ask.source === "string" ? "foreign" : null },
    }
    return { door, term, put, asks, notes, records, say: (...note) => notes.push(note.join(" ")) }
}

function reply(bytes, source, proof) {
    return { id: name(bytes), message: bytes, source, at: 1, node: "room", ...(proof ? { proof } : {}) }
}

function remote() {
    return {
        pull: async id => id === work ? reply(origin, "fw 1", PROOF) : id === name(child) ? reply(child, "fw 2", PROOF) : null,
        pullWork: async id => id === work ? reply(child, "fw 2", PROOF) : null,
    }
}

describe("mint intent from actual kept bytes", () => {
    test("the birth can be a moving work or an exact moment without changing its id", () => {
        assert.equal(shareForkRef(origin, { headId: work, proof: PROOF }), `work:${work}`)
        assert.equal(shareForkRef(origin, { headId: name(child) }), `keep:${work}`)
        assert.equal(shareForkRef(origin, { headId: work }), `keep:${work}`,
            "no self-origin shortcut without evidence")
    })
    test("a later head follows its evidenced origin", () => {
        assert.equal(shareForkRef(child, { headId: name(child), origin, proof: PROOF, originProof: PROOF }), `work:${work}`)
    })
    test("without origin evidence a legacy stream shares an exact snapshot", () => {
        assert.equal(shareForkRef(child, { headId: name(child) }), `keep:${name(child)}`)
    })
    test("a foreign-root claim cannot mint a moving work link", () => {
        const forged = writeSnap({ root: OTHER, work_id: work, source: "fw 2", ts: { t: 3, n: 0 } })
        assert.equal(shareForkRef(forged, { headId: name(forged), origin }), `keep:${name(forged)}`)
    })
    test("a child is never an origin", () => {
        const grandchild = writeSnap({ root: ROOT, work_id: name(child), source: "fw 2", ts: { t: 3, n: 0 } })
        assert.equal(shareForkRef(grandchild, { headId: name(grandchild), origin: child }), `keep:${name(grandchild)}`)
    })
    test("the link engine remains opaque and the vocabulary has no new owner", () => {
        const engine = createLink(`?fork=work%3A${work}`, () => {}, { words: WORDS })
        assert.equal(engine.read("fork"), `work:${work}`)
        assert.equal(Object.keys(WORDS).length, 6)
    })
})

for (const warm of [true, false]) {
    describe(`${warm ? "warm" : "cold"} typed arrival`, () => {
        test("keep:birth pins fw 1 while work:birth opens fw 2", async () => {
            const exact = fixture(warm ? [origin, child] : [])
            assert.equal(await forkRef(`keep:${work}`, { ...exact, ...remote() }), "same")
            assert.equal(exact.asks[0].source, "fw 1")
            assert.equal(exact.asks[0].base_id, work)
            const moving = fixture(warm ? [origin, child] : [])
            assert.equal(await forkRef(`work:${work}`, { ...moving, ...remote() }), "same")
            assert.equal(moving.asks[0].source, "fw 2")
            assert.equal(moving.asks[0].base_id, name(child))
            assert.equal(moving.asks[0].work_id, work)
        })
        test("a foreign hand forks from the exact selected child, not the work handle", async () => {
            const f = fixture(warm ? [origin, child] : [], OTHER)
            assert.equal(await forkRef(`work:${work}`, { ...f, ...remote() }), "foreign")
            assert.equal(f.asks[0].base_id, name(child))
            assert.equal(f.asks[0].addr, work)
        })
    })
}

describe("reader boundaries", () => {
    test("an exact miss cannot turn into the work's head", async () => {
        const f = fixture()
        let heads = 0
        const landed = await forkRef(`keep:${work}`, {
            ...f, pull: async () => reply(child, "fw 2"), pullWork: async () => { heads++; return reply(child, "fw 2") },
        })
        assert.equal(landed, null)
        assert.equal(heads, 0)
        assert.equal(f.asks.length, 0)
        assert.equal(f.put.length, 0)
    })
    test("missing origin stays unknown even if a claimed child is held", async () => {
        const f = fixture([child])
        let heads = 0
        assert.equal(await forkRef(`work:${work}`, { ...f, pull: async () => null, pullWork: async () => { heads++; return reply(child, "fw 2") } }), null)
        assert.equal(heads, 0)
        assert.equal(f.asks.length, 0)
    })
    test("a known child cannot be addressed as a new work", async () => {
        const f = fixture([origin, child])
        assert.equal(await forkRef(`work:${name(child)}`, { ...f, ...remote() }), null)
        assert.equal(f.asks.length, 0)
    })
    test("foreign-root local and remote claims cannot take a work head", async () => {
        const forged = writeSnap({ root: OTHER, work_id: work, source: "fw 2", ts: { t: 999, n: 0 } })
        const f = fixture([origin, forged])
        assert.equal(await forkRef(`work:${work}`, { ...f, pullWork: async () => reply(forged, "fw 2") }), "same")
        assert.equal(f.asks[0].base_id, work)
        assert.ok(f.notes.some(note => note.includes("nonmember")))
    })
    test("a newer local member survives an older room answer", async () => {
        const f = fixture([origin, child])
        assert.equal(await forkRef(`work:${work}`, { ...f, pullWork: async () => reply(origin, "fw 1") }), "same")
        assert.equal(f.asks[0].base_id, name(child))
    })
    test("a one-keep work needs no continuation or works row", async () => {
        const f = fixture([origin])
        assert.equal(await forkRef(`work:${work}`, f), "same")
        assert.equal(f.asks[0].base_id, work)
    })
    test("an exact same-hand claim cannot rejoin a different origin's work", async () => {
        const claimed = writeSnap({ root: OTHER, work_id: work, source: "fw 2", ts: { t: 3, n: 0 } })
        const f = fixture([origin, claimed], OTHER)
        assert.equal(await forkRef(`keep:${name(claimed)}`, f), "foreign")
        assert.equal(f.asks[0].addr, name(claimed))
        assert.equal(f.asks[0].base_id, name(claimed))
        assert.equal(f.asks[0].work_id, undefined)
    })
    test("without origin evidence exact material forks rather than inventing membership", async () => {
        const f = fixture([child])
        assert.equal(await forkRef(`keep:${name(child)}`, f), "foreign")
        assert.equal(f.asks[0].addr, name(child))
        assert.equal(f.asks[0].base_id, name(child))
    })
    test("bad remote source can use a separately verified held referent", async () => {
        const f = fixture([origin])
        assert.equal(await forkRef(`keep:${name(child)}`, { ...f, pull: async () => reply(child, "WRONG") }), "same")
        assert.equal(f.asks[0].source, "fw 2")
        assert.deepEqual(f.put[0].extras, {})
    })
    test("equal-stamp local members select the same id-desc winner as SQL", async () => {
        const a = writeSnap({ root: ROOT, work_id: work, source: "fw 2", title: "a", ts: { t: 2, n: 0 } })
        const b = writeSnap({ root: ROOT, work_id: work, source: "fw 2", title: "b", ts: { t: 2, n: 0 } })
        const f = fixture([origin, a, b])
        await forkRef(`work:${work}`, f)
        assert.equal(f.asks[0].base_id, [name(a), name(b)].sort().at(-1))
    })
    test("a corrupt source is neither executed nor cached under another name", async () => {
        const f = fixture()
        f.door.source = async () => null
        assert.equal(await forkRef(`keep:${name(child)}`, { ...f, pull: async () => reply(child, "WRONG") }), null)
        assert.equal(f.asks[0].source, null)
        assert.equal(f.put.length, 1)
        assert.deepEqual(f.put[0].extras, {})
    })
    test("a corrupt local source is not a runnable snapshot", async () => {
        const f = fixture([child])
        f.door.source = async () => "WRONG"
        assert.equal(await forkRef(`keep:${name(child)}`, f), null)
        assert.equal(f.asks[0].source, null)
    })
    test("a forged response id cannot misname valid bytes", async () => {
        const f = fixture()
        assert.equal(await forkRef(`keep:${work}`, { ...f, pull: async () => ({ ...reply(origin, "fw 1"), id: name(child) }) }), null)
        assert.equal(f.put.length, 0)
    })
    test("unknown and malformed readings never fall through to corpus lookup", async () => {
        let corpus = 0
        for (const ref of ["work:x", "keep:x", `head:${work}`, `work:${work.toUpperCase()}`]) {
            const f = fixture()
            assert.equal(await forkRef(ref, { ...f, corpus: { index: async () => { corpus++; return {} } } }), null)
        }
        assert.equal(corpus, 0)
    })
    test("a bare legacy alias retains its old reader and captures an exact base", async () => {
        const f = fixture()
        assert.equal(await forkRef(work, { ...f, pullLegacy: async () => reply(child, "fw 2") }), "foreign")
        assert.equal(f.asks[0].addr, work, "alias lineage is the requested id")
        assert.equal(f.asks[0].base_id, name(child))
        assert.ok(f.notes.some(note => note.includes("legacy link reader")))
        assert.equal(f.asks[0].work_id, undefined, "never authenticated work")
    })
    test("offline alias lookup keeps retained bytes borrowable", async () => {
        const f = fixture([child], ROOT, { trusted: false })
        assert.equal(await forkRef(work, { ...f, pullLegacy: async () => null }), "foreign")
        assert.equal(f.asks[0].source, "fw 2")
        assert.equal(f.asks[0].addr, work)
        assert.equal(f.asks[0].base_id, name(child))
        assert.equal(f.asks[0].work_id, undefined)
    })
    test("a proven bare origin rejoins; an unproven same-root bare child borrows", async () => {
        const proven = fixture([origin, child])
        assert.equal(await forkRef(name(child), proven), "same")
        assert.equal(proven.asks[0].base_id, name(child))
        const bare = fixture([origin, child], ROOT, { trusted: false })
        assert.equal(await forkRef(name(child), bare), "foreign")
        assert.equal(bare.asks[0].base_id, name(child))
        assert.equal(bare.asks[0].work_id, undefined)
    })
    test("an actual engine keeps an originless alias borrowable offline", async () => {
        const { idb, KeyRange } = createMemoryIDB()
        const engine = createEngine({ idb, KeyRange, dbName: "offline-alias" })
        const door = createJournal({ engine })
        try {
            const root = name(await engine.genesis())
            const bytes = writeSnap({ root, work_id: work, source: "fw 2", ts: { t: 2, n: 0 } })
            await engine.put(bytes, { source: "fw 2" })
            let selected = null
            const term = {
                forkKeep: () => assert.fail("an unproven alias must not rejoin"),
                forkBuffer: (ask) => { selected = ask; return "fork" },
            }
            assert.equal(await forkRef(work, {
                door, term, pullLegacy: async () => null, say: () => {},
            }), "fork")
            assert.equal(selected.source, "fw 2")
            assert.equal(selected.addr, work)
            assert.equal(selected.base_id, name(bytes))
        } finally {
            await door.close()
        }
    })
    test("source identity includes Unicode and valid empty programs", async () => {
        for (const source of ["", "label '你好 ∞' 10"]) {
            const bytes = writeSnap({ root: ROOT, source, ts: { t: 1, n: 0 } })
            const f = fixture()
            assert.equal(await forkRef(`keep:${name(bytes)}`, { ...f, pull: async () => reply(bytes, source) }), "same")
            assert.equal(f.asks[0].source, source)
        }
    })
})

test("the three fetch helpers select distinct existing HTTP readings", async t => {
    const before = globalThis.fetch
    t.after(() => { globalThis.fetch = before })
    const urls = []
    globalThis.fetch = async url => {
        urls.push(url)
        const reading = url.includes("read=keep") ? "keep" : "work"
        return { ok: true, headers: new Headers({ "x-dojo-keep-read": reading }), json: async () => ({}) }
    }
    await pullKeep(work)
    await pullWork(work)
    await pullLegacy(work)
    assert.deepEqual(urls, [`/keeps/${work}?read=keep`, `/keeps/${work}?read=work`, `/keeps/${work}`])
})

test("an old server cannot silently answer an explicit work read as the birth", async t => {
    const before = globalThis.fetch
    t.after(() => { globalThis.fetch = before })
    let decoded = 0
    globalThis.fetch = async () => ({ ok: true, json: async () => { decoded++; return reply(origin, "fw 1") } })
    assert.equal(await pullWork(work), null)
    assert.equal(await pullKeep(work), null)
    assert.equal(decoded, 0)
    assert.deepEqual(await pullLegacy(work), reply(origin, "fw 1"))
    assert.equal(decoded, 1)
})

test("a wrong interpretation echo is refused before payload decoding", async t => {
    const before = globalThis.fetch
    t.after(() => { globalThis.fetch = before })
    let decoded = false
    globalThis.fetch = async () => ({
        ok: true,
        headers: new Headers({ "x-dojo-keep-read": "keep" }),
        json: async () => { decoded = true; return reply(origin, "fw 1") },
    })
    assert.equal(await pullWork(work), null)
    assert.equal(decoded, false)
})

describe("a pulled proof crosses the link door unchanged", () => {
    const proof = { v: 1, genesis: "d".repeat(64), signature: "ab".repeat(64) }

    // The link forwards; it does not adjudicate. Verification belongs to the store
    // (id:keep-auth-durable-proof); inventing evidence here would be a second authority.
    test("the room's evidence is forwarded verbatim, never re-derived", async () => {
        const f = fixture()
        assert.equal(await forkRef(`keep:${work}`, {
            ...f, pull: async () => ({ ...reply(origin, "fw 1"), proof }),
        }), "same")
        assert.deepEqual(f.put[0].extras, { source: "fw 1", proof })
    })

    test("an answer without proof invents none", async () => {
        const f = fixture()
        assert.equal(await forkRef(`keep:${work}`, { ...f, pull: async () => reply(origin, "fw 1") }), "same")
        assert.deepEqual(f.put[0].extras, { source: "fw 1" })
    })

    test("a malformed proof is carried, not repaired", async () => {
        const bad = { ...proof, signature: proof.signature.toUpperCase() }
        const f = fixture()
        await forkRef(`keep:${work}`, { ...f, pull: async () => ({ ...reply(origin, "fw 1"), proof: bad }) })
        assert.equal(f.put[0].extras.proof, bad)
    })

    // A cache hit fetches no evidence: the message-only copy stays unverified.
    // Explicit put enrichment is a different door, and this path never opens it.
    test("held bytes are neither re-pulled nor enriched", async () => {
        const f = fixture([origin])
        let asked = 0
        await forkRef(`keep:${work}`, {
            ...f, pull: async () => { asked++; return { ...reply(origin, "fw 1"), proof } },
        })
        assert.equal(asked, 0)
        assert.equal(f.put.length, 0)
    })

    test("a pulled third-party proof stays durable evidence after reopen", async () => {
        const { payload } = (await proofCases()).find((row) => row.valid)
        const foreignRoot = JSON.parse(payload.message).root
        const { idb, KeyRange } = createMemoryIDB()
        let engine = createEngine({ idb, KeyRange, dbName: "link-proof" })
        const put = []
        // A real reader hand, seated first. `forkRef` asks for a root, and seating one
        // is the journal's own right; the claim here is that a foreign import cannot
        // adopt or replace it — not that the link never mints.
        const readerRoot = name(await engine.genesis())
        assert.notEqual(readerRoot, foreignRoot, "the fixture must be a foreign hand")
        const door = {
            root: async () => name(await engine.genesis()),
            get: async () => undefined,
            list: async () => [],
            source: async () => undefined,
            put: async (bytes, extras) => { put.push({ bytes, extras }); return engine.put(bytes, extras) },
            share: async (id, fact) => engine.share(id, fact),
        }
        const term = { forkKeep: () => "same", forkBuffer: () => "foreign" }
        const landed = await forkRef(`keep:${payload.id}`, {
            door, term, say: () => {},
            pull: async () => ({ id: payload.id, message: payload.message, proof: payload.proof, at: 1, node: "room" }),
        })
        assert.equal(landed, "foreign", "a foreign hand forks the pulled bytes, never adopts them")
        assert.deepEqual(put[0].extras, { proof: payload.proof })
        assert.deepEqual(await engine.proof(payload.message), payload.proof)
        assert.equal(name(await engine.genesis()), readerRoot, "the reader hand is unchanged")
        assert.deepEqual(await engine.local(foreignRoot), [], "the shared fact leaves no local outbox row")
        await engine.close()

        // Reopen with no crypto at all. `proof` can then only read the row, which is
        // exactly what the wire asks for, so equality is retained evidence — never
        // a signature this worker could have minted.
        engine = createEngine({ idb, KeyRange, dbName: "link-proof", crypto: {} })
        assert.equal(name(await engine.genesis()), readerRoot, "reopen keeps the reader hand")
        assert.deepEqual(await engine.proof(payload.message), payload.proof)
        await engine.close()
    })

    // The hazard: a reader holding the signing hand could answer an unsigned import
    // by signing it. Archival retention must not — the bytes were authored elsewhere.
    test("a same-root import without evidence cannot acquire a signature", async () => {
        const { idb, KeyRange } = createMemoryIDB()
        const engine = createEngine({ idb, KeyRange, dbName: "link-import" })
        const bytes = writeSnap({ root: name(await engine.genesis()), source: "fw 1", title: "elsewhere", ts: { t: 1, n: 0 } })
        // Archival retention: the copy lands, and no signature is invented for it.
        await accept(engine, bytes, { at: 7, node: "archive" }, { authored: true, source: "" })
        assert.equal(await engine.get(name(bytes)), bytes, "the unsigned copy is retained")
        await assert.rejects(engine.proof(bytes), /no retained proof/)
        await engine.close()
    })
})
