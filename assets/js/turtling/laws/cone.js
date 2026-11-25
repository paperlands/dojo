// A cone's own frame: the narrow opening, the lateral it spends, and the point
// they name. (id:laws-freedom)
//
// The double nappe means θ and 180 − θ are one surface, so `openAngle` is the
// narrow reading — spelled once. Every consumer (hand, display, meet, realize)
// reads this frame instead of re-deriving `min(half, 180 − half)` and `|h|·tan`.
// A half-angle of 90° is a plane and of 0° a line: `isOpenCone` says so.

import { cross, unit } from "./vec3.js"

export const RAD = Math.PI / 180

export const openAngle = (halfAngle) => Math.min(halfAngle, 180 - halfAngle)

export const isOpenCone = (halfAngle) => {
    const open = openAngle(halfAngle)
    return open > 1e-9 && open < 90 - 1e-9
}

// The cross-section radius at height `h` of a cone whose narrow opening is `open`.
export const coneLateral = (h, open) => Math.abs(h) * Math.tan(open * RAD)

// The point of a cone by its own coordinates: a height h along the axis and an
// azimuth φ. (id:laws-freedom)
export function conePointOn(apex, a, u, v, h, phi, open) {
    const lat = coneLateral(h, open)
    const c = Math.cos(phi), s = Math.sin(phi)
    const off = (k) => (u[k] * c + v[k] * s) * lat
    return [apex[0] + a[0] * h + off(0), apex[1] + a[1] * h + off(1), apex[2] + a[2] * h + off(2)]
}

// The cone's frame: a normalized axis, an in-plane basis, the narrow opening, and
// the coordinate it names back. Null for a plane, a line, or a degenerate axis.
export function coneFrame(apex, axis, halfAngle) {
    if (!Array.isArray(apex) || !Array.isArray(axis) || !(halfAngle > 0)) return null
    const open = openAngle(halfAngle)
    if (!(open < 90 - 1e-9)) return null
    const a = unit(axis)
    if (!a) return null
    const u = unit(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
    if (!u) return null
    const v = cross(a, u)
    const A = [...apex]
    return {
        apex: A, axis: a, u, v, open,
        point: (h, phi) => conePointOn(A, a, u, v, h, phi, open),
        lateral: (h) => coneLateral(h, open),
        along: (h) => [A[0] + a[0] * h, A[1] + a[1] * h, A[2] + a[2] * h],
    }
}

// Ray ∩ a cone. A double nappe, so the ray may hit both sides; the grab keeps the
// side it started on (`prefer`). A miss clamps to the silhouette in the ray's own
// plane — the tangency point — so the point rides the cone's edge, never flies.
// Unwired by the hand (D039), kept as the pure meet. (id:laws-decl-anchor)
export function touchCone(ray, cone, prefer = null) {
    const A = cone && Array.isArray(cone.apex) ? cone.apex : null
    const raw = cone && Array.isArray(cone.axis) ? cone.axis : null
    const half = cone ? cone.halfAngle : null
    if (!A || !raw || !ray || !(half > 0)) return null
    const an = Math.hypot(raw[0], raw[1], raw[2])
    if (!(an > 0)) return null
    const ax = raw[0] / an, ay = raw[1] / an, az = raw[2] / an
    const cc = Math.cos(openAngle(half) * RAD)
    const cc2 = cc * cc
    const [ox, oy, oz] = ray.origin
    const [dx, dy, dz] = ray.direction
    if (Math.hypot(dx, dy, dz) === 0) return null
    const ux = ox - A[0], uy = oy - A[1], uz = oz - A[2]
    const p = ux * ax + uy * ay + uz * az
    const q = dx * ax + dy * ay + dz * az
    const m = ux * ux + uy * uy + uz * uz
    const n = ux * dx + uy * dy + uz * dz
    const s = dx * dx + dy * dy + dz * dz
    const qa = q * q - cc2 * s
    const qb = 2 * (p * q - cc2 * n)
    const qc = p * p - cc2 * m
    const at = (t) => [ox + dx * t, oy + dy * t, oz + dz * t]
    const hits = []
    if (Math.abs(qa) < 1e-12) {
        if (Math.abs(qb) > 1e-12) {
            const t = -qc / qb
            if (t > 1e-9) hits.push({ t, at: at(t) })
        }
    } else {
        const disc = qb * qb - 4 * qa * qc
        if (disc >= 0) {
            const r = Math.sqrt(disc)
            for (const t of [(-qb - r) / (2 * qa), (-qb + r) / (2 * qa)]) {
                if (t > 1e-9) hits.push({ t, at: at(t) })
            }
        }
    }
    if (hits.length) {
        if (Array.isArray(prefer)) {
            let best = hits[0]
            let bd = (best.at[0] - prefer[0]) ** 2 + (best.at[1] - prefer[1]) ** 2 + (best.at[2] - prefer[2]) ** 2
            for (const h of hits) {
                const d = (h.at[0] - prefer[0]) ** 2 + (h.at[1] - prefer[1]) ** 2 + (h.at[2] - prefer[2]) ** 2
                if (d < bd) { bd = d; best = h }
            }
            return best.at
        }
        return hits.reduce((a, b) => (a.t <= b.t ? a : b)).at
    }
    // A miss: the ray's nearest approach to the apex, laid onto the cone in its own
    // coordinates — the point rides toward the silhouette, never flying.
    const tq = Math.max(0, -n / (s || 1))
    const vx = ox + dx * tq - A[0]
    const vy = oy + dy * tq - A[1]
    const vz = oz + dz * tq - A[2]
    const h = vx * ax + vy * ay + vz * az
    let px = vx - ax * h, py = vy - ay * h, pz = vz - az * h
    const pl = Math.hypot(px, py, pz)
    if (pl > 1e-9) { px /= pl; py /= pl; pz /= pl } else { px = 1; py = 0; pz = 0 }
    const open = openAngle(half)
    if (!(open < 90 - 1e-9)) return [A[0] + vx - ax * h, A[1] + vy - ay * h, A[2] + vz - az * h]
    const lat = coneLateral(h, open)
    return [A[0] + ax * h + px * lat, A[1] + ay * h + py * lat, A[2] + az * h + pz * lat]
}
