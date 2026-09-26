// The reveal control: when a law's possibility hints appear on the surface.
// (id:laws-experiment-3-possibility)
//
// View-only. It hides or shows every law-derived hint together — the locus
// outline, the resting axis and the surface curves — and changes no geometry,
// no law, no eligibility and no motion revision. Ordinary point and head marks
// are drawn by the same view path in every mode.

export const REVEAL_MODES = ["visible", "delayed"]

// The declared movement floor: a request the law absorbs in place (a radial
// push on a sphere) changes nothing and must not count as a move. Same floor
// the analytic realization uses for floating noise.
export const REVEAL_MOVE_TOL = 1e-6

export const normalizeReveal = (mode) => mode === "delayed" ? "delayed" : "visible"

// Should the law-derived hints be drawn now? Visible always; Delayed only after
// one accepted hand move has revealed them.
export const hintsVisible = (mode, revealed) =>
    normalizeReveal(mode) !== "delayed" || revealed === true

// May one accepted hand move reveal the hints? Only if it actually moved the
// point: an accepted request that leaves the point where it was has not moved it.
export function revealedBy({ mode, revealed, from, to, tol = REVEAL_MOVE_TOL } = {}) {
    if (revealed === true) return true
    if (normalizeReveal(mode) !== "delayed") return true
    if (!Array.isArray(from) || !Array.isArray(to)) return false
    if (from.length < 3 || to.length < 3) return false
    if (![...from, ...to].every(Number.isFinite)) return false
    return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) > tol
}
