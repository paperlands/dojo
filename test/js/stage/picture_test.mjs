// A still is the picture, not the buffer. (id:host-surface)
// Run with: node --test test/js/stage/picture_test.mjs
//
// Marks ride their own 2D layer above the GL canvas, so a capture that reads the
// canvas alone is the geometry without its pins, rims and names. This asserts the
// composite's contract with a stub context: bottom→top, snapshot-sized, and an
// empty answer when there is nothing above the canvas (no readback either).
//
// The rest is the hatch's cost fence: the crop is ONE blit of the ink's box (never a
// per-row copy), and the encode is handed to the browser's own encoder (never a
// synchronous toDataURL on the frame). A first hatch that blocked the main thread for
// a whole PNG encode was the stutter every run showed half a second in.
import { test, describe, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
    capScale, composeLayers, cropInto, encodeURL, inkBox, inkOf,
} from "../../../assets/js/turtling/export/picture.js"
import { Recorder } from "../../../assets/js/turtling/export/recorder.js"

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

// A bitmap with alpha only at the named coordinates — the only thing a trim reads.
const bitmap = (width, height, ink = []) => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (const [x, y] of ink) data[(y * width + x) * 4 + 3] = 255
    return { data, width, height }
}

describe("inkBox", () => {
    test("the box is the ink's own extent, corners included", () => {
        assert.deepEqual(inkBox(bitmap(8, 6, [[2, 1], [5, 4], [3, 3]])),
            { x: 2, y: 1, width: 4, height: 4 })
    })

    test("one place is a one-pixel still", () => {
        assert.deepEqual(inkBox(bitmap(8, 6, [[5, 4]])), { x: 5, y: 4, width: 1, height: 1 })
    })

    test("a clear canvas has no box to crop", () => {
        assert.equal(inkBox(bitmap(4, 4)), null)
    })

    test("a degenerate or absent bitmap answers null, never a throw", () => {
        assert.equal(inkBox(null), null)
        assert.equal(inkBox(bitmap(0, 0)), null)
        assert.equal(inkBox({ width: 4, height: 4 }), null)
    })

    test("an unaligned view is answered by bytes, exactly as the words would", () => {
        // The readback is word-aligned; another caller's view may not be, and the
        // answer may not depend on which loop read it.
        const backing = new ArrayBuffer(8 * 6 * 4 + 4)
        const data = new Uint8ClampedArray(backing, 4, 8 * 6 * 4)
        for (const [x, y] of [[2, 1], [5, 4], [3, 3]]) data[(y * 8 + x) * 4 + 3] = 255
        assert.deepEqual(inkBox({ data, width: 8, height: 6 }), { x: 2, y: 1, width: 4, height: 4 })
    })
})

describe("cropInto", () => {
    test("one blit of the ink box into the padded trim", () => {
        const calls = []
        const source = { id: "still" }
        cropInto({ drawImage: (...args) => calls.push(args) }, source,
            { x: 2, y: 1, width: 4, height: 4 }, { pad: 2 })
        assert.deepEqual(calls, [[source, 2, 1, 4, 4, 2, 2, 4, 4]])
    })

    test("a cap scales the same blit, the air included", () => {
        const calls = []
        cropInto({ drawImage: (...args) => calls.push(args) }, { id: "still" },
            { x: 0, y: 0, width: 100, height: 50 }, { pad: 0, scale: 0.5 })
        assert.deepEqual(calls, [[{ id: "still" }, 0, 0, 100, 50, 0, 0, 50, 25]])
    })
})

describe("capScale", () => {
    test("no cap is the surface's own size", () => {
        assert.equal(capScale(null, 3200, 1800), 1)
        assert.equal(capScale(0, 3200, 1800), 1)
    })

    test("a cap fits the longest edge and never enlarges", () => {
        assert.equal(capScale(1600, 3200, 1800), 0.5)
        assert.equal(capScale(1600, 800, 600), 1)
    })
})

describe("encodeURL", () => {
    const real = globalThis.FileReader
    afterEach(() => {
        if (real === undefined) delete globalThis.FileReader
        else globalThis.FileReader = real
    })

    const reader = () => {
        globalThis.FileReader = class {
            readAsDataURL(blob) {
                this.result = `data:image/png;base64,${blob.size}`
                queueMicrotask(() => this.onload())
            }
        }
    }

    test("an encoder that can answer off the frame is asked to", async () => {
        reader()
        const asked = []
        const canvas = {
            toBlob: (cb, mime) => { asked.push(mime); cb({ size: 42 }) },
            toDataURL: () => { throw new Error("a synchronous encode would block the frame") },
        }
        assert.equal(await encodeURL(canvas, "png", 0.9), "data:image/png;base64,42")
        assert.deepEqual(asked, ["image/png"])
    })

    test("a canvas with only toDataURL still answers", async () => {
        reader()
        const canvas = { toDataURL: (mime) => `data:${mime};base64,sync` }
        assert.equal(await encodeURL(canvas, "png"), "data:image/png;base64,sync")
    })

    test("no reader in the world falls back rather than rejecting", async () => {
        delete globalThis.FileReader
        const canvas = {
            toBlob: () => { throw new Error("never asked without a reader") },
            toDataURL: () => "data:image/png;base64,sync",
        }
        assert.equal(await encodeURL(canvas, "png"), "data:image/png;base64,sync")
    })

    test("an encoder that yields no still is the empty picture, not a failed hatch", async () => {
        reader()
        const canvas = {
            toBlob: (cb) => cb(null),
            toDataURL: () => "data:image/png;base64,empty",
        }
        assert.equal(await encodeURL(canvas, "png"), "data:image/png;base64,empty")
    })
})

// --- The hatch's own snapshot: what leaves, at what size, through which encoder ---
//
// takeSnapshot rides document/ImageData/FileReader. The fixture gives exactly what
// the stage hands it: a readback of a known bitmap and no layers above it.

const canvases = []
const encodeCanvas = () => {
    const log = []
    const ctx = {
        putImageData: () => log.push("put"),
        drawImage: (...args) => log.push(["blit", ...args.slice(1)]),
        getImageData: () => { throw new Error("a canvas-only picture owes no readback") },
    }
    const canvas = {
        getContext: () => ctx,
        // The encoder lives on the canvas, as it does in the DOM. The still's own
        // size stands in for its bytes, so the crop is checkable.
        toBlob: (cb, mime) => { log.push(["toBlob", mime]); cb({ size: `${canvas.width}x${canvas.height}` }) },
        toDataURL: (mime) => {
            log.push(["toDataURL", mime]);
            return `data:${mime};base64,${canvas.width}x${canvas.height}`
        },
        log,
        width: 0,
        height: 0,
    }
    canvases.push(canvas)
    return canvas
}

const installPictureGlobals = () => {
    const real = { document: globalThis.document, ImageData: globalThis.ImageData, FileReader: globalThis.FileReader }
    canvases.length = 0
    globalThis.document = { createElement: () => encodeCanvas() }
    globalThis.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height } }
    globalThis.FileReader = class {
        readAsDataURL(blob) {
            this.result = `data:image/png;base64,${blob.size}`
            queueMicrotask(() => this.onload())
        }
    }
    return () => {
        for (const [key, value] of Object.entries(real)) {
            if (value === undefined) delete globalThis[key]
            else globalThis[key] = value
        }
    }
}

// Rows 1..4 of a six-row bitmap: the vertical flip mirrors them onto themselves.
const inkAt = (width, height, ink) => {
    const pixels = new Uint8Array(width * height * 4)
    for (const [x, y] of ink) pixels[(y * width + x) * 4 + 3] = 255
    return pixels
}

const recorder = (pixels, config = {}) => {
    const rec = Object.create(Recorder.prototype)
    rec._canvas = { width: 8, height: 6 }
    rec._gl = { RGBA: 1, UNSIGNED_BYTE: 2, readPixels() { throw new Error("the stage's own pixels are owed") } }
    rec._config = { snapshotFormat: "png", snapshotQuality: 0.9, snapshotMaxEdge: null, ...config }
    rec._destroyed = false
    rec._pixels = pixels
    return rec
}

describe("takeSnapshot", () => {
    test("a hatch publishes the padded crop and never encodes the whole frame", async () => {
        const restore = installPictureGlobals()
        try {
            const pixels = inkAt(8, 6, [[2, 1], [5, 4], [3, 3]])
            const shot = await recorder(pixels).takeSnapshot({ pixels, width: 8, height: 6, layers: [], full: false })
            assert.equal(shot.trimmed, "data:image/png;base64,8x8", "ink box 4x4 plus two pixels of air")
            assert.equal(shot.full, null, "no save asked for the whole frame")
            const trim = canvases.at(-1)
            assert.deepEqual(trim.log, [["blit", 2, 1, 4, 4, 2, 2, 4, 4], ["toBlob", "image/png"]],
                "one blit, one asynchronous encode")
        } finally { restore() }
    })

    test("a save is the one caller that pays for the whole frame", async () => {
        const restore = installPictureGlobals()
        try {
            const pixels = inkAt(8, 6, [[2, 1], [5, 4]])
            const shot = await recorder(pixels).takeSnapshot({ pixels, width: 8, height: 6, layers: [], full: true })
            assert.equal(shot.full, "data:image/png;base64,8x6")
            assert.equal(shot.trimmed, "data:image/png;base64,8x8", "the crop is owed as well as the frame")
        } finally { restore() }
    })

    test("an untrimmed still is the frame, and that is its picture", async () => {
        const restore = installPictureGlobals()
        try {
            const pixels = inkAt(8, 6, [[2, 1]])
            const shot = await recorder(pixels).takeSnapshot({ pixels, width: 8, height: 6, layers: [], trim: false })
            assert.equal(shot.trimmed, null)
            assert.equal(shot.full, "data:image/png;base64,8x6")
        } finally { restore() }
    })

    test("a writer's cap fits the crop, air included", async () => {
        const restore = installPictureGlobals()
        try {
            const pixels = inkAt(8, 6, [[2, 1], [5, 4]])
            await recorder(pixels, { snapshotMaxEdge: 4 })
                .takeSnapshot({ pixels, width: 8, height: 6, layers: [], full: false })
            const trim = canvases.at(-1)
            assert.equal(trim.width, 4, "an 8x8 still capped to its longest edge")
            assert.equal(trim.height, 4)
            assert.deepEqual(trim.log[0], ["blit", 2, 1, 4, 4, 1, 1, 2, 2])
        } finally { restore() }
    })

    test("a clear canvas has no crop to send", async () => {
        const restore = installPictureGlobals()
        try {
            const pixels = inkAt(8, 6, [])
            const shot = await recorder(pixels).takeSnapshot({ pixels, width: 8, height: 6, layers: [], full: false })
            assert.equal(shot.trimmed, null)
            assert.equal(shot.full, null)
        } finally { restore() }
    })
})
