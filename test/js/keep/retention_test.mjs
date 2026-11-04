import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { write, name } from "../../../assets/js/keep/entry.js"
import { createMemoryIDB } from "./idb_memory.mjs"

const root = "a".repeat(64)
const bytes = (tag, t = 1) => write("snap", { tag }, { root, ts: { t, n: 0 } })
const digest = async (image) => createHash("sha256")
    .update(Buffer.from(await image.arrayBuffer())).digest("hex")
const receipt = async (image) => ({ at: 1, node: "archive", retained: { image: await digest(image) } })

function fixture(blobCap = 3) {
    const { idb, KeyRange } = createMemoryIDB()
    const open = (version = 1) => createEngine({
        idb, KeyRange, dbName: "retention", version, blobCap,
        random: (a) => a.fill(1),
    })
    return { idb, open }
}

async function pressure(j) {
    await j.put(bytes("pressure", 100), { image: new Blob(["PPP"]) })
}

describe("retention: permission follows the stored image, not the message slot", () => {
    test("an old A receipt never evicts replacement B, even after reopen and reproject", async () => {
        const { open } = fixture()
        let j = open()
        const message = bytes("replace")
        const a = new Blob(["AAA"])
        const b = new Blob(["BBB"])
        try {
            const id = await j.put(message, { image: a })
            await j.share(id, await receipt(a))
            await pressure(j)
            assert.equal(await j.image(id), undefined, "verified A may yield")
            await j.put(message, { image: b })
            assert.equal(await (await j.image(id)).text(), "BBB", "A's receipt cannot delete B")
            await j.close()
            j = open(2)
            await pressure(j)
            assert.equal(await (await j.image(id)).text(), "BBB", "reproject preserves the binding")
            await j.close()
            j = open(2)
            await pressure(j)
            assert.equal(await (await j.image(id)).text(), "BBB", "plain reopen preserves the binding")
            assert.equal(await j.get(id), message)
        } finally {
            await j.close()
        }
    })

    test("a mismatched receipt cannot evict the initial image", async () => {
        const j = fixture().open()
        try {
            const id = await j.put(bytes("mismatch"), { image: new Blob(["AAA"]) })
            await j.share(id, await receipt(new Blob(["BBB"])))
            await pressure(j)
            assert.equal(await (await j.image(id)).text(), "AAA")
        } finally {
            await j.close()
        }
    })

    test("an ignored duplicate image cannot change the surviving image's binding", async () => {
        const j = fixture().open()
        const message = bytes("duplicate")
        const a = new Blob(["AAA"])
        try {
            const id = await j.put(message, { image: a })
            await j.put(message, { image: new Blob(["BBB"]) })
            assert.equal(await (await j.image(id)).text(), "AAA")
            await j.share(id, await receipt(a))
            await pressure(j)
            assert.equal(await j.image(id), undefined, "the surviving A still matches its receipt")
        } finally {
            await j.close()
        }
    })

    test("rehydrating the same exact image remains evictable", async () => {
        const j = fixture().open()
        const message = bytes("same")
        const a = new Blob(["AAA"])
        try {
            const id = await j.put(message, { image: a })
            await j.share(id, await receipt(a))
            await pressure(j)
            assert.equal(await j.image(id), undefined)
            await j.put(message, { image: a })
            assert.equal(await j.image(id), undefined, "the receipt still covers these exact bytes")
        } finally {
            await j.close()
        }
    })

    test("one oversized image cannot hide behind a nominal per-image estimate", async () => {
        const j = fixture(200_000).open()
        const large = new Blob([new Uint8Array(250_000)])
        try {
            const id = await j.put(bytes("large"), { image: large })
            await j.share(id, await receipt(large))
            const local = await j.put(bytes("local", 2), { image: new Blob([new Uint8Array(100_000)]) })
            assert.equal(await j.image(id), undefined)
            assert.equal((await j.image(local)).size, 100_000)
        } finally {
            await j.close()
        }
    })

    test("sole copies may exceed the eviction target without being silently discarded", async () => {
        const j = fixture(1).open()
        try {
            const id = await j.put(bytes("sole"), { image: new Blob(["AAA"]) })
            await pressure(j)
            assert.equal(await (await j.image(id)).text(), "AAA")
        } finally {
            await j.close()
        }
    })

    test("mutable image shapes do not acquire an unearned digest binding", async () => {
        const j = fixture().open()
        try {
            const image = new Uint8Array([65, 65, 65])
            const id = await j.put(bytes("mutable"), { image })
            await j.share(id, await receipt(new Blob([image])))
            await pressure(j)
            assert.ok(await j.image(id), "a receipt alone does not verify an unbound image")
        } finally {
            await j.close()
        }
    })

    test("a legacy writer cannot reuse the binding left by an evicted image", async () => {
        const { idb, open } = fixture()
        let j = open()
        const message = bytes("legacy")
        const a = new Blob(["AAA"])
        try {
            const id = await j.put(message, { image: a })
            await j.share(id, await receipt(a))
            await pressure(j)
            assert.equal(await j.image(id), undefined)
            await j.close()
            const raw = await new Promise((resolve, reject) => {
                const req = idb.open("retention", 1)
                req.onsuccess = () => resolve(req.result)
                req.onerror = () => reject(req.error)
            })
            try {
                await new Promise((resolve, reject) => {
                    const tx = raw.transaction(["blobs"], "readwrite")
                    tx.oncomplete = resolve
                    tx.onabort = () => reject(tx.error)
                    tx.objectStore("blobs").put(new Blob(["BBB"]), id)
                })
            } finally {
                raw.close()
            }
            j = open()
            await pressure(j)
            assert.equal(await (await j.image(id)).text(), "BBB", "legacy reinsertion stays unverified")
        } finally {
            await j.close()
        }
    })

    test("a quota failure aborts message, source, and image together and permits retry", async () => {
        const { idb, KeyRange } = createMemoryIDB()
        let full = true
        const faulting = {
            open(...args) {
                const req = idb.open(...args)
                const patch = (db) => {
                    const transaction = db.transaction.bind(db)
                    db.transaction = (...args) => {
                        const tx = transaction(...args)
                        const objectStore = tx.objectStore.bind(tx)
                        tx.objectStore = (name) => {
                            const store = objectStore(name)
                            if (name === "source" && full) {
                                store.put = () => { throw new DOMException("full", "QuotaExceededError") }
                            }
                            return store
                        }
                        return tx
                    }
                }
                Object.defineProperty(req, "onsuccess", {
                    set(fn) { this._success = (event) => { patch(req.result); fn(event) } },
                    get() { return this._success },
                })
                return req
            },
        }
        const j = createEngine({ idb: faulting, KeyRange, dbName: "quota", random: (a) => a.fill(1) })
        const message = bytes("quota")
        try {
            await assert.rejects(j.put(message, { image: new Blob(["AAA"]), source: "source" }),
                { name: "QuotaExceededError" })
            assert.deepEqual(await j.list(root), [], "the aborted message is not committed")
            assert.equal(await j.get(name(message)), undefined)
            assert.equal(await j.image(name(message)), undefined)
            assert.equal(await j.source(name("source")), undefined)
            full = false
            const id = await j.put(message, { image: new Blob(["AAA"]), source: "source" })
            assert.equal(await j.get(id), message)
            assert.equal(await (await j.image(id)).text(), "AAA")
        } finally {
            await j.close()
        }
    })
})
