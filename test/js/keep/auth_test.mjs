import { test } from "node:test"
import assert from "node:assert/strict"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { createJournal } from "../../../assets/js/keep/journal.js"
import { createWire } from "../../../assets/js/keep/wire.js"
import { write, name, read } from "../../../assets/js/keep/entry.js"
import { genesisBytes } from "../../../assets/js/keep/genesis.js"
import { KEEP_PROOF_DOMAIN } from "../../../assets/js/keep/auth.js"
import { createMemoryIDB } from "./idb_memory.mjs"

function fixture() {
    const { idb, KeyRange } = createMemoryIDB()
    const open = (extra = {}) => createEngine({ idb, KeyRange, dbName: "signing", ...extra })
    return { idb, open }
}

function message(root) {
    return write("snap", { title: "你好 🌱", source_id: name("") }, { root, ts: { t: 1, n: 0 } })
}

async function verifies(bytes, proof) {
    const auth = read(proof.genesis).auth
    const publicKey = await crypto.subtle.importKey("raw", Buffer.from(auth.public_key, "hex"),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey,
        Buffer.from(proof.signature, "hex"), new TextEncoder().encode(KEEP_PROOF_DOMAIN + bytes))
}

async function withSelf(idb, action) {
    const db = await new Promise((resolve, reject) => {
        const request = idb.open("signing")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(["self"], "readwrite")
            let result
            action(tx.objectStore("self"), (value) => { result = value })
            tx.oncomplete = () => resolve(result)
            tx.onerror = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}

test("nonextractable signing key and genesis survive reopen together", async () => {
    const { idb, open } = fixture()
    let engine = open()
    const birth = await engine.genesis()
    const bytes = message(name(birth))
    await engine.put(bytes, { authored: true })
    const proof = await engine.proof(bytes)
    assert.deepEqual(Object.keys(proof).sort(), ["genesis", "signature", "v"])
    assert.equal(await verifies(bytes, proof), true)
    assert.equal(await verifies(bytes + " ", proof), false)
    const key = await withSelf(idb, (store, done) => {
        const request = store.get("signing-key")
        request.onsuccess = () => done(request.result)
    })
    assert.equal(key.extractable, false)
    await assert.rejects(crypto.subtle.exportKey("pkcs8", key))
    await engine.close()
    engine = open()
    assert.equal(await engine.genesis(), birth)
    assert.equal(await verifies(bytes, await engine.proof(bytes)), true)
    await engine.close()
})

test("concurrent first mint seats one matching key/genesis pair", async () => {
    const { open } = fixture()
    const a = open(), b = open()
    const [ga, gb] = await Promise.all([a.genesis(), b.genesis()])
    assert.equal(ga, gb)
    const bytes = message(name(ga))
    await Promise.all([a.put(bytes, { authored: true }), b.put(bytes, { authored: true })])
    for (const engine of [a, b]) assert.equal(await verifies(bytes, await engine.proof(bytes)), true)
    await a.close(); await b.close()
})

test("proof reads cannot create authority for uncommitted bytes", async () => {
    const { open } = fixture()
    const engine = open()
    await engine.genesis()
    await assert.rejects(engine.proof(message("f".repeat(64))), /no retained proof/)
    await engine.close()
})

test("missing secure-context crypto fails before seating any identity", async () => {
    const { open } = fixture()
    const engine = open({ crypto: {} })
    await assert.rejects(engine.genesis(), /secure context/)
    await engine.close()
    const recovered = open()
    assert.ok(read(await recovered.genesis()).auth)
    await recovered.close()
})

test("key loss preserves kept proofs but cannot sign new bytes", async () => {
    const { idb, open } = fixture()
    const engine = open()
    const birth = await engine.genesis()
    const bytes = message(name(birth))
    await engine.put(bytes, { authored: true })
    const kept = await engine.proof(bytes)
    await withSelf(idb, (store) => store.delete("signing-key"))
    assert.deepEqual(await engine.proof(bytes), kept)
    const fresh = write("snap", { title: "after key loss" }, { root: name(birth), ts: { t: 2, n: 0 } })
    await assert.rejects(engine.put(fresh, { authored: true }), /unavailable/)
    assert.equal(await engine.get(name(fresh)), undefined)
    assert.equal(await engine.genesis(), birth)
    const legacy = genesisBytes((a) => a.fill(1), { t: 0, n: 0 })
    await withSelf(idb, (store) => store.put(legacy, "genesis"))
    await engine.put(message(name(legacy)))
    await assert.rejects(engine.proof(message(name(legacy))), /no retained proof/)
    assert.equal(await engine.genesis(), legacy)
    await engine.close()
})

test("wire carries proof, while signing failure sends nothing and keeps the outbox local", async () => {
    const { open } = fixture()
    const door = createJournal({ engine: open() })
    const bytes = message(await door.root())
    const id = await door.put(bytes, { authored: true })
    const sent = []
    await createWire({ door, hook: { pushEvent: async (_event, payload) => {
        sent.push(payload)
        return undefined
    } } }).announce()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].id, id)
    assert.equal(await verifies(sent[0].message, sent[0].proof), true)
    const blocked = { ...door, proof: async () => { throw new Error("signing unavailable") } }
    let unsigned = 0
    await createWire({ door: blocked, hook: { pushEvent: async () => { unsigned += 1 } } }).announce()
    assert.equal(unsigned, 0)
    assert.equal((await door.local(await door.root())).length, 1)
    await door.close()
})
