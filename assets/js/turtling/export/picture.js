// A picture is its surfaces, bottom→top. (id:host-surface)
//
// Marks ride their own 2D layer above the GL canvas, so a still read from the
// canvas alone is the geometry without its pins, rims and names. This is the one
// composite: canvas→canvas drawImage is a GPU copy — no readback, no pixel loop —
// and it stays correct when the layer holds nothing or when a mark has already
// moved into the scene (that layer simply stops being offered).
//
// THREE-free and DOM-free so the ordering can be asserted with a stub context.
export function composeLayers(ctx, layers, width, height) {
    for (const layer of layers ?? []) {
        // An unsized or collapsed layer has no ink, and a zero-dimension source
        // is not worth asking drawImage about.
        if (!(layer?.width > 0) || !(layer?.height > 0)) continue
        ctx.drawImage(layer, 0, 0, width, height)
    }
}

// The ink a trim can see. Marks are pictures too: without them the crop box
// follows the geometry and cuts away whatever sits outside it. The readback is
// per hatch, never per frame — and skipped entirely for a canvas-only picture.
export function inkOf(ctx, layers, width, height, canvasInk) {
    return layers?.length ? ctx.getImageData(0, 0, width, height) : canvasInk
}

// Alpha is every fourth byte. Read as words it is ONE test per pixel instead of a
// byte fetch; detected, not assumed, so a big-endian host still reads byte 3.
const ALPHA_MASK = (() => {
    const probe = new Uint32Array(new Uint8Array([0, 0, 0, 0xff]).buffer)
    return probe[0] === 0xff000000 ? 0xff000000 : 0xff
})()

function alphaWords(data) {
    if (data.byteOffset % 4 !== 0 || data.byteLength % 4 !== 0) return null
    return new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4)
}

// The ink's own box, in the picture's pixels — { x, y, width, height }, or null
// when nothing was drawn. Pure, so the crop is asserted without a canvas.
// Each row is entered from both ends, so a stroke costs the pixels outside its
// extent (measured: 4.7 ms vs 17.8 on a canvas-filling figure at 3200x1800).
// The loops are spelled twice on purpose: a per-pixel closure cost 1.8x here.
export function inkBox(imageData) {
    const { width, height, data } = imageData ?? {}
    if (!(width > 0) || !(height > 0) || !data) return null
    const words = alphaWords(data)
    let xMin = width, xMax = -1, yMin = height, yMax = -1
    if (words) {
        for (let y = 0; y < height; y++) {
            const rowStart = y * width
            let first = 0
            while (first < width && (words[rowStart + first] & ALPHA_MASK) === 0) first++
            if (first === width) continue
            let last = width - 1
            while (last > first && (words[rowStart + last] & ALPHA_MASK) === 0) last--
            if (first < xMin) xMin = first
            if (last > xMax) xMax = last
            if (y < yMin) yMin = y
            yMax = y
        }
    } else {
        // An unaligned view is not the readback's own; bytes answer it exactly.
        for (let y = 0; y < height; y++) {
            const rowStart = y * width * 4
            let first = 0
            while (first < width && data[rowStart + first * 4 + 3] === 0) first++
            if (first === width) continue
            let last = width - 1
            while (last > first && data[rowStart + last * 4 + 3] === 0) last--
            if (first < xMin) xMin = first
            if (last > xMax) xMax = last
            if (y < yMin) yMin = y
            yMax = y
        }
    }
    if (xMax < xMin || yMax < yMin) return null
    return { x: xMin, y: yMin, width: xMax - xMin + 1, height: yMax - yMin + 1 }
}

// The crop is DRAWN, not copied: one blit of the ink box into the still that gets
// encoded, so no per-row pixel loop and no second full-size ImageData. Source and
// target are different canvases (drawImage refuses a canvas as its own source).
// `scale` fits an output cap; the pad stays air around the ink, as before.
export function cropInto(ctx, source, box, { pad = 0, scale = 1 } = {}) {
    ctx.drawImage(source, box.x, box.y, box.width, box.height,
        pad * scale, pad * scale, box.width * scale, box.height * scale)
}

// A still is encoded OFF the frame: toBlob hands the PNG to the browser's own
// encoder, and the reader returns the data URL the keep publishes. toDataURL
// blocks the main thread for the whole encode — that stall was the first-hatch
// hitch. Fall back only where no asynchronous path exists. (id:host-surface)
export function encodeURL(canvas, type, quality) {
    const mime = `image/${type}`
    const synchronous = () => canvas.toDataURL(mime, quality)
    const Reader = globalThis.FileReader
    if (typeof canvas.toBlob !== 'function' || typeof Reader !== 'function') {
        return Promise.resolve(synchronous())
    }
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            // An encoder that answers nothing is the old "data:," case: an empty
            // still, not a rejected hatch.
            if (!blob) { resolve(synchronous()); return }
            const reader = new Reader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = () => reject(reader.error ?? new Error('snapshot encode unreadable'))
            reader.readAsDataURL(blob)
        }, mime, quality)
    })
}

// How much of a still survives `maxEdge` — 1 when the writer set no cap.
export function capScale(maxEdge, width, height) {
    if (!(maxEdge > 0)) return 1
    const longest = Math.max(width, height)
    return longest > maxEdge ? maxEdge / longest : 1
}
