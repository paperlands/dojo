// Marks share stage.project's client content pixels; this layer takes no input.
// It mounts beside its canvas and folds its own origin out of the drawing.
// Re-anchor at each draw so scrolling cannot drift marks. (id:host-surface)
import { CLIENT_SPACE } from "./laws/handle.js"
import { surfaceOf, surfaceOfCanvas, observeSurface, contentRectOf } from "./viewport.js"

// Just above the canvas, below page chrome; pointer-events:none means the layer
// never takes input, so stacking only decides what it is drawn over.
const Z_ABOVE_CANVAS = 2

// The one mount read: a designated host marked for JS ownership when the shell
// offers one, else the canvas's own parent, else the body. Pure, so the
// contract is testable without a DOM. (id:host-surface)
export function overlayMountFor(surface, doc = globalThis.document) {
    const parent = surface?.parentElement ?? null
    return parent?.querySelector?.('[data-turtle-overlay]') ?? parent ?? doc.body
}

// The layer occupies the projection's space, so the mark stays with its
// walking head when the camera moves.
export function createOverlay({ onResize, space = CLIENT_SPACE, canvas: surface = null } = {}) {
    if (space !== CLIENT_SPACE) throw new Error(`overlay: no placement for space "${space}"`)
    const host = globalThis
    const layer = document.createElement('canvas')
    Object.assign(layer.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        pointerEvents: 'none',
        zIndex: String(Z_ABOVE_CANVAS),
    })
    layer.setAttribute('aria-hidden', 'true')
    // The canvas's containing block, never `document.body` (that would stack one
    // overlay per canvas on the window). Prefer the designated host: it carries
    // phx-update="ignore", so morphdom cannot reconcile the JS-appended layer away
    // on a presence/hatch patch. (id:host-surface)
    const mount = overlayMountFor(surface)
    mount.appendChild(layer)
    // Heal a surface with no ignored host; the marks never outlive their mount. (id:host-surface)
    const ensureMounted = () => { if (!layer.isConnected) overlayMountFor(surface).appendChild(layer) }

    const ctx = layer.getContext('2d')
    let dpr = 1
    let width = 0
    let height = 0
    // A client's far edge is not its width unless the box starts at zero.
    let bounds = { left: 0, top: 0, right: 0, bottom: 0 }

    // The projection's own box: the surface's CSS size, which is what a
    // screen-space mark has to be sized against.
    function readSurface() {
        return surface
            ? surfaceOfCanvas(surface, { host })
            : surfaceOf({ rect: null, dpr: host.devicePixelRatio, fallback: { width: host.innerWidth, height: host.innerHeight } })
    }

    // Absolute offsets start at the offsetParent's padding box, not its border.
    function base() {
        const parent = layer.offsetParent
        if (!parent) return { left: 0, top: 0 }
        const rect = parent.getBoundingClientRect()
        const style = getComputedStyle(parent)
        // And its own scroll: absolute offsets start at the padding box in the
        // CONTENT's coordinates, so a scrolled offsetParent has to be added back or
        // the layer slides away by exactly the scroll.
        return {
            left: rect.left + (parseFloat(style.borderLeftWidth) || 0) - (parent.scrollLeft || 0),
            top: rect.top + (parseFloat(style.borderTopWidth) || 0) - (parent.scrollTop || 0),
        }
    }

    function place(box) {
        const from = base()
        const left = `${box.left - from.left}px`
        const top = `${box.top - from.top}px`
        if (layer.style.left !== left) layer.style.left = left
        if (layer.style.top !== top) layer.style.top = top
    }

    function resize() {
        const next = readSurface()
        if (!next) return
        // A collapsed canvas is a zero. Leaving the previous CSS size in place
        // keeps a 320px layer over a canvas the page has closed.
        if (next.collapsed) {
            dpr = next.dpr
            width = 0
            height = 0
            layer.style.width = "0px"
            layer.style.height = "0px"
            if (next.client) place(next.client)
            bounds = { left: next.left, top: next.top, right: next.left, bottom: next.top }
            return
        }
        // A transformed canvas has a client box that is not its layout size.
        // The layer covers the visual box. Projection into that box is refused
        // by the stage, so marks are not drawn in a mixed space.
        if (next.transformed && next.client) {
            dpr = next.dpr
            width = next.client.width
            height = next.client.height
            place(next.client)
            layer.style.width = `${width}px`
            layer.style.height = `${height}px`
        } else {
            dpr = next.dpr
            width = next.width
            height = next.height
            place(next.client ?? next)
            layer.style.width = `${width}px`
            layer.style.height = `${height}px`
        }
        // Guarded: assigning to a canvas's width or height CLEARS it, even when the
        // value is unchanged — and `resize` is also called on scroll, where nothing
        // about the size moves and the marks have to survive.
        const bitmap = [Math.max(1, Math.floor(width * dpr)), Math.max(1, Math.floor(height * dpr))]
        if (layer.width !== bitmap[0]) layer.width = bitmap[0]
        if (layer.height !== bitmap[1]) layer.height = bitmap[1]
        // Draw in CSS pixels; the device ratio belongs to the backing store.
        anchor()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        // A resize clears the backing store: whoever draws on this layer must be
        // told, or the marks are erased until something else wakes the frame.
        onResize?.()
    }

    // Layout can move without resizing. Re-place at every draw, then fold
    // the layer's origin out so callers keep speaking client pixels.
    function anchor() {
        if (surface) {
            const rect = contentRectOf(surface)
            // A transform has a visual box and no content-box mapping. Place
            // against that visual box, in the one space it was measured in.
            const at = rect?.supported === false ? rect.visual : rect
            if (at && Number.isFinite(at.left)) place(at)
        }
        const box = layer.getBoundingClientRect()
        bounds = { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
        ctx.setTransform(dpr, 0, 0, dpr, -(box.left || 0) * dpr, -(box.top || 0) * dpr)
    }

    const stopLayer = observeSurface(layer, resize)
    const stopSurface = surface ? observeSurface(surface, resize) : () => {}
    // Scroll moves without resizing: re-place and redraw on every ancestor's scroll.
    // Other layout-only moves wait for the next draw. (id:host-surface)
    const onScroll = () => resize()
    host.document?.addEventListener('scroll', onScroll, { capture: true, passive: true })
    resize()

    return {
        get ctx() { return ctx },
        get width() { return width },
        get height() { return height },
        // The layer's client-space box. A mark projected to a client point is inside
        // this box or it is off the ink, and that is the only comparison that stays
        // true when the canvas is not at the viewport's origin.
        get left() { return bounds.left },
        get top() { return bounds.top },
        get right() { return bounds.right },
        get bottom() { return bounds.bottom },
        begin() {
            // Clear in device pixels, then re-anchor: `begin` opens the frame the
            // marks are drawn in, so the origin is read here rather than trusted
            // from the last resize.
            ensureMounted()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, layer.width, layer.height)
            anchor()
        },
        dispose() {
            stopLayer()
            stopSurface()
            host.document?.removeEventListener('scroll', onScroll, { capture: true })
            // And the element itself. Dropping the reference is not disposal: without
            // this the layer stays in the page for good, one per hatch, invisible and
            // never drawn to — the accumulation the layer fixture now asserts against.
            layer.remove()
        },
    }
}
