// Analytic realization and independent validation for one reversible law.
// (id:laws-build-p2b, id:laws-build-solve-seam)
//
// Pure: plain tuples in, plain tuples out. No frames, no scheduler, no solver.
// Exact geometry for the supported form; an unsupported value says so rather
// than approximates. The acceptance tolerance is declared here, before testing:
//   REALIZE_TOL — exact placement (floating noise only)
//   ACCEPT_TOL  — the independent check's absolute tolerance, display scale

import { sub, add, scale, dot, len, finite3, unit as unitKernel } from "./vec3.js"
import { openAngle, RAD } from "./cone.js"

export const REALIZE_TOL = 1e-9
export const ACCEPT_TOL = 1e-6

// The arm a direction-only law takes when the point sits on the observer: one
// declared paper step, so a direction-only placement is visible at the default eye.
// A policy number, not a truth.
export const DEFAULT_ARM = 100

// A direction below the exact-placement tolerance is not one. (id:laws-build-solve-seam)
const unit = (v) => unitKernel(v, REALIZE_TOL)
// Realize |target − observer| = want by moving the target, holding the observer.
// A repeatable direction is chosen when the two coincide, because the choice is
// policy, not a truth. (id:laws-decl-anchor, id:laws-freedom)
export function realizeDistance(target, observer, want) {
    if (!Array.isArray(observer) || !observer.every(Number.isFinite)) {
        return { ok: false, reason: 'observer position is unknown' }
    }
    if (!Number.isFinite(want) || want < 0) {
        return { ok: false, reason: 'distance must be a non-negative finite number' }
    }
    const d = finite3(target) ? len(sub(target, observer)) : NaN
    if (Math.abs(d - want) <= REALIZE_TOL) return { ok: true, pose: [...target], moved: false }
    let ux = 1, uy = 0, uz = 0
    if (d > REALIZE_TOL) {
        const [dx, dy, dz] = sub(target, observer)
        ux = dx / d; uy = dy / d; uz = dz / d
    }
    const pose = [observer[0] + ux * want, observer[1] + uy * want, observer[2] + uz * want]
    return { ok: true, pose, moved: true }
}

// Realize a point on a cone: `want` from the observer's nose at the point's own
// radius. On the apex the point has no direction, so the frame's own up gives the
// generator and `arm` the length — policy, not truth. (id:laws-freedom)
export function realizeTilt(apex, nose, up, target, want, arm = DEFAULT_ARM) {
    if (!finite3(apex) || !finite3(nose) || !finite3(up)) return { ok: false, reason: 'observer pose is unknown' }
    if (!Number.isFinite(want)) return { ok: false, reason: 'the tilt must be a finite number' }
    const axis = unit(nose)
    if (!axis) return { ok: false, reason: 'the observer has no nose' }
    const d = finite3(target) ? sub(target, apex) : [0, 0, 0]
    const r = len(d)
    const apart = r > REALIZE_TOL
    // The nappe nearest the point, so a proposal agrees with nearest(cone).
    const side = apart && dot(d, axis) < 0 ? -1 : 1
    // The generator's lateral: the point's own when it has one, else the frame's up
    // projected off the nose — so the default turns with the frame, never a world axis.
    let lateral = apart ? sub(d, scale(axis, dot(d, axis))) : [0, 0, 0]
    if (len(lateral) <= REALIZE_TOL) {
        const u = unit(up) ?? [0, 0, 1]
        lateral = sub(u, scale(axis, dot(u, axis)))
    }
    const across = unit(lateral)
    if (!across) return { ok: false, reason: 'the cone has no generator' }
    // The double nappe means θ and 180 − θ are one surface: take the narrow reading,
    // so the point stays on the nappe nearest the target instead of flipping across
    // the apex as the tilt passes 90°. (id:laws-freedom)
    const w = Math.min(Math.max(want, 0), 180)
    const rad = openAngle(w) * RAD
    const dir = add(scale(axis, side * Math.cos(rad)), scale(across, Math.sin(rad)))
    const pose = add(apex, scale(dir, apart ? r : arm))
    return { ok: true, pose, moved: !finite3(target) || len(sub(pose, target)) > REALIZE_TOL }
}

// The original predicate, checked independently of however the candidate was
// produced. Non-finite geometry, a negative length and a wrong distance are all
// rejected. (id:laws-build-solve-seam)
export function validateDistance(target, observer, want) {
    if (!finite3(target) || !finite3(observer)) return { ok: false, reason: 'non-finite geometry' }
    if (!Number.isFinite(want) || want < 0) return { ok: false, reason: 'distance domain' }
    const d = len(sub(target, observer))
    return Math.abs(d - want) <= ACCEPT_TOL
        ? { ok: true, distance: d }
        : { ok: false, reason: `distance is ${d}, not ${want}` }
}
