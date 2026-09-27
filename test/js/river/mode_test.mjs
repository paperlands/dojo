// Mode is structure; CSS is a pure projection. Ready lives inside modeOf.
// Present and draft are two fold places; chrome projects one at-open.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
    applyMode,
    classSetOf,
    isOpen,
    MODE_CLASSES,
    modeOf,
    seatOf,
    PRESENT,
    DRAFT,
} from "../../../assets/js/river/mode.js"

describe("seatOf / isOpen / modeOf", () => {
    test("seat follows the standing key", () => {
        assert.equal(seatOf({ key: PRESENT }), "present")
        assert.equal(seatOf({ key: DRAFT }), "draft")
        assert.equal(seatOf({ key: "deadbeef", id: "deadbeef" }), "keep")
    })

    test("open is present or draft — not a keep", () => {
        assert.equal(isOpen("present"), true)
        assert.equal(isOpen("draft"), true)
        assert.equal(isOpen("keep"), false)
    })

    test("shared only when on a keep the room holds", () => {
        const sharedIds = new Set(["a"])
        assert.equal(
            modeOf({ at: { key: PRESENT, id: null }, sharedIds, caption: "" }).shared,
            false,
        )
        assert.equal(
            modeOf({ at: { key: "a", id: "a" }, sharedIds }).shared,
            true,
        )
        assert.equal(
            modeOf({ at: { key: "b", id: "b" }, sharedIds }).shared,
            false,
        )
    })

    test("ready is a non-empty caption at an open seat — not a free verb", () => {
        assert.equal(
            modeOf({ at: { key: PRESENT, id: null }, sharedIds: new Set(), caption: "hi" }).ready,
            true,
        )
        assert.equal(
            modeOf({ at: { key: DRAFT, id: null }, sharedIds: new Set(), caption: "hi" }).ready,
            true,
        )
        assert.equal(
            modeOf({ at: { key: PRESENT, id: null }, sharedIds: new Set(), caption: "  " }).ready,
            false,
        )
        assert.equal(
            modeOf({ at: { key: "k", id: "k" }, sharedIds: new Set(), caption: "hi" }).ready,
            false,
        )
    })

    test("sealing freezes chrome as keep, never ready/shared", () => {
        const m = modeOf({
            at: { key: PRESENT, id: null },
            sharedIds: new Set(["a"]),
            caption: "HELLO",
            sealing: "HELLO",
        })
        assert.equal(m.sealing, "HELLO")
        assert.equal(m.ready, false)
        assert.deepEqual([...classSetOf(m)].sort(), ["at-keep", "is-keeping"].sort())
    })
})

describe("classSetOf: pure dual of the CSS selectors", () => {
    test("open ready — one class for both places", () => {
        assert.deepEqual(
            [...classSetOf({ seat: "present", shared: false, ready: true, sealing: null })].sort(),
            ["at-open", "is-ready"].sort(),
        )
        assert.deepEqual(
            [...classSetOf({ seat: "draft", shared: false, ready: false, sealing: null })].sort(),
            ["at-open"],
        )
    })

    test("shared keep", () => {
        assert.deepEqual(
            [...classSetOf({ seat: "keep", shared: true, ready: false, sealing: null })].sort(),
            ["at-keep", "is-shared"].sort(),
        )
    })

    test("MODE_CLASSES is the whole vocabulary", () => {
        assert.deepEqual(
            [...MODE_CLASSES].sort(),
            ["at-keep", "at-open", "is-keeping", "is-ready", "is-shared"].sort(),
        )
    })
})

describe("applyMode: toggles only mode classes; data-seat names the place", () => {
    test("preserves strangers, projects mode", () => {
        const el = {
            dataset: {},
            classList: {
                _set: new Set(["river-sky", "has-mirror", "fixed"]),
                toggle(c, on) {
                    if (on) this._set.add(c)
                    else this._set.delete(c)
                },
                contains(c) {
                    return this._set.has(c)
                },
            },
        }
        applyMode(el, { seat: "present", shared: false, ready: true, sealing: null })
        assert.ok(el.classList.contains("river-sky"))
        assert.ok(el.classList.contains("has-mirror"))
        assert.ok(el.classList.contains("at-open"))
        assert.ok(el.classList.contains("is-ready"))
        assert.equal(el.dataset.seat, "present")

        applyMode(el, { seat: "draft", shared: false, ready: false, sealing: null })
        assert.ok(el.classList.contains("at-open"))
        assert.equal(el.dataset.seat, "draft")
        assert.equal(el.classList.contains("is-ready"), false)

        applyMode(el, { seat: "keep", shared: true, ready: false, sealing: null })
        assert.ok(el.classList.contains("at-keep"))
        assert.ok(el.classList.contains("is-shared"))
        assert.equal(el.classList.contains("at-open"), false)
        assert.equal(el.dataset.seat, undefined)
        assert.ok(el.classList.contains("has-mirror"), "fold class survives")
    })

    test("sealing clears data-seat — drop is not draft chrome mid-keep", () => {
        const el = {
            dataset: { seat: "draft" },
            classList: {
                _set: new Set(),
                toggle(c, on) {
                    if (on) this._set.add(c)
                    else this._set.delete(c)
                },
                contains(c) {
                    return this._set.has(c)
                },
            },
        }
        applyMode(el, { seat: "draft", shared: false, ready: false, sealing: "HELLO" })
        assert.ok(el.classList.contains("at-keep"))
        assert.ok(el.classList.contains("is-keeping"))
        assert.equal(el.dataset.seat, undefined)
    })
})
