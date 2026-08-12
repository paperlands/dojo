// The snap kind and the mint (id:kb-7, id:kb-7-snap).
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
    writeSnap,
    toBlob,
    mintSnap,
    attachImage,
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

describe("mintSnap: the word is the cause (id:kj-answer)", () => {
    /** @type {ReturnType<typeof freshDoor>} */
    let door
    beforeEach(() => {
        door = freshDoor()
    })
    afterEach(async () => {
        await door.close()
    })

    test("mints one keep from word + source; name verifies", async () => {
        const work = "c".repeat(64)
        const source = "fd 100"
        const minted = await mintSnap(
            { title: "a small step" },
            { source, diagnostics: [] },
            { work_id: work, buffer_id: "buf" },
            door,
        )
        assert.ok(minted)
        const bytes = await door.get(minted.id)
        assert.equal(name(bytes), minted.id)
        assert.equal(minted.bytes, bytes, "the bytes come back for the attach")
        const v = read(bytes)
        assert.equal(v.kind, "snap")
        assert.equal(v.target, work)
        assert.equal(v.root, await door.root())
        assert.equal(v.source_id, name(source))
        // mintSnap draws stamp() — a projectable ts lands in the bytes
        assert.ok(Number.isFinite(v.ts.t))
        assert.ok(Number.isFinite(v.ts.n))
        // Source blob under name(source)
        assert.equal(await door.source(name(source)), source)
    })

    test("NO GPU ON THIS PATH — the keep exists with no picture at all", async () => {
        // The frame clock may never fire (turtling/hatch.js: !present, mine ===
        // false, a canvas that never changes). It can cost a picture; it must
        // never cost the child's word.
        const minted = await mintSnap(
            { title: "kept in the dark" },
            { source: "fw 1\n", diagnostics: [] },
            { work_id: "a".repeat(64) },
            door,
        )
        assert.ok(minted, "a pictureless keep is a keep")
        assert.equal(read(await door.get(minted.id)).title, "kept in the dark")
        assert.equal(await door.image(minted.id), undefined)
    })

    test("the reflection's wounds ride into the body (D022)", async () => {
        const wounds = [{ line: 2, message: "unknown verb" }]
        const minted = await mintSnap(
            { title: "hurt" },
            { source: "fw 1\nzz 2\n", diagnostics: wounds },
            { work_id: "a".repeat(64) },
            door,
        )
        assert.deepEqual(read(await door.get(minted.id)).diagnostics, wounds)
    })

    test("prev rides the ASK, not the ids — the fork is the child's gesture", async () => {
        const parent = "9".repeat(64)
        const work = "b".repeat(64)
        const forked = await mintSnap(
            { title: "forked", prev: parent },
            { source: "fw 1\n", diagnostics: [] },
            { work_id: work },
            door,
        )
        assert.equal(read(await door.get(forked.id)).prev, parent)

        // Absent, not null, on a straight keep (id:kc-r-absence).
        const straight = await mintSnap(
            { title: "straight" },
            { source: "fw 2\n", diagnostics: [] },
            { work_id: work },
            door,
        )
        assert.equal(Object.hasOwn(read(await door.get(straight.id)), "prev"), false)
    })

    test("two keeps in one breath — each independent; nothing can pace a mint away", async () => {
        const work = "d".repeat(64)
        const [a, b] = await Promise.all([
            mintSnap({ title: "one" }, { source: "a" }, { work_id: work }, door),
            mintSnap({ title: "two" }, { source: "b" }, { work_id: work }, door),
        ])
        assert.notEqual(a.id, b.id)
        assert.equal((await door.list(await door.root())).length, 2)
    })

    test("a wordless ask stays silent; an empty word is no word", async () => {
        const work = "b".repeat(64)
        const quiet = await mintSnap({}, { source: "fw 2\n" }, { work_id: work }, door)
        assert.equal(read(await door.get(quiet.id)).title, null)
        const blank = await mintSnap(
            { title: "" },
            { source: "fw 3\n" },
            { work_id: work },
            door,
        )
        assert.equal(read(await door.get(blank.id)).title, null)
    })

    test("without work_id the mint returns null and does not reject", async () => {
        // A drop is a fact (id:kc-c-wire) — said out loud, never an unhandled rejection.
        assert.equal(
            await mintSnap({ title: "x" }, { source: "x" }, { work_id: null }, door),
            null,
        )
    })

    test("empty source is stored — source_id is not a tombstone", async () => {
        const minted = await mintSnap(
            { title: "blank" },
            { source: "" },
            { work_id: "e".repeat(64), buffer_id: "b" },
            door,
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
            await mintSnap({ title: "x" }, { source: "x" }, { work_id: "f".repeat(64) }, dead),
            null,
        )
    })
})

describe("attachImage: the picture is the reveal (id:kj-answer-attach)", () => {
    /** @type {ReturnType<typeof freshDoor>} */
    let door
    beforeEach(() => {
        door = freshDoor()
    })
    afterEach(async () => {
        await door.close()
    })

    const mint = (title) =>
        mintSnap({ title }, { source: "fd 100" }, { work_id: "c".repeat(64) }, door)

    test("the picture lands on a keep that already exists; the keep is unchanged", async () => {
        const minted = await mint("later")
        assert.equal(await door.image(minted.id), undefined)

        assert.equal(await attachImage(door, minted.bytes, PNG_1PX), true)

        const img = await door.image(minted.id)
        assert.ok(img, "image stored under the message id")
        // Same name, same bytes — put is idempotent, so the attach is not a
        // second keep (id:kc-p-facts).
        assert.equal(await door.get(minted.id), minted.bytes)
        assert.equal((await door.list(await door.root())).length, 1)
    })

    test("no picture is not a wound — it says false and keeps nothing", async () => {
        const minted = await mint("dark")
        assert.equal(await attachImage(door, minted.bytes, null), false)
        assert.equal(await door.image(minted.id), undefined)
    })

    test("a dead door yields false, never a rejection", async () => {
        const minted = await mint("doomed")
        const dead = {
            put: async () => {
                throw new Error("worker gone")
            },
        }
        assert.equal(await attachImage(dead, minted.bytes, PNG_1PX), false)
    })
})
