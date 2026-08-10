// The snap kind and the mint (id:kb-7, id:kb-7-snap).
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { writeSnap, toBlob, keepSnap } from "../../../assets/js/keep/kinds/snap.js"
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

describe("keepSnap: pure mint then put; hatch never awaits", () => {
    /** @type {ReturnType<typeof freshDoor>} */
    let door
    beforeEach(() => {
        door = freshDoor()
    })
    afterEach(async () => {
        await door.close()
    })

    test("mints one keep holding the image; name verifies", async () => {
        const work = "c".repeat(64)
        const source = "fd 100"
        const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        const hatch = {
            source,
            path: `data:image/png;base64,${png}`,
            diagnostics: [],
            keep: true,
        }
        const id = await keepSnap(hatch, { work_id: work, buffer_id: "buf" }, door)
        assert.ok(id)
        const bytes = await door.get(id)
        assert.equal(name(bytes), id)
        const v = read(bytes)
        assert.equal(v.kind, "snap")
        assert.equal(v.target, work)
        assert.equal(v.root, await door.root())
        assert.equal(v.source_id, name(source))
        // keepSnap mints with stamp() — a projectable ts lands in the bytes
        assert.equal(typeof v.ts.t, "number")
        assert.ok(Number.isFinite(v.ts.t))
        assert.equal(typeof v.ts.n, "number")
        assert.ok(Number.isFinite(v.ts.n))
        // Image beside the message under the message's id
        const img = await door.image(id)
        assert.ok(img, "image stored under message id")
        // Source blob under name(source)
        assert.equal(await door.source(name(source)), source)
    })

    test("two keeps during 'animation' — each is independent; pacer cannot drop the mint", async () => {
        // The mint is outside the pacer. Two fire-and-forget keepSnaps both land.
        const work = "d".repeat(64)
        const p1 = keepSnap(
            { source: "a", path: null, diagnostics: [] },
            { work_id: work, buffer_id: "1" },
            door,
        )
        const p2 = keepSnap(
            { source: "b", path: null, diagnostics: [] },
            { work_id: work, buffer_id: "2" },
            door,
        )
        const [id1, id2] = await Promise.all([p1, p2])
        assert.ok(id1)
        assert.ok(id2)
        assert.notEqual(id1, id2)
        const listed = await door.list(await door.root())
        assert.equal(listed.length, 2)
    })

    test("the word rides the hatch into the keep; a wordless one stays silent", async () => {
        const work = "b".repeat(64)
        const id = await keepSnap(
            { source: "fw 1\n", title: "a small step", diagnostics: [] },
            { work_id: work },
            door,
        )
        assert.equal(read(await door.get(id)).title, "a small step")

        // A hatch with no word — the record button's path — keeps nothing
        // where a word would be, rather than inventing one.
        const quiet = await keepSnap(
            { source: "fw 2\n", diagnostics: [] },
            { work_id: work },
            door,
        )
        assert.equal(read(await door.get(quiet)).title, null)

        // An empty word is no word: a keep never carries "" as a title.
        const blank = await keepSnap(
            { source: "fw 3\n", title: "", diagnostics: [] },
            { work_id: work },
            door,
        )
        assert.equal(read(await door.get(blank)).title, null)
    })

    test("without work_id the mint returns null and does not reject", async () => {
        // A drop is a fact (id:kc-c-wire) — said out loud, never an unhandled rejection.
        const id = await keepSnap(
            { source: "x", diagnostics: [] },
            { work_id: null },
            door,
        )
        assert.equal(id, null)
    })

    test("empty source is stored — source_id is not a tombstone", async () => {
        const work = "e".repeat(64)
        const id = await keepSnap(
            { source: "", diagnostics: [] },
            { work_id: work, buffer_id: "b" },
            door,
        )
        assert.ok(id)
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
        const id = await keepSnap(
            { source: "x", diagnostics: [] },
            { work_id: "f".repeat(64) },
            dead,
        )
        assert.equal(id, null)
    })
})
