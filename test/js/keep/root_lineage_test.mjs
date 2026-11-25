// M3: local hand lineage indexes our created Keeps across recovery.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { createJournal } from "../../../assets/js/keep/journal.js"
import { createWire, KEEP_EVENT } from "../../../assets/js/keep/wire.js"
import { write, name } from "../../../assets/js/keep/entry.js"
import { createMemoryIDB } from "./idb_memory.mjs"

const fill = (b) => (arr) => {
    arr.fill(b)
    return arr
}
const snap = (root, tag, ts) => write("snap", { tag }, { root, target: "b".repeat(64), ts })
const PRIOR = "genesis-prior:"

function fixture() {
    const { idb, KeyRange } = createMemoryIDB()
    const dbName = `lineage-${Math.random().toString(36).slice(2)}`
    let n = 0
    const open = (opts = {}) => createEngine({
        idb,
        KeyRange,
        dbName,
        random: fill(0x55),
        stamp: () => ({ t: 1_700_000_000_000 + ++n, n: 0 }),
        blobCap: 1024,
        ...opts,
    })
    return { idb, dbName, open }
}

async function selfWrite(idb, dbName, key, value) {
    const db = await new Promise((resolve, reject) => {
        const request = idb.open(dbName)
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
        tx.objectStore("self").put(value, key)
        await done
    } finally {
        db.close()
    }
}

async function selfDelete(idb, dbName, key) {
    const db = await new Promise((resolve, reject) => {
        const request = idb.open(dbName)
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
        tx.objectStore("self").delete(key)
        await done
    } finally {
        db.close()
    }
}

function hook(replies = {}) {
    const log = []
    return {
        log,
        pushEvent: async (event, payload) => {
            log.push({ event, payload })
            return replies[event]?.(payload) ?? { id: payload.id, at: 1, node: "n" }
        },
    }
}

describe("M3 local hand lineage", () => {
    test("active first, verified priors sorted, deduped; malformed priors skipped", async () => {
        const f = fixture()
        let engine = f.open()
        const r1Birth = await engine.genesis()
        const r1 = name(r1Birth)
        await selfDelete(f.idb, f.dbName, "signing-key")
        const second = await engine.newHand({ expectedRoot: r1 })
        const r2 = second.root
        await selfDelete(f.idb, f.dbName, "signing-key")
        const third = await engine.newHand({ expectedRoot: r2 })
        const r3 = third.root
        const current = await engine.genesis()
        await engine.close()

        await selfWrite(f.idb, f.dbName, PRIOR + r3, current) // duplicate active
        await selfWrite(f.idb, f.dbName, PRIOR + "f".repeat(64), "not genesis")

        const cold = f.open({ crypto: { get subtle() { throw new Error("crypto touched") } } })
        try {
            assert.deepEqual(await cold.roots(), { active: r3, prior: [r1, r2].sort() })
        } finally {
            await cold.close()
        }
    })

    test("no lineage is [] and roots reads without a signing key", async () => {
        const f = fixture()
        const engine = f.open()
        try {
            assert.deepEqual(await engine.roots(), { active: null, prior: [] })
            const root = name(await engine.genesis())
            await selfDelete(f.idb, f.dbName, "signing-key")
            assert.deepEqual(await engine.roots(), { active: root, prior: [] })
        } finally {
            await engine.close()
        }
    })

    test("old-root pending ships after recovery/restart; foreign proof does not", async () => {
        const f = fixture()
        let engine = f.open()
        let door = createJournal({ engine })
        const r1 = await door.root()
        const old = snap(r1, "old", { t: 1, n: 0 })
        const oldId = await door.put(old, { authored: true })

        const foreign = fixture()
        let foreignEngine = foreign.open()
        let foreignDoor = createJournal({ engine: foreignEngine })
        const r3 = await foreignDoor.root()
        const other = snap(r3, "foreign", { t: 2, n: 0 })
        const otherId = await foreignDoor.put(other, { authored: true })
        const otherProof = await foreignDoor.proof(other)
        await door.put(other, { proof: otherProof })
        await foreignDoor.close()
        await foreignEngine.close()

        await selfDelete(f.idb, f.dbName, "signing-key")
        const next = await door.newHand({ expectedRoot: r1 })
        const r2 = next.root
        await door.close()

        engine = f.open()
        door = createJournal({ engine })
        try {
            assert.deepEqual(await door.roots(), { active: r2, prior: [r1] })
            const h = hook()
            await createWire({ hook: h, door, page: 10 }).announce()
            const ids = h.log.filter((e) => e.event === KEEP_EVENT).map((e) => e.payload.id)
            assert.deepEqual(ids, [oldId])
            assert.equal(ids.includes(otherId), false, "foreign proof is not ours")
        } finally {
            await door.close()
        }
    })

    test("one page per root; a failing root does not block a healthy root", async () => {
        const roots = ["a".repeat(64), "b".repeat(64)]
        const calls = []
        const row = snap(roots[1], "healthy", { t: 1, n: 0 })
        const door = {
            root: async () => roots[0],
            roots: async () => ({ active: roots[0], prior: [roots[1]] }),
            local: async (root) => {
                calls.push(root)
                if (root === roots[0]) throw new Error("root read failed")
                return [row]
            },
            proof: async () => ({ v: 1, genesis: "c".repeat(64), signature: "ab".repeat(64) }),
            share: async () => true,
        }
        const h = hook()
        await createWire({ hook: h, door, page: 10 }).announce()
        assert.deepEqual(calls, roots)
        assert.deepEqual(
            h.log.filter((e) => e.event === KEEP_EVENT).map((e) => e.payload.id),
            [name(row)],
        )
    })
})

test("roots absence falls back to root; a roots read failure does not", async () => {
    const root = "a".repeat(64)
    const row = snap(root, "legacy", { t: 1, n: 0 })
    const proof = { v: 1, genesis: "c".repeat(64), signature: "ab".repeat(128) }
    let rootReads = 0
    const legacy = {
        root: async () => { rootReads += 1; return root },
        local: async () => [row],
        proof: async () => proof,
        share: async () => true,
    }
    const h = hook()
    await createWire({ hook: h, door: legacy, page: 10 }).announce()
    assert.equal(rootReads, 1)
    assert.deepEqual(h.log.map((e) => e.payload.id), [name(row)])

    let fallback = false
    const broken = {
        root: async () => { fallback = true; return root },
        roots: async () => { throw new Error("lineage read failed") },
        local: async () => [row],
        proof: async () => proof,
        share: async () => true,
    }
    const h2 = hook()
    await createWire({ hook: h2, door: broken, page: 10 }).announce()
    assert.equal(fallback, false, "real roots read error is not a silent root fallback")
    assert.deepEqual(h2.log, [])
})

test("empty lineage awaiting does not discard a demand armed mid-read", async () => {
    let reads = 0
    let release
    const pendingRoots = new Promise((resolve) => { release = resolve })
    const root = "a".repeat(64)
    const row = snap(root, "late", { t: 1, n: 0 })
    const proof = { v: 1, genesis: "c".repeat(64), signature: "ab".repeat(128) }
    const door = {
        roots: async () => {
            reads += 1
            return reads === 1 ? pendingRoots : { active: root, prior: [] }
        },
        local: async () => [row],
        proof: async () => proof,
        share: async () => true,
    }
    const h = hook()
    const wire = createWire({ hook: h, door, page: 10 })
    const first = wire.announce()
    await Promise.resolve()
    const armed = wire.announce()
    release({ active: null, prior: [] })
    await Promise.all([first, armed])
    assert.equal(reads, 2, "the armed demand reads lineage again")
    assert.deepEqual(h.log.map((e) => e.payload.id), [name(row)])
})
