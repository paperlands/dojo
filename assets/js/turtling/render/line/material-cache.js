// LineMaterial cache by style; stage-owned lifetime. (spec A3, id:child-ink)

import { LineMaterial } from '../../../utils/three-addons/lines/LineMaterial.js'
import { INK } from '../../ink.js'

// opts.createMaterial — inject for headless tests; production tags _cached.
export function createMaterialCache(opts = {}) {
    const cache = new Map()
    let disposed = false
    // Materials inherit the stage's current surface resolution, not the window.
    // Remember it for materials created after a resize. (id:host-surface)
    let resolution = { width: 1, height: 1 }
    const make = opts.createMaterial || defaultLineMaterial
    // Every material this cache creates carries the current resolution, so one made
    // between resizes is not silently sized to whatever it happened to be then.
    const adopt = (key, mat) => {
        mat._cached = true
        mat.resolution?.set(resolution.width, resolution.height)
        cache.set(key, mat)
        return mat
    }

    return {
        get size() { return cache.size },

        get(color, thickness) {
            if (disposed) throw new Error('materialCache: used after dispose')
            const key = `${color || INK}:${thickness || 2}`
            let mat = cache.get(key)
            if (!mat) {
                mat = adopt(key, make(color, thickness, { vertexColors: false }))
            }
            return mat
        },

        // Thickness-only key; vertex colours carry ink. (id:child-ink)
        getInk(thickness) {
            if (disposed) throw new Error('materialCache: used after dispose')
            const key = `ink:${thickness || 2}`
            let mat = cache.get(key)
            if (!mat) {
                mat = adopt(key, make(0xffffff, thickness, { vertexColors: true }))
            }
            return mat
        },

        // Line width is screen-space — keep resolution current after resize.
        updateResolution(width, height) {
            resolution = { width, height }
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
        color: opts.vertexColors ? 0xffffff : (color || INK),
        linewidth: thickness || 2,
        vertexColors: !!opts.vertexColors,
        dashed: false,
    })
    // The resolution is the stage's to set (see `adopt` above); LineMaterial's own
    // default is (1, 1), and the stage sets the surface before anything draws.
    return mat
}
