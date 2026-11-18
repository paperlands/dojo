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
