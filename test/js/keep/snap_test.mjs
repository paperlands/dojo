// The snap kind and the mint (id:kb-7, id:kb-7-snap).
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
    writeSnap,
    toBlob,
    mintSnap,
} from "../../../assets/js/keep/kinds/snap.js"
import { createJournal as createDoor } from "../../../assets/js/keep/journal.js"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { read, name, V } from "../../../assets/js/keep/entry.js"
import { createMemoryIDB } from "./idb_memory.mjs"

const fill = (b) => (arr) => {
    arr.fill(b)
    return arr
}

function freshDoor() {
    const { idb, KeyRange } = createMemoryIDB()
    let c = 0
    const engine = createEngine({
        idb,
        KeyRange,
        dbName: `snap-${Math.random().toString(36).slice(2)}`,
        random: fill(0x55),
        stamp: () => ({ t: 1_700_000_000_000 + ++c, n: 0 }),
        blobCap: 1024 * 1024,
    })
    return createDoor({ engine })
}

describe("writeSnap: the first kind", () => {
    test("target is work_id; body is source_id + diagnostics + buffer_id", () => {
        const root = "a".repeat(64)
        const work = "b".repeat(64)
        const source = "to forward 100\n"
        const bytes = writeSnap({
            root,
            work_id: work,
            source,
            diagnostics: [{ code: "x" }],
            buffer_id: "tab1",
            ts: { t: 1, n: 0 },
        })
        const v = read(bytes)
        assert.equal(v.v, V)
        assert.equal(v.kind, "snap")
        assert.equal(v.root, root)
        assert.equal(v.target, work)
        assert.equal(v.source_id, name(source))
        assert.deepEqual(v.diagnostics, [{ code: "x" }])
        assert.equal(v.buffer_id, "tab1")
        // commands, state, message, attend — folds, not fields
        assert.equal(v.commands, undefined)
        assert.equal(v.state, undefined)
        assert.equal(v.message, undefined)
        assert.equal(v.attend, undefined)
        // source text is NOT inline — it is a blob
        assert.equal(v.source, undefined)
        // the child said nothing this time, and absence is a value, not a
        // missing key: five frozen fields and a body of FIXED shape (id:kc-r-absence)
        assert.equal(v.title, null)
        assert.ok("title" in v)
    })

    test("the child's word is kept — no fold could recover it", () => {
        const root = "a".repeat(64)
        const work = "b".repeat(64)
        const bytes = writeSnap({
            root,
            work_id: work,
            source: "fw 10\n",
            title: "the first hexagon",
            ts: { t: 2, n: 0 },
        })
        assert.equal(read(bytes).title, "the first hexagon")

        // The word is part of the message, so it is part of the name: two
        // moments of the same drawing said differently are two keeps.
        const silent = writeSnap({
            root,
            work_id: work,
            source: "fw 10\n",
            ts: { t: 2, n: 0 },
        })
        assert.notEqual(name(bytes), name(silent))
    })

    test("prev mints only on a fork — absent on a straight keep", () => {
        const root = "a".repeat(64)
        const work = "b".repeat(64)
        const parent = "c".repeat(64)
        const straight = writeSnap({
            root,
            work_id: work,
            source: "fw 1\n",
            ts: { t: 1, n: 0 },
        })
        assert.equal(read(straight).prev, undefined, "no parent key on a straight keep")

        const fork = writeSnap({
            root,
            work_id: work,
            source: "fw 2\n",
            prev: parent,
            ts: { t: 2, n: 0 },
        })
        assert.equal(read(fork).prev, parent)

        // Empty / null prev is absence, not a field.
        const blank = writeSnap({
            root,
            work_id: work,
            source: "fw 3\n",
            prev: null,
            ts: { t: 3, n: 0 },
        })
        assert.equal(read(blank).prev, undefined)
    })

    test("message stays small — source is a pointer, not inlined (id:kc-evict)", () => {
        // [⏚] The number this step exists to measure. Source as blob → ~300 B.
        // Inlining source + commands measured 4004 B; that design is refused.
        const source = "to forward 100\nrt 90\nto forward 50\n".repeat(20)
        const bytes = writeSnap({
            root: "a".repeat(64),
            work_id: "b".repeat(64),
            source,
            diagnostics: [],
            buffer_id: "x",
            ts: { t: 1, n: 0 },
        })
        // Catalog + source_id (64) + empty diagnostics + buffer_id — hundreds, not thousands.
        assert.ok(
            bytes.length < 500,
            `message is ${bytes.length} B; source-as-blob should keep it under 500`,
        )
        // And the source itself is far larger than the message that points at it.
        assert.ok(source.length > bytes.length)
    })
    test("ts is required — no ambient default in the pure write (id:kc-parts)", () => {
        // Gesture draws, write requires: same tell genesis refused for half-ambient.
        const base = {
            root: "a".repeat(64),
            work_id: "b".repeat(64),
            source: "fw 1\n",
        }
        assert.throws(() => writeSnap(base), TypeError)
        assert.throws(() => writeSnap({ ...base, ts: null }), TypeError)
        assert.throws(() => writeSnap({ ...base, ts: {} }), TypeError)
        assert.throws(() => writeSnap({ ...base, ts: { t: 1 } }), TypeError)
        assert.throws(() => writeSnap({ ...base, ts: { t: "1", n: 0 } }), TypeError)
        // Fixed pair → fixed bytes: a test need not re-read ts out of the wire.
        const fixed = { t: 9, n: 1 }
        assert.deepEqual(read(writeSnap({ ...base, ts: fixed })).ts, fixed)
    })

    test("signature_of — build by keys you have; empty → omit (id:kc-sign)", () => {
        const root = "a".repeat(64)
        const work = "b".repeat(64)
        const peerRoot = "c".repeat(64)

        // Self-only.
        const linear = writeSnap({
            root,
            work_id: work,
            source: "fw 1\n",
            name: "bob",
            ts: { t: 1, n: 0 },
        })
        assert.deepEqual(read(linear).signature_of, { [root]: "bob" })
        assert.equal(read(linear).target, work)

        // Both — neither side silently drops the other.
        const fork = writeSnap({
            root,
            work_id: work,
            source: "fw 2\n",
            name: "bob",
            peer: { root: peerRoot, name: "alice" },
            prev: "d".repeat(64),
            ts: { t: 2, n: 0 },
        })
        const v = read(fork)
        assert.deepEqual(v.signature_of, { [peerRoot]: "alice", [root]: "bob" })
        assert.equal(v.prev, "d".repeat(64))
        assert.equal(v.target, work)

        // Peer-only — missing self letters must not erase the peer.
        const peerOnly = writeSnap({
            root,
            work_id: work,
            source: "fw 3\n",
            peer: { root: peerRoot, name: "alice" },
            ts: { t: 3, n: 0 },
        })
        assert.deepEqual(read(peerOnly).signature_of, { [peerRoot]: "alice" })
        assert.equal(Object.hasOwn(read(peerOnly).signature_of, root), false)

        // No letters → no signature_of key (absence, not null).
        const quiet = writeSnap({
            root,
            work_id: work,
            source: "fw 4\n",
            ts: { t: 4, n: 0 },
        })
        assert.equal(Object.hasOwn(read(quiet), "signature_of"), false)
    })

})

describe("toBlob: data URL dies at the mint (id:kb-vet2-image)", () => {
    test("decodes a PNG data URL to a Blob once", () => {
        // 1×1 PNG
        const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        const dataUrl = `data:image/png;base64,${png}`
        const blob = toBlob(dataUrl)
        assert.ok(blob instanceof Blob)
        assert.equal(blob.type, "image/png")
        assert.ok(blob.size > 0)
        // Pass-through for already-Blob
        assert.equal(toBlob(blob), blob)
        assert.equal(toBlob(null), null)
    })
})

const PNG_1PX =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

describe("mintSnap: one put, photograph or nothing", () => {
    /** @type {ReturnType<typeof freshDoor>} */
    let door
    beforeEach(() => {
        door = freshDoor()
    })
    afterEach(async () => {
        await door.close()
    })

    const mint = (ask, reflection, ids) =>
        mintSnap(ask, reflection, ids, door, PNG_1PX)

    test("mints one keep from word + source + picture; name verifies", async () => {
        const work = "c".repeat(64)
        const source = "fd 100"
        const id = await mint(
            { title: "a small step" },
            { source, diagnostics: [] },
            { work_id: work, buffer_id: "buf" },
        )
        assert.ok(id)
        const bytes = await door.get(id)
        assert.equal(name(bytes), id)
        const v = read(bytes)
        assert.equal(v.kind, "snap")
        assert.equal(v.target, work)
        assert.equal(v.root, await door.root())
        assert.equal(v.source_id, name(source))
        assert.ok(Number.isFinite(v.ts.t))
        assert.ok(Number.isFinite(v.ts.n))
        assert.equal(await door.source(name(source)), source)
        assert.ok(await door.image(id), "picture landed in the same put")
    })

    test("no picture — not kept", async () => {
        const minted = await mintSnap(
            { title: "kept in the dark" },
            { source: "fw 1\n", diagnostics: [] },
            { work_id: "a".repeat(64) },
            door,
            null,
        )
        assert.equal(minted, null)
        assert.equal((await door.list(await door.root())).length, 0)
    })

    test("the reflection's wounds ride into the body (D022)", async () => {
        const wounds = [{ line: 2, message: "unknown verb" }]
        const minted = await mint(
            { title: "hurt" },
            { source: "fw 1\nzz 2\n", diagnostics: wounds },
            { work_id: "a".repeat(64) },
        )
        assert.deepEqual(read(await door.get(minted)).diagnostics, wounds)
    })

    test("prev rides the ASK, not the ids — the fork is the child's gesture", async () => {
        const parent = "9".repeat(64)
        const work = "b".repeat(64)
        const forked = await mint(
            { title: "forked", prev: parent },
            { source: "fw 1\n", diagnostics: [] },
            { work_id: work },
        )
        assert.equal(read(await door.get(forked)).prev, parent)

        // Absent, not null, on a straight keep (id:kc-r-absence).
        const straight = await mint(
            { title: "straight" },
            { source: "fw 2\n", diagnostics: [] },
            { work_id: work },
        )
        assert.equal(Object.hasOwn(read(await door.get(straight)), "prev"), false)
    })

    test("two keeps in one breath — each independent; nothing can pace a mint away", async () => {
        const work = "d".repeat(64)
        const [a, b] = await Promise.all([
            mint({ title: "one" }, { source: "a" }, { work_id: work }),
            mint({ title: "two" }, { source: "b" }, { work_id: work }),
        ])
        assert.notEqual(a, b)
        assert.equal((await door.list(await door.root())).length, 2)
    })

    test("a wordless ask stays silent; an empty word is no word", async () => {
        const work = "b".repeat(64)
        const quiet = await mint({}, { source: "fw 2\n" }, { work_id: work })
        assert.equal(read(await door.get(quiet)).title, null)
        const blank = await mint(
            { title: "" },
            { source: "fw 3\n" },
            { work_id: work },
        )
        assert.equal(read(await door.get(blank)).title, null)
    })

    test("without work_id the mint is an origin keep", async () => {
        const id = await mintSnap(
            { title: "x" },
            { source: "x" },
            { work_id: null },
            door,
            PNG_1PX,
        )
        assert.ok(id)
        const v = read(await door.get(id))
        assert.equal(v.target, undefined)
        assert.equal(name(await door.get(id)), id)
    })

    test("empty source is stored — source_id is not a tombstone", async () => {
        const minted = await mint(
            { title: "blank" },
            { source: "" },
            { work_id: "e".repeat(64), buffer_id: "b" },
        )
        assert.ok(minted)
        assert.equal(await door.source(name("")), "")
    })

    test("a dead door yields null, never a rejection", async () => {
        const dead = {
            root: async () => {
                throw new Error("worker gone")
            },
            put: async () => {
                throw new Error("unreachable")
            },
        }
        assert.equal(
            await mintSnap({ title: "x" }, { source: "x" }, { work_id: "f".repeat(64) }, dead, PNG_1PX),
            null,
        )
    })
})
