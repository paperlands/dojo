// Geometry's approximate arithmetic, not the scalar tower or display.
// Angular precision is dimensionless; cancellation has a tighter roundoff budget.
// (id:rotation-precision-boundary)
export const ANGULAR_EPS = 1e-12
const ROUND_OFF = 8 * Number.EPSILON

export const angular = value => Math.abs(value) < ANGULAR_EPS ? 0 : value
export const coefficient = value => {
    const magnitude = Math.abs(value)
    return magnitude < ANGULAR_EPS ? 0 : Math.abs(magnitude - 1) < ANGULAR_EPS ? Math.sign(value) : value
}

export const sum3 = (a, b, c) => {
    const value = a + b + c
    return Math.abs(value) <= ROUND_OFF * Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) ? 0 : value
}
