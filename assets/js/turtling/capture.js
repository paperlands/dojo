// One active cut and one unissued demand. The cut is a value, not a live alias.
// Claim stays off the server payload; pace checks the same object again.

export function copyValue(value) {
    return structuredClone(value)
}

export function copyBody(body) {
    if (!body || typeof body !== "object") return null
    return copyValue(body)
}

/** Collapsed layers are absent. A sized layer that cannot be drawn is a failed cut. */
export function copySurface(layer, make) {
    if (!(layer?.width > 0) || !(layer?.height > 0)) return undefined
    const surface = make?.(layer.width, layer.height)
    if (!surface) return null
    const ctx = surface.getContext?.("2d")
    if (!ctx?.drawImage) return null
    try {
        ctx.drawImage(layer, 0, 0)
    } catch (error) {
        if (error?.name === "InvalidStateError") return null
        throw error
    }
    return surface
}

export function copyLayers(layers, make) {
    const copied = []
    for (const layer of layers ?? []) {
        const surface = copySurface(layer, make)
        if (surface === undefined) continue
        if (!surface) return null
        copied.push(surface)
    }
    return copied
}

export function makeSurface(width, height) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height)
    if (typeof document !== "undefined") {
        const el = document.createElement("canvas")
        el.width = width
        el.height = height
        return el
    }
    return null
}

function slot() {
    let resolve
    const promise = new Promise((done) => { resolve = done })
    return { promise, resolve, done: false, cut: null }
}

export function createCapture() {
    let active = null
    let next = null
    let closed = false

    function settle(which, value) {
        if (!which || which.done) return
        which.done = true
        which.resolve(value)
        if (which === active) active = null
        if (which === next) next = null
    }

    function picture() {
        if (closed) return Promise.resolve(null)
        if (!next) next = slot()
        return next.promise
    }

    function reserve() {
        if (closed) return null
        const which = next ?? slot()
        next = null
        active = which
        return which
    }

    function begin(cut) {
        const which = reserve()
        if (!which) return null
        which.cut = cut
        return which
    }

    function finish(which, path) {
        if (!which?.cut) {
            settle(which, null)
            return
        }
        settle(which, { body: which.cut.body, path, claim: which.cut.claim })
    }

    function fail(which) {
        settle(which, null)
    }

    function takeUnissued() {
        const which = next
        next = null
        return which
    }

    function close() {
        closed = true
        settle(active, null)
        settle(next, null)
    }

    return {
        picture,
        reserve,
        begin,
        finish,
        fail,
        takeUnissued,
        close,
        active: () => active,
        get hatching() { return !!active && !active.done },
    }
}

export function currentDemand(current, bufferId, workId = null, baseId = null) {
    return {
        ...current,
        buffer_id: bufferId ?? null,
        work_id: workId ?? null,
        base_id: baseId ?? null,
        path: null,
    }
}

/** The lent body is the document. An unbound source, or no claim, is not a hatch. */
export function publishCapture(payload, pacedHatch) {
    const body = payload?.body
    if (!body || typeof body !== "object" || !payload.claim) return false
    const wire = { ...body, path: payload.path ?? null }
    delete wire.claim
    pacedHatch(wire, payload.claim)
    return true
}
