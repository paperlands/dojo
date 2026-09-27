// Framing a bounded figure: the camera pose that fills the view with a set of
// world extents. The mark keeps its true size — only the eye moves, so a bounded
// locus is framed, never enlarged. (id:laws-freedom)
//
// Pure: numbers in, a camera pose out. The stage applies it; no DOM, no THREE.

import { basisOf } from "./meet.js"

const RAD = Math.PI / 180
const DEFAULT_DIR = [0.6, 0.5, 0.8]

const len = (v) => Math.hypot(v[0], v[1], v[2])
const unit = (v) => { if (!Array.isArray(v)) return null; const n = len(v); return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : null }
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)

// The smallest sphere enclosing a set of spheres, grown one at a time. Exact for
// a single bounded mark; a figure's extents are only ever an envelope.
// (id:laws-freedom)
export function unionBounds(spheres) {
    const list = (spheres ?? []).filter((s) => s && finite3(s.center) && Number.isFinite(s.radius))
    if (list.length === 0) return null
    let center = [...list[0].center]
    let radius = Math.max(0, list[0].radius)
    for (let i = 1; i < list.length; i++) {
        const s = list[i]
        const d = len([s.center[0] - center[0], s.center[1] - center[1], s.center[2] - center[2]])
        const r = Math.max(0, s.radius)
        if (d + r <= radius) continue
        if (d + radius <= r) { center = [...s.center]; radius = r; continue }
        const grown = (radius + d + r) / 2
        const t = d > 1e-12 ? (grown - radius) / d : 0
        center = center.map((c, k) => c + (s.center[k] - c) * t)
        radius = grown
    }
    return { center, radius }
}

// A direction oblique to the primary bounded mark's normal. A circle read on its
// own normal is a point on the sight line; tilting off it makes the circle read
// as a curve. No bounded mark: a studio three-quarter view. (id:laws-freedom)
export function viewDirection(normal = null) {
    const n = unit(normal)
    if (!n) return [...DEFAULT_DIR]
    const t = basisOf(n)?.u ?? [1, 0, 0]
    const tilt = 48 * RAD
    return unit([
        n[0] * Math.cos(tilt) + t[0] * Math.sin(tilt),
        n[1] * Math.cos(tilt) + t[1] * Math.sin(tilt),
        n[2] * Math.cos(tilt) + t[2] * Math.sin(tilt),
    ]) ?? [...DEFAULT_DIR]
}

// The camera pose that frames `bounds`. The distance puts the bounding radius on
// the tighter half-FOV with a margin, floored so the pivot law still holds — a
// small figure is framed by the floor, not by inflating the mark. (id:laws-freedom)
export function fitPose(bounds, { dir = DEFAULT_DIR, fovDeg = 60, aspect = 1, floor = 0, margin = 1.12 } = {}) {
    if (!bounds || !finite3(bounds.center)) return null
    const n = unit(dir) ?? [...DEFAULT_DIR]
    const halfV = (Number.isFinite(fovDeg) ? fovDeg : 60) * RAD / 2
    const halfH = Math.atan(Math.tan(halfV) * (aspect > 0 ? aspect : 1))
    const half = Math.max(1e-4, Math.min(halfV, halfH))
    const radius = Math.max(0, Number.isFinite(bounds.radius) ? bounds.radius : 0)
    const need = (radius / Math.sin(half)) * margin
    const distance = Math.max(Number.isFinite(floor) ? floor : 0, need)
    return {
        target: [...bounds.center],
        position: [
            bounds.center[0] + n[0] * distance,
            bounds.center[1] + n[1] * distance,
            bounds.center[2] + n[2] * distance,
        ],
        distance,
    }
}
