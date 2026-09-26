// Analytic realization and independent validation for one reversible law.
// (id:laws-build-p2b, id:laws-build-solve-seam)
//
// Pure: plain tuples in, plain tuples out. No frames, no scheduler, no solver.
// Exact geometry for the supported form; an unsupported value says so rather
// than approximates. The acceptance tolerance is declared here, before testing:
//   REALIZE_TOL — exact placement (floating noise only)
//   ACCEPT_TOL  — the independent check's absolute tolerance, display scale

export const REALIZE_TOL = 1e-9
export const ACCEPT_TOL = 1e-6

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)

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
