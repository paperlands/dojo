// The journal door — engine never leaks (id:kb-6).
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
    createJournal,
    JOURNAL_VERBS,
} from "../../../assets/js/keep/journal.js"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { VERBS as SOURCE_VERBS } from "../../../assets/js/keep/verbs.js"
import { write, name } from "../../../assets/js/keep/entry.js"
import { createMemoryIDB } from "./idb_memory.mjs"

const fill = (b) => (arr) => {
    arr.fill(b)
    return arr
}

function snap(root, body, ts) {
    return write("snap", body, { root, target: "b".repeat(64), ts })
}

function freshDoor(opts = {}) {
    const { idb, KeyRange } = createMemoryIDB()
    let t = 1_700_000_000_000
    let c = 0
    const engine = createEngine({
        idb,
        KeyRange,
        dbName: `door-${Math.random().toString(36).slice(2)}`,
        random: opts.random ?? fill(0x33),
        stamp: () => {
            c += 1
            return { t: t + c, n: 0 }
        },
        blobCap: 1024,
    })
    return createJournal({ engine })
}

describe("journal door: public surface", () => {
    /** @type {ReturnType<typeof createJournal>} */
    let door
    beforeEach(() => {
        door = freshDoor()
    })
    afterEach(async () => {
        await door.close()
    })

    test("names the verbs; put derives the name; no id parameter", async () => {
        assert.deepEqual(
            [...JOURNAL_VERBS].sort(),
            ["genesis", "get", "image", "list", "local", "put", "share", "source"].sort(),
        )
        // One list — door re-exports verbs.js
        assert.equal(JOURNAL_VERBS, SOURCE_VERBS)
        const root = await door.root()
        const bytes = snap(root, { tag: 1 }, { t: 1, n: 0 })
        const id = await door.put(bytes)
        assert.equal(id, name(bytes))
        assert.equal(await door.get(id), bytes)
    })

    test("root() is the one way to ask who am I — always a promise", async () => {
        assert.equal(typeof door.root, "function")
        assert.equal(door.ensureRoot, undefined)
        const a = await door.root()
        const b = await door.root()
        assert.equal(a, b)
        assert.match(a, /^[0-9a-f]{64}$/)
        // genesis returns bytes; root() returns the name
        const bytes = await door.genesis()
        assert.equal(name(bytes), a)
    })

    test("list / local / share round-trip through the door", async () => {
        const root = await door.root()
        const a = snap(root, { tag: "a" }, { t: 100, n: 0 })
        const b = snap(root, { tag: "b" }, { t: 200, n: 0 })
        const idA = await door.put(a)
        await door.put(b)
        await door.share(idA, { at: 1, node: "n" })

        const listed = await door.list(root)
        assert.deepEqual(
            listed.map((x) => read(x).tag),
            ["b", "a"],
        )
        const held = await door.local(root)
        assert.deepEqual(
            held.map((x) => read(x).tag),
            ["b"],
        )
        // Cap rides the same wire — n bounds the fold (id:kb-8-page).
        assert.equal((await door.local(root, 1)).length, 1)
        assert.equal((await door.list(root, 1)).length, 1)
    })

    test("engine never leaks — return values are data, never IDB handles", async () => {
        const root = await door.root()
        const bytes = snap(root, { x: 1 }, { t: 1, n: 0 })
        const id = await door.put(bytes, { image: new Uint8Array([1, 2, 3]) })
        const img = await door.image(id)
        assert.equal(typeof id, "string")
        assert.ok(img == null || img instanceof Uint8Array || typeof img === "object")
        assert.equal(door.open, undefined)
        assert.equal(door.engine, undefined)
        assert.equal(typeof door.put, "function")
    })
})

describe("journal door: structural greps (id:kb-6 GREEN)", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const keepDir = join(here, "../../../assets/js/keep")

    test("the door source does not open the storage API or import the engine", () => {
        const src = readFileSync(join(keepDir, "journal.js"), "utf8")
        assert.equal(
            /\bindexedDB\b/.test(src),
            false,
            "door must not name the storage API",
        )
        assert.equal(
            /from\s+["']\.\/journal\.store\.js["']/.test(src),
            false,
            "door must not import the engine",
        )
    })

    test("only the store reaches the storage API; worker is its only keep/ importer", () => {
        const store = readFileSync(join(keepDir, "journal.store.js"), "utf8")
        const worker = readFileSync(join(keepDir, "journal.worker.js"), "utf8")
        assert.match(store, /\bindexedDB\b/)
        assert.match(worker, /from\s+["']\.\/journal\.store\.js["']/)
        for (const f of ["journal.js", "entry.js", "hash.js", "genesis.js", "upcast.js", "verbs.js"]) {
            const src = readFileSync(join(keepDir, f), "utf8")
            assert.equal(
                /from\s+["']\.\/journal\.store\.js["']/.test(src),
                false,
                `${f} must not import the store`,
            )
        }
    })

    test("production store has no test-double hooks", () => {
        const store = readFileSync(join(keepDir, "journal.store.js"), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "")
        // _open was the last production test hook (id:kb-vet4 37).
        for (const hook of ["_ready", "_commit", "_resolveLock", "_open"]) {
            assert.equal(
                store.includes(hook),
                false,
                `store must not name ${hook}`,
            )
        }
    })

    test("engine export is createEngine, not createJournal (id:kb-vet4 35)", () => {
        const store = readFileSync(join(keepDir, "journal.store.js"), "utf8")
        assert.match(store, /export function createEngine\b/)
        assert.equal(
            /export function createJournal\b/.test(store),
            false,
            "journal = the door; the store is the engine",
        )
        const worker = readFileSync(join(keepDir, "journal.worker.js"), "utf8")
        assert.match(worker, /createEngine/)
        assert.equal(/createJournal/.test(worker), false)
    })

    test("door and worker share one verbs module", () => {
        const door = readFileSync(join(keepDir, "journal.js"), "utf8")
        const worker = readFileSync(join(keepDir, "journal.worker.js"), "utf8")
        assert.match(door, /from\s+["']\.\/verbs\.js["']/)
        assert.match(worker, /from\s+["']\.\/verbs\.js["']/)
        // No second VERBS list in either file.
        assert.equal(/\bconst VERBS\b/.test(door), false)
        assert.equal(/\bconst VERBS\b/.test(worker), false)
    })
})

describe("journal door: dead worker (id:kb-vet4 30)", () => {
    test("onerror latches dead — later verbs refuse, never hang", async () => {
        /** @type {((ev: {message?: string}) => void) | null} */
        let fireError = null
        class FakeWorker {
            constructor() {
                fireError = (ev) => this.onerror?.(ev)
            }
            postMessage() {}
            terminate() {}
        }

        const door = createJournal({
            Worker: FakeWorker,
            workerUrl: "about:blank",
        })
        // In-flight warm (genesis) settles when the transport dies.
        fireError({ message: "script 404" })
        await assert.rejects(() => door.root(), /worker dead|script 404/)

        // Subsequent verbs reject at once — no hang (id:kb-vet4 30).
        await assert.rejects(() => door.put("x"), /journal: worker dead/)
        await assert.rejects(() => door.root(), /journal: worker dead/)
        await door.close()
    })
})

function read(bytes) {
    return JSON.parse(bytes)
}
