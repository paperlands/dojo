// Memory IDB lifetime — prose law becomes a failing test (finding 4, id:kb-5).
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createMemoryIDB } from "./idb_memory.mjs"

function openDb(idb, name = "life", version = 1) {
    return new Promise((resolve, reject) => {
        const req = idb.open(name, version)
        req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains("log")) {
                db.createObjectStore("log", { keyPath: "id" })
            }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

function req(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

describe("idb_memory: auto-commit is real IDB lifetime", () => {
    test("yielding to the TASK queue between ops deactivates the transaction", async () => {
        // THE ONE WAY THE STORE BREAKS (id:kb-5): await a fetch, a timer, a
        // worker round-trip — anything that yields to the task queue — and the
        // transaction commits underneath you.
        const { idb } = createMemoryIDB()
        const db = await openDb(idb)
        const tx = db.transaction(["log"], "readwrite")
        const store = tx.objectStore("log")

        await req(store.put({ id: "a", v: 1 }))
        await new Promise((r) => setTimeout(r, 0)) // the task boundary

        await assert.rejects(
            () => req(store.put({ id: "b", v: 2 })),
            (e) => e.name === "TransactionInactiveError" || /Inactive/.test(e.message),
        )
        db.close()
    })

    test("a microtask await survives — the fake is not stricter than the browser", async () => {
        // Measured: a microtask-granular commit killed the tx on one
        // `await Promise.resolve()`, which a browser survives. A green a
        // harmless await can fail is a bad green (id:kb-2).
        const { idb } = createMemoryIDB()
        const db = await openDb(idb, "microtask")
        const tx = db.transaction(["log"], "readwrite")
        const store = tx.objectStore("log")

        await req(store.put({ id: "a", v: 1 }))
        await Promise.resolve()
        await (async () => {})()
        await req(store.put({ id: "b", v: 2 }))

        assert.equal((await req(store.get("b"))).v, 2)
        db.close()
    })

    test("chained await idbReq stays active — the honest path", async () => {
        const { idb } = createMemoryIDB()
        const db = await openDb(idb, "honest")
        const tx = db.transaction(["log"], "readwrite")
        const store = tx.objectStore("log")

        await req(store.put({ id: "a", v: 1 }))
        await req(store.put({ id: "b", v: 2 }))
        const got = await req(store.get("a"))
        assert.equal(got.v, 1)

        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve
            tx.onerror = () => reject(tx.error)
            // If still active somehow, wait; auto-commit should already be scheduled.
        })
        db.close()
    })

    test("concurrent readwrite: second writer sees the first's self", async () => {
        // Genesis race fence without exposing _ready to production.
        // Handlers-first: oncomplete before the last request settles.
        const { idb } = createMemoryIDB()
        const db = await openDb(idb, "race")

        const write = async (id) => {
            const tx = db.transaction(["log"], "readwrite")
            const done = new Promise((resolve, reject) => {
                tx.oncomplete = resolve
                tx.onerror = () => reject(tx.error)
                tx.onabort = () => reject(tx.error || new Error("abort"))
            })
            const store = tx.objectStore("log")
            const existing = await req(store.get("self"))
            if (!existing) await req(store.put({ id: "self", v: id }))
            await done
            return existing
        }

        const [sawA, sawB] = await Promise.all([write("a"), write("b")])
        // Exactly one found empty and wrote; the other saw that write.
        // (Both empty is impossible under a serialised write lock.)
        assert.ok(
            (sawA == null) !== (sawB == null),
            "exactly one writer finds self empty",
        )
        // Fresh tx per read — lifetime is per transaction.
        const self = await req(
            db.transaction(["log"], "readonly").objectStore("log").get("self"),
        )
        assert.ok(self)
        assert.ok(self.v === "a" || self.v === "b")
        db.close()
    })
})

// The floor moved to entry.js — one law, both sides of the wire (id:kb-vet5 42).
// It is asserted against the Elixir mirror in entry_test.mjs.
