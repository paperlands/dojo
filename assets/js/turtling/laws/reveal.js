// The reveal control: when a law's possibility hints appear on the surface.
// (id:laws-experiment-3-possibility)
//
// View-only, and EXPLICIT. Visible shows the hints at once; Delayed keeps them
// hidden until the facilitator calls revealNow — accepted hand movement never
// opens the gate. Hiding or showing touches no geometry, no law, no eligibility
// and no motion revision. Ordinary point and head marks are drawn in every mode.

export const REVEAL_MODES = ["visible", "delayed"]

// Behaviour recording only, never a reveal trigger: did a move actually
// displace the point? An accepted request the law absorbs in place (a radial
// push on a sphere) is not a move. Same floor the analytic realization uses.
export const REVEAL_MOVE_TOL = 1e-6

export const normalizeReveal = (mode) => mode === "delayed" ? "delayed" : "visible"

// Should the law-derived hints be drawn now? Visible always; Delayed only after
// an explicit reveal. There is no movement input to this function by design.
export const hintsVisible = (mode, revealed) =>
    normalizeReveal(mode) !== "delayed" || revealed === true

export function movedEnough(from, to, tol = REVEAL_MOVE_TOL) {
    if (!Array.isArray(from) || !Array.isArray(to)) return false
    if (from.length < 3 || to.length < 3) return false
    if (![...from, ...to].every(Number.isFinite)) return false
    return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) > tol
}
