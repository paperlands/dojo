// Validate the represented trajectory, not merely its endpoint. (id:laws-build-p4)
//
// A motion moves a set of frames from their accepted poses to a candidate. Legal
// endpoints are not legal motion: the straight chord between two points on a circle
// passes inside it. PURE and NOT YET WIRED: the commit boundary still validates
// endpoints only, and the discrete hand step teleports, so today a chorded move is
// not refused in play.
//
// Supported representations and their obligations — the honest list, not a sampler
// that hopes the gaps are small:
//
//   straight relative motion — p(t) = from + t·(to − from) with the other endpoint
//     held. |p(t) − held|² is a quadratic in t, so the distance's extremes over
//     [0, 1] are the two ends and the one vertex. `segmentOk` checks those three
//     exactly; no sample count can hide a bulge between samples.
//   circular arc — named by its centre, radius, a unit axis and two angles. Every
//     point is re-derived from that representation, so the defining distance holds
//     by construction. `arcOk` refuses a malformed representation and checks the
//     re-derived radius numerically. (id:laws-build-p4-arc)
//   slider segment — a scalar walks a line between declared bounds; the residual to
//     the held centre is convex along that line, so its maximum is at an endpoint or
//     at the projection of the centre. A straight traverse is `segmentOk`.
//
// General continuation — a free chord threading several laws, or a path with no
// representation — is NOT supported here. `pathOk` is a sampled *necessary* test for
// those: it refuses a non-finite path or a missing participant, but it cannot prove
// the space between samples. It must never be wired into publication as if it did.
//
// Pure: positions in, a verdict out.

const round = (v) => Math.abs(v) < 1e-12 ? 0 : v
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const unit = (v) => { const n = len(v); return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : null }

export function sampleSegment(from, to, samples = 16) {
    const out = []
    for (let i = 0; i <= samples; i++) {
        const t = i / samples
        out.push([
            round(from[0] + (to[0] - from[0]) * t),
            round(from[1] + (to[1] - from[1]) * t),
            round(from[2] + (to[2] - from[2]) * t),
        ])
    }
    return out
}

// The worst residual of a distance law along a *sampled* segment. A malformed
// input is not a pass: it is an infinite residual, so a caller cannot read safety
// out of a NaN. `segmentOk` is the analytic checker for the straight case.
export function segmentResidual(from, to, other, radius, samples = 16) {
    if (!finite3(from) || !finite3(to) || !finite3(other) || !Number.isFinite(radius)) return Infinity
    let worst = 0
    for (const p of sampleSegment(from, to, samples)) {
        const d = Math.hypot(p[0] - other[0], p[1] - other[1], p[2] - other[2])
        worst = Math.max(worst, Math.abs(d - radius))
    }
    return worst
}

export function segmentKeepsDistance(from, to, other, radius, { tol = 1e-6, samples = 16 } = {}) {
    return segmentResidual(from, to, other, radius, samples) <= tol
}

// The exact range of |p(t) − other| over the straight move p(t) = from + t·d,
// t ∈ [0, 1]. |p(t) − other|² = a t² + b t + c is quadratic, so the distance's
// extremes are the ends and the vertex t* = −b/2a when it lies inside. No sampling.
export function segmentExtremes(from, to, other) {
    if (!finite3(from) || !finite3(to) || !finite3(other)) return null
    const d = sub(to, from)
    const a = dot(d, d)
    const b = 2 * dot(d, sub(from, other))
    const c = dot(sub(from, other), sub(from, other))
    const distances = [Math.sqrt(c), Math.sqrt(dot(sub(to, other), sub(to, other)))]
    if (a > 1e-18) {
        const t = -b / (2 * a)
        if (t > 0 && t < 1) distances.push(Math.sqrt(Math.max(0, a * t * t + b * t + c)))
    }
    return { min: Math.min(...distances), max: Math.max(...distances) }
}

// The analytic obligation for straight relative motion: the exact worst residual
// over the whole segment, checked at the only three points that can carry it.
export function segmentOk({ from, to, other, radius, tol = 1e-6 } = {}) {
    if (!Number.isFinite(radius) || radius < 0) return { ok: false, reason: 'distance must be a non-negative finite number', residual: null }
    const e = segmentExtremes(from, to, other)
    if (!e) return { ok: false, reason: 'the straight segment or the held point is not finite', residual: null }
    const residual = Math.max(Math.abs(e.min - radius), Math.abs(e.max - radius))
    return residual <= tol
        ? { ok: true, residual }
        : { ok: false, reason: 'the straight path leaves the distance', residual }
}

// A point on a represented circular arc, derived from the representation itself.
export function arcPoint({ center, radius, axis, fromAngle, toAngle }, t) {
    const seed = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const u = unit(cross(axis, seed)) ?? [1, 0, 0]
    const v = cross(axis, u)
    const angle = fromAngle + (toAngle - fromAngle) * t
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return [0, 1, 2].map((i) => center[i] + radius * (c * u[i] + s * v[i]))
}

// The obligation for a represented arc: the representation must be well formed,
// and the points it derives must sit at its own radius. Because the points are
// derived from the representation, this is construction plus a numerical witness,
// not a hope that enough samples were taken. (id:laws-build-p4-arc)
export function arcOk({ center, radius, axis, fromAngle, toAngle, samples = 16, tol = 1e-6 } = {}) {
    if (!finite3(center) || !Number.isFinite(radius) || radius < 0) return { ok: false, reason: 'malformed arc', residual: null }
    if (!finite3(axis) || Math.abs(len(axis) - 1) > 1e-6) return { ok: false, reason: 'the arc axis is not a unit vector', residual: null }
    if (!Number.isFinite(fromAngle) || !Number.isFinite(toAngle)) return { ok: false, reason: 'the arc angles are not finite', residual: null }
    let worst = 0
    for (let i = 0; i <= samples; i++) {
        const p = arcPoint({ center, radius, axis, fromAngle, toAngle }, i / samples)
        worst = Math.max(worst, Math.abs(len(sub(p, center)) - radius))
    }
    return worst <= tol
        ? { ok: true, residual: worst }
        : { ok: false, reason: 'the arc leaves its radius', residual: worst }
}

// A participant index: >= 0 names a path, < 0 names a held reading.
const knownIndex = (index, paths, others) => Number.isInteger(index) &&
    (index >= 0 ? index < paths.length : -index - 1 < others.length)

// A *sampled* necessary test for a whole moved set. It refuses a malformed path
// or a law whose participant is missing rather than skipping the law — a hole in
// the check is not a pass. It cannot establish the space between samples.
export function pathOk({ paths = [], others = [], laws = [], tol = 1e-6, samples = 16 } = {}) {
    for (const path of paths) {
        if (!path || !finite3(path.from) || !finite3(path.to)) return { ok: false, reason: 'a path endpoint is not finite', at: null, residual: null }
    }
    for (const held of others) {
        if (!finite3(held)) return { ok: false, reason: 'a held participant is not finite', at: null, residual: null }
    }
    for (const law of laws) {
        if (!Number.isFinite(law.radius) || law.radius < 0) return { ok: false, reason: 'a law radius is not finite', at: null, residual: null }
        if (!knownIndex(law.a, paths, others) || !knownIndex(law.b, paths, others)) {
            return { ok: false, reason: 'a law names a participant that is not here', at: null, residual: null }
        }
    }
    const at = (index, t) => {
        if (index >= 0) {
            const { from, to } = paths[index]
            return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
        }
        return others[-index - 1]
    }
    for (let i = 0; i <= samples; i++) {
        const t = i / samples
        for (const law of laws) {
            const a = at(law.a, t)
            const b = at(law.b, t)
            const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
            if (!Number.isFinite(d)) return { ok: false, reason: 'a sampled distance is not finite', at: t, residual: null }
            if (Math.abs(d - law.radius) > tol) return { ok: false, at: t, residual: Math.abs(d - law.radius) }
        }
    }
    return { ok: true, at: null, residual: 0 }
}
