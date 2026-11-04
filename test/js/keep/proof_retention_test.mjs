import { test } from "node:test"
import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { checkKeepProof } from "../../../assets/js/keep/auth.js"
import { accept } from "../../../assets/js/keep/shared.js"
import { write, name } from "../../../assets/js/keep/entry.js"
import { hashBytes } from "../../../assets/js/keep/hash.js"
import { createMemoryIDB } from "./idb_memory.mjs"
import { proofCases, equivalentProof } from "./proof_cases.mjs"

function fixture() {
    const { idb, KeyRange } = createMemoryIDB()
    return { open: (extra = {}) => createEngine({ idb, KeyRange, dbName: "proofs", ...extra }) }
}

function bytes(root, title = "kept", source = "") {
    return write("snap", { title, source_id: name(source) }, { root, ts: { t: 1, n: 0 } })
}

async function authored() {
    const { open } = fixture()
    const engine = open()
    const message = bytes(name(await engine.genesis()))
    await engine.put(message, { authored: true })
    const proof = await engine.proof(message)
    await engine.close()
    return { message, proof }
}

test("cache admission agrees with the public adversarial proof corpus", async () => {
    for (const { label, valid, payload } of await proofCases()) {
        if (valid) assert.deepEqual(await checkKeepProof(payload.message, payload.proof), payload.proof, label)
        else await assert.rejects(checkKeepProof(payload.message, payload.proof), undefined, label)
    }
})

test("own commit carries proof before shipment; reads never sign again", async (t) => {
    const { open } = fixture()
    let engine = open()
    const message = bytes(name(await engine.genesis()))
    await engine.put(message, { authored: true, source: "", image: new Blob(["png"]) })
    const kept = await engine.proof(message)
    t.mock.method(crypto.subtle, "sign", () => { throw Error("must not re-sign") })
    await engine.close()
    engine = open({ crypto: {} })
    assert.deepEqual(await engine.proof(message), kept)
    assert.deepEqual(await checkKeepProof(message, kept), kept)
    assert.equal(await engine.get(name(message)), message)
    await engine.close()
})

test("signing failure does not commit unsigned own bytes, source or image", async (t) => {
    const { open } = fixture()
    const engine = open()
    const message = bytes(name(await engine.genesis()))
    t.mock.method(crypto.subtle, "sign", () => { throw Error("sign failed") })
    await assert.rejects(engine.put(message, { authored: true, source: "", image: new Blob(["png"]) }), /sign failed/)
    assert.equal(await engine.get(name(message)), undefined)
    assert.equal(await engine.source(name("")), undefined)
    assert.equal(await engine.image(name(message)), undefined)
    await assert.rejects(engine.proof(message), /no retained proof/)
    await engine.close()
})

test("same-root imports never become a request to sign", async (t) => {
    const { open } = fixture()
    const engine = open()
    const message = bytes(name(await engine.genesis()), "asserted by a room")
    let signatures = 0
    const sign = crypto.subtle.sign.bind(crypto.subtle)
    t.mock.method(crypto.subtle, "sign", (...args) => { signatures += 1; return sign(...args) })
    await accept(engine, message, { at: 4, node: "room" }, { authored: true, source: "" })
    assert.equal(signatures, 0)
    await assert.rejects(engine.proof(message), /no retained proof/)
    await engine.put(message, { authored: true })
    assert.equal(signatures, 1)
    assert.ok(await engine.proof(message))
    await engine.put(message, { authored: true })
    assert.equal(signatures, 1, "duplicate authoring preserves the first proof")
    await engine.close()
})

test("foreign refill preserves original proof without creating a local identity", async () => {
    const { message, proof } = await authored()
    const { open } = fixture()
    let engine = open()
    await accept(engine, message, { at: 3, node: "archive" }, { proof, source: "" })
    assert.deepEqual(await engine.proof(message), proof)
    assert.equal(await engine.get(name(proof.genesis)), undefined, "no self genesis was minted")
    assert.deepEqual(await engine.local(JSON.parse(message).root), [])
    await engine.close()
    engine = open({ crypto: {} })
    assert.deepEqual(await engine.proof(message), proof)
    assert.equal(await engine.source(name("")), "")
    await engine.close()
})

test("invalid-first cannot reserve bytes or evidence; invalid-later cannot erase proof or receipt", async () => {
    const { message, proof } = await authored()
    const { open } = fixture()
    const engine = open()
    const bad = { ...proof, signature: "0".repeat(128) }
    await assert.rejects(engine.put(message, { proof: bad, source: "", image: new Blob(["bad"]) }))
    assert.equal(await engine.get(name(message)), undefined)
    assert.equal(await engine.source(name("")), undefined)
    assert.equal(await engine.image(name(message)), undefined)
    const id = await accept(engine, message, { at: 4, node: "first" }, { proof, source: "" })
    await assert.rejects(accept(engine, message, { at: 999, node: "bad" }, { proof: bad }))
    const equivalent = equivalentProof(proof)
    await engine.put(message, { proof: equivalent })
    assert.deepEqual(await engine.proof(message), proof, "first valid proof stays stable")
    assert.deepEqual(await engine.local(JSON.parse(message).root), [])
    await engine.share(id, { at: 999, node: "later" })
    assert.deepEqual(await engine.proof(message), proof)
    await engine.close()
})

test("proof enrichment preserves an existing unverified copy and its receipt", async () => {
    const { message, proof } = await authored()
    const { open } = fixture()
    const engine = open()
    await accept(engine, message, { at: 4, node: "first" }, { source: "" })
    await assert.rejects(engine.proof(message), /no retained proof/)
    await engine.put(message, { proof })
    assert.equal(await engine.get(name(message)), message)
    assert.deepEqual(await engine.proof(message), proof)
    assert.deepEqual(await engine.local(JSON.parse(message).root), [])
    await engine.close()
})

test("task-yielding signing and verification occur outside the atomic IDB write", async (t) => {
    const foreign = await authored()
    const { open } = fixture()
    const engine = open()
    const own = bytes(name(await engine.genesis()))
    for (const method of ["sign", "verify"]) {
        const native = crypto.subtle[method].bind(crypto.subtle)
        t.mock.method(crypto.subtle, method, async (...args) => {
            await delay(5)
            return native(...args)
        })
    }
    await engine.put(own, { authored: true, source: "", image: new Blob(["own"]) })
    await engine.put(foreign.message, { proof: foreign.proof, source: "", image: new Blob(["peer"]) })
    assert.ok(await engine.proof(own))
    assert.deepEqual(await engine.proof(foreign.message), foreign.proof)
    await engine.close()
})

test("concurrent valid/invalid refills keep one valid proof and one byte identity", async () => {
    const { message, proof } = await authored()
    const { open } = fixture()
    const a = open(), b = open()
    const results = await Promise.allSettled([
        a.put(message, { proof }),
        b.put(message, { proof: { ...proof, signature: "0".repeat(128) } }),
        b.put(message, { proof }),
    ])
    assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"])
    assert.deepEqual(await a.proof(message), proof)
    assert.deepEqual(await b.proof(message), proof)
    assert.deepEqual(await a.list(JSON.parse(message).root), [message])
    await a.close(); await b.close()
})

test("eviction and projection rebuild preserve public evidence", async () => {
    const { message, proof } = await authored()
    const { open } = fixture()
    let engine = open({ blobCap: 1 })
    const image = new Blob(["png"])
    const id = await engine.put(message, { proof, image, source: "" })
    await engine.share(id, { at: 1, node: "archive", retained: { image: hashBytes(new Uint8Array(await image.arrayBuffer())) } })
    await engine.put(bytes("f".repeat(64), "pressure"), { image: new Blob(["pressure"]) })
    assert.equal(await engine.image(id), undefined)
    assert.deepEqual(await engine.proof(message), proof)
    await engine.close()
    engine = open({ version: 2, crypto: {} })
    assert.equal(await engine.get(id), message)
    assert.deepEqual(await engine.proof(message), proof)
    assert.deepEqual(await engine.local(JSON.parse(message).root), [])
    await engine.close()
})

test("a quota abort leaves neither own bytes nor detached evidence and allows retry", async () => {
    const { idb, KeyRange } = createMemoryIDB()
    let full = true
    const faulting = {
        open(...args) {
            const request = idb.open(...args)
            Object.defineProperty(request, "onsuccess", {
                set(fn) {
                    this._success = (event) => {
                        const db = request.result
                        const transaction = db.transaction.bind(db)
                        db.transaction = (...args) => {
                            const tx = transaction(...args)
                            const objectStore = tx.objectStore.bind(tx)
                            tx.objectStore = (name) => {
                                const store = objectStore(name)
                                if (name === "source" && full) store.put = () => { throw new DOMException("full", "QuotaExceededError") }
                                return store
                            }
                            return tx
                        }
                        fn(event)
                    }
                },
                get() { return this._success },
            })
            return request
        },
    }
    const engine = createEngine({ idb: faulting, KeyRange, dbName: "quota-proof" })
    const message = bytes(name(await engine.genesis()))
    await assert.rejects(engine.put(message, { authored: true, source: "", image: new Blob(["png"]) }), { name: "QuotaExceededError" })
    assert.equal(await engine.get(name(message)), undefined)
    assert.equal(await engine.source(name("")), undefined)
    assert.equal(await engine.image(name(message)), undefined)
    await assert.rejects(engine.proof(message), /no retained proof/)
    full = false
    await engine.put(message, { authored: true, source: "", image: new Blob(["png"]) })
    assert.ok(await checkKeepProof(message, await engine.proof(message)))
    await engine.close()
})
