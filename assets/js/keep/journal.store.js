// The journal engine — durability behind the worker (id:kb-5, id:kc-c-journal).
//
// Four stores, four laws:
//   log    — messages, append-only, forever; id = name(message)
//   blobs  — images, keyed by the *message's* id; capped; shared only may go
//   source — program text, keyed by name(text); NEVER evicted (id:kb-source)
//   self   — one record: the genesis bytes; identity's home (id:kb-vet2-root)
//
// put takes bytes, not (id, bytes) — the name is not a choice (id:kc-law 3).
// local is 1|0, a number — a boolean index holds zero rows (measured).
// list/local use openCursor(range, "prev") — getAll is ascending (measured).
//
// Indexed columns are ONE projection of the message with ONE writer
// (id:kb-projection-fence). The rebuild IS the upgrade: bump the DB version
// and onupgradeneeded re-projects every row from its message.
//
// Eviction is a fold over reasons at put, never a stored verdict (id:kc-evict).
// At this step the fold has one term: shared blobs, oldest-first, under a cap.
// Unshared is the only copy and is never evicted. Re-derivability licenses
// the rest — not "the room surely holds the image" (id:kb-vet3 23).

import { stamp as ambientStamp } from "../utils/stamp.js"
import { name, read, unshaped } from "./entry.js"
import { genesisBytes } from "./genesis.js"

/** Schema version = projection version. Bump ⇒ re-project every row. */
export const DB_VERSION = 1

/** Default hard cap on the image blob store (bytes). Shared only may yield. */
export const DEFAULT_BLOB_CAP = 32 * 1024 * 1024

/**
 * A deliberate OVER-estimate of one image (measured ~17 KB, id:kc-evict), used
 * only to skip the fold when the cap provably cannot be reached. Over-estimating
 * is the safe direction: it folds too eagerly, never too late.
 */
export const NOMINAL_IMAGE = 64 * 1024

const SELF_KEY = "genesis"

/**
 * @param {object} [opts]
 * @param {IDBFactory} [opts.idb] - injectable; tests pass a memory factory
 * @param {string} [opts.dbName]
 * @param {number} [opts.version] - schema/projection version
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
    const dbName = opts.dbName ?? "dojo-keep"
    const version = opts.version ?? DB_VERSION
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
    // After versionchange, the held schema may be newer than this build.
    // Next open adopts it — never re-pins our own version (id:kb-vet4 31).
    let adoptHeldVersion = false

    function open() {
        if (closed) return Promise.reject(new Error("journal: closed"))
        if (dbp) return dbp
        dbp = new Promise((resolve, reject) => {
            // Versionless after versionchange; versioned on first open / our bump.
            const req = adoptHeldVersion
                ? idb.open(dbName)
                : idb.open(dbName, version)
            adoptHeldVersion = false
            req.onerror = () => reject(req.error)
            req.onupgradeneeded = () => {
                const d = req.result
                const tx = req.transaction
                ensureSchema(d)
                // Rebuild is the upgrade (id:kb-vet2-rebuild). Empty on first create.
                reproject(tx)
            }
            req.onsuccess = () => {
                const d = req.result
                // The upgrade waits for every older connection to close
                // (id:kb-vet3 22). Answer versionchange by closing so the
                // upgrade can proceed; the next verb re-opens versionless.
                d.onversionchange = () => {
                    d.close()
                    if (db === d) {
                        db = null
                        dbp = null
                    }
                    adoptHeldVersion = true
                }
                db = d
                resolve(d)
            }
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

    function whenCommitted(tx) {
        return new Promise((resolve, reject) => {
            let done = false
            const ok = () => {
                if (!done) {
                    done = true
                    resolve()
                }
            }
            const fail = (e) => {
                if (!done) {
                    done = true
                    reject(e)
                }
            }
            tx.oncomplete = ok
            tx.onerror = () => fail(tx.error)
            tx.onabort = () => fail(tx.error || new Error("journal: abort"))
        })
    }

    /**
     * put(bytes, {image?, source?}) → id
     * Hashes the message, projects columns, stores. Image under the message's
     * id; source under name(source). ONE tx over [log, blobs, source].
     * Idempotent on id: a second put of the same name preserves shared/local.
     *
     * Projection floor (id:kb-11-derive, client twin; id:kb-vet4 29): every
     * index column must project — root a string, ts finite. Refuse silent loss
     * in neither index. The genesis is not a put (id:kb-5-genesis-place).
     *
     * Clan history lands as local: 1. The permanent answer is a later share,
     * never a put option — put then share (id:kb-8, keep/shared.js accept).
     * There is no put(bytes, {shared}).
     */
    async function put(bytes, extras = {}) {
        if (typeof bytes !== "string") {
            throw new TypeError("journal.put: bytes must be the entry string")
        }
        const id = name(bytes)
        const value = read(bytes)

        // The floor covers every column the index holds, and it is the SAME
        // floor the clan applies (entry.unshaped ↔ Dojo.Keep.shaped?/1). A
        // keep below it is durable and invisible here, or shared-and-refused
        // there — one law, one seam, loud (id:kb-5-floor, id:kb-vet5 42).
        const missing = unshaped(value)
        if (missing) {
            throw new TypeError(
                `journal.put: ${missing} will never project — refuse silent loss`,
            )
        }

        const root = value.root
        const ts = value.ts

        await withStore(["log", "blobs", "source"], "readwrite", async (tx) => {
            const log = tx.objectStore("log")
            const blobs = tx.objectStore("blobs")
            const sources = tx.objectStore("source")

            const existing = await idbReq(log.get(id))
            if (!existing) {
                // local: 1 — kept local until a permanent answer (id:kc-c-journal).
                log.put({ id, message: bytes, root, ts, local: 1 })
            }
            // Existing row: leave shared/local alone. Message is content-addressed;
            // a second put of the same bytes is the same keep (idempotent union).

            if (extras.image != null) {
                const has = await idbReq(blobs.get(id))
                if (!has) blobs.put(extras.image, id)
            }
            // Store source unconditionally when handed — even "". source_id =
            // name("") must point at a row, not a tombstone (id:kb-source-absence).
            if (extras.source !== undefined) {
                const sid = name(extras.source)
                sources.put(extras.source, sid)
            }
        })

        // Eviction is a fold at put, never a stored verdict (id:kc-evict).
        // Only a NEW blob can push the store over: a message-only put cannot,
        // and most puts are message-only (clan history, re-puts, forks).
        if (extras.image != null) await evictIfNeeded()
        return id
    }

    async function get(id) {
        return withStore(["log"], "readonly", async (tx) => {
            const row = await idbReq(tx.objectStore("log").get(id))
            return row ? row.message : undefined
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
     * Kept local: not yet permanently answered. local is 1|0, a NUMBER —
     * a boolean index holds 0 rows (measured). Newest first, like list.
     *
     * n bounds the SHARED FOLD (id:kb-8-page): a kept-local entry inside the
     * newest n of the whole log is necessarily among the newest n kept-local,
     * so local(root, n) is exactly enough to fold list(root, n). The wire
     * ships local(root, PAGE) the same way — one page per pass (id:kb-9).
     */
    async function local(root, n = Infinity) {
        return withStore(["log"], "readonly", async (tx) => {
            const idx = tx.objectStore("log").index("by_root_local")
            const range = KeyRange.bound(
                [root, 1, -Infinity, -Infinity],
                [root, 1, Infinity, Infinity],
            )
            return cursorCollect(idx.openCursor(range, "prev"), n)
        })
    }

    /**
     * Clan's permanent answer beside the value. Flips local → 0.
     * shared = {at, node}. A permanent refusal is also an answer (id:kc-c-shared).
     */
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
            row.shared = { at: shared.at, node: shared.node }
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

    /**
     * Read-or-mint in ONE readwrite transaction over [self, log].
     * Two tabs: the engine serialises the tx; the second reads the first's
     * mint. A random body makes two tabs a fork without this — the transaction
     * is the race fence, not idempotence (id:kb-3-owner).
     *
     * The genesis is NOT a put, so the projection floor is not its law. It is
     * the one row unindexed on purpose (root: null — id:kb-5-genesis-place):
     * history never shows it and it never ships. Do not "fix" the asymmetry.
     */
    async function genesis() {
        return withStore(["self", "log"], "readwrite", async (tx) => {
            const self = tx.objectStore("self")
            const log = tx.objectStore("log")
            const held = await idbReq(self.get(SELF_KEY))
            if (held != null) return held

            const bytes = genesisBytes(random, stampFn())
            const id = name(bytes)
            const value = read(bytes)
            self.put(bytes, SELF_KEY)
            // Genesis also takes its log place in the same breath (id:kb-6).
            // root is null on the entry — the log's first entry cannot name a
            // log that does not yet exist. list(root) uses the *name* of this
            // entry as root for every later keep.
            log.put({
                id,
                message: bytes,
                root: value.root ?? null,
                ts: value.ts ?? null,
                local: 1,
            })
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
            // Cheap upper bound before the exact fold: if every blob were
            // NOMINAL_IMAGE we would still fit, so nothing can be over and the
            // per-blob reads are pure waste. Keys cost one request; sizes cost N.
            // An image larger than NOMINAL can only DELAY this fold, never skip
            // it: keys.length keeps growing, so the gate always opens.
            if (keys.length * NOMINAL_IMAGE <= blobCap) return
            /** @type {{id: string, size: number, t: number, n: number}[]} */
            const shared = []
            let total = 0
            for (const id of keys) {
                const blob = await idbReq(blobs.get(id))
                if (!blob) continue
                const size = blobSize(blob)
                total += size
                const row = await idbReq(log.get(id))
                // Only shared (local === 0) may be evicted. No shared fact ⇒ only copy.
                if (row && row.local === 0) {
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
        genesis,
        close,
        get blobCap() {
            return blobCap
        },
    }
}

// ── schema ──────────────────────────────────────────────────────────

function ensureSchema(db) {
    if (!db.objectStoreNames.contains("log")) {
        const log = db.createObjectStore("log", { keyPath: "id" })
        // Compound over nested keyPaths — accepted (measured, id:kc-c-journal).
        log.createIndex("by_root_ts", ["root", "ts.t", "ts.n"])
        log.createIndex("by_root_local", ["root", "local", "ts.t", "ts.n"])
    }
    if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs") // key = message id, out-of-line
    }
    if (!db.objectStoreNames.contains("source")) {
        db.createObjectStore("source") // key = name(source text)
    }
    if (!db.objectStoreNames.contains("self")) {
        db.createObjectStore("self") // key "genesis" → bytes
    }
}

/**
 * Rebuild every projection column from its message. shared is a fact beside
 * the value and is preserved; local is derived from it (id:kb-projection-fence).
 * Uses getAll so the rebuild finishes inside the upgrade transaction's
 * request window rather than a long cursor chain.
 */
function reproject(tx) {
    if (!tx.objectStoreNames.contains("log")) return
    const log = tx.objectStore("log")
    const all = log.getAll()
    all.onsuccess = () => {
        for (const row of all.result || []) {
            try {
                const value = read(row.message)
                row.root = value.root ?? null
                row.ts = value.ts ?? null
                // local is a projection of shared — one owner (id:kc-r-local-fence).
                row.local = row.shared ? 0 : 1
                log.put(row)
            } catch {
                // Unreadable message: leave the row; the reader verifies names.
            }
        }
    }
}

// ── IDB helpers ─────────────────────────────────────────────────────

function idbReq(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function cursorCollect(cursorReq, n) {
    const out = []
    return new Promise((resolve, reject) => {
        cursorReq.onsuccess = () => {
            const c = cursorReq.result
            if (!c || out.length >= n) return resolve(out)
            out.push(c.value.message)
            c.continue()
        }
        cursorReq.onerror = () => reject(cursorReq.error)
    })
}

function blobSize(blob) {
    if (blob == null) return 0
    if (typeof blob.size === "number") return blob.size
    if (typeof blob.byteLength === "number") return blob.byteLength
    if (typeof blob === "string") return blob.length
    return 0
}
