// Where the marks layer mounts, without a DOM. (id:host-surface)
// Run with: node --test test/js/stage/overlay_mount_test.mjs
//
// The shell owns a `[data-turtle-overlay]` host under `phx-update="ignore"` so
// morphdom cannot reconcile the JS-appended layer away on a presence/hatch
// patch. The canvas's own parent is the fallback for a surface with no host;
// only a canvas with no parent at all reaches the body.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { overlayMountFor } from "../../../assets/js/turtling/overlay.js"

const host = { kind: "host" }
const parent = (found) => ({ kind: "parent", querySelector: (sel) => (sel === "[data-turtle-overlay]" ? found : null) })

describe("overlayMountFor", () => {
    test("a designated host wins over the canvas's parent", () => {
        assert.equal(overlayMountFor({ parentElement: parent(host) }), host)
    })

    test("without a host, the canvas's own parent mounts the layer", () => {
        const p = parent(null)
        assert.equal(overlayMountFor({ parentElement: p }), p)
    })

    test("a parent without querySelector is still a mount", () => {
        const p = { kind: "plain" }
        assert.equal(overlayMountFor({ parentElement: p }), p)
    })

    test("only a parentless canvas reaches the document body", () => {
        const body = { kind: "body" }
        assert.equal(overlayMountFor(null, { body }), body)
        assert.equal(overlayMountFor({}, { body }), body)
    })
})
