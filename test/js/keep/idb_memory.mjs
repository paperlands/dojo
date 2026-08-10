// Focused in-memory IndexedDB for journal tests (zero-npm, node:test).
// Subset the keep journal needs: open/upgrade, keyPath + out-of-line stores,
// compound indexes over nested paths, put/get/delete/getAllKeys, openCursor
// with bound range and "prev"|"next".
//
// Semantics that make prose into green (id:kb-5):
//   • A transaction auto-commits when its request count drains AT THE TASK
//     BOUNDARY — the browser's own lifetime. No _commit hook for production to
//     call. Microtask awaits survive, as they do in a browser; await anything
//     that yields to the task queue (fetch, timer, worker round-trip,
//     blob.arrayBuffer) and the next request throws TransactionInactiveError.
//   • Readwrite is serialised: the second writer's requests wait on the first
//     writer's completion (genesis race fence, id:kb-3-owner) — held inside
//     the fake, never exposed as tx._ready.
//
// Booleans are not valid keys (measured: boolean index holds 0 rows).
// Incomplete compound keys are sparse (absent from the index, not an error).

// ── ordering ────────────────────────────────────────────────────────

function cmp(a, b) {
    if (Object.is(a, b)) return 0
    const ta = rank(a), tb = rank(b)
    if (ta !== tb) return ta < tb ? -1 : 1
    if (Array.isArray(a)) {
        const n = Math.max(a.length, b.length)
        for (let i = 0; i < n; i++) {
            if (i >= a.length) return -1
            if (i >= b.length) return 1
            const c = cmp(a[i], b[i])
            if (c) return c
        }
        return 0
    }
    if (typeof a === "number") return a < b ? -1 : 1
    if (typeof a === "string") return a < b ? -1 : a > b ? 1 : 0
    return 0
}

function rank(v) {
    if (v === undefined || v === null) return 0
    if (typeof v === "number") return 1
    if (typeof v === "string") return 3
    if (Array.isArray(v)) return 5
    return 4
}

export class MemKeyRange {
    constructor(lower, upper, lowerOpen = false, upperOpen = false) {
        this.lower = lower
        this.upper = upper
        this.lowerOpen = lowerOpen
        this.upperOpen = upperOpen
    }
    static bound(lower, upper, lowerOpen = false, upperOpen = false) {
        return new MemKeyRange(lower, upper, lowerOpen, upperOpen)
    }
    includes(key) {
        if (this.lower !== undefined) {
            const c = cmp(key, this.lower)
            if (c < 0 || (c === 0 && this.lowerOpen)) return false
        }
        if (this.upper !== undefined) {
            const c = cmp(key, this.upper)
            if (c > 0 || (c === 0 && this.upperOpen)) return false
        }
        return true
    }
}

// ── path / clone ────────────────────────────────────────────────────

function pathGet(obj, path) {
    if (Array.isArray(path)) return path.map((p) => pathGet(obj, p))
    let cur = obj
    for (const p of String(path).split(".")) {
        if (cur == null) return undefined
        cur = cur[p]
    }
    return cur
}

function clone(v) {
    if (v == null || typeof v !== "object") return v
    if (typeof Blob !== "undefined" && v instanceof Blob) return v
    if (ArrayBuffer.isView(v)) return v
    if (typeof structuredClone === "function") return structuredClone(v)
    return JSON.parse(JSON.stringify(v))
}

function isIndexable(key) {
    if (typeof key === "boolean") return false // measured: boolean index = 0 rows
    // null is NOT a valid IDB key either. A fake that is MORE permissive than
    // the browser is how a false green is born, so refuse what the browser
    // refuses: this is what keeps the genesis (root: null) out of both indexes.
    if (key === undefined || key === null) return false
    if (typeof key === "number" && Number.isNaN(key)) return false
    if (Array.isArray(key)) return key.every(isIndexable)
    return true
}

function inactiveError() {
    const e = new Error("TransactionInactiveError")
    e.name = "TransactionInactiveError"
    return e
}

// ── store ───────────────────────────────────────────────────────────

class Store {
    constructor(name, { keyPath = null } = {}) {
        this.name = name
        this.keyPath = keyPath
        this.rows = new Map()
        /** @type {Map<string, {keyPath:any}>} */
        this.indexDefs = new Map()
    }

    createIndex(name, keyPath) {
        this.indexDefs.set(name, { keyPath })
        return { name, keyPath }
    }

    _keyOf(value, key) {
        if (this.keyPath) {
            const k = pathGet(value, this.keyPath)
            if (k === undefined) throw new Error(`keyPath ${this.keyPath} missing`)
            return k
        }
        if (key === undefined) throw new Error("out-of-line key required")
        return key
    }

    put(value, key) {
        const k = this._keyOf(value, key)
        this.rows.set(k, clone(value))
        return k
    }

    get(key) {
        const v = this.rows.get(key)
        return v === undefined ? undefined : clone(v)
    }

    delete(key) {
        this.rows.delete(key)
    }

    getAllKeys() {
        return [...this.rows.keys()]
    }

    getAll() {
        return [...this.rows.values()].map(clone)
    }

    indexEntries(indexName) {
        const def = this.indexDefs.get(indexName)
        if (!def) throw new Error(`no index ${indexName}`)
        const out = []
        for (const [pk, value] of this.rows) {
            const ik = pathGet(value, def.keyPath)
            if (!isIndexable(ik)) continue
            out.push({ key: ik, primaryKey: pk, value: clone(value) })
        }
        return out
    }

    entries() {
        return [...this.rows.entries()].map(([pk, value]) => ({
            key: pk,
            primaryKey: pk,
            value: clone(value),
        }))
    }

    update(pk, value) {
        this.rows.set(pk, clone(value))
    }
}

// ── request / cursor — lifetime owned by the transaction ────────────

/**
 * @param {object} life - { active, pending, onIdle, gate }
 *   gate: Promise that resolves when this writer may run (readwrite serialise)
 *   onIdle: called when pending hits 0 after a request — schedules auto-commit
 */
function request(life, run) {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null }
    const start = () => {
        if (!life.active) {
            queueMicrotask(() => {
                r.error = inactiveError()
                r.onerror?.({ target: r })
            })
            return
        }
        life.pending += 1
        queueMicrotask(() => {
            if (!life.active) {
                life.pending -= 1
                r.error = inactiveError()
                r.onerror?.({ target: r })
                if (life.pending === 0) life.onIdle()
                return
            }
            try {
                r.result = run()
                r.onsuccess?.({ target: r })
            } catch (e) {
                r.error = e
                r.onerror?.({ target: r })
            } finally {
                life.pending -= 1
                if (life.pending === 0) life.onIdle()
            }
        })
    }
    // Write lock: wait for the previous readwrite to finish, then run.
    if (life.gate) life.gate.then(start)
    else start()
    return r
}

function cursor(life, entries, range, direction, onUpdate) {
    let list = range ? entries.filter((e) => range.includes(e.key)) : entries.slice()
    list.sort((a, b) => cmp(a.key, b.key))
    if (direction === "prev") list.reverse()
    let i = 0
    const r = { result: undefined, error: null, onsuccess: null, onerror: null }

    function emit() {
        if (!life.active) {
            queueMicrotask(() => {
                r.error = inactiveError()
                r.onerror?.({ target: r })
            })
            return
        }
        life.pending += 1
        queueMicrotask(() => {
            if (!life.active) {
                life.pending -= 1
                r.error = inactiveError()
                r.onerror?.({ target: r })
                if (life.pending === 0) life.onIdle()
                return
            }
            try {
                if (i >= list.length) {
                    r.result = null
                } else {
                    const e = list[i]
                    r.result = {
                        key: e.key,
                        primaryKey: e.primaryKey,
                        value: e.value,
                        continue() {
                            i += 1
                            emit()
                        },
                        update(v) {
                            onUpdate?.(e.primaryKey, v)
                            e.value = v
                        },
                    }
                }
                r.onsuccess?.({ target: r })
            } catch (err) {
                r.error = err
                r.onerror?.({ target: r })
            } finally {
                life.pending -= 1
                if (life.pending === 0) life.onIdle()
            }
        })
    }

    if (life.gate) life.gate.then(emit)
    else emit()
    return r
}

function wrapStore(store, life) {
    return {
        name: store.name,
        keyPath: store.keyPath,
        createIndex: (n, kp) => store.createIndex(n, kp),
        put: (value, key) => request(life, () => store.put(value, key)),
        get: (key) => request(life, () => store.get(key)),
        delete: (key) => request(life, () => store.delete(key)),
        getAllKeys: () => request(life, () => store.getAllKeys()),
        getAll: () => request(life, () => store.getAll()),
        openCursor: (range = null, direction = "next") =>
            cursor(life, store.entries(), range, direction, (pk, v) =>
                store.update(pk, v),
            ),
        index: (name) => ({
            openCursor: (range = null, direction = "next") =>
                cursor(life, store.indexEntries(name), range, direction, (pk, v) =>
                    store.update(pk, v),
                ),
            getAll: (range = null) =>
                request(life, () => {
                    let es = store.indexEntries(name)
                    if (range) es = es.filter((e) => range.includes(e.key))
                    es.sort((a, b) => cmp(a.key, b.key))
                    return es.map((e) => e.value)
                }),
        }),
    }
}

// ── database / factory ──────────────────────────────────────────────

/**
 * Shared durable state for a named database. Connections are thin handles
 * over this — close() closes one connection, not the store (real IDB).
 */
class DatabaseState {
    constructor(name) {
        this.name = name
        this.version = 0
        /** @type {Map<string, Store>} */
        this.stores = new Map()
        /** @type {Set<Connection>} */
        this.connections = new Set()
        /** Serialize readwrite: next writer's gate waits on this. */
        this._writeChain = Promise.resolve()
    }

    createObjectStore(name, opts = {}) {
        const s = new Store(name, opts)
        this.stores.set(name, s)
        // Upgrade path has no transaction lifetime yet — bare wrap.
        return wrapStore(s, { active: true, pending: 0, onIdle: () => {}, gate: null })
    }
}

class Connection {
    constructor(state) {
        this._state = state
        this.name = state.name
        this.version = state.version
        this.onversionchange = null
        this._closed = false
        state.connections.add(this)
        const self = this
        this.objectStoreNames = {
            contains: (n) => self._state.stores.has(n),
            *[Symbol.iterator]() {
                yield* self._state.stores.keys()
            },
        }
    }

    createObjectStore(name, opts = {}) {
        return this._state.createObjectStore(name, opts)
    }

    transaction(storeNames, mode = "readonly") {
        if (this._closed) throw new Error("DB closed")
        const names = Array.isArray(storeNames) ? storeNames : [storeNames]
        const state = this._state

        /** @type {{ active: boolean, pending: number, onIdle: () => void, gate: Promise<void> | null }} */
        const life = {
            active: true,
            pending: 0,
            onIdle: () => {},
            gate: null,
        }

        let finished = false
        let releaseLock = null

        if (mode === "readwrite") {
            // This writer's requests wait on the previous writer.
            const prev = state._writeChain
            life.gate = prev
            state._writeChain = new Promise((r) => {
                releaseLock = r
            })
        }

        const tx = {
            mode,
            error: null,
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStoreNames: {
                contains: (n) => names.includes(n) && state.stores.has(n),
            },
            objectStore(n) {
                if (!life.active) throw inactiveError()
                if (!names.includes(n)) throw new Error(`store ${n} not in transaction`)
                const s = state.stores.get(n)
                if (!s) throw new Error(`no store ${n}`)
                return wrapStore(s, life)
            },
            abort() {
                finish("abort")
            },
        }

        function finish(how) {
            if (finished) return
            finished = true
            life.active = false
            if (how === "complete") {
                queueMicrotask(() => tx.oncomplete?.())
            } else if (how === "abort") {
                tx.error = tx.error || new Error("journal: abort")
                queueMicrotask(() => tx.onabort?.())
            }
            // Release the write lock so the next writer may run.
            if (releaseLock) {
                releaseLock()
                releaseLock = null
            }
        }

        // Auto-commit AT THE TASK BOUNDARY — the browser's own model.
        // A real transaction lives through the whole microtask drain and dies
        // when control returns to the event loop. So the check is a macrotask:
        // every `await` that stays in the microtask queue survives (as it does
        // in a browser), and everything id:kb-5 actually names — a fetch, a
        // timer, a worker round-trip, blob.arrayBuffer() — yields to the task
        // queue and finds the transaction gone.
        //
        // A microtask-granular check was measurably STRICTER than the browser:
        // one `await Promise.resolve()` between two requests killed the tx here
        // and survives there. A green a harmless await can fail is a bad green.
        life.onIdle = () => {
            if (finished) return
            setTimeout(() => {
                if (finished || life.pending > 0) return
                finish("complete")
            }, 0)
        }

        return tx
    }

    close() {
        this._closed = true
        this._state.connections.delete(this)
    }
}

/**
 * Isolated memory IDB factory — one per test journal.
 * @returns {{ idb: object, KeyRange: typeof MemKeyRange }}
 */
export function createMemoryIDB() {
    /** @type {Map<string, DatabaseState>} */
    const registry = new Map()

    const idb = {
        open(name, version = 1) {
            const req = {
                result: undefined,
                error: null,
                transaction: null,
                onsuccess: null,
                onerror: null,
                onupgradeneeded: null,
                onblocked: null,
            }
            queueMicrotask(() => {
                try {
                    let state = registry.get(name)
                    if (!state) {
                        state = new DatabaseState(name)
                        registry.set(name, state)
                    }
                    const oldVersion = state.version

                    if (version > oldVersion) {
                        // Ask other connections to close (id:kb-vet3 22).
                        for (const c of [...state.connections]) {
                            c.onversionchange?.()
                        }
                        const conn = new Connection(state)
                        conn.version = version
                        const upgradeLife = {
                            active: true,
                            pending: 0,
                            onIdle: () => {},
                            gate: null,
                        }
                        const upgradeTx = {
                            objectStoreNames: conn.objectStoreNames,
                            objectStore: (n) => {
                                const s = state.stores.get(n)
                                if (!s) throw new Error(`no store ${n}`)
                                return wrapStore(s, upgradeLife)
                            },
                        }
                        req.transaction = upgradeTx
                        req.result = conn
                        req.onupgradeneeded?.({
                            target: req,
                            oldVersion,
                            newVersion: version,
                        })
                        state.version = version
                        // Drain reproject getAll, then succeed.
                        queueMicrotask(() => {
                            queueMicrotask(() => {
                                req.onsuccess?.({ target: req })
                            })
                        })
                    } else {
                        const conn = new Connection(state)
                        conn.version = state.version
                        req.result = conn
                        queueMicrotask(() => req.onsuccess?.({ target: req }))
                    }
                } catch (e) {
                    req.error = e
                    req.onerror?.({ target: req })
                }
            })
            return req
        },
        deleteDatabase(name) {
            registry.delete(name)
            const r = { result: undefined, error: null, onsuccess: null, onerror: null }
            queueMicrotask(() => r.onsuccess?.({ target: r }))
            return r
        },
    }

    return { idb, KeyRange: MemKeyRange }
}
