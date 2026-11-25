// One rendered frame's effective view: frozen numbers and two pure helpers.
// screen = projection · worldToView · world; units are CSS content-local px.
// (id:host-embedding-slice-1-view)

import { Matrix4, Quaternion, Vector3 } from '../utils/three-entry.js'
import { snapshotFact } from './observation.js'

// Allow matrix-inversion roundoff at clip edges, far below a CSS pixel.
const CLIP_EPSILON = 1e-9
const finite3 = (v) => Array.isArray(v) && v.length >= 3
    && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])

const elementsOf = (matrix) => {
    const source = Array.isArray(matrix) ? matrix : matrix?.elements
    if (!source || source.length !== 16) return null
    const copy = Array.from(source)
    return copy.every(Number.isFinite) ? copy : null
}

// A reframe is an SE3: quaternion {x,y,z,w} plus position. null is identity.
function reframeMatrix(reframe) {
    if (!reframe) return null
    const r = reframe.rotation, p = reframe.position
    if (!r || !finite3(p)) return null
    const [x, y, z, w] = [r.x, r.y, r.z, r.w]
    if (![x, y, z, w].every(Number.isFinite)) return null
    return new Matrix4().compose(
        new Vector3(p[0], p[1], p[2]),
        new Quaternion(x, y, z, w),
        new Vector3(1, 1, 1),
    )
}

/** World→view = C⁻¹ · R, derived from the pose, never read from a copy. */
export function worldToViewOf(camera, reframe = null) {
    const world = camera?.matrixWorld
    if (!elementsOf(world)) return null
    const determinant = world.determinant()
    if (!Number.isFinite(determinant) || determinant === 0) return null
    const view = new Matrix4().copy(world).invert()
    const local = reframeMatrix(reframe)
    if (reframe && !local) return null
    if (local) view.multiply(local)
    return view
}

/** Freeze one frame's view; matrices may be Matrix4 or plain arrays. */
export function createViewSnapshot({
    status, reason = null, frame = null, time = null,
    width = 0, height = 0, dpr = 1, worldToView = null, projection = null,
} = {}) {
    const matrix = elementsOf(worldToView), lens = elementsOf(projection)
    const measured = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    const ready = status === 'ready' && measured && matrix && lens
    return snapshotFact({
        kind: 'view',
        status: ready ? 'ready' : (status === 'ready' ? 'unavailable' : status ?? 'unavailable'),
        reason: reason ?? (status === 'ready' && !ready ? 'invalid-view' : null),
        frame, time,
        width: ready ? width : 0,
        height: ready ? height : 0,
        dpr: Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
        worldToView: ready ? matrix : null,
        projection: ready ? lens : null,
    })
}

// P · worldToView, or null when either side is missing.
function combined(view) {
    if (!view || view.status !== 'ready') return null
    if (!view.worldToView || !view.projection) return null
    return new Matrix4()
        .fromArray(view.projection)
        .multiply(new Matrix4().fromArray(view.worldToView))
}

/** World point → content-local px, or null (behind eye, off-frame, non-finite). */
export function projectPoint(view, world) {
    if (!finite3(world)) return null
    if (!view || view.status !== 'ready' || !(view.width > 0) || !(view.height > 0)) return null
    const m = combined(view)
    if (!m) return null
    const e = m.elements
    const w = e[3] * world[0] + e[7] * world[1] + e[11] * world[2] + e[15]
    if (!Number.isFinite(w) || w <= 0) return null
    const point = new Vector3(world[0], world[1], world[2]).applyMatrix4(m)
    if (![point.x, point.y, point.z].every(Number.isFinite)) return null
    const limit = 1 + CLIP_EPSILON
    if (Math.abs(point.x) > limit || Math.abs(point.y) > limit || Math.abs(point.z) > limit) return null
    return {
        x: (Math.max(-1, Math.min(1, point.x)) * 0.5 + 0.5) * view.width,
        y: (0.5 - Math.max(-1, Math.min(1, point.y)) * 0.5) * view.height,
    }
}

/** Content-local pixel → world ray (eye origin, unit direction), or null. */
export function unprojectRay(view, x, y) {
    if (!view || view.status !== 'ready' || !(view.width > 0) || !(view.height > 0)) return null
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (x < 0 || x > view.width || y < 0 || y > view.height) return null
    const m = combined(view)
    if (!m) return null
    const determinant = m.determinant()
    if (!Number.isFinite(determinant) || determinant === 0) return null
    const inverse = m.invert()
    const nx = (x / view.width) * 2 - 1
    const ny = 1 - (y / view.height) * 2
    const near = new Vector3(nx, ny, -1).applyMatrix4(inverse)
    const far = new Vector3(nx, ny, 1).applyMatrix4(inverse)
    if (![near.x, near.y, near.z, far.x, far.y, far.z].every(Number.isFinite)) return null
    const direction = new Vector3().subVectors(far, near)
    if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() === 0) return null
    direction.normalize()
    // worldToView maps world→view, so view-space origin (0,0,0) is the eye.
    const eye = new Vector3(0, 0, 0).applyMatrix4(
        new Matrix4().fromArray(view.worldToView).invert())
    return {
        origin: [eye.x, eye.y, eye.z],
        direction: [direction.x, direction.y, direction.z],
    }
}
