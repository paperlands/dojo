// A 2D layer over the canvas, for pencil marks. (id:laws-decl-handle)
//
// Paper stays WebGL; the interface is drawn here — at viewport coordinates, in
// CSS pixels, through the SAME projection the hit test uses. What is drawn and
// what is touchable therefore cannot disagree, which is the one failure this
// whole seam has repeatedly produced.
//
// Fixed to the viewport and transparent to pointers, so it needs no knowledge
// of the canvas's position, scrolling or the page around it.

export function createOverlay({ onResize } = {}) {
    const canvas = document.createElement('canvas')
    Object.assign(canvas.style, {
        position: 'fixed',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '2',
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
