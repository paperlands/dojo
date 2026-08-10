// Draft memory — potential heads, local only.
import { describe, test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readDraft, writeDraft } from "../../../assets/js/river/draft-memory.js"

const WORK = "w".repeat(64)
const OTHER = "o".repeat(64)
const FROM = "f".repeat(64)

// storage.js hits localStorage; give the suite a quiet bag.
const mem = new Map()
globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: (k) => { mem.delete(k) },
    clear: () => { mem.clear() },
}

beforeEach(() => mem.clear())

describe("draft memory: one potential head per work", () => {
    test("round-trip: write, read, survives face omission", () => {
        writeDraft(WORK, { from: FROM, text: "fw 10\n", title: "fork a", face: "blob:gone" })
        const got = readDraft(WORK)
        assert.deepEqual(got, {
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
            [WORK]: { from: FROM }, // no text
            [OTHER]: { text: "no from" },
        }))
        assert.equal(readDraft(WORK), null)
        assert.equal(readDraft(OTHER), null)
    })
})
