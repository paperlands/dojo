// LineMaterial cache by style; stage-owned lifetime. (spec A3, id:child-ink)

import { LineMaterial } from '../../../utils/three-addons/lines/LineMaterial.js'
import { INK } from '../../ink.js'

export function createMaterialCache(opts = {}) {
    const cache = new Map()
    const variants = new Map()
    let origins = new WeakMap()
    let bindings = new WeakMap()
    let disposed = false
    let resolution = { width: 1, height: 1 }
    const make = opts.createMaterial || defaultLineMaterial
    const requireLive = () => {
        if (disposed) throw new Error('materialCache: used after dispose')
    }
    const adopt = (mat) => {
        mat._cached = true
        mat.resolution?.set(resolution.width, resolution.height)
        return mat
    }
    const get = (key, color, thickness, vertexColors) => {
        requireLive()
        if (!cache.has(key)) {
            const mat = adopt(make(color, thickness, { vertexColors }))
            cache.set(key, mat)
            origins.set(mat, mat)
        }
        return cache.get(key)
    }
    const releaseEntries = (entries) => {
        for (const entry of entries) {
            if (--entry.refs > 0) continue
            entry.material.dispose?.()
            origins.delete(entry.material)
            const degrees = variants.get(entry.base)
            degrees.delete(entry.opacity)
            if (!degrees.size) variants.delete(entry.base)
        }
    }
    const release = (mesh) => {
        const binding = bindings.get(mesh)
        if (!binding) return
        bindings.delete(mesh)
        releaseEntries(binding.entries)
    }

    return {
        get size() { return cache.size },
        get variantCount() { return [...variants.values()].reduce((n, degrees) => n + degrees.size, 0) },
        get(color, thickness) {
            return get(`${color || INK}:${thickness || 2}`, color, thickness, false)
        },
        getInk(thickness) {
            return get(`ink:${thickness || 2}`, 0xffffff, thickness, true)
        },

        // A binding owns its variant lease, not a flag on the mesh. (id:child-ink)
        bindOpacity(mesh, opacity) {
            requireLive()
            const previous = bindings.get(mesh)
            if (!previous && !Array.isArray(mesh.material) &&
                (!origins.has(mesh.material) || (opacity === 1 && origins.get(mesh.material) === mesh.material))) return
            if (previous?.material === mesh.material && previous.opacity === opacity && !Array.isArray(mesh.material)) return
            const entries = []
            const bind = (material) => {
                const base = origins.get(material)
                if (!base || opacity === 1) return base ?? material
                let degrees = variants.get(base)
                if (!degrees) variants.set(base, degrees = new Map())
                let entry = degrees.get(opacity)
                if (!entry) {
                    const variant = adopt(base.clone())
                    variant.opacity = opacity
                    variant.transparent = opacity < 1
                    variant.depthWrite = opacity >= 1
                    entry = { base, opacity, material: variant, refs: 0 }
                    degrees.set(opacity, entry)
                    origins.set(variant, base)
                }
                entry.refs++
                entries.push(entry)
                return entry.material
            }
            const material = Array.isArray(mesh.material) ? mesh.material.map(bind) : bind(mesh.material)
            // Acquire before releasing: an unchanged array may still use the same variant.
            release(mesh)
            mesh.material = material
            bindings.set(mesh, { material, opacity, entries })
        },
        release,

        // Base and leased materials share the surface's resolution. (id:host-surface)
        updateResolution(width, height) {
            resolution = { width, height }
            for (const mat of cache.values()) mat.resolution?.set(width, height)
            for (const degrees of variants.values()) {
                for (const entry of degrees.values()) entry.material.resolution?.set(width, height)
            }
        },
        clear() {
            for (const degrees of variants.values()) {
                for (const entry of degrees.values()) entry.material.dispose?.()
            }
            variants.clear()
            for (const mat of cache.values()) mat.dispose?.()
            cache.clear()
            origins = new WeakMap()
            bindings = new WeakMap()
        },
        dispose() {
            if (disposed) return
            disposed = true
            this.clear()
        },
    }
}

function defaultLineMaterial(color, thickness, opts = {}) {
    return new LineMaterial({
        color: opts.vertexColors ? 0xffffff : (color || INK),
        linewidth: thickness || 2,
        vertexColors: !!opts.vertexColors,
        dashed: false,
    })
}
