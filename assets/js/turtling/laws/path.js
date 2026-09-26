// Validate the represented trajectory, not merely its endpoint. (id:laws-build-p4)
//
// A motion moves a set of frames from their accepted poses to a candidate. Legal
// endpoints are not legal motion: the straight chord between two points on a circle
// passes inside it. This samples the represented path and checks every active
// distance along the way, so a chord that leaves the locus is refused before it is
// published. Pure: positions in, a verdict out.

const round = (v) => Math.abs(v) < 1e-12 ? 0 : v

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

// The worst residual of a distance law along the represented segment. `other` is
// held for the motion, so only the moved frame travels.
export function segmentResidual(from, to, other, radius, samples = 16) {
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

// The path of a whole moved set: every moved frame interpolates independently, and
// every law is checked at every sample. `paths` is [{ from, to }]; `others` is the
// held reading; `laws` is [{ a, b, radius }] over indices into the moved set or -1
// for a held frame.
export function pathOk({ paths, others = [], laws = [], tol = 1e-6, samples = 16 }) {
    const at = (paths_, others_, index, t) => {
        if (index >= 0) {
            const { from, to } = paths_[index]
            return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
        }
        return others_[-index - 1]
    }
    for (let i = 0; i <= samples; i++) {
        const t = i / samples
        for (const law of laws) {
            const a = at(paths, others, law.a, t)
            const b = at(paths, others, law.b, t)
            if (!a || !b) continue
            const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
            if (Math.abs(d - law.radius) > tol) return { ok: false, at: t, residual: Math.abs(d - law.radius) }
        }
    }
    return { ok: true, at: null, residual: 0 }
}
