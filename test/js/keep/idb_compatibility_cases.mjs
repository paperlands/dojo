// Shared witnesses: identical operations against the memory factory and real IndexedDB.
import { createEngine, reprojectJournal } from "../../../assets/js/keep/journal.store.js"
import { name } from "../../../assets/js/keep/entry.js"
import { checkKeepProof } from "../../../assets/js/keep/auth.js"

const same = (a, b, why) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`compatibility: ${why}`)
}
const holds = (value, why) => { if (!value) throw new Error(`compatibility: ${why}`) }
const request = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
})
const committed = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"))
    tx.onerror = () => reject(tx.error)
})

export function openRaw(idb, dbName, version, upgrade) {
    const r = version === undefined ? idb.open(dbName) : idb.open(dbName, version)
    r.onupgradeneeded = (e) => upgrade?.(r.result, r.transaction, e)
    return request(r)
}

async function transact(db, stores, mode, fn) {
    const tx = db.transaction(stores, mode)
    const done = committed(tx)
    const value = await fn(tx)
    await done
    return value
}

const entry = (root, t, v = 1, more = {}) => JSON.stringify({
    title: `entry ${t}`, ...more, v, kind: "snap", root, ts: { t, n: 0 },
})
function engine(store, dbName) {
    const idb = store.idb ?? globalThis.indexedDB
    return createEngine({
        ...store, dbName,
        idb: {
            open(...args) {
                holds(args.length === 1, "every ordinary open is versionless")
                return idb.open(...args)
            },
        },
        random: (a) => { a.fill(0x31); return a },
        stamp: () => ({ t: 1, n: 0 }),
    })
}

export async function compatibilityWalk(store, prefix = "compat") {
    const idb = store.idb ?? globalThis.indexedDB
    const dbName = `${prefix}-preservation`
    const warm = engine(store, dbName)
    let cold, newer
    const out = {}
    try {
        const birth = await warm.genesis()
        const root = name(birth)
        const bytes = entry(root, 10)
        const id = await warm.put(bytes, { authored: true, source: "old source", image: new Blob(["old image"]) })
        const proof = await warm.proof(bytes)
        const opaque = { future: [null, { meaning: "not understood here" }], revision: 7 }
        const upgraded = await openRaw(idb, dbName, 2, (db, tx) => {
            const futureStore = db.createObjectStore("future")
            futureStore.createIndex("by_revision", "revision", { unique: true })
            tx.objectStore("log").createIndex("by_root_future", "root")
        })
        await transact(upgraded, ["log", "self", "future"], "readwrite", async (tx) => {
            const row = await request(tx.objectStore("log").get(id))
            row.opaque = opaque
            tx.objectStore("log").put(row)
            tx.objectStore("self").put(opaque, "future-self")
            tx.objectStore("future").put(opaque, "future-key")
        })
        upgraded.close()

        newer = engine(store, dbName)
        const future = entry(root, 20, 7, { unknown: opaque, target: id })
        const fid = await newer.put(future, { authored: true, source: "future source", image: new Blob(["future image"]) })
        const futureProof = await newer.proof(future)
        await newer.close()
        out.warmAdopts = await warm.get(fid) === future
        holds(out.warmAdopts, "live old tab reopens a newer database")
        await warm.close()

        cold = engine(store, dbName)
        const [fromA, fromB] = await Promise.all([cold.get(id), cold.get(fid)])
        out.coldAdopts = fromA === bytes && fromB === future
        holds(out.coldAdopts, "fresh old build opens a newer database")
        same(await cold.list(root), [future, bytes], "old reader lists exact future bytes")
        same(await cold.proof(bytes), proof, "retained old proof is unchanged")
        same(await cold.proof(future), futureProof, "retained future proof is unchanged")
        await cold.put(bytes, { proof })
        await cold.share(id, { at: 30, node: "peer" })
        same(await cold.local(root), [future], "old shared/local projection remains lawful")
        const child = entry(root, 40, 1, { target: fid, prev: fid })
        await cold.put(child, { authored: true })
        await checkKeepProof(child, await cold.proof(child), store.crypto ?? globalThis.crypto)
        out.keyStillSigns = (await cold.hand()).root === root
        holds(out.keyStillSigns, "same nonextractable signing hand survives adoption")
        out.messagesAndProofs = await cold.get(fid) === future && await cold.get(id) === bytes
        out.sidecars = await cold.source(name("old source")) === "old source" &&
            await cold.source(name("future source")) === "future source" &&
            await (await cold.image(id)).text() === "old image" &&
            await (await cold.image(fid)).text() === "future image"
        holds(out.messagesAndProofs && out.sidecars, "bytes and sidecars survive old writes")
        await cold.close()

        const raw = await openRaw(idb, dbName)
        try {
            holds(raw.version === 2, "old writes never change held physical version")
            await transact(raw, ["log", "self", "future"], "readonly", async (tx) => {
                const row = await request(tx.objectStore("log").get(id))
                same(row.opaque, opaque, "unknown row fields survive put and share")
                same(row.proof, proof, "row proof retained exactly")
                same(await request(tx.objectStore("self").get("genesis")), birth, "genesis retained exactly")
                same(await request(tx.objectStore("self").get("future-self")), opaque, "unknown self key retained")
                same(await request(tx.objectStore("future").get("future-key")), opaque, "unknown store retained")
            })
        } finally { raw.close() }
        out.unknownData = true
        newer = engine(store, dbName)
        same(await newer.list(root), [child, future, bytes], "new build reads old writes after rollback")
        await checkKeepProof(child, await newer.proof(child), store.crypto ?? globalThis.crypto)
        out.newReadsOld = true
        await newer.close()
        await reprojectJournal({ idb, dbName, version: 3 })
        newer = engine(store, dbName)
        same(await newer.list(root), [child, future, bytes], "cursor reprojection preserves exact history")
        same(await newer.proof(bytes), proof, "cursor reprojection preserves old proof")
        same(await newer.proof(future), futureProof, "cursor reprojection preserves future proof")
        const afterReproject = await openRaw(idb, dbName)
        try {
            await transact(afterReproject, ["log"], "readonly", async (tx) => {
                const row = await request(tx.objectStore("log").get(id))
                same(row.opaque, opaque, "cursor reprojection preserves unknown row fields")
            })
        } finally { afterReproject.close() }
        const after = entry(root, 50)
        await newer.put(after, { authored: true })
        await checkKeepProof(after, await newer.proof(after), store.crypto ?? globalThis.crypto)
        out.reprojectionPreserves = true
    } finally {
        await warm.close()
        await cold?.close()
        await newer?.close()
    }
    return out
}

export const incompatibleShapes = {
    "missing-store": (db) => db.deleteObjectStore("source"),
    "missing-index": (_db, tx) => tx.objectStore("log").deleteIndex("by_root_local"),
    "wrong-index": (_db, tx) => {
        const log = tx.objectStore("log")
        log.deleteIndex("by_root_ts")
        log.createIndex("by_root_ts", ["ts.t", "root", "ts.n"])
    },
    "unique-index": (_db, tx) => tx.objectStore("log").createIndex("future_constraint", "root", { unique: true }),
    "wrong-key": (db) => {
        db.deleteObjectStore("source")
        db.createObjectStore("source", { keyPath: "id" })
    },
    "auto-increment": (db) => {
        db.deleteObjectStore("source")
        db.createObjectStore("source", { autoIncrement: true })
    },
    "multi-entry": (_db, tx) => {
        const log = tx.objectStore("log")
        log.deleteIndex("by_root_ts")
        log.createIndex("by_root_ts", "root", { multiEntry: true })
    },
}

async function fingerprint(db) {
    const stores = [...db.objectStoreNames].sort()
    return transact(db, stores, "readonly", async (tx) => {
        const out = { version: db.version, stores: {} }
        for (const name of stores) {
            const s = tx.objectStore(name)
            const indexes = [...s.indexNames].sort().map((name) => {
                const i = s.index(name)
                return [name, i.keyPath, i.unique, i.multiEntry]
            })
            out.stores[name] = { keyPath: s.keyPath, autoIncrement: s.autoIncrement, indexes,
                keys: await request(s.getAllKeys()), rows: await request(s.getAll()) }
        }
        return out
    })
}

export async function refusalWalk(store, shape, prefix = "compat") {
    const idb = store.idb ?? globalThis.indexedDB
    const dbName = `${prefix}-${shape}`
    const j = engine(store, dbName)
    const root = "a".repeat(64)
    const bytes = entry(root, 10)
    const id = await j.put(bytes)
    await j.close()
    const altered = await openRaw(idb, dbName, 2, incompatibleShapes[shape])
    const before = await fingerprint(altered)
    altered.close()
    const rejected = engine(store, dbName)
    try {
        let failure
        try { await rejected.genesis() } catch (error) { failure = error }
        holds(failure?.code === "schema-incompatible", `${shape}: refuse before genesis`)
        holds(failure.message.includes("stored data was not changed"), `${shape}: clear preservation refusal`)
        let later
        try { await rejected.get(id) } catch (error) { later = error }
        holds(later === failure, `${shape}: failed door refuses consistently`)
    } finally { await rejected.close() }
    for (const version of [2, 3]) {
        let failure
        try { await reprojectJournal({ idb, dbName, version }) } catch (error) { failure = error }
        holds(failure?.code === "schema-incompatible", `${shape}: refuse before maintenance v${version}`)
    }
    const after = await openRaw(idb, dbName)
    try { same(await fingerprint(after), before, `${shape}: refusal changed neither rows nor schema/version`) }
    finally { after.close() }
    const released = await openRaw(idb, dbName, 3)
    released.close()
    return { refused: true, unchanged: true, released: true }
}

export async function lifecycleWalk(store, prefix = "compat") {
    const idb = store.idb ?? globalThis.indexedDB
    const dbName = `${prefix}-lifecycle`
    const held = await openRaw(idb, dbName, undefined, (db) => db.createObjectStore("s"))
    holds(held.version === 1, "versionless fresh open creates version one")
    await committed(held.transaction("s", "readonly"))
    const events = []
    held.onversionchange = (e) => { events.push(`change:${e.oldVersion}->${e.newVersion}`) }
    const r = idb.open(dbName, 2)
    let upgraded = false
    let blockerWork
    r.onblocked = () => {
        blockerWork = (async () => {
            events.push("blocked")
            holds(!upgraded, "upgrade cannot begin while old connection remains open")
            await transact(held, ["s"], "readwrite", (tx) => request(tx.objectStore("s").put("old write", "key")))
            events.push("old-write")
            held.close()
        })()
    }
    r.onupgradeneeded = () => { upgraded = true; events.push("upgrade") }
    const newer = await request(r)
    await blockerWork
    events.push("success")
    same(events, ["change:1->2", "blocked", "old-write", "upgrade", "success"], "upgrade serialization")
    same(await transact(newer, ["s"], "readonly", (tx) => request(tx.objectStore("s").get("key"))), "old write", "blocked writer commits before upgrade")
    newer.close()
    let lower
    try { (await openRaw(idb, dbName, 1)).close() } catch (e) { lower = e.name }
    same(lower, "VersionError", "raw lower pin must fail")
    const adopted = await openRaw(idb, dbName)
    holds(adopted.version === 2, "raw versionless open adopts held version")
    adopted.close()
    let aborted
    try {
        await openRaw(idb, dbName, 3, (db, tx) => {
            db.createObjectStore("rollback")
            tx.objectStore("s").put("not committed", "key")
            tx.abort()
        })
    } catch (e) { aborted = e.name }
    same(aborted, "AbortError", "aborted upgrade refuses")
    const restored = await openRaw(idb, dbName)
    try {
        holds(restored.version === 2 && !restored.objectStoreNames.contains("rollback"), "aborted DDL/version rolls back")
        same(await transact(restored, ["s"], "readonly", (tx) => request(tx.objectStore("s").get("key"))), "old write", "aborted row write rolls back")
    } finally { restored.close() }
    return { lowerPin: lower, versionless: true, emptyCompletes: true, blocked: true, rollback: true }
}

export async function engineLifecycleWalk(store = {}, prefix = "compat") {
    const idb = store.idb ?? globalThis.indexedDB
    const dbName = `${prefix}-engine-lifecycle`
    const seed = engine(store, dbName)
    await seed.hand()
    await seed.close()
    const blocker = await openRaw(idb, dbName)
    let failure
    try { await reprojectJournal({ idb, dbName, version: 2 }) } catch (e) { failure = e }
    holds(failure?.code === "schema-blocked", "only explicit maintenance requests a blocked upgrade")
    let opens = 0
    const counted = { open(...args) { opens++; return idb.open(...args) } }
    const ordinary = engine({ ...store, idb: counted }, dbName)
    try {
        // The queued versionless open gets no blocked event; all verbs share its promise.
        const waiting = Array.from({ length: 5 }, () => ordinary.hand())
        holds(opens === 1, "ordinary verbs share exactly one native open")
        blocker.close()
        for (const result of await Promise.all(waiting)) same(result, { root: null, signing: "none" }, "ordinary open recovers")
        const after = await openRaw(idb, dbName)
        holds(after.version === 1, "abandoned maintenance aborts before late repair or version change")
        after.close()
    } finally {
        blocker.close()
        await ordinary.close()
    }
    same(await reprojectJournal({ idb, dbName, version: 2 }), 2, "maintenance can be explicitly retried")
    let closing
    const wrapped = {
        open(...args) {
            const r = idb.open(...args)
            void closing.close()
            return r
        },
    }
    closing = engine({ ...store, idb: wrapped }, dbName)
    try {
        let failure
        try { await closing.hand() } catch (e) { failure = e }
        holds(failure?.message === "journal: closed", "close during ordinary open rejects")
    } finally { await closing.close() }
    const released = await openRaw(idb, dbName, 3)
    released.close()
    return { blockedRepairRefuses: true, lateUpgradeAborted: true, closedOpenReleased: true, singleFlight: true }
}

export async function maintenanceWalk(store = {}, prefix = "compat") {
    const idb = store.idb ?? globalThis.indexedDB
    const dbName = `${prefix}-maintenance`
    const root = "a".repeat(64)
    const bytes = entry(root, 10)
    const seed = engine(store, dbName)
    const id = await seed.put(bytes)
    await seed.close()
    const added = await openRaw(idb, dbName, 2, (_db, tx) => tx.objectStore("log").createIndex("extra", "root"))
    await transact(added, ["log"], "readwrite", async (tx) => {
        const log = tx.objectStore("log")
        const row = await request(log.get(id))
        row.local = 0
        log.put(row)
    })
    const before = await fingerprint(added)
    added.close()
    const ordinary = engine(store, dbName)
    try { same(await ordinary.get(id), bytes, "ordinary open reads without repairing") }
    finally { await ordinary.close() }
    const after = await openRaw(idb, dbName)
    try { same(await fingerprint(after), before, "opening/index addition is not a repair") }
    finally { after.close() }
    same(await reprojectJournal({ idb, dbName, version: 3 }), 3, "explicit maintenance repairs")
    same(await reprojectJournal({ idb, dbName, version: 3 }), 3, "same maintenance is idempotent")
    same(await reprojectJournal({ idb, dbName, version: 2 }), 3, "maintenance skips newer held versions")
    const repaired = engine(store, dbName)
    try { same(await repaired.local(root), [bytes], "repair restored the derived projection") }
    finally { await repaired.close() }
    const released = await openRaw(idb, dbName, 4)
    released.close()
    const racing = (target, winner) => ({
        open(name, version) {
            if (version === target) {
                const other = idb.open(name, winner)
                other.onsuccess = () => other.result.close()
            }
            return version === undefined ? idb.open(name) : idb.open(name, version)
        },
    })
    same(await reprojectJournal({ idb: racing(5, 5), dbName, version: 5 }), 5, "equal concurrent upgrade is an ordinary no-op")
    same(await reprojectJournal({ idb: racing(6, 7), dbName, version: 6 }), 7, "higher concurrent upgrade is checked and adopted")
    same(await reprojectJournal({ idb, dbName, version: 6 }), 7, "repeated lower target never downgrades")
    const freshName = `${dbName}-fresh`
    same(await reprojectJournal({ idb, dbName: freshName, version: 3 }), 3, "maintenance creates an absent database at its explicit target")
    const fresh = engine(store, freshName)
    try { same(await fresh.hand(), { root: null, signing: "none" }, "ordinary open adopts a maintenance-created database") }
    finally { await fresh.close() }
    return { explicitOnly: true, idempotent: true, newerHeldSkipped: true, concurrentUpgradeSafe: true, freshCreatesTarget: true, released: true }
}
export async function compatibilitySuite(store = {}, prefix = "compat") {
    const out = { preservation: await compatibilityWalk(store, prefix), lifecycle: await lifecycleWalk(store, prefix) }
    out.engineLifecycle = await engineLifecycleWalk(store, prefix)
    out.maintenance = await maintenanceWalk(store, prefix)
    for (const shape of Object.keys(incompatibleShapes)) out[shape] = await refusalWalk(store, shape, prefix)
    return out
}
