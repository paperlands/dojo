// The surface a stage draws on, without a DOM. (id:host-surface)
// Run with: node --test test/js/stage/viewport_test.mjs
//
// The canvas IS the surface: its box and the device ratio decide the
// projection. The window is a FALLBACK for a canvas that has no box yet — which
// is the one case where reading it is honest — and every other path must come
// from the box. These are the arithmetic's own edges, where a wrong answer is
// invisible until something is drawn the wrong size.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { surfaceOf, clientContentBox, projectClient } from "../../../assets/js/turtling/viewport.js"

const window800x600 = { width: 800, height: 600 }

describe("surfaceOf", () => {
    test("a box is the surface, with its own origin", () => {
        const surface = surfaceOf({ rect: { width: 320, height: 240, left: 40, top: 12 }, dpr: 1 })
        assert.deepEqual(surface, {
            state: "measured",
            width: 320, height: 240, dpr: 1,
            left: 40, top: 12, right: 360, bottom: 252,
            windowed: false, collapsed: false, transformed: false,
            layout: { width: 320, height: 240 },
            client: { left: 40, top: 12, right: 360, bottom: 252, width: 320, height: 240 },
        })
    })

    test("a canvas with no box falls back to the window, and says so", () => {
        const surface = surfaceOf({ rect: { width: 0, height: 0, left: 0, top: 0 }, dpr: 2, fallback: window800x600 })
        assert.deepEqual(surface, {
            state: "unavailable",
            width: 800, height: 600, dpr: 2,
            left: 0, top: 0, right: 800, bottom: 600,
            windowed: true, collapsed: false, transformed: false,
            layout: { width: 800, height: 600 },
            client: null,
        })
    })

    test("a CONNECTED canvas with no box is measured as collapsed, not as the window", () => {
        // The window may still be a projection policy elsewhere. It is not this
        // measurement. A collapsed canvas is a zero box.
        const surface = surfaceOf({
            rect: { width: 0, height: 0, left: 8, top: 4 }, dpr: 3, fallback: window800x600, connected: true,
        })
        assert.deepEqual(surface, {
            state: "collapsed",
            width: 0, height: 0, dpr: 2,
            left: 8, top: 4, right: 8, bottom: 4,
            windowed: false, collapsed: true, transformed: false,
            layout: { width: 0, height: 0 },
            client: { left: 8, top: 4, right: 8, bottom: 4, width: 0, height: 0 },
        })
    })

    test("a connected canvas keeps its own box, and is never collapsed when it has one", () => {
        const surface = surfaceOf({ rect: { width: 10, height: 4, left: 1, top: 2 }, dpr: 1, fallback: window800x600, connected: true })
        assert.equal(surface.collapsed, false)
        assert.equal(surface.windowed, false)
        assert.deepEqual([surface.width, surface.height], [10, 4])
    })

    test("one dead axis is no box at all — a zero height is not a surface", () => {
        // A canvas mid-layout, or a `display: contents` parent, reports a rect
        // with one live axis. Taking it would divide the camera's aspect by zero.
        for (const rect of [{ width: 640, height: 0, left: 0, top: 0 }, { width: 0, height: 480, left: 0, top: 0 }]) {
            const surface = surfaceOf({ rect, dpr: 1, fallback: window800x600 })
            assert.equal(surface.windowed, true)
            assert.deepEqual([surface.width, surface.height], [800, 600])
        }
    })

    test("negative dimensions are not a box either", () => {
        const surface = surfaceOf({ rect: { width: -10, height: 240, left: 0, top: 0 }, dpr: 1, fallback: window800x600 })
        assert.equal(surface.windowed, true)
    })

    test("the device ratio is clamped to 2, and a nonsense ratio is 1", () => {
        const box = { width: 100, height: 100, left: 0, top: 0 }
        assert.equal(surfaceOf({ rect: box, dpr: 3 }).dpr, 2)
        assert.equal(surfaceOf({ rect: box, dpr: 1.5 }).dpr, 1.5)
        for (const dpr of [0, -1, NaN, undefined, null, "two"]) {
            assert.equal(surfaceOf({ rect: box, dpr }).dpr, 1, `dpr ${String(dpr)}`)
        }
    })

    test("nothing to measure is null, not a zero-sized surface", () => {
        assert.equal(surfaceOf({ rect: null, dpr: 1, fallback: null }), null)
        assert.equal(surfaceOf({ rect: { width: 0, height: 0 }, dpr: 1, fallback: { width: 0, height: 0 } }), null)
        assert.equal(surfaceOf(), null)
    })

    test("a transform is named, and layout is not reported as the client width", () => {
        const surface = surfaceOf({
            transformed: true,
            layout: { width: 320, height: 240 },
            visual: { left: 10, top: 20, width: 640, height: 480, right: 650, bottom: 500 },
            dpr: 1,
            fallback: window800x600,
            connected: true,
        })
        assert.equal(surface.state, "transformed")
        assert.deepEqual(surface.layout, { width: 320, height: 240 })
        assert.equal(surface.client.width, 640)
        assert.notEqual(surface.client.width, surface.layout.width)
    })
})

describe("client content box", () => {
    test("an untransformed box names every edge", () => {
        const box = clientContentBox({
            visual: { left: 10, top: 20, width: 322, height: 242, right: 332, bottom: 262 },
            border: { left: 1, right: 1, top: 1, bottom: 1 },
            padding: { left: 0, right: 0, top: 0, bottom: 0 },
            layout: { width: 320, height: 240 },
        })
        assert.equal(box.supported, true)
        assert.deepEqual(
            { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
            { left: 11, top: 21, right: 331, bottom: 261, width: 320, height: 240 },
        )
    })

    test("scale(2) is a transform, not a 320-wide client box", () => {
        const box = clientContentBox({
            visual: { left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480 },
            border: { left: 0, right: 0, top: 0, bottom: 0 },
            padding: { left: 0, right: 0, top: 0, bottom: 0 },
            layout: { width: 320, height: 240 },
        })
        assert.equal(box.supported, false)
        assert.equal(box.reason, "transformed")
        assert.equal(box.visual.width, 640)
        assert.deepEqual(box.layout, { width: 320, height: 240 })
        assert.equal(projectClient(box, 0, 0), null)
    })

    test("the fallback's origin is never taken as a box origin", () => {
        // The window has no offset; a windowed surface that reported one would
        // shift every place mark by the scroll position.
        const surface = surfaceOf({ rect: null, dpr: 1, fallback: { width: 800, height: 600, left: 99, top: 99 } })
        assert.deepEqual([surface.left, surface.top], [0, 0])
    })
})

describe("projection stays on the content box", () => {
    test("the center of the box is the center of NDC", () => {
        const rect = { supported: true, left: 40, top: 10, width: 320, height: 240, right: 360, bottom: 250 }
        assert.deepEqual(projectClient(rect, 0, 0), { x: 200, y: 130 })
    })

    test("a point past the far edge is not a client position", () => {
        // NDC x = 5 is three widths past the right edge. A box that forgot
        // `right` used to let this through, because `x > undefined` is false.
        const rect = { supported: true, left: 0, top: 0, width: 320, height: 240 }
        assert.equal(projectClient(rect, 5, 0), null)
        assert.equal(projectClient(rect, 0, -5), null)
        const inside = projectClient(rect, 1, 1)
        assert.deepEqual(inside, { x: 320, y: 0 })
    })
})
