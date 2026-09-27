// One index: Map<id, { bytes, source?, face? }>
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { bytesOf, clear, faceOf, ingest, prune } from "../../../assets/js/river/keeps.js"
import { name, write } from "../../../assets/js/keep/entry.js"

const ROOT = "r".repeat(64)

function snap(tag, t = 1) {
    return write(
        "snap",
        { source_id: name(tag), diagnostics: [], buffer_id: null, title: tag },
        { root: ROOT, target: "w".repeat(64), ts: { t, n: 0 } },
    )
}

describe("keeps index", () => {
    test("ingest upserts bytes and preserves source/face", () => {
        const keeps = new Map()
        const a = snap("a", 1)
        const id = name(a)
        ingest(keeps, [a])
        assert.equal(bytesOf(keeps, id), a)
        keeps.get(id).source = "fw 1"
        keeps.get(id).face = "blob:x"

        const a2 = snap("a", 1) // same content → same name
        ingest(keeps, [a2])
        assert.equal(keeps.get(id).source, "fw 1")
        assert.equal(faceOf(keeps, id), "blob:x")
        assert.equal(bytesOf(keeps, id), a2)
    })

    test("prune drops strangers and revokes faces", () => {
        const revoked = []
        const orig = globalThis.URL
        globalThis.URL = { revokeObjectURL: (u) => revoked.push(u) }
        try {
            const keeps = new Map()
            const a = snap("a")
            const b = snap("b", 2)
            ingest(keeps, [a, b])
            keeps.get(name(a)).face = "blob:a"
            keeps.get(name(b)).face = "blob:b"
            prune(keeps, new Set([name(a)]))
            assert.ok(keeps.has(name(a)))
            assert.equal(keeps.has(name(b)), false)
            assert.deepEqual(revoked, ["blob:b"])
        } finally {
            globalThis.URL = orig
        }
    })

    test("clear revokes every face", () => {
        const revoked = []
        const orig = globalThis.URL
        globalThis.URL = { revokeObjectURL: (u) => revoked.push(u) }
        try {
            const keeps = new Map()
            const a = snap("a")
            ingest(keeps, [a])
            keeps.get(name(a)).face = "blob:z"
            clear(keeps)
            assert.equal(keeps.size, 0)
            assert.deepEqual(revoked, ["blob:z"])
        } finally {
            globalThis.URL = orig
        }
    })
})
