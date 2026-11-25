// Caption chrome — pure facts, one painter.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { BEAT, captionOf, titleOf } from "../../../assets/js/river/chrome.js"
import { write, name } from "../../../assets/js/keep/entry.js"
import { PRESENT, DRAFT } from "../../../assets/js/river/mode.js"

const ROOT = "a".repeat(64)

function snap(title) {
    return write(
        "snap",
        { source_id: name(title), diagnostics: [], buffer_id: null, title },
        { root: ROOT, target: "w".repeat(64), ts: { t: 1, n: 0 } },
    )
}

describe("BEAT: one place for keep→land durations", () => {
    test("named durations, positive", () => {
        for (const k of ["IGNITE_MS", "KEEP_GUARD_MS", "HOLD_MIN_MS", "LAND_MS", "BLUSH_MS"]) {
            assert.ok(BEAT[k] > 0, k)
        }
        assert.ok(Object.isFrozen(BEAT))
    })
})

describe("captionOf", () => {
    test("sealing freezes the word", () => {
        const c = captionOf({
            at: { key: PRESENT, id: null },
            sealing: "HELLO",
            draft: null,
            keeps: new Map(),
            empty: true,
        })
        assert.equal(c.word, "HELLO")
    })

    test("empty river present wants YOUR TITLE", () => {
        const c = captionOf({
            at: { key: PRESENT, id: null },
            sealing: null,
            draft: null,
            keeps: new Map(),
            empty: true,
        })
        assert.equal(c.placeholder, "YOUR TITLE")
    })

    test("keep seat shows title from keeps index", () => {
        const bytes = snap("moment")
        const id = name(bytes)
        const keeps = new Map([[id, { bytes }]])
        const c = captionOf({
            at: { key: id, id },
            sealing: null,
            draft: null,
            keeps,
            empty: false,
        })
        assert.equal(c.word, "moment")
        assert.equal(c.clearMessage, true)
    })

    test("draft placeholder names the parent via keeps", () => {
        const bytes = snap("parent")
        const id = name(bytes)
        const keeps = new Map([[id, { bytes }]])
        const c = captionOf({
            at: { key: DRAFT, id: null },
            sealing: null,
            draft: { from: id, title: "fork" },
            keeps,
            empty: false,
        })
        assert.equal(c.placeholder, "from parent")
        assert.equal(c.message, "fork")
    })
})

describe("titleOf", () => {
    test("reads title; unreadable is null", () => {
        assert.equal(titleOf(snap("x")), "x")
        assert.equal(titleOf("{not"), null)
    })
})

