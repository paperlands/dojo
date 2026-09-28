// The vector kernel the law modules share. (id:laws-decl-vector)
//
// Pure tuples in, pure tuples out. One arithmetic and one degenerate contract, so
// a locus's geometry is spelled once. Where a tolerance is a *policy* — meet's
// conditioning REL_TOL, realize's exact REALIZE_TOL — the caller passes it; the
// default EPS is floating noise only.

export const EPS = 1e-12

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (v) => Math.hypot(v[0], v[1], v[2])

export const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)

// Null below `eps`: a direction too short to have one. The guard is the whole
// contract, so every caller reads the same "no direction" answer.
export const unit = (v, eps = EPS) => {
    if (!Array.isArray(v)) return null
    const n = len(v)
    return n > eps ? scale(v, 1 / n) : null
}
