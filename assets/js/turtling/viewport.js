// Layout sizes the buffer; client content pixels place marks; DPR sets density.
// A connected zero stays collapsed. Transformed projection is unsupported.
// The window substitutes only for an unavailable surface. (id:host-surface)

const MAX_DPR = 2
const TRANSFORM_SLOP = 1

function ratioOf(dpr) {
    return Math.min(Number.isFinite(+dpr) && +dpr > 0 ? +dpr : 1, MAX_DPR)
}

function box(left, top, width, height) {
    return { left, top, width, height, right: left + width, bottom: top + height }
}

/**
 * Client-space content box, or an explicit refusal when layout and the visual
 * box are not the same space.
 *
 * `visual` is the border box from getBoundingClientRect. `layout` is the
 * untransformed content size. Border and padding are CSS pixels of the
 * untransformed element. Under a transform those insets are not in `visual`'s
 * space, so the box is not invented by mixing the two.
 */
export function clientContentBox({ visual, border, padding, layout }) {
    const padX = (padding?.left || 0) + (padding?.right || 0)
    const padY = (padding?.top || 0) + (padding?.bottom || 0)
    const borderX = (border?.left || 0) + (border?.right || 0)
    const borderY = (border?.top || 0) + (border?.bottom || 0)
    const layoutW = Math.max(0, layout?.width || 0)
    const layoutH = Math.max(0, layout?.height || 0)
    const visualW = Math.max(0, (visual?.width || 0) - borderX - padX)
    const visualH = Math.max(0, (visual?.height || 0) - borderY - padY)
    const transformed = Math.abs(visualW - layoutW) > TRANSFORM_SLOP
        || Math.abs(visualH - layoutH) > TRANSFORM_SLOP
    if (transformed) {
        const left = visual?.left || 0
        const top = visual?.top || 0
        const width = visual?.width || 0
        const height = visual?.height || 0
        return {
            supported: false,
            reason: "transformed",
            layout: { width: layoutW, height: layoutH },
            visual: {
                left, top, width, height,
                right: Number.isFinite(visual?.right) ? visual.right : left + width,
                bottom: Number.isFinite(visual?.bottom) ? visual.bottom : top + height,
            },
        }
    }
    const left = (visual?.left || 0) + (border?.left || 0) + (padding?.left || 0)
    const top = (visual?.top || 0) + (border?.top || 0) + (padding?.top || 0)
    const content = box(left, top, layoutW, layoutH)
    return { supported: true, ...content, layout: { width: layoutW, height: layoutH } }
}

/**
 * A projected client point is inside the content box, or it is not. A box that
 * does not name its far edges is not treated as unbounded.
 */
export function withinClient(rect, x, y) {
    if (!rect || rect.supported === false) return false
    if (!(rect.width > 0) || !(rect.height > 0)) return false
    const right = Number.isFinite(rect.right) ? rect.right : rect.left + rect.width
    const bottom = Number.isFinite(rect.bottom) ? rect.bottom : rect.top + rect.height
    return x >= rect.left && x <= right && y >= rect.top && y <= bottom
}

/** NDC (after the camera projection) into a client point, or null when it misses the box. */
export function projectClient(rect, ndcX, ndcY) {
    if (!rect || rect.supported === false || !(rect.width > 0) || !(rect.height > 0)) return null
    const x = rect.left + (ndcX * 0.5 + 0.5) * rect.width
    const y = rect.top + (-ndcY * 0.5 + 0.5) * rect.height
    if (!withinClient(rect, x, y)) return null
    return { x, y }
}

function describe({ state, width, height, dpr, left, top, right, bottom, windowed, collapsed, transformed, client }) {
    return {
        state, width, height, dpr, left, top, right, bottom,
        windowed, collapsed, transformed,
        layout: { width, height },
        client,
    }
}

/**
 * A surface folded from a measured box and a device ratio.
 *
 * @param {object} o
 * @param {object|null} o.rect        client content box, when there is one
 * @param {number} o.dpr
 * @param {object|null} o.fallback    window size, only for an unavailable surface
 * @param {boolean} o.connected
 * @param {boolean} o.transformed
 * @param {object|null} o.layout      untransformed content size, when transformed
 * @param {object|null} o.visual      transformed border box in client pixels
 * @returns {object|null}
 */
export function surfaceOf({
    rect = null, dpr = 1, fallback = null, connected = false,
    transformed = false, layout = null, visual = null,
} = {}) {
    const ratio = ratioOf(dpr)
    if (transformed && layout && layout.width > 0 && layout.height > 0) {
        const left = visual?.left || 0
        const top = visual?.top || 0
        const width = visual?.width || 0
        const height = visual?.height || 0
        const client = visual ? box(left, top, width, height) : null
        if (client && Number.isFinite(visual.right)) client.right = visual.right
        if (client && Number.isFinite(visual.bottom)) client.bottom = visual.bottom
        return describe({
            state: "transformed",
            width: layout.width, height: layout.height, dpr: ratio,
            left, top, right: client?.right ?? left, bottom: client?.bottom ?? top,
            windowed: false, collapsed: false, transformed: true, client,
        })
    }
    const boxed = !!(rect && rect.width > 0 && rect.height > 0)
    // A connected canvas with no box has been collapsed by the page. The
    // measurement is that zero. A previous buffer may stay; this object does
    // not replace the zero with the window.
    if (!boxed && connected) {
        const left = rect?.left || 0
        const top = rect?.top || 0
        const client = box(left, top, 0, 0)
        return describe({
            state: "collapsed",
            width: 0, height: 0, dpr: ratio,
            left, top, right: left, bottom: top,
            windowed: false, collapsed: true, transformed: false, client,
        })
    }
    const source = boxed ? rect : fallback
    if (!source || !(source.width > 0) || !(source.height > 0)) return null
    const left = boxed ? (rect.left || 0) : 0
    const top = boxed ? (rect.top || 0) : 0
    const width = source.width
    const height = source.height
    const right = boxed && Number.isFinite(rect.right) ? rect.right : left + width
    const bottom = boxed && Number.isFinite(rect.bottom) ? rect.bottom : top + height
    const client = boxed ? { left, top, width, height, right, bottom } : null
    return describe({
        state: boxed ? "measured" : "unavailable",
        width, height, dpr: ratio, left, top, right, bottom,
        windowed: !boxed, collapsed: false, transformed: false, client,
    })
}

/** The surface a canvas is. */
export function surfaceOfCanvas(canvas, { host = globalThis } = {}) {
    const box = canvas ? contentRectOf(canvas) : null
    const transformed = box?.supported === false
    return surfaceOf({
        rect: transformed ? null : box,
        transformed,
        layout: transformed ? box.layout : null,
        visual: transformed ? box.visual : null,
        dpr: host?.devicePixelRatio,
        fallback: { width: host?.innerWidth ?? 0, height: host?.innerHeight ?? 0 },
        // Explicitly `=== true`. A canvas with no `isConnected` at all — a plain
        // object, a stub — is DETACHED, which is the fallback path.
        connected: canvas?.isConnected === true,
    })
}

function px(style, name) {
    return parseFloat(style?.[name]) || 0
}

/**
 * The box a canvas DRAWS in: its content box, in one space.
 *
 * A border is decoration around the bitmap. The runtime detects the
 * intrinsic-size echo by comparing the box it measured against the bitmap it
 * wrote, and a border made those two numbers never equal.
 *
 * CSS transform is unsupported for projection. The returned box says so
 * instead of pairing an untransformed clientWidth with a transformed rect.
 */
export function contentRectOf(canvas) {
    const visual = canvas.getBoundingClientRect()
    const style = getComputedStyle(canvas)
    const border = {
        left: px(style, "borderLeftWidth"), right: px(style, "borderRightWidth"),
        top: px(style, "borderTopWidth"), bottom: px(style, "borderBottomWidth"),
    }
    const padding = {
        left: px(style, "paddingLeft"), right: px(style, "paddingRight"),
        top: px(style, "paddingTop"), bottom: px(style, "paddingBottom"),
    }
    const padX = padding.left + padding.right
    const padY = padding.top + padding.bottom
    // A real element always has clientWidth, including 0. A stub that only has
    // a rect is measured from that rect, which is the same space when nothing
    // is transformed.
    const layout = {
        width: Math.max(0, (Number.isFinite(canvas.clientWidth) ? canvas.clientWidth : visual.width) - padX),
        height: Math.max(0, (Number.isFinite(canvas.clientHeight) ? canvas.clientHeight : visual.height) - padY),
    }
    return clientContentBox({ visual, border, padding, layout })
}

/**
 * Watch everything that can change a surface, and report each change.
 *
 * A ResizeObserver cannot see a device ratio change: the box is identical when
 * the window moves to another display, or the page zooms. So the ratio is
 * watched by a media query re-armed on every hit. Returns the disposer.
 */
export function observeSurface(element, onChange, { host = globalThis } = {}) {
    let stopRatio = () => {}
    const arm = () => {
        stopRatio()
        const query = host?.matchMedia?.(`(resolution: ${host.devicePixelRatio || 1}dppx)`)
        if (typeof query?.addEventListener !== "function") return
        const onRatio = () => { arm(); onChange() }
        query.addEventListener("change", onRatio, { once: true })
        stopRatio = () => query.removeEventListener("change", onRatio)
    }
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => onChange()) : null
    observer?.observe(element)
    arm()
    return () => {
        observer?.disconnect()
        stopRatio()
    }
}
