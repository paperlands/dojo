// The journal engine — durability behind the worker (id:kb-5, id:kc-c-journal).
//
// Four stores, four laws:
//   log    — messages, append-only, forever; id = name(message)
//   blobs  — images, keyed by the *message's* id; capped; shared only may go
//   source — program text, keyed by name(text); NEVER evicted (id:kb-source)
//   self   — genesis bytes + nonextractable signing key (id:keep-auth-write-guard)
//
// put takes bytes, not (id, bytes) — the name is not a choice (id:kc-law 3).
// local is 1|0, a number — a boolean index holds zero rows (measured).
// list/local use openCursor(range, "prev") — getAll is ascending (measured).
//
// Physical schema versions and authored envelope versions are independent.
// Additive indexes need not rewrite messages; views are never re-kept.
// Compatibility contract: id:keep-idb-compatibility.

// Eviction is a fold over reasons at put, never a stored verdict.

import { stamp as ambientStamp } from "../utils/stamp.js"
import { name, read, unshaped } from "./entry.js"
import { genesisBytes } from "./genesis.js"
import { hashBytes } from "./hash.js"
import { signingHand, keepProof, checkKeepProof, publicCredential } from "./auth.js"

const DB_NAME = "dojo-keep"

/** Image eviction target; sole or unverified copies may exceed it. */
const DEFAULT_BLOB_CAP = 32 * 1024 * 1024
function typed(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function compatibleKey(key) {
    return key != null && key.type === "private" && key.extractable === false &&
        key.algorithm?.name === "ECDSA" && key.algorithm?.namedCurve === "P-256"
}

const supportsGenesis = (genesis) => {
    try {
        publicCredential(genesis)
        return true
    } catch {
        return false
    }
}

const usableHand = (genesis, key, crypto) =>
    crypto?.subtle != null && compatibleKey(key) && supportsGenesis(genesis)

const SELF_KEY = "genesis"
const SIGNING_KEY = "signing-key"
const PRIOR_KEY = "genesis-prior:"

/**
 * @param {object} [opts]
 * @param {IDBFactory} [opts.idb] - injectable; tests pass a memory factory
 * @param {string} [opts.dbName]
 * @param {(arr: Uint8Array) => Uint8Array} [opts.random]
 * @param {() => {t: number, n: number}} [opts.stamp]
 * @param {number} [opts.blobCap]
 * @param {typeof IDBKeyRange} [opts.KeyRange] - injectable for node tests
 */
export function createEngine(opts = {}) {
    const idb = opts.idb ?? globalThis.indexedDB
    if (!idb) throw new Error("journal: no indexedDB (and none injected)")
    const KeyRange = opts.KeyRange ?? globalThis.IDBKeyRange
    if (!KeyRange) throw new Error("journal: no IDBKeyRange (and none injected)")
    const dbName = opts.dbName ?? DB_NAME
    const crypto = opts.crypto ?? globalThis.crypto
    const random =
        opts.random ??
        (globalThis.crypto?.getRandomValues?.bind(globalThis.crypto) ?? null)
    if (!random) throw new Error("journal: no random (and none injected)")
    const stampFn = opts.stamp ?? ambientStamp
    const blobCap = opts.blobCap ?? DEFAULT_BLOB_CAP

    /** @type {Promise<IDBDatabase> | null} */
    let dbp = null
    /** @type {IDBDatabase | null} */
    let db = null
    let closed = false
    function open() {
        if (closed) return Promise.reject(new Error("journal: closed"))
        if (!dbp) dbp = openAt(idb, dbName, {
            isClosed: () => closed,
            onOpen(d) {
                d.onversionchange = () => {
                    d.close()
                    if (db === d) { db = null; dbp = null }
                }
                db = d
            },
        })
        return dbp
    }

    /**
     * ONE LAW INSIDE fn: await nothing but an IDB request.
     *
     * A transaction stays alive only while its requests keep arriving; awaiting
     * an IDB event resolves in the microtask right after it, so the tx is still
     * active. Await a fetch, a toBlob, a worker round-trip — anything that yields
     * to the task queue — and the tx commits underneath you, so the NEXT request
     * throws TransactionInactiveError. Intermittently, under load, far from here.
     * That is the one way this file breaks; decode and hash BEFORE entering.
     *
     * No test-double hooks. Lifetime is the engine's (and the memory fake's
     * auto-commit) — production code never names _ready / _commit / _resolveLock.
     */
    async function withStore(storeNames, mode, fn) {
        const d = await open()
        const tx = d.transaction(storeNames, mode)
        // Handlers first — a real IDB may complete in the microtask after the
        // last request; missing oncomplete would hang the verb forever.
        const committed = whenCommitted(tx)
        try {
            const result = await fn(tx)
            await committed
            return result
        } catch (err) {
            try {
                tx.abort?.()
            } catch {
                /* already failed */
            }
            // Observe the abort rejection so it is not an unhandledrejection
            // noise that buries the real err (id:kb-vet4 32).
            void committed.catch(() => {})
            throw err
        }
    }


    // Retain bytes + proof atomically; only explicit authored intent may sign.
    // Source and image share the transaction; receipts remain a later share.
    // Incoming bytes are never inferred to be ours (id:keep-auth-durable-proof).
    async function put(bytes, extras = {}) {
        if (typeof bytes !== "string") {
            throw new TypeError("journal.put: bytes must be the entry string")
        }
        const id = name(bytes)
        const value = read(bytes)

        // The skeleton covers every column the index holds — one table
        // (skeleton.json) both sides interpret (id:kb-5-skeleton). Without
        // it a keep is durable and invisible here, or shared-and-refused there.
        const missing = unshaped(value)
        if (missing) {
            throw new TypeError(
                `journal.put: ${missing} will never project — refuse silent loss`,
            )
        }

        const root = value.root
        const ts = value.ts
        const { image, source } = extras
        const imageDigest = await digestOfImage(image)
        const evidence = await putProof(bytes, root, extras)
        // An authored proof must pass the SAME admission before it is stored.
        if (extras.authored === true && evidence != null) {
            await checkKeepProof(bytes, evidence, crypto)
        }

        const stores = ["log", "blobs", "source", ...(extras.authored === true ? ["self"] : [])]
        await withStore(stores, "readwrite", async (tx) => {
            // Authored bytes commit only under the hand that is active AT WRITE TIME.
            if (extras.authored === true) {
                const self = tx.objectStore("self")
                const birth = await idbReq(self.get(SELF_KEY))
                const key = await idbReq(self.get(SIGNING_KEY))
                if (birth == null || name(birth) !== root || key == null) {
                    throw typed("stale-hand", "keep: stale hand; no bytes were written")
                }
            }
            const log = tx.objectStore("log")
            const blobs = tx.objectStore("blobs")
            const sources = tx.objectStore("source")

            const existing = await idbReq(log.get(id))
            const row = existing ?? { id, message: bytes, root, ts, local: 1 }
            if (evidence != null && !row.proof) row.proof = evidence
            if (!existing || evidence != null) log.put(row)

            if (image != null) {
                const has = await idbReq(blobs.get(id))
                if (!has) {
                    // Bind only the blob actually inserted. (id:keep-foundation-retention)
                    blobs.put(image, id)
                    row.image_digest = imageDigest
                    log.put(row)
                }
            }
            // Store source unconditionally when handed — even "". source_id =
            // name("") must point at a row, not a tombstone (id:kb-source-absence).
            if (source !== undefined) {
                const sid = name(source)
                sources.put(source, sid)
            }
        })

        // Eviction is a fold at put, never a stored verdict (id:kc-evict).
        // Only a NEW blob can push the store over: a message-only put cannot,
        // and most puts are message-only (clan history, re-puts, forks).
        if (image != null) await evictIfNeeded()
        return id
    }

    async function get(id) {
        // The journal's name lives in `self`, not the log. Hold the root,
        // hold the genesis (id:kb-3-owner, id:kb-5-genesis-place).
        return withStore(["log", "self"], "readonly", async (tx) => {
            const row = await idbReq(tx.objectStore("log").get(id))
            if (row) return row.message
            const self = tx.objectStore("self")
            const held = await idbReq(self.get(SELF_KEY))
            if (held != null && name(held) === id) return held
            const prior = await idbReq(self.get(PRIOR_KEY + id))
            return prior ?? undefined
        })
    }

    /**
     * Author's history, newest first. Reverse cursor — getAll is ascending
     * (measured, id:kc-c-journal).
     */
    async function list(root, n = Infinity) {
        return withStore(["log"], "readonly", async (tx) => {
            const idx = tx.objectStore("log").index("by_root_ts")
            const range = KeyRange.bound(
                [root, -Infinity, -Infinity],
                [root, Infinity, Infinity],
            )
            return cursorCollect(idx.openCursor(range, "prev"), n)
        })
    }

    /**
     * Default = newest n kept-local (the shared fold, id:kb-8-page).
     * proved = retain only rows with proof BEFORE n, so wire page and "more" share one query.
     * Sparse prefixes are inspected without an n bound (finite total, not a latency promise).
     */
    async function local(root, n = Infinity, { proved = false } = {}) {
        return withStore(["log"], "readonly", async (tx) => {
            const idx = tx.objectStore("log").index("by_root_local")
            const range = KeyRange.bound(
                [root, 1, -Infinity, -Infinity],
                [root, 1, Infinity, Infinity],
            )
            // Positive evidence before the n bound: a proof-less row is inspected, not shipped.
            const keep = proved ? (row) => row.proof != null : null
            return cursorCollect(idx.openCursor(range, "prev"), n, keep)
        })
    }

    /** An answer ends the retry (local → 0); only a verified
     *  retained:{image:digest} permits eviction. (id:keep-foundation-retention) */
    async function share(id, shared) {
        if (!shared || typeof shared.at !== "number") {
            throw new TypeError("journal.share: shared needs {at, node}")
        }
        return withStore(["log"], "readwrite", async (tx) => {
            const log = tx.objectStore("log")
            const row = await idbReq(log.get(id))
            if (!row) return false
            // Granted once. A second share of the same id is a no-op that keeps
            // the first fact (the row's fact, not the attempt's — id:kb-vet3 26).
            if (row.shared) return true
            const retained = shared.retained === false
                ? false
                : shared.retained && typeof shared.retained.image === "string"
                    ? { image: shared.retained.image }
                    : undefined
            row.shared = {
                at: shared.at,
                node: shared.node,
                ...(retained === undefined ? {} : { retained }),
            }
            row.local = 0
            log.put(row)
            return true
        })
    }

    async function image(id) {
        return withStore(["blobs"], "readonly", async (tx) => {
            return idbReq(tx.objectStore("blobs").get(id))
        })
    }

    /** Follow the message's source pointer (id:kb-source). */
    async function source(sourceId) {
        return withStore(["source"], "readonly", async (tx) => {
            return idbReq(tx.objectStore("source").get(sourceId))
        })
    }

    // Crypto completes before the byte/proof transaction (id:keep-auth-durable-proof).
    async function putProof(bytes, root, { proof: candidate, authored = false }) {
        if (authored !== true && authored !== false) throw new TypeError("keep: authored must be boolean")
        if (candidate != null) {
            if (authored) throw new Error("keep: authoring and proof retention are separate intents")
            return checkKeepProof(bytes, candidate, crypto)
        }
        const held = await withStore(authored ? ["log", "self"] : ["log"], "readonly", async (tx) => {
            const row = await idbReq(tx.objectStore("log").get(name(bytes)))
            if (!authored) return { row }
            const self = tx.objectStore("self")
            const [birth, key] = await Promise.all([
                idbReq(self.get(SELF_KEY)),
                idbReq(self.get(SIGNING_KEY)),
            ])
            return { row, birth, key }
        })
        if (authored && (held.birth == null || name(held.birth) !== root)) {
            throw typed("stale-hand", "keep: cannot author another root")
        }
        if (held.row?.message === bytes && held.row.proof) return held.row.proof
        if (!authored) return null
        if (!usableHand(held.birth, held.key, crypto)) {
            throw typed("needs-hand", "keep: signing key unavailable; a keyless root needs a new signing hand")
        }
        return keepProof(bytes, held.birth, held.key, crypto)
    }

    // This reads public evidence; key loss cannot erase it or authorize new bytes.
    async function proof(bytes) {
        if (typeof bytes !== "string") throw new TypeError("journal.proof: bytes must be text")
        const row = await withStore(["log"], "readonly", (tx) =>
            idbReq(tx.objectStore("log").get(name(bytes))))
        if (row?.message !== bytes || !row.proof) throw new Error("keep: no retained proof")
        return row.proof
    }

    // Computed readiness; never mints and never signs (id:keep-auth-write-guard).
    async function hand() {
        return withStore(["self"], "readonly", async (tx) => {
            const self = tx.objectStore("self")
            const [birth, key] = await Promise.all([
                idbReq(self.get(SELF_KEY)),
                idbReq(self.get(SIGNING_KEY)),
            ])
            const root = typeof birth === "string" ? name(birth) : null
            if (crypto?.subtle == null) return { root, signing: "unavailable" }
            if (birth == null) return { root: null, signing: "none" }
            return { root, signing: usableHand(birth, key, crypto) ? "ready" : "keyless" }
        })
    }

    // Local hand lineage only: public self genesis + verified prior keys.
    // Never mints, rotates, reads the private key, or consults crypto.
    async function roots() {
        return withStore(["self"], "readonly", async (tx) => {
            const self = tx.objectStore("self")
            const [birth, keys] = await Promise.all([
                idbReq(self.get(SELF_KEY)),
                idbReq(self.getAllKeys()),
            ])
            let active = null
            const seen = new Set()
            if (typeof birth === "string") {
                active = name(birth)
                seen.add(active)
            }
            const priors = []
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i]
                if (typeof key !== "string" || !key.startsWith(PRIOR_KEY)) continue
                const value = await idbReq(self.get(key))
                if (typeof value !== "string") continue
                const root = key.slice(PRIOR_KEY.length)
                if (!root || name(value) !== root || seen.has(root)) continue
                seen.add(root)
                priors.push(root)
            }
            priors.sort()
            return { active, prior: priors }
        })
    }

    // Explicit recovery only: none/keyless -> a fresh hand; healthy pair is a no-op.
    async function newHand({ expectedRoot } = {}) {
        const read = () => withStore(["self"], "readonly", async (tx) => {
            const self = tx.objectStore("self")
            return {
                birth: await idbReq(self.get(SELF_KEY)),
                key: await idbReq(self.get(SIGNING_KEY)),
            }
        })
        const seat = async (tx, hand) => {
            const self = tx.objectStore("self")
            const birth = await idbReq(self.get(SELF_KEY))
            const key = await idbReq(self.get(SIGNING_KEY))
            const current = typeof birth === "string" ? name(birth) : null
            if (current !== (expectedRoot ?? null)) throw typed("stale-hand", "keep: stale hand")
            if (usableHand(birth, key, crypto)) return { root: current, changed: false }
            const bytes = genesisBytes(random, stampFn(), hand.auth)
            if (birth != null) self.put(birth, PRIOR_KEY + current)
            self.put(bytes, SELF_KEY)
            self.put(hand.privateKey, SIGNING_KEY)
            return { root: name(bytes), changed: true, archived: current }
        }

        const before = await read()
        const current = typeof before.birth === "string" ? name(before.birth) : null
        if (current !== (expectedRoot ?? null)) throw typed("stale-hand", "keep: stale hand")
        if (usableHand(before.birth, before.key, crypto)) return { root: current, changed: false }
        const next = await signingHand(crypto)
        return withStore(["self"], "readwrite", (tx) => seat(tx, next))
    }

    // One atomic seat for genesis + key, including a two-tab first-mint race.
    // Genesis travels as public evidence, never as a moment in the log.
    async function genesis() {
        const held = await withStore(["self"], "readonly", (tx) =>
            idbReq(tx.objectStore("self").get(SELF_KEY)))
        if (held != null) return held

        // Crypto yields tasks: mint outside IDB, then atomically seat key + genesis.
        const hand = await signingHand(crypto)
        return withStore(["self"], "readwrite", async (tx) => {
            const self = tx.objectStore("self")
            const held = await idbReq(self.get(SELF_KEY))
            if (held != null) return held

            const bytes = genesisBytes(random, stampFn(), hand.auth)
            self.put(bytes, SELF_KEY)
            self.put(hand.privateKey, SIGNING_KEY)
            return bytes
        })
    }

    /**
     * Shared blobs, oldest-first, under the cap. Unshared never yields.
     * Messages and source are never touched.
     */
    async function evictIfNeeded() {
        await withStore(["log", "blobs"], "readwrite", async (tx) => {
            const log = tx.objectStore("log")
            const blobs = tx.objectStore("blobs")
            const keys = await idbReq(blobs.getAllKeys())
            /** @type {{id: string, size: number, t: number, n: number}[]} */
            const shared = []
            let total = 0
            for (const id of keys) {
                const blob = await idbReq(blobs.get(id))
                if (!blob) continue
                const size = blobSize(blob)
                total += size
                const row = await idbReq(log.get(id))
                // The receipt must cover this stored blob, not an earlier occupant.
                // Legacy or unverifiable blobs stay pinned. (id:keep-foundation-retention)
                if (row?.local === 0 && typeof row.image_digest === "string" &&
                    row.image_digest === row.shared?.retained?.image) {
                    const t = row.ts?.t ?? 0
                    const n = row.ts?.n ?? 0
                    shared.push({ id, size, t, n })
                }
            }
            if (total <= blobCap) return
            // Oldest-first among shared.
            shared.sort((a, b) => a.t - b.t || a.n - b.n)
            for (const s of shared) {
                if (total <= blobCap) break
                blobs.delete(s.id)
                const row = await idbReq(log.get(s.id))
                delete row.image_digest
                log.put(row)
                total -= s.size
            }
        })
    }

    async function close() {
        closed = true
        if (db) {
            db.close()
            db = null
        }
        dbp = null
    }

    return {
        put,
        get,
        list,
        local,
        share,
        image,
        source,
        hand,
        roots,
        newHand,
        genesis,
        proof,
        close,
        get blobCap() {
            return blobCap
        },
    }
}

// Explicit maintenance, never a side effect of ordinary opening (id:keep-idb-compatibility).
export async function reprojectJournal({ idb = globalThis.indexedDB, dbName = DB_NAME, version } = {}) {
    if (!Number.isSafeInteger(version) || version < 1) {
        throw new TypeError("journal.reproject: a positive physical version is required")
    }
    const onOpen = (_db, tx) => whenCommitted(tx)
    let d
    try {
        d = await openAt(idb, dbName, { version, onUpgrade: reproject, onOpen })
    } catch (error) {
        if (error?.name !== "VersionError") throw error
        d = await openAt(idb, dbName, { onOpen })
    }
    d.close()
    return d.version
}

// ── schema ──────────────────────────────────────────────────────────

const SCHEMA = {
    log: {
        keyPath: "id",
        indexes: {
            by_root_ts: ["root", "ts.t", "ts.n"],
            by_root_local: ["root", "local", "ts.t", "ts.n"],
        },
    },
    blobs: { keyPath: null, indexes: {} },
    source: { keyPath: null, indexes: {} },
    self: { keyPath: null, indexes: {} },
}

function createSchema(db) {
    for (const [name, { keyPath, indexes }] of Object.entries(SCHEMA)) {
        const store = db.createObjectStore(name, { keyPath })
        for (const [index, path] of Object.entries(indexes)) store.createIndex(index, path)
    }
}

// Structure is observable; stable row meanings are a contract (id:keep-idb-compatibility).
function requireSchema(db, upgradeTx) {
    const refuse = (part) => {
        throw typed("schema-incompatible", `journal: unsupported schema (${part}); stored data was not changed`)
    }
    for (const name of Object.keys(SCHEMA)) {
        if (!db.objectStoreNames.contains(name)) refuse(`missing store ${name}`)
    }
    const tx = upgradeTx ?? db.transaction(Object.keys(SCHEMA), "readonly")
    for (const [name, { keyPath, indexes }] of Object.entries(SCHEMA)) {
        const store = tx.objectStore(name)
        if (store.keyPath !== keyPath) refuse(`${name}.keyPath`)
        if (store.autoIncrement) refuse(`${name}.autoIncrement`)
        for (const [index, path] of Object.entries(indexes)) {
            if (!store.indexNames.contains(index)) refuse(`missing index ${name}.${index}`)
            const held = store.index(index)
            if (JSON.stringify(held.keyPath) !== JSON.stringify(path) || held.unique || held.multiEntry) {
                refuse(`${name}.${index}`)
            }
        }
        for (const index of store.indexNames) {
            if (store.index(index).unique) refuse(`unique index ${name}.${index}`)
        }
    }
    return tx
}

// Only derived columns change; all other row fields survive (id:kb-projection-fence).
// Each cursor request keeps the atomic upgrade alive without materializing the log.
function reproject(tx) {
    if (!tx.objectStoreNames.contains("log")) return
    const log = tx.objectStore("log")
    const cursor = log.openCursor()
    cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) return
        const row = c.value
        try {
            const value = read(row.message)
            row.root = value.root ?? null
            row.ts = value.ts ?? null
            row.local = row.shared ? 0 : 1
        } catch {
            c.continue()
            return
        }
        // Update failures must abort the whole upgrade, not certify a partial fold.
        c.update(row)
        c.continue()
    }
}

// ── IDB helpers ─────────────────────────────────────────────────────

function whenCommitted(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error || new Error("journal: abort"))
    })
}

// Own the native request until it settles, including after a blocked rejection.
function openAt(idb, dbName, { version, onUpgrade, onOpen, isClosed = () => false } = {}) {
    return new Promise((resolve, reject) => {
        const req = version === undefined ? idb.open(dbName) : idb.open(dbName, version)
        let failure = null
        const checkLive = () => {
            if (failure) throw failure
            if (isClosed()) throw new Error("journal: closed")
        }
        req.onerror = () => reject(failure ?? req.error)
        req.onblocked = () => {
            failure = typed("schema-blocked", "journal: another tab is blocking the upgrade; close it and retry")
            reject(failure)
        }
        req.onupgradeneeded = (event) => {
            try {
                checkLive()
                if (event.oldVersion === 0) createSchema(req.result)
                else requireSchema(req.result, req.transaction)
                onUpgrade?.(req.transaction)
            } catch (error) {
                failure = error
                try { req.transaction.abort() } catch { /* a late success still closes below */ }
                reject(error)
            }
        }
        req.onsuccess = async () => {
            const d = req.result
            d.onversionchange = () => d.close()
            try {
                checkLive()
                const checked = requireSchema(d)
                await onOpen?.(d, checked)
                checkLive()
                resolve(d)
            } catch (error) {
                d.close()
                reject(error)
            }
        }
    })
}

function idbReq(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function cursorCollect(cursorReq, n, keep = null) {
    const out = []
    return new Promise((resolve, reject) => {
        cursorReq.onsuccess = () => {
            const c = cursorReq.result
            if (!c || out.length >= n) return resolve(out)
            if (!keep || keep(c.value)) out.push(c.value.message)
            c.continue()
        }
        cursorReq.onerror = () => reject(cursorReq.error)
    })
}

// Hash before opening a transaction. Only immutable Blob bytes earn a binding.
// Other image shapes remain readable but pinned. (id:keep-foundation-retention)
async function digestOfImage(image) {
    if (typeof Blob === "undefined" || !(image instanceof Blob)) return null
    try {
        return hashBytes(new Uint8Array(await image.arrayBuffer()))
    } catch {
        return null
    }
}

function blobSize(blob) {
    if (blob == null) return 0
    if (typeof blob.size === "number") return blob.size
    if (typeof blob.byteLength === "number") return blob.byteLength
    if (typeof blob === "string") return blob.length
    return 0
}
