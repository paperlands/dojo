// work_id on the buffer — the origin keep, once kept. Null until then.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import * as buffers from "../../../assets/js/terminal/buffers.js"

let idN = 0
function mints() {
    return {
        name: () => "n",
        id: () => `b${++idN}`,
    }
}

function fresh() {
    idN = 0
    return buffers.createCollection(mints())
}

describe("buffers: work_id is the origin keep, once kept", () => {
    test("createCollection has no work until a keep names it", () => {
        const c = fresh()
        const b = buffers.currentBuffer(c)
        assert.equal(b.work_id, null)
        assert.equal(b.id, "b1")
    })

    test("a blank tab (addBuffer) has no work — new river, unnamed", () => {
        const c = fresh()
        const { collection, id } = buffers.addBuffer(c, { name: "two" }, mints())
        const added = collection.items.get(id)
        assert.equal(added.work_id, null)
        assert.notEqual(id, c.currentId)
    })

    test("same river is opts.work_id = the origin keep", () => {
        const c = fresh()
        const origin = "k".repeat(64)
        const parent = buffers.setWorkId(c, c.currentId, origin)
        const { collection, id } = buffers.addBuffer(
            parent,
            { name: "hand-2", content: "fw", work_id: origin },
            mints(),
        )
        const child = collection.items.get(id)
        assert.equal(child.work_id, origin)
        assert.notEqual(child.id, parent.currentId)
    })

    test("fork-from-keep rejoins via opts.work_id = origin keep id", () => {
        const c = fresh()
        const keepTarget = "k".repeat(64)
        const { collection, id } = buffers.addBuffer(
            c,
            { name: "from-keep", content: "fd 50", work_id: keepTarget },
            mints(),
        )
        assert.equal(collection.items.get(id).work_id, keepTarget)
        assert.equal(buffers.currentBuffer(c).work_id, null)
    })

    test("stored buffer without work_id stays null; existing is sticky", () => {
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
        assert.equal(loaded.items.get("old").work_id, null)
        assert.equal(loaded.items.get("kept").work_id, "sticky".padEnd(64, "0"))
        const again = buffers.loadCollection(buffers.serialize(loaded), mints())
        assert.equal(again.items.get("old").work_id, null)
        assert.equal(again.items.get("kept").work_id, "sticky".padEnd(64, "0"))
    })

    test("serialize rides work_id; buffer.id is never the durable field", () => {
        const c = fresh()
        const s = buffers.serialize(c)
        const id = c.currentId
        assert.equal(s[id].work_id, null)
        assert.equal(s[id].id, id)
    })

    test("setWorkId stashes the origin keep on the standing tab", () => {
        const c = fresh()
        const id = c.currentId
        const recovered = "k".repeat(64)
        const next = buffers.setWorkId(c, id, recovered)
        assert.equal(next.items.get(id).work_id, recovered)
        assert.notEqual(next, c)
        assert.equal(buffers.setWorkId(next, id, recovered), next, "same work is no write")
        assert.equal(buffers.setWorkId(c, "ghost", recovered), c)
    })

    test("no fork export — the decision landed as data, not a dead name", () => {
        assert.equal(typeof buffers.fork, "undefined")
    })
})
