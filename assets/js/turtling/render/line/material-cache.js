// LineMaterial cache by style; stage-owned lifetime. (spec A3, id:child-ink)

import { LineMaterial } from '../../../utils/three-addons/lines/LineMaterial.js'

// opts.createMaterial — inject for headless tests; production tags _cached.
export function createMaterialCache(opts = {}) {
    const cache = new Map()
    let disposed = false
    const make = opts.createMaterial || defaultLineMaterial

    return {
        get size() { return cache.size },

        get(color, thickness) {
            if (disposed) throw new Error('materialCache: used after dispose')
            const key = `${color || 0xe77808}:${thickness || 2}`
            let mat = cache.get(key)
            if (!mat) {
                mat = make(color, thickness, { vertexColors: false })
                mat._cached = true
                cache.set(key, mat)
            }
            return mat
        },

        // Thickness-only key; vertex colours carry ink. (id:child-ink)
        getInk(thickness) {
            if (disposed) throw new Error('materialCache: used after dispose')
            const key = `ink:${thickness || 2}`
            let mat = cache.get(key)
            if (!mat) {
                mat = make(0xffffff, thickness, { vertexColors: true })
                mat._cached = true
                cache.set(key, mat)
            }
            return mat
        },

        // Line width is screen-space — keep resolution current after resize.
        updateResolution(width, height) {
            for (const mat of cache.values()) mat.resolution?.set(width, height)
        },

        // Blank slate (turtle.reset / compositor.dispose). Stage still owns us.
        clear() {
            for (const mat of cache.values()) mat.dispose?.()
            cache.clear()
        },

        // End of WebGL life (stage.dispose). Idempotent.
        dispose() {
            if (disposed) return
            disposed = true
            this.clear()
        },
    }
}

function defaultLineMaterial(color, thickness, opts = {}) {
    const mat = new LineMaterial({
        color: opts.vertexColors ? 0xffffff : (color || 0xe77808),
        linewidth: thickness || 2,
        vertexColors: !!opts.vertexColors,
        dashed: false,
    })
    mat.resolution.set(window.innerWidth, window.innerHeight)
    return mat
}
