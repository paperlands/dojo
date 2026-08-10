// Shared is a fold, not a field (id:kb-8). Put then share is the order.
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { shared, accept } from "../../../assets/js/keep/shared.js"
import { createJournal } from "../../../assets/js/keep/journal.store.js"
import { write, name, read } from "../../../assets/js/keep/entry.js"
import { createMemoryIDB } from "./idb_memory.mjs"

const fill = (b) => (arr) => {
    arr.fill(b)
    return arr
}

function snap(root, body, ts) {
    return write("snap", body, { root, target: "b".repeat(64), ts })
}

function fresh() {
    const { idb, KeyRange } = createMemoryIDB()
    let c = 0
    return createJournal({
        idb,
        KeyRange,
        dbName: `shared-${Math.random().toString(36).slice(2)}`,
        random: fill(0x77),
        stamp: () => ({ t: 1_700_000_000_000 + ++c, n: 0 }),
        blobCap: 1024,
    })
}

describe("shared: list minus local, by name(bytes) at the reader", () => {
    /** @type {ReturnType<typeof createJournal>} */
    let j
    beforeEach(() => {
        j = fresh()
    })
    afterEach(async () => {
        await j.close()
    })

    test("shared messages are list − local; ids derived, never from a row", async () => {
        // [⏚] Measured: 3 put, share two → list 3, local 1, fold 2.
        const root = "a".repeat(64)
        const a = snap(root, { tag: "a" }, { t: 100, n: 0 })
        const b = snap(root, { tag: "b" }, { t: 200, n: 0 })
        const c = snap(root, { tag: "c" }, { t: 300, n: 0 })
        const idA = await j.put(a)
        await j.put(b)
        await j.put(c)
        await j.share(idA, { at: 1, node: "n" })
        await j.share(name(b), { at: 2, node: "n" })

        const listed = await j.list(root)
        const held = await j.local(root)
        const sharedBytes = shared(listed, held)

        assert.deepEqual(
            listed.map((x) => read(x).tag),
            ["c", "b", "a"],
        )
        assert.deepEqual(
            held.map((x) => read(x).tag),
            ["c"],
        )
        // Author order preserved from list; only the answered ones.
        assert.deepEqual(
            sharedBytes.map((x) => read(x).tag),
            ["b", "a"],
        )
        // Law 3: every id is name of the bytes the reader holds.
        for (const bytes of sharedBytes) {
            assert.equal(name(bytes), name(bytes))
            assert.ok(listed.includes(bytes))
            assert.equal(held.includes(bytes), false)
        }
    })

    test("pure over empty — no surface field to ask", () => {
        assert.deepEqual(shared([], []), [])
        const one = snap("r".repeat(64), { x: 1 }, { t: 1, n: 0 })
        assert.deepEqual(shared([one], [one]), [])
        assert.deepEqual(shared([one], []), [one])
    })

    test("a page folds against a page of the same depth (id:kb-8-page)", async () => {
        // The bound the fold's cost rests on: a kept-local entry inside the
        // newest n of the log is among the newest n kept-local. So local(root, n)
        // is EXACTLY enough for list(root, n) — never a partial answer.
        //
        // 40 entries; the newest 10 are the page. Kept local: two inside the
        // page (newest, and 4th newest) and many far older.
        const root = "p".repeat(64)
        const all = []
        for (let i = 0; i < 40; i++) {
            const bytes = snap(root, { i }, { t: 1000 + i, n: 0 })
            all.push(bytes)
            await j.put(bytes)
        }
        // Share everything, then un-share (by never sharing) the chosen few.
        const keptLocal = new Set([39, 36, 12, 5, 0])
        for (let i = 0; i < 40; i++) {
            if (!keptLocal.has(i)) await j.share(name(all[i]), { at: i, node: "n" })
        }

        const page = await j.list(root, 10) // newest 10 → i = 39…30
        const heldPage = await j.local(root, 10)
        const heldWhole = await j.local(root)

        assert.equal(page.length, 10)
        assert.equal(heldWhole.length, 5, "five kept local across the whole log")
        assert.equal(heldPage.length, 5, "capped at n, but only 5 exist")

        // The bound: folding against the capped read equals folding against all.
        assert.deepEqual(shared(page, heldPage), shared(page, heldWhole))
        assert.deepEqual(
            shared(page, heldPage).map((b) => read(b).i),
            [38, 37, 35, 34, 33, 32, 31, 30],
            "the page minus its two kept-local entries",
        )
    })

    test("the bound holds when kept-local is deeper than the page", async () => {
        // 30 entries, ALL kept local. Page of 5 → local(root, 5) is the newest
        // 5 kept local, which covers the page exactly. Nothing is shared.
        const root = "q".repeat(64)
        for (let i = 0; i < 30; i++) {
            await j.put(snap(root, { i }, { t: 2000 + i, n: 0 }))
        }
        const page = await j.list(root, 5)
        assert.deepEqual(shared(page, await j.local(root, 5)), [])
        assert.deepEqual(shared(page, await j.local(root)), [])
    })
})

describe("accept: put then share — the order, not a put parameter", () => {
    /** @type {ReturnType<typeof createJournal>} */
    let j
    beforeEach(() => {
        j = fresh()
    })
    afterEach(async () => {
        await j.close()
    })

    test("clan history lands local:1 until the fact is shared", async () => {
        const root = "b".repeat(64)
        const bytes = snap(root, { tag: "from-clan" }, { t: 50, n: 0 })

        // put alone — as if the message arrived without an answer yet
        const id = await j.put(bytes)
        assert.deepEqual(
            (await j.local(root)).map((x) => read(x).tag),
            ["from-clan"],
        )

        // fact rides the reply; share flips local → 0
        await j.share(id, { at: 9, node: "peer" })
        assert.equal((await j.local(root)).length, 0)
        assert.equal((await j.list(root)).length, 1)
    })

    test("accept puts then shares — one call, the named order", async () => {
        const root = "c".repeat(64)
        const bytes = snap(root, { tag: "accepted" }, { t: 60, n: 0 })
        const id = await accept(j, bytes, { at: 10, node: "n" })
        assert.equal(id, name(bytes))
        assert.equal((await j.local(root)).length, 0)
        assert.deepEqual(
            shared(await j.list(root), await j.local(root)).map((x) => read(x).tag),
            ["accepted"],
        )
    })

    test("own entry returning from the clan re-ships once, then settles", async () => {
        // Author minted and shared; clan history folds the same bytes back.
        // put is idempotent (preserves shared); without accept's share on the
        // reply path, a never-shared re-arrival would re-ship — with put then
        // share, it settles.
        const root = "d".repeat(64)
        const bytes = snap(root, { tag: "mine" }, { t: 70, n: 0 })
        const id = await j.put(bytes)
        // Still local — would re-ship on announce
        assert.equal((await j.local(root)).length, 1)

        // Reply lands: put (no-op on columns) then share
        await accept(j, bytes, { at: 11, node: "n" })
        assert.equal((await j.local(root)).length, 0)
        // Second fold of the same reply is a no-op
        await accept(j, bytes, { at: 99, node: "other" })
        assert.equal((await j.local(root)).length, 0)
        assert.equal(await j.get(id), bytes)
        // First fact kept (share is granted once)
        // — surface sees it only as "not in local"
        assert.deepEqual(
            shared(await j.list(root), await j.local(root)).map(name),
            [id],
        )
    })

    test("the source rides the accept — a message without it is a tombstone", async () => {
        // Source is re-derivable from NOTHING, so it fans with the message and
        // is never evicted (id:kb-source-absence). The image does not ride —
        // it is heavy and re-derivable, and arrives on the walk.
        const root = "f".repeat(64)
        const text = "to spiral :n\n  forward :n\n  right 91\nend\n"
        const bytes = write(
            "snap",
            { source_id: name(text), diagnostics: [], buffer_id: null },
            { root, target: "b".repeat(64), ts: { t: 90, n: 0 } },
        )

        const id = await accept(j, bytes, { at: 12, node: "peer" }, { source: text })

        assert.equal(await j.source(name(text)), text, "the pointer resolves")
        assert.equal(read(await j.get(id)).source_id, name(text))
        assert.equal(await j.image(id), undefined, "the picture waits for the walk")
    })

    test("accepted without its source, the pointer dangles — the wire must send it", async () => {
        // Stated as a test so the omission is visible, not discovered later on
        // a surface with nothing to show.
        const root = "g".repeat(64)
        const text = "forward 10\n"
        const bytes = write(
            "snap",
            { source_id: name(text), diagnostics: [], buffer_id: null },
            { root, target: "b".repeat(64), ts: { t: 91, n: 0 } },
        )
        await accept(j, bytes, { at: 13, node: "peer" })
        assert.equal(await j.source(name(text)), undefined)
    })

    test("put does not accept a shared option — no silent fifth parameter", async () => {
        const root = "e".repeat(64)
        const bytes = snap(root, { tag: "nope" }, { t: 80, n: 0 })
        // A caller who invents put(bytes, {shared}) is ignored: still local.
        await j.put(bytes, { shared: { at: 1, node: "n" } })
        assert.equal((await j.local(root)).length, 1, "extras.shared is not a door")
        // The only path is the named order.
        await accept(j, bytes, { at: 1, node: "n" })
        assert.equal((await j.local(root)).length, 0)
    })
})

describe("shared: the surface's four reads, and the laws they carry (id:kb-8)", () => {
    test("list / local / get never touch the blob store — image is the open", async () => {
        // "The list never touches bytes. No blob read is issued until a keep is opened."
        const { idb, KeyRange } = createMemoryIDB()
        let blobGets = 0
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
                                s.get = (...ga) => {
                                    blobGets += 1
                                    return g(...ga)
                                }
                            }
                            return s
                        }
                        return tx
                    }
                }
                Object.defineProperty(req, "onsuccess", {
                    set(fn) {
                        this._fn = (e) => {
                            patch(req.result)
                            fn(e)
                        }
                    },
                    get() {
                        return this._fn
                    },
                })
                return req
            },
        }
        let c = 0
        const j = createJournal({
            idb: counting,
            KeyRange,
            dbName: `list-no-blob-${Math.random().toString(36).slice(2)}`,
            random: fill(0x55),
            stamp: () => ({ t: 1_700_000_000_000 + ++c, n: 0 }),
            blobCap: 1024 * 1024,
        })
        try {
            const root = "h".repeat(64)
            const bytes = snap(root, { tag: "pic" }, { t: 1, n: 0 })
            const id = await j.put(bytes, { image: new Uint8Array([9, 9, 9]) })
            blobGets = 0
            await j.list(root)
            await j.local(root)
            await j.get(id)
            assert.equal(blobGets, 0, "history and get never open the picture")
            // Opening the keep is the first blob read.
            await j.image(id)
            assert.equal(blobGets, 1, "image(id) is the open")
        } finally {
            await j.close()
        }
    })

    test("the message outlives the image — name still verifies after eviction", async () => {
        // Cap so a shared image must yield. The message stays forever.
        const { idb, KeyRange } = createMemoryIDB()
        let c = 0
        const j = createJournal({
            idb,
            KeyRange,
            dbName: `outlive-${Math.random().toString(36).slice(2)}`,
            random: fill(0x66),
            stamp: () => ({ t: 1_700_000_000_000 + ++c, n: 0 }),
            blobCap: 100,
        })
        try {
            const root = "i".repeat(64)
            const img = (n) => new Uint8Array(n)
            const a = snap(root, { tag: "a" }, { t: 100, n: 0 })
            const b = snap(root, { tag: "b" }, { t: 200, n: 0 })
            const idA = await j.put(a, { image: img(60) })
            const idB = await j.put(b, { image: img(60) })
            await j.share(idA, { at: 1, node: "n" })
            await j.share(idB, { at: 2, node: "n" })
            // A third shared image pushes past the cap — oldest shared yields.
            const cBytes = snap(root, { tag: "c" }, { t: 300, n: 0 })
            const idC = await j.put(cBytes, { image: img(60) })
            await j.share(idC, { at: 3, node: "n" })

            for (const [id, bytes] of [
                [idA, a],
                [idB, b],
                [idC, cBytes],
            ]) {
                const held = await j.get(id)
                assert.equal(held, bytes)
                assert.equal(name(held), id)
            }
            // Oldest shared picture gone; the message is not.
            assert.equal(await j.image(idA), undefined)
            assert.equal(await j.get(idA), a)
        } finally {
            await j.close()
        }
    })

    test("two orders stay two — author history is by ts, never by shared.at", async () => {
        const j = fresh()
        try {
            const root = "j".repeat(64)
            // Author stamps: a@100, b@200, c@300. Clan answers in reverse at.
            const a = snap(root, { tag: "a" }, { t: 100, n: 0 })
            const b = snap(root, { tag: "b" }, { t: 200, n: 0 })
            const c = snap(root, { tag: "c" }, { t: 300, n: 0 })
            await j.put(a)
            await j.put(b)
            await j.put(c)
            await j.share(name(c), { at: 1, node: "n" }) // answered first by clan
            await j.share(name(a), { at: 99, node: "n" }) // answered last by clan
            // b stays kept local

            const listed = await j.list(root)
            assert.deepEqual(
                listed.map((x) => read(x).tag),
                ["c", "b", "a"],
                "author's ts order — shared.at must not reorder",
            )
            // The fold preserves list's order (author's), not the clan's at.
            assert.deepEqual(
                shared(listed, await j.local(root)).map((x) => read(x).tag),
                ["c", "a"],
            )
        } finally {
            await j.close()
        }
    })
})

describe("shared: structural greps (id:kb-8 NOT)", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const keepDir = join(here, "../../../assets/js/keep")

    test("shared is a pure fold — no storage API, no ninth verb", () => {
        const src = readFileSync(join(keepDir, "shared.js"), "utf8")
        assert.equal(/\bindexedDB\b/.test(src), false)
        assert.equal(/from\s+["']\.\/journal\.store\.js["']/.test(src), false)
        // The fold and the receive order — nothing else.
        assert.match(src, /export function shared\b/)
        assert.match(src, /export async function accept\b/)
        // No stored count, no tally, no mode machine.
        for (const word of ["syncing", "pending", "online", "badge", "count"]) {
            assert.equal(
                new RegExp(`\\b${word}\\b`).test(src),
                false,
                `shared.js must not name ${word}`,
            )
        }
    })

    test("no put(bytes, {shared}) and no row-returning list", () => {
        const store = readFileSync(join(keepDir, "journal.store.js"), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "")
        // put body never assigns row.shared from extras
        assert.equal(
            /extras\s*\.\s*shared/.test(store),
            false,
            "store must not read extras.shared",
        )
        // list/local push the message string, never the row
        assert.match(store, /out\.push\(\s*c\.value\.message\s*\)/)
        // Eight verbs — shared is not among them
        const verbs = readFileSync(join(keepDir, "verbs.js"), "utf8")
        assert.equal(/\b"shared"\b/.test(verbs), false)
    })
})
