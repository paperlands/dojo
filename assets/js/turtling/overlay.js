// The 2D observer layer over WebGL: place marks share stage.project's
// client/CSS pixel coordinates. It never receives pointer input.
// (id:laws-place-head-frame)
//
// Fixed to the viewport and transparent to pointers, so it needs no knowledge
// of the canvas's position, scrolling or the page around it.
import { CLIENT_SPACE } from "./laws/handle.js"

// Just above the canvas, below page chrome; pointer-events:none means the layer
// never takes input, so stacking only decides what it is drawn over.
const Z_ABOVE_CANVAS = 2

// The layer occupies the projection's space, so the mark stays with its
// walking head when the camera moves.
export function createOverlay({ onResize, space = CLIENT_SPACE } = {}) {
    if (space !== CLIENT_SPACE) throw new Error(`overlay: no placement for space "${space}"`)
    const canvas = document.createElement('canvas')
    Object.assign(canvas.style, {
        position: 'fixed',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: String(Z_ABOVE_CANVAS),
    })
    canvas.setAttribute('aria-hidden', 'true')
    document.body.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    let dpr = 1
    let width = 0
    let height = 0

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2)
        width = window.innerWidth
        height = window.innerHeight
        canvas.width = Math.max(1, Math.floor(width * dpr))
        canvas.height = Math.max(1, Math.floor(height * dpr))
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
        // Draw in CSS pixels; the device ratio belongs to the backing store.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        // A resize clears the backing store: whoever draws on this layer must be
        // told, or the marks are erased until something else wakes the frame.
        onResize?.()
    }
    resize()
    window.addEventListener('resize', resize)

    return {
        get ctx() { return ctx },
        get width() { return width },
        get height() { return height },
        begin() {
            ctx.clearRect(0, 0, width, height)
        },
        dispose() {
            window.removeEventListener('resize', resize)
            canvas.remove()
        },
    }
}
