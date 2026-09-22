// The keep join as one breath (id:kc-p-join).
//
// Models the coreshell seat without a canvas: ask → once(path) → mint-with-picture.
// No picture in the deadline → null, no row. A hatch alone mints nothing.
//
// Run: node --test test/js/keep/join_test.mjs

import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

import { createObservable } from "../../../assets/js/kernel/observable.js"
import { temporal } from "../../../assets/js/utils/temporal.js"
import { mintSnap } from "../../../assets/js/keep/kinds/snap.js"
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
    // The join itself — wait for a picture, one put, or a spoken drop.
    const unKeeper = registerKeeper(async (ask) => {
        const seen = reflection() ?? {}
        const path = await temporal.once(paths.watch, waitMs)
        const id = await mintSnap(ask, seen, ids(), door, path)
        if (!id) return null
        touched()
        return id
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

describe("the join lifecycle (id:kc-p-join)", () => {
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

    test("a path in the deadline mints a photograph", async () => {
        const pending = askKeep("a small step")
        paths.notify(PNG_1PX)
        const id = await pending
        assert.equal(typeof id, "string")
        assert.ok(id.length > 0)
        assert.ok(await door.image(id), "picture landed in the same put")
        assert.deepEqual(seat.breaths, ["touch"], "one fold breath at mint")
        assert.ok(await door.get(id))
    })

    test("a late path still makes the keep — the wait is the join", async () => {
        const pending = askKeep("later")
        await sleep(10)
        paths.notify(PNG_1PX)
        const id = await pending
        assert.ok(id)
        assert.ok(await door.image(id))
        assert.deepEqual(seat.breaths, ["touch"])
    })

    test("a producer that never produces is a spoken drop — no keep", async () => {
        const id = await askKeep("kept in the dark")
        assert.equal(id, null)
        assert.equal((await door.list(await door.root())).length, 0)
        assert.deepEqual(seat.breaths, [], "no mint → no touch")
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
        const pending = askKeep("forked", { prev: parent })
        paths.notify(PNG_1PX)
        const id = await pending
        assert.ok(id)
        const { read } = await import("../../../assets/js/keep/entry.js")
        assert.equal(read(await door.get(id)).prev, parent)
        assert.ok(await door.image(id))
    })
})
