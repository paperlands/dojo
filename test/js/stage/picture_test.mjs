// A still is the picture, not the buffer. (id:host-surface)
// Run with: node --test test/js/stage/picture_test.mjs
//
// Marks ride their own 2D layer above the GL canvas, so a capture that reads the
// canvas alone is the geometry without its pins, rims and names. This asserts the
// composite's contract with a stub context: bottom→top, snapshot-sized, and an
// empty answer when there is nothing above the canvas (no readback either).
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { composeLayers, inkOf } from "../../../assets/js/turtling/export/picture.js"

const stub = () => {
    const calls = { drawn: [], read: 0 }
    return {
        calls,
        drawImage: (...args) => calls.drawn.push(args),
        getImageData: () => { calls.read++; return { data: new Uint8ClampedArray(0), width: 0, height: 0 } },
    }
}
const layer = (name, width = 320, height = 200) => ({ name, width, height })

describe("composeLayers", () => {
    test("layers land bottom→top at the snapshot's own bitmap size", () => {
        const ctx = stub()
        const a = layer("a"), b = layer("b")
        composeLayers(ctx, [a, b], 640, 400)
        assert.deepEqual(ctx.calls.drawn, [[a, 0, 0, 640, 400], [b, 0, 0, 640, 400]])
    })

    test("an unsized or collapsed layer is skipped, never a throw", () => {
        const ctx = stub()
        composeLayers(ctx, [layer("zero", 0, 200), layer("flat", 320, 0), null, layer("ok")], 640, 400)
        assert.deepEqual(ctx.calls.drawn.map(([l]) => l.name), ["ok"])
    })

    test("no layers above the canvas draws nothing", () => {
        const ctx = stub()
        composeLayers(ctx, [], 640, 400)
        composeLayers(ctx, undefined, 640, 400)
        assert.equal(ctx.calls.drawn.length, 0)
    })
})

describe("inkOf", () => {
    test("with marks, the trim reads what is on the canvas", () => {
        const ctx = stub()
        const canvasInk = { id: "gl" }
        assert.notEqual(inkOf(ctx, [layer("a")], 640, 400, canvasInk), canvasInk)
        assert.equal(ctx.calls.read, 1)
    })

    test("without marks, the canvas's own pixels are the ink — no readback", () => {
        const ctx = stub()
        const canvasInk = { id: "gl" }
        assert.equal(inkOf(ctx, [], 640, 400, canvasInk), canvasInk)
        assert.equal(ctx.calls.read, 0)
    })
})
