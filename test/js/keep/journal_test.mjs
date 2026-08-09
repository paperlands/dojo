// The journal — six (now eight) verbs, one engine (id:kb-5, id:kc-c-journal).
// Store and random injected; memory IDB speaks the measured shapes.
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { createJournal, DB_VERSION } from "../../../assets/js/keep/journal.store.js"
import { write, read, name, V } from "../../../assets/js/keep/entry.js"
import { createMemoryIDB } from "./idb_memory.mjs"

const fill = (b) => (arr) => {
    arr.fill(b)
    return arr
}

let n = 0
function freshJournal(opts = {}) {
    const { idb, KeyRange } = createMemoryIDB()
    n += 1
    let t = 1_700_000_000_000
    let c = 0
    const stamp = () => {
        c += 1
        return { t: t + c, n: 0 }
    }
    return createJournal({
        idb,
        KeyRange,
        dbName: `test-keep-${n}`,
        random: opts.random ?? fill(0x11),
        stamp: opts.stamp ?? stamp,
        blobCap: opts.blobCap ?? 1024,
        version: opts.version ?? DB_VERSION,
        ...opts,
        idb,
        KeyRange,
    })
}

function snap(root, body, ts) {
    return write("snap", body, { root, target: "b".repeat(64), ts })
}

describe("journal: put derives the name; get returns the bytes", () => {
    /** @type {ReturnType<typeof createJournal>} */
    let j
    beforeEach(() => {
        j = freshJournal()
    })
    afterEach(async () => {
        await j.close()
    })

    test("put returns name(bytes) and get round-trips", async () => {
        const root = "a".repeat(64)
        const bytes = snap(root, { source: "fd 100" }, { t: 100, n: 0 })
        const id = await j.put(bytes)
        assert.equal(id, name(bytes))
        assert.equal(await j.get(id), bytes)
    })

    test("put takes bytes, never (id, bytes) — a wrong name is unrepresentable", async () => {
        const bytes = snap("r".repeat(64), { source: "x" }, { t: 1, n: 0 })
        // The signature has no id parameter. The name is derived.
        const id = await j.put(bytes)
        assert.equal(id, name(bytes))
        assert.notEqual(id, "forged")
    })

    test("put is idempotent — second put preserves shared/local", async () => {
        const root = "c".repeat(64)
        const bytes = snap(root, { source: "x" }, { t: 50, n: 0 })
        const id = await j.put(bytes)
        await j.share(id, { at: 9, node: "n1" })
        await j.put(bytes) // union again
        const local = await j.local(root)
        assert.equal(local.length, 0, "still shared, not re-localised")
        assert.equal(await j.get(id), bytes)
    })
})

describe("journal: list is newest-first; local is a number", () => {
    /** @type {ReturnType<typeof createJournal>} */
    let j
    const root = "d".repeat(64)
    beforeEach(() => {
        j = freshJournal()
    })
    afterEach(async () => {
        await j.close()
    })

    test("list yields (t,n) descending via reverse cursor", async () => {
        // Measured order: c,b,e,a over (t 300, 200, 100·n1, 100·n0)
        const a = snap(root, { tag: "a" }, { t: 100, n: 0 })
        const e = snap(root, { tag: "e" }, { t: 100, n: 1 })
        const b = snap(root, { tag: "b" }, { t: 200, n: 0 })
        const c = snap(root, { tag: "c" }, { t: 300, n: 0 })
        for (const bytes of [a, e, b, c]) await j.put(bytes)

        const listed = await j.list(root)
        assert.deepEqual(
            listed.map((x) => read(x).tag),
            ["c", "b", "e", "a"],
        )
    })

    test("list(root, n) caps at n, still newest first", async () => {
        for (let i = 0; i < 5; i++) {
            await j.put(snap(root, { i }, { t: 1000 + i, n: 0 }))
        }
        const top = await j.list(root, 2)
        assert.equal(top.length, 2)
        assert.deepEqual(
            top.map((x) => read(x).i),
            [4, 3],
        )
    })

    test("local returns kept-local and excludes shared", async () => {
        const a = snap(root, { tag: "a" }, { t: 100, n: 0 })
        const b = snap(root, { tag: "b" }, { t: 200, n: 0 })
        const c = snap(root, { tag: "c" }, { t: 300, n: 0 })
        const idA = await j.put(a)
        await j.put(b)
        await j.put(c)
        await j.share(idA, { at: 1, node: "n" })

        const held = await j.local(root)
        assert.deepEqual(
            held.map((x) => read(x).tag).sort(),
            ["b", "c"],
        )
        // newest-first among local
        assert.deepEqual(
            held.map((x) => read(x).tag),
            ["c", "b"],
        )
    })
})

describe("journal: share is a fact beside; genesis is once", () => {
    /** @type {ReturnType<typeof createJournal>} */
    let j
    beforeEach(() => {
        j = freshJournal({ random: fill(0xab) })
    })
    afterEach(async () => {
        await j.close()
    })

    test("share flips local→0; second share keeps the first fact", async () => {
        const root = "e".repeat(64)
        const bytes = snap(root, { source: "x" }, { t: 1, n: 0 })
        const id = await j.put(bytes)
        assert.equal(await j.share(id, { at: 10, node: "A" }), true)
        assert.equal(await j.share(id, { at: 99, node: "B" }), true)
        // local empty
        assert.equal((await j.local(root)).length, 0)
        // still gettable
        assert.equal(await j.get(id), bytes)
    })

    test("genesis once — reload twenty times, one root", async () => {
        const first = await j.genesis()
        const root = name(first)
        for (let i = 0; i < 20; i++) {
            const again = await j.genesis()
            assert.equal(again, first)
            assert.equal(name(again), root)
        }
        assert.equal(read(first).kind, "genesis")
        assert.equal(read(first).root, null)
        assert.equal(read(first).v, V)
    })

    test("two journals with different random → two roots", async () => {
        const j2 = freshJournal({ random: fill(0xcd) })
        try {
            const a = name(await j.genesis())
            const b = name(await j2.genesis())
            assert.notEqual(a, b)
        } finally {
            await j2.close()
        }
    })

    test("two concurrent genesis on one DB → one mint (tx race fence)", async () => {
        // Drive both through one factory; concurrent genesis must not fork.
        const { idb, KeyRange } = createMemoryIDB()
        const mk = (byte) =>
            createJournal({
                idb,
                KeyRange,
                dbName: "race-genesis",
                random: fill(byte),
                stamp: () => ({ t: 1, n: byte }),
            })
        const a = mk(0x01)
        const b = mk(0x02)
        try {
            const [ga, gb] = await Promise.all([a.genesis(), b.genesis()])
            // One transaction wins; the other reads. Same bytes.
            assert.equal(ga, gb)
            assert.equal(name(ga), name(gb))
        } finally {
            await a.close()
            await b.close()
        }
    })
})

describe("journal: blobs capped; source never evicted; messages forever", () => {
    test("write past the cap → oldest shared blob gone; local blobs stay; messages stay", async () => {
        // Cap 100 bytes. Each image is 60 bytes. Two shared images → over cap.
        const j = freshJournal({ blobCap: 100 })
        const root = "f".repeat(64)
        try {
            const mk = async (tag, t, img) => {
                const bytes = snap(root, { tag }, { t, n: 0 })
                const id = await j.put(bytes, { image: img })
                return { id, bytes }
            }
            const img = (n) => new Blob([new Uint8Array(n)], { type: "image/png" })

            const a = await mk("a", 100, img(60))
            const b = await mk("b", 200, img(60))
            const c = await mk("c", 300, img(60)) // kept local — never evicted

            await j.share(a.id, { at: 1, node: "n" })
            await j.share(b.id, { at: 2, node: "n" })
            // Trigger eviction fold via another put
            await mk("d", 400, img(10))

            // Messages all present
            assert.equal(await j.get(a.id), a.bytes)
            assert.equal(await j.get(b.id), b.bytes)
            assert.equal(await j.get(c.id), c.bytes)

            // Oldest shared (a) gone; newer shared (b) may remain; local (c) present
            assert.equal(await j.image(a.id), undefined, "oldest shared image evicted")
            assert.ok(await j.image(c.id), "kept-local image never evicted")
        } finally {
            await j.close()
        }
    })

    test("source is stored under name(text) and never yields to the cap", async () => {
        const j = freshJournal({ blobCap: 10 })
        const root = "g".repeat(64)
        try {
            const src = "to forward 100\n"
            const bytes = snap(root, { source_id: name(src) }, { t: 1, n: 0 })
            const id = await j.put(bytes, {
                image: new Blob([new Uint8Array(100)]),
                source: src,
            })
            await j.share(id, { at: 1, node: "n" })
            // More shared images to force eviction
            for (let i = 0; i < 3; i++) {
                const b = snap(root, { i }, { t: 10 + i, n: 0 })
                const bid = await j.put(b, { image: new Blob([new Uint8Array(50)]) })
                await j.share(bid, { at: 2 + i, node: "n" })
            }
            // Source survives
            assert.equal(await j.source(name(src)), src)
            // Message survives even if its image went
            assert.equal(await j.get(id), bytes)
        } finally {
            await j.close()
        }
    })
})

describe("journal: projection rebuild IS the upgrade", () => {
    test("force local to disagree, bump version, open → local restored from shared", async () => {
        const { idb, KeyRange } = createMemoryIDB()
        const dbName = "reproject-test"
        const j1 = createJournal({
            idb,
            KeyRange,
            dbName,
            version: 1,
            random: fill(0x42),
            stamp: () => ({ t: 1, n: 0 }),
        })
        const root = "h".repeat(64)
        const bytes = snap(root, { tag: "x" }, { t: 5, n: 0 })
        const id = await j1.put(bytes)
        await j1.share(id, { at: 1, node: "n" })
        // Corrupt: local should be 0 after share; force it to 1 while shared stands.
        await j1._open()
        // Reach into memory DB — use put on a raw path via a second open upgrade.
        // Corrupt through a direct transaction on the shared factory:
        const raw = await new Promise((resolve, reject) => {
            const req = idb.open(dbName, 1)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        await new Promise((resolve, reject) => {
            const tx = raw.transaction(["log"], "readwrite")
            const store = tx.objectStore("log")
            const g = store.get(id)
            g.onsuccess = () => {
                const row = g.result
                row.local = 1 // lie: shared but local=1
                store.put(row)
            }
            tx.oncomplete = resolve
            tx.onerror = () => reject(tx.error)
            if (typeof tx._commit === "function") {
                // allow the get/put microtasks then commit
                queueMicrotask(() => queueMicrotask(() => tx._commit()))
            }
        })
        raw.close()
        await j1.close()

        // Bump version → reproject
        const j2 = createJournal({
            idb,
            KeyRange,
            dbName,
            version: 2,
            random: fill(0x42),
            stamp: () => ({ t: 1, n: 0 }),
        })
        try {
            const held = await j2.local(root)
            assert.equal(held.length, 0, "reproject set local=0 from shared")
            assert.equal(await j2.get(id), bytes)
        } finally {
            await j2.close()
        }
    })
})

describe("journal: what it is not", () => {
    test("no mark, no outbox — unshipped is local(root)", async () => {
        const j = freshJournal()
        const root = "i".repeat(64)
        try {
            await j.put(snap(root, { a: 1 }, { t: 1, n: 0 }))
            await j.put(snap(root, { a: 2 }, { t: 2, n: 0 }))
            const held = await j.local(root)
            assert.equal(held.length, 2)
            // No high-water, no seq — the query is the mark.
        } finally {
            await j.close()
        }
    })
})

describe("journal: the genesis's place in the log is a decision, not an accident", () => {
    // Its own root is null, and null is not a valid IDB key, so the genesis
    // sits in NEITHER index. That is right twice over — but it was true by
    // accident, and meaning must never ride on an absence (id:kc-r-absence).
    // These tests make the two consequences deliberate.

    test("the root IS the address of the genesis — get(root) returns its bytes", async () => {
        const j = freshJournal()
        try {
            const gen = await j.genesis()
            // id = name(bytes) = root. The journal's name and the address of its
            // first entry are one string. This is the local recovery path: hold
            // the root, hold the genesis (id:kb-3-owner).
            assert.equal(await j.get(name(gen)), gen)
        } finally {
            await j.close()
        }
    })

    test("history never shows the genesis — identity is not a moment kept", async () => {
        const j = freshJournal()
        try {
            const gen = await j.genesis()
            const root = name(gen)
            await j.put(snap(root, { a: 1 }, { t: 9, n: 0 }))
            const history = await j.list(root)
            assert.equal(history.length, 1)
            assert.equal(history.includes(gen), false)
        } finally {
            await j.close()
        }
    })

    test("the genesis never ships — TOFU binds on the first snap's root field", async () => {
        // local(root) is what announce drains (id:kb-9). The genesis is absent
        // from it, so the clan learns the root from a SNAP that carries it, and
        // the nonce never leaves the browser. Deliberate: if a later change put
        // the genesis in the index, announce would start shipping it silently.
        const j = freshJournal()
        try {
            const gen = await j.genesis()
            const root = name(gen)
            await j.put(snap(root, { a: 1 }, { t: 9, n: 0 }))
            const drain = await j.local(root)
            assert.equal(drain.length, 1)
            assert.equal(drain.includes(gen), false)
            assert.equal(read(drain[0]).root, root, "the snap carries the root")
        } finally {
            await j.close()
        }
    })
})

describe("journal: eviction cannot cost what it does not need", () => {
    test("a message-only put never reads a blob", async () => {
        // Only a NEW blob can push the store over the cap. Measured before the
        // fence: gets grew linearly with blob count on EVERY put, so folding
        // 500 entries of clan history would have paid ~N reads apiece and blown
        // kb-5's own zero-dropped-frames green.
        const { idb, KeyRange } = createMemoryIDB()
        let gets = 0
        const counting = {
            open: (...a) => {
                const req = idb.open(...a)
                const patch = (d) => {
                    const t = d.transaction.bind(d)
                    d.transaction = (...ta) => {
                        const tx = t(...ta)
                        const os = tx.objectStore.bind(tx)
                        tx.objectStore = (nm) => {
                            const s = os(nm)
                            if (nm === "blobs") {
                                const g = s.get.bind(s)
                                s.get = (...ga) => { gets += 1; return g(...ga) }
                            }
                            return s
                        }
                        return tx
                    }
                }
                Object.defineProperty(req, "onsuccess", {
                    set(fn) { this._fn = (e) => { patch(req.result); fn(e) } },
                    get() { return this._fn },
                })
                return req
            },
        }
        let c = 0
        const j = createJournal({
            idb: counting, KeyRange, dbName: "evict-cost",
            random: fill(0x11), stamp: () => ({ t: 1000 + (c += 1), n: 0 }),
            blobCap: 1024 * 1024,
        })
        try {
            const root = "e".repeat(64)
            for (let i = 0; i < 8; i += 1) {
                await j.put(snap(root, { i }, { t: 100 + i, n: 0 }), {
                    image: new Uint8Array(64),
                })
            }
            gets = 0
            await j.put(snap(root, { last: true }, { t: 999, n: 0 }))
            assert.equal(gets, 0, "a message-only put reads no blob at all")
        } finally {
            await j.close()
        }
    })
})
