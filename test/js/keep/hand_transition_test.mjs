// Recovery changes the active hand, never existing bytes (id:keep-auth-write-guard).
import { test } from "node:test"
import assert from "node:assert/strict"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { genesisBytes } from "../../../assets/js/keep/genesis.js"
import { write, name } from "../../../assets/js/keep/entry.js"
import { mintSnap } from "../../../assets/js/keep/kinds/snap.js"
import { checkKeepProof } from "../../../assets/js/keep/auth.js"
import { createMemoryIDB } from "./idb_memory.mjs"

function deferred() {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
}

async function fixture(extra = {}) {
    const { idb, KeyRange } = createMemoryIDB()
    const open = opts => createEngine({ idb, KeyRange, dbName: "hands", ...extra, ...opts })
    const engine = open()
    await engine.get("absent")
    async function self(fn) {
        const db = await new Promise((resolve, reject) => {
            const request = idb.open("hands")
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
    return { engine, open, self }
}

const legacy = () => genesisBytes(a => a.fill(9), { t: 1, n: 0 })
const snap = (root, t, source = "") => write("snap", { source_id: name(source) }, { root, ts: { t, n: 0 } })

test("hand is a computed read and does not mint a missing identity", async () => {
    let draws = 0
    const f = await fixture({ random: a => { draws++; return a.fill(1) } })
    try {
        assert.deepEqual(await f.engine.hand(), { root: null, signing: "none" })
        assert.deepEqual(await f.engine.hand(), { root: null, signing: "none" })
        assert.equal(draws, 0)
    } finally { await f.engine.close() }
})

test("unavailable crypto is not an invitation to remint a hand", async () => {
    const f = await fixture({ crypto: {} })
    try {
        assert.equal((await f.engine.hand()).signing, "unavailable")
        await assert.rejects(f.engine.newHand({ expectedRoot: null }), /secure context/)
        assert.equal(await f.self(store => store.get("genesis")), undefined)
    } finally { await f.engine.close() }
})

test("a keyless hand is replaced explicitly; its exact public genesis and retained bytes survive reopen", async () => {
    const f = await fixture()
    let engine = f.engine
    try {
        const birth = legacy(), oldRoot = name(birth)
        await f.self(store => store.put(birth, "genesis"))
        const old = snap(oldRoot, 1, "fw 1")
        const id = await engine.put(old, { source: "fw 1" })
        assert.deepEqual(await engine.hand(), { root: oldRoot, signing: "keyless" })
        await engine.newHand({ expectedRoot: oldRoot })
        const next = await engine.hand()
        assert.equal(next.signing, "ready")
        assert.notEqual(next.root, oldRoot)
        assert.equal(await engine.get(oldRoot), birth)
        assert.equal(await engine.get(id), old)
        assert.equal(await engine.source(name("fw 1")), "fw 1")
        await engine.close()
        engine = f.open()
        assert.deepEqual(await engine.hand(), next)
        assert.equal(await engine.get(oldRoot), birth)
        const bytes = snap(next.root, 2)
        await engine.put(bytes, { authored: true })
        await checkKeepProof(bytes, await engine.proof(bytes))
    } finally { await engine.close() }
})

test("a stale replacement and a healthy-hand replacement cannot discard the active credential", async () => {
    const f = await fixture()
    try {
        const birth = await f.engine.genesis(), root = name(birth)
        await assert.rejects(f.engine.newHand({ expectedRoot: "f".repeat(64) }), error => error.code === "stale-hand")
        try { await f.engine.newHand({ expectedRoot: root }) } catch { /* refusing is also safe */ }
        assert.equal(await f.engine.genesis(), birth)
        const bytes = snap(root, 3)
        await f.engine.put(bytes, { authored: true })
        await checkKeepProof(bytes, await f.engine.proof(bytes))
    } finally { await f.engine.close() }
})

test("two replacement attempts seat exactly one matching key/genesis pair", async () => {
    const f = await fixture()
    const other = f.open()
    try {
        const birth = legacy(), root = name(birth)
        await f.self(store => store.put(birth, "genesis"))
        const outcomes = await Promise.allSettled([
            f.engine.newHand({ expectedRoot: root }), other.newHand({ expectedRoot: root }),
        ])
        assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1)
        const loser = outcomes.find(x => x.status === "rejected")
        assert.equal(loser.reason.code, "stale-hand")
        assert.deepEqual(await f.engine.hand(), await other.hand())
        const bytes = snap((await other.hand()).root, 4)
        await other.put(bytes, { authored: true })
        await checkKeepProof(bytes, await f.engine.proof(bytes))
    } finally { await other.close(); await f.engine.close() }
})

test("a legacy genesis with a leftover private key is keyless, not a healthy signing hand", async () => {
    const f = await fixture()
    try {
        await f.engine.genesis()
        const birth = legacy(), root = name(birth)
        await f.self(store => store.put(birth, "genesis"))
        assert.deepEqual(await f.engine.hand(), { root, signing: "keyless" })
        await f.engine.newHand({ expectedRoot: root })
        const next = await f.engine.hand()
        assert.notEqual(next.root, root)
        const bytes = snap(next.root, 6)
        await f.engine.put(bytes, { authored: true })
        await checkKeepProof(bytes, await f.engine.proof(bytes))
    } finally { await f.engine.close() }
})

test("a mismatched stored key cannot produce locally committed invalid evidence", async () => {
    const f = await fixture()
    try {
        const root = name(await f.engine.genesis())
        const unrelated = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])
        await f.self(store => store.put(unrelated.privateKey, "signing-key"))
        const bytes = snap(root, 7, "fw 77")
        await assert.rejects(f.engine.put(bytes, { authored: true, source: "fw 77" }))
        assert.equal(await f.engine.get(name(bytes)), undefined)
        assert.equal(await f.engine.source(name("fw 77")), undefined)
    } finally { await f.engine.close() }
})

test("a recovered mint uses its captured hand, not a second mutable root read", async () => {
    const f = await fixture()
    try {
        const previousRoot = name(await f.engine.genesis())
        const previous = snap(previousRoot, 1, "fw 1")
        const base = await f.engine.put(previous, { source: "fw 1", authored: true })
        const previousProof = await f.engine.proof(previous)
        await f.self(store => store.delete("signing-key"))
        await f.engine.newHand({ expectedRoot: previousRoot })
        const root = (await f.engine.hand()).root
        const door = {
            root: () => assert.fail("mint must use the captured signing hand"),
            put: (bytes, extras) => f.engine.put(bytes, extras),
        }
        const id = await mintSnap({ title: "continuing", prev: base }, { source: "fw 2" },
            { root, work_id: null, buffer_id: "fresh" }, door, new Blob(["picture"]))
        const bytes = await f.engine.get(id)
        const value = JSON.parse(bytes)
        assert.equal(value.root, root)
        assert.equal(value.target, undefined)
        assert.equal(value.prev, base)
        assert.equal(value.source_id, name("fw 2"))
        await checkKeepProof(bytes, await f.engine.proof(bytes))
        assert.deepEqual(await f.engine.proof(previous), previousProof)
        assert.equal(await f.engine.get(base), previous)
    } finally { await f.engine.close() }
})

test("a retired captured hand is refused consistently before any mint write", async () => {
    const f = await fixture()
    try {
        const previousRoot = name(await f.engine.genesis())
        await f.self(store => store.delete("signing-key"))
        await f.engine.newHand({ expectedRoot: previousRoot })
        const root = (await f.engine.hand()).root
        const door = {
            root: () => assert.fail("do not replace a captured hand silently"),
            put: (bytes, extras) => f.engine.put(bytes, extras),
        }
        await assert.rejects(mintSnap({ title: "old request" }, { source: "fw 9" },
            { root: previousRoot, work_id: null, buffer_id: "old" }, door, new Blob(["picture"])),
        error => error.code === "stale-hand")
        assert.deepEqual(await f.engine.list(previousRoot), [])
        assert.deepEqual(await f.engine.list(root), [])
        assert.equal(await f.engine.source(name("fw 9")), undefined)
    } finally { await f.engine.close() }
})

test("a signing task finishing after replacement cannot commit old-hand bytes or referents", { timeout: 5000 }, async () => {
    const entered = deferred(), release = deferred()
    let pause = false
    const subtle = new Proxy(crypto.subtle, {
        get(target, prop) {
            if (prop === "sign") return async (...args) => {
                if (pause) { entered.resolve(); await release.promise }
                return target.sign(...args)
            }
            const value = target[prop]
            return typeof value === "function" ? value.bind(target) : value
        },
    })
    const f = await fixture({ crypto: { subtle } })
    let writing
    try {
        const birth = await f.engine.genesis(), root = name(birth)
        const kept = snap(root, 1)
        await f.engine.put(kept, { authored: true })
        const previousProof = await f.engine.proof(kept)
        const bytes = snap(root, 5, "fw 55")
        pause = true
        writing = f.engine.put(bytes, { authored: true, source: "fw 55", image: new Blob(["image"]) })
        const rejected = assert.rejects(writing, error => error.code === "stale-hand")
        void rejected.catch(() => {})
        await entered.promise
        await f.self(store => store.delete("signing-key"))
        await f.engine.newHand({ expectedRoot: root })
        release.resolve()
        await rejected
        assert.equal(await f.engine.get(name(bytes)), undefined)
        assert.equal(await f.engine.source(name("fw 55")), undefined)
        assert.equal(await f.engine.image(name(bytes)), undefined)
        assert.deepEqual(await f.engine.proof(kept), previousProof)
    } finally {
        release.resolve()
        await writing?.catch(() => {})
        await f.engine.close()
    }
})
