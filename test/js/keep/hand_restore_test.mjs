// A key restored while newHand awaits generation is a healthy hand, not a replacement.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { write, name } from "../../../assets/js/keep/entry.js"
import { checkKeepProof } from "../../../assets/js/keep/auth.js"
import { createMemoryIDB } from "./idb_memory.mjs"

function deferred() {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
}

async function fixture(subtle) {
    const { idb, KeyRange } = createMemoryIDB()
    const engine = createEngine({ idb, KeyRange, dbName: "restore-hand", crypto: { subtle } })
    await engine.get("absent")
    async function self(fn) {
        const db = await new Promise((resolve, reject) => {
            const request = idb.open("restore-hand")
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
        try {
            const tx = db.transaction("self", "readwrite")
            const done = new Promise((resolve, reject) => {
                tx.oncomplete = resolve
                tx.onabort = () => reject(tx.error)
                tx.onerror = () => reject(tx.error)
            })
            const request = fn(tx.objectStore("self"))
            const result = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
            })
            await done
            return result
        } finally { db.close() }
    }
    return { engine, self }
}

test("a restored key during generation makes newHand a no-op", async () => {
    const entered = deferred(), release = deferred()
    let pause = false
    const subtle = new Proxy(crypto.subtle, {
        get(target, prop) {
            if (prop === "generateKey") return async (...args) => {
                if (pause) { entered.resolve(); await release.promise }
                return target.generateKey(...args)
            }
            const value = target[prop]
            return typeof value === "function" ? value.bind(target) : value
        },
    })
    const f = await fixture(subtle)
    try {
        const birth = await f.engine.genesis(), root = name(birth)
        const key = await f.self(store => store.get("signing-key"))
        await f.self(store => store.delete("signing-key"))
        assert.equal((await f.engine.hand()).signing, "keyless")

        pause = true
        const pending = f.engine.newHand({ expectedRoot: root })
        await entered.promise
        await f.self(store => store.put(key, "signing-key"))
        release.resolve()

        assert.deepEqual(await pending, { root, changed: false })
        assert.deepEqual(await f.engine.hand(), { root, signing: "ready" })
        assert.equal(await f.engine.genesis(), birth, "the active genesis was kept")
        assert.equal(await f.self(store => store.get("genesis-prior:" + root)), undefined,
            "a no-op archives nothing")

        const bytes = write("snap", { source_id: name("fw 1") }, { root, ts: { t: 1, n: 0 } })
        await f.engine.put(bytes, { authored: true })
        await checkKeepProof(bytes, await f.engine.proof(bytes))
    } finally {
        release.resolve()
        await f.engine.close()
    }
})
