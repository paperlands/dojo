// Pure fold: versions → columns, keptLocal, sharedIds, settling.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { HEAD, fold, landed, restKey } from "../../../assets/js/river/fold.js"
import { PRESENT, DRAFT } from "../../../assets/js/river/mode.js"
import { name, write } from "../../../assets/js/keep/entry.js"

const ROOT = "r".repeat(64)
const WORK = "w".repeat(64)

function snap(tag, { work = WORK, t = 100, prev } = {}) {
    const body = { source_id: name(tag), diagnostics: [], buffer_id: null, title: tag }
    if (prev !== undefined) body.prev = prev
    return write("snap", body, { root: ROOT, target: work, ts: { t, n: 0 } })
}

describe("fold: empty river still has a present", () => {
    test("no versions → present only", () => {
        const f = fold([], [])
        assert.equal(f.columns.length, 1)
        assert.equal(f.columns[0].key, PRESENT)
        assert.equal(f.hasMirror, false)
        assert.equal(f.siblingHead, null)
        assert.equal(f.headKey, PRESENT)
        assert.equal(f.newestId, null)
        assert.equal(f.sharedIds.size, 0)
        assert.equal(f.keptLocal.size, 0)
        assert.equal(f.settling, false)
    })

    test("draft hangs past the present", () => {
        const f = fold([], [], { draft: { from: "parent", face: "blob:x" } })
        assert.equal(f.columns.length, 2)
        assert.equal(f.columns[1].key, DRAFT)
        assert.equal(f.columns[1].face, "blob:x")
    })
})

describe("fold: linear keeps", () => {
    test("one keep → column + present; local is kept-local", () => {
        const a = snap("a", { t: 1 })
        const f = fold([a], [a])
        assert.equal(f.columns.length, 2)
        assert.equal(f.columns[0].key, name(a))
        assert.equal(f.newestId, name(a))
        assert.ok(f.kept(name(a)))
        assert.ok(f.keptLocal.has(name(a)))
        assert.equal(f.headKey, name(a))
    })

    test("list minus local → sharedIds", () => {
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const f = fold([b, a], [a])
        assert.ok(f.sharedIds.has(name(b)))
        assert.equal(f.kept(name(b)), false)
        assert.equal(f.newestId, name(b))
    })

    test("fork opens a mirror", () => {
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const c = snap("c", { t: 3, prev: name(a) })
        const f = fold([c, b, a], [c, b, a])
        assert.equal(f.hasMirror, true)
        assert.ok(f.siblingHead)
    })

    test("settling is a share edge from keptLocal last breath", () => {
        const a = snap("a", { t: 1 })
        const id = name(a)
        const was = fold([a], [a]).keptLocal
        const next = fold([a], [], { keptLocal: was })
        assert.ok(next.sharedIds.has(id))
        assert.equal(next.settling, true)
        assert.equal(fold([a], [], { keptLocal: next.keptLocal }).settling, false)
    })
})

describe("restKey: the rest a breath asks for", () => {
    const a = snap("a", { t: 1 })

    test("no rest asked → the wheel holds still", () => {
        assert.equal(restKey(null, fold([a], [a])), null)
    })

    test("HEAD names the line's east-most keep", () => {
        assert.equal(restKey(HEAD, fold([a], [a])), name(a))
        assert.equal(restKey(HEAD, fold([], [])), PRESENT)
    })

    test("present always stands", () => {
        assert.equal(restKey(PRESENT, fold([], [])), PRESENT)
    })

    test("a draft rest is no rest once the draft is gone", () => {
        assert.equal(restKey(DRAFT, fold([], [], { draft: { from: "p" } })), DRAFT)
        assert.equal(restKey(DRAFT, fold([], [])), null)
    })
})

describe("landed: mint edge, not share (id:kr-land)", () => {
    test("share leaves the head still — no land", () => {
        const head = "a".repeat(64)
        assert.equal(landed(head, head), false)
        assert.equal(landed(null, null), false)
    })

    test("mint grows the head — land", () => {
        const was = "a".repeat(64)
        const now = "b".repeat(64)
        assert.equal(landed(was, now), true)
        assert.equal(landed(null, now), true)
    })

    test("empty fold is not a land", () => {
        assert.equal(landed("a".repeat(64), null), false)
    })
})
