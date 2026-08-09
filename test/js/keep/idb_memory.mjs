// Focused in-memory IndexedDB for journal tests (zero-npm, node:test).
// Subset the keep journal needs: open/upgrade, keyPath + out-of-line stores,
// compound indexes over nested paths, put/get/delete/getAllKeys, openCursor
// with bound range and "prev"|"next".
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

// ── request ─────────────────────────────────────────────────────────

function request(run) {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null }
    // Microtask: await idbReq(...) works; transaction lifetime covers it.
    queueMicrotask(() => {
        try {
            r.result = run()
            r.onsuccess?.({ target: r })
        } catch (e) {
            r.error = e
            r.onerror?.({ target: r })
        }
    })
    return r
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

function cursor(entries, range, direction, onUpdate) {
    let list = range ? entries.filter((e) => range.includes(e.key)) : entries.slice()
    list.sort((a, b) => cmp(a.key, b.key))
    if (direction === "prev") list.reverse()
    let i = 0
    const r = { result: undefined, error: null, onsuccess: null, onerror: null }

    function emit() {
        queueMicrotask(() => {
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
        })
    }
    emit()
    return r
}

function wrapStore(store) {
    return {
        name: store.name,
        keyPath: store.keyPath,
        createIndex: (n, kp) => store.createIndex(n, kp),
        put: (value, key) => request(() => store.put(value, key)),
        get: (key) => request(() => store.get(key)),
        delete: (key) => request(() => store.delete(key)),
        getAllKeys: () => request(() => store.getAllKeys()),
        getAll: () => request(() => store.getAll()),
        openCursor: (range = null, direction = "next") =>
            cursor(store.entries(), range, direction, (pk, v) => store.update(pk, v)),
        index: (name) => ({
            openCursor: (range = null, direction = "next") =>
                cursor(store.indexEntries(name), range, direction, (pk, v) =>
                    store.update(pk, v),
                ),
            getAll: (range = null) =>
                request(() => {
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
        /** Serialize readwrite transactions — the genesis race fence. */
        this._writeChain = Promise.resolve()
    }

    createObjectStore(name, opts = {}) {
        const s = new Store(name, opts)
        this.stores.set(name, s)
        return wrapStore(s)
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
        let finished = false

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
                if (!names.includes(n)) throw new Error(`store ${n} not in transaction`)
                const s = state.stores.get(n)
                if (!s) throw new Error(`no store ${n}`)
                return wrapStore(s)
            },
            _commit() {
                if (finished) return
                finished = true
                queueMicrotask(() => {
                    tx.oncomplete?.()
                    tx._resolveLock?.()
                })
            },
            _resolveLock: null,
        }

        // Readwrite is serialised so concurrent genesis is find-or-create,
        // not a fork — the property real IDB transactions give us (id:kb-3-owner).
        if (mode === "readwrite") {
            let release
            const gate = new Promise((r) => {
                release = r
            })
            tx._resolveLock = release
            const prev = state._writeChain
            state._writeChain = prev.then(() => gate)
            tx._ready = prev
        } else {
            tx._ready = Promise.resolve()
            tx._resolveLock = null
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
                        const upgradeTx = {
                            objectStoreNames: conn.objectStoreNames,
                            objectStore: (n) => {
                                const s = state.stores.get(n)
                                if (!s) throw new Error(`no store ${n}`)
                                return wrapStore(s)
                            },
                        }
                        // createObjectStore goes on the connection during upgrade
                        // (and mutates shared state).
                        req.transaction = upgradeTx
                        req.result = conn
                        req.onupgradeneeded?.({
                            target: req,
                            oldVersion,
                            newVersion: version,
                        })
                        state.version = version
                        // Drain reproject cursors, then succeed.
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
            return request(() => undefined)
        },
    }

    return { idb, KeyRange: MemKeyRange }
}
