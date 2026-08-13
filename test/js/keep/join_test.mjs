// The keep join as one breath (id:kc-p-join · id:kj-answer).
//
// Models the coreshell seat without a canvas: ask → mint → once(path) → attach.
// No hatch fixture can mint; the picture may arrive late or never; the word is
// the cause either way.
//
// Run: node --test test/js/keep/join_test.mjs

import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

import { createObservable } from "../../../assets/js/kernel/observable.js"
import { temporal } from "../../../assets/js/utils/temporal.js"
import { mintSnap, attachImage } from "../../../assets/js/keep/kinds/snap.js"
import {
    askKeep,
    registerKeeper,
    touched,
    watchTouched,
} from "../../../assets/js/keep/cell.js"
import { createJournal as createDoor } from "../../../assets/js/keep/journal.js"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { createMemoryIDB } from "./idb_memory.mjs"

const PNG_1PX =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

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
        dbName: `join-${Math.random().toString(36).slice(2)}`,
        random: fill(0x42),
        stamp: () => ({ t: 1_700_000_000_000 + ++c, n: 0 }),
        blobCap: 1024 * 1024,
    })
    return createDoor({ engine })
}

/**
 * The owner seat, stripped to law (inner.js registerKeeper). Returns the
 * release and a breath log so the seal's truth can be counted.
 *
 * @param {{
 *   door: { root: Function, put: Function, get: Function, image: Function },
 *   paths: ReturnType<typeof createObservable>,
 *   reflection?: () => { source?: string, diagnostics?: unknown },
 *   ids?: () => { work_id: string | null, buffer_id?: string | null },
 *   waitMs?: number,
 * }} opts
 */
function seatOwner({
    door,
    paths,
    reflection = () => ({ source: "fd 100", diagnostics: [] }),
    ids = () => ({ work_id: "a".repeat(64), buffer_id: "buf" }),
    waitMs = 40,
}) {
    /** @type {string[]} */
    const breaths = []
    const unTouch = watchTouched(() => breaths.push("touch"))
    // The join itself (id:kj-answer-collapse) — mint first, reveal later.
    const unKeeper = registerKeeper(async (ask) => {
        const minted = await mintSnap(ask, reflection() ?? {}, ids(), door)
        if (!minted) return null
        touched()
        void temporal.once(paths.watch, waitMs).then(async (path) => {
            if (await attachImage(door, minted.bytes, path)) touched()
        })
        return minted.id
    })
    return {
        breaths,
        release() {
            unKeeper()
            unTouch()
        },
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

describe("the join lifecycle (id:kc-p-join · id:kj-answer)", () => {
    /** @type {ReturnType<typeof freshDoor>} */
    let door
    /** @type {ReturnType<typeof createObservable>} */
    let paths
    /** @type {ReturnType<typeof seatOwner>} */
    let seat

    beforeEach(() => {
        door = freshDoor()
        paths = createObservable()
        seat = seatOwner({ door, paths })
    })
    afterEach(async () => {
        seat.release()
        await door.close()
    })

    test("the word is the cause — ask answers with an id before any picture", async () => {
        // The seal ends on this return (id:kj-vet 2). A path that has not
        // arrived yet must not hold the asker.
        const id = await askKeep("a small step")
        assert.equal(typeof id, "string")
        assert.ok(id.length > 0)
        assert.equal(await door.image(id), undefined, "picture has not landed")
        assert.deepEqual(seat.breaths, ["touch"], "one fold breath at mint")
        // The keep is whole without a face.
        assert.ok(await door.get(id))
    })

    test("the picture is the reveal — a late path attaches; the keep is unchanged", async () => {
        const id = await askKeep("later")
        const bytes = await door.get(id)
        assert.equal(await door.image(id), undefined)

        // Hatch product arrives on its own clock (id:kj-life-hatch).
        paths.notify(PNG_1PX)
        // Attach is async put; give the microtask + IDB a beat.
        await sleep(30)

        const img = await door.image(id)
        assert.ok(img, "image stored under the message id")
        assert.equal(await door.get(id), bytes, "re-put is the same keep")
        assert.deepEqual(
            seat.breaths,
            ["touch", "touch"],
            "mint then attach — two empty fold breaths, like share",
        )
    })

    test("a producer that never produces costs a face, never the keep", async () => {
        const id = await askKeep("kept in the dark")
        assert.ok(id)
        // Wait past the deadline (seat waitMs = 40).
        await sleep(80)
        assert.ok(await door.get(id), "the keep still stands")
        assert.equal(await door.image(id), undefined, "no face attached")
        assert.deepEqual(seat.breaths, ["touch"], "attach never fires a second breath")
    })

    test("a hatch alone mints nothing — durability is not on that event", async () => {
        // No ask was made. A frameshot for the clan is not a keep (id:kc-p-join).
        paths.notify(PNG_1PX)
        await sleep(20)
        assert.equal((await door.list(await door.root())).length, 0)
        assert.deepEqual(seat.breaths, [], "no mint, no fold")
    })

    test("a refused mint answers null at once — seal ends on a spoken drop", async () => {
        seat.release()
        seat = seatOwner({
            door,
            paths,
            ids: () => ({ work_id: null }),
        })
        assert.equal(await askKeep("nowhere"), null)
        assert.deepEqual(seat.breaths, [], "no mint → no touch")
        assert.equal((await door.list(await door.root())).length, 0)
    })

    test("fork prev rides the ask into the body; hatch never sees it", async () => {
        const parent = "9".repeat(64)
        const id = await askKeep("forked", { prev: parent })
        assert.ok(id)
        // Path is nobody's business for the fork fact.
        const { read } = await import("../../../assets/js/keep/entry.js")
        assert.equal(read(await door.get(id)).prev, parent)
        // A late path still only attaches the face — does not re-encode the ask.
        paths.notify(PNG_1PX)
        await sleep(30)
        assert.equal(read(await door.get(id)).prev, parent)
        assert.ok(await door.image(id))
    })
})
