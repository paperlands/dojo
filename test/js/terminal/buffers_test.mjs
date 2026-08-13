// work_id on the buffer — the second continuant (id:kb-2a, id:kb-work).
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import * as buffers from "../../../assets/js/terminal/buffers.js"

let idN = 0
let workN = 0
function mints() {
    return {
        name: () => "n",
        id: () => `b${++idN}`,
        work: () => `w${String(++workN).padStart(2, "0")}${"0".repeat(62)}`,
    }
}

function fresh() {
    idN = 0
    workN = 0
    return buffers.createCollection(mints())
}

describe("buffers: work_id is minted per continuant", () => {
    test("createCollection mints a work_id on the first buffer", () => {
        const c = fresh()
        const b = buffers.currentBuffer(c)
        assert.ok(b.work_id)
        assert.match(b.work_id, /^w01/)
        assert.equal(b.id, "b1")
    })

    test("a blank tab (addBuffer) mints a NEW work_id — new river", () => {
        const c = fresh()
        const parentWork = buffers.currentBuffer(c).work_id
        const { collection, id } = buffers.addBuffer(c, { name: "two" }, mints())
        const added = collection.items.get(id)
        assert.notEqual(added.work_id, parentWork, "blank tab is a new river (id:kb-vet2-work)")
        assert.match(added.work_id, /^w02/)
    })

    test("same river is opts.work_id = parent.work_id — the gesture, not a dead export", () => {
        // Peer forks mint new rivers (terminal.forkBuffer). Same-hand / rejoin
        // continues via the data: opts.work_id. No dead fork() export (finding 6).
        const c = fresh()
        const parent = buffers.currentBuffer(c)
        const { collection, id } = buffers.addBuffer(
            c,
            { name: "hand-2", content: parent.content, work_id: parent.work_id },
            mints(),
        )
        const child = collection.items.get(id)
        assert.equal(child.work_id, parent.work_id, "same river")
        assert.notEqual(child.id, parent.id, "new hand")
    })

    test("fork-from-keep rejoins via opts.work_id = keep.target", () => {
        const c = fresh()
        const keepTarget = "k".repeat(64)
        const { collection, id } = buffers.addBuffer(
            c,
            { name: "from-keep", content: "fd 50", work_id: keepTarget },
            mints(),
        )
        assert.equal(collection.items.get(id).work_id, keepTarget)
        assert.notEqual(
            collection.items.get(id).work_id,
            buffers.currentBuffer(c).work_id,
            "rejoined a keep's work, not the blank tab that was current",
        )
    })

    test("stored buffer without work_id gains one on load; existing is sticky", () => {
        workN = 0
        idN = 0
        const raw = {
            old: {
                id: "old",
                name: "legacy",
                content: "fd 1",
                mode: "plang",
                active: true,
            },
            kept: {
                id: "kept",
                name: "has",
                content: "fd 2",
                mode: "plang",
                work_id: "sticky".padEnd(64, "0"),
                active: false,
            },
        }
        const loaded = buffers.loadCollection(raw, mints())
        assert.ok(loaded.items.get("old").work_id, "migration mints")
        assert.equal(loaded.items.get("kept").work_id, "sticky".padEnd(64, "0"), "sticky")
        const again = buffers.loadCollection(buffers.serialize(loaded), mints())
        assert.equal(again.items.get("old").work_id, loaded.items.get("old").work_id)
        assert.equal(again.items.get("kept").work_id, "sticky".padEnd(64, "0"))
    })

    test("serialize rides work_id; buffer.id is never the durable field on a keep", () => {
        const c = fresh()
        const s = buffers.serialize(c)
        const id = c.currentId
        assert.ok(s[id].work_id)
        assert.equal(s[id].id, id)
        assert.notEqual(s[id].work_id, s[id].id)
    })

    test("no fork export — the decision landed as data, not a dead name", () => {
        assert.equal(typeof buffers.fork, "undefined")
    })
})
