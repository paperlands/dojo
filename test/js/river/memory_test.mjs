// Potential heads — unkept + draft, one module, two storage bags.
import { describe, test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
    readDraft,
    readHead,
    writeDraft,
    writeHead,
} from "../../../assets/js/river/memory.js"

const WORK = "w".repeat(64)
const OTHER = "o".repeat(64)
const FROM = "f".repeat(64)

const mem = new Map()
globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: (k) => { mem.delete(k) },
    clear: () => { mem.clear() },
}

beforeEach(() => mem.clear())

describe("head memory: the unkept present per work", () => {
    test("round-trip holds the head buffer text", () => {
        writeHead(WORK, "label 'mine' 10\n")
        assert.equal(readHead(WORK), "label 'mine' 10\n")
    })

    test("works do not share a head", () => {
        writeHead(WORK, "fw 1")
        writeHead(OTHER, "fw 2")
        assert.equal(readHead(WORK), "fw 1")
        assert.equal(readHead(OTHER), "fw 2")
    })

    test("null clears; missing is null", () => {
        writeHead(WORK, "x")
        writeHead(WORK, null)
        assert.equal(readHead(WORK), null)
        assert.equal(readHead(null), null)
    })
})

describe("draft memory: one potential head per work", () => {
    test("round-trip: write, read, survives face omission", () => {
        writeDraft(WORK, { from: FROM, text: "fw 10\n", title: "fork a", face: "blob:gone" })
        assert.deepEqual(readDraft(WORK), {
            from: FROM,
            text: "fw 10\n",
            title: "fork a",
            face: null,
        })
    })

    test("works do not share a draft", () => {
        writeDraft(WORK, { from: FROM, text: "mine" })
        writeDraft(OTHER, { from: FROM, text: "theirs", title: "t" })
        assert.equal(readDraft(WORK).text, "mine")
        assert.equal(readDraft(OTHER).text, "theirs")
        assert.equal(readDraft(OTHER).title, "t")
    })

    test("null clears; absent work is null", () => {
        writeDraft(WORK, { from: FROM, text: "x" })
        writeDraft(WORK, null)
        assert.equal(readDraft(WORK), null)
        assert.equal(readDraft(OTHER), null)
        assert.equal(readDraft(null), null)
    })

    test("corrupt / incomplete rows are refused, not half-restored", () => {
        mem.set("@paperlands.river.drafts", JSON.stringify({
            [WORK]: { from: FROM },
            [OTHER]: { text: "no from" },
        }))
        assert.equal(readDraft(WORK), null)
        assert.equal(readDraft(OTHER), null)
    })

    test("an unreadable row is refused, never a clear", () => {
        writeHead(WORK, "standing")
        writeHead(WORK, 42)
        assert.equal(readHead(WORK), "standing")

        writeDraft(WORK, { from: FROM, text: "standing" })
        writeDraft(WORK, { text: "no from" })
        assert.equal(readDraft(WORK).text, "standing")
    })

    test("head and draft bags do not collide", () => {
        writeHead(WORK, "head text")
        writeDraft(WORK, { from: FROM, text: "draft text" })
        assert.equal(readHead(WORK), "head text")
        assert.equal(readDraft(WORK).text, "draft text")
    })
})
