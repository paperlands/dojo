// A point's state: what it is, and where it may go. (id:laws-decl-point-agent)
//
// Pure. One query — tag, normals, degrees of freedom, and the exact locus when the
// form names one — so the view, the gesture and the compositor cannot disagree.
// A constraint contributes its gradient (a normal) at the point; freedom is the
// null space. Resolution is projection onto the locus, never a solve.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v) => { const n = len(v); return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : null }
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)

// First-order rank of a set of normals (Gram–Schmidt). In free 3-space the
// degrees of freedom are 3 − rank.
function rankOf(normals) {
    const basis = []
    for (const n of normals) {
        let v = [...n]
        for (const b of basis) { const d = dot(v, b); v = [v[0] - d * b[0], v[1] - d * b[1], v[2] - d * b[2]] }
        const m = len(v)
        if (m > 1e-9) basis.push(v.map((x) => x / m))
    }
    return basis.length
}

// `at` — the accepted world position. `headed` — a body owns the position.
// `constraints` — the active laws on it, already resolved: { feature: 'distance',
// other, radius } or { pinned: true }. Declared symmetries only; nothing algebraic.
export function stateOf({ at = null, headed = false, exposed = true, isPlace = true,
    error = null, unresolved = null, constraints = [] } = {}) {
    const known = finite3(at)

    // role — what it is. Free point or headed identity; independent of whether
    // its answer is usable. (id:laws-decl-point-agent)
    const role = headed ? 'headed' : 'point'

    // status — where the answer stands. `previous` keeps the last accepted
    // geometry as an observation but is not an offer; `unresolved` has no answer.
    const status = (!known || error) ? 'unresolved'
        : (unresolved || !exposed || !isPlace) ? 'previous'
            : 'accepted'

    // truth — what holds it. A zero radius is a PIN only when the other point is
    // held; two coincident movable points keep their common translation, so the
    // pair is coincident, not pinned. (id:laws-freedom)
    const distances = constraints
        .filter((c) => c.feature === 'distance' && Number.isFinite(c.radius) && finite3(c.other))
        .map((c) => ({ other: [...c.other], radius: c.radius, held: c.otherHeld === true }))
    const pinned = constraints.some((c) => c.pinned) || distances.some((c) => c.radius === 0 && c.held)
    const coincident = distances.some((c) => c.radius === 0 && !c.held)
    const truth = { pinned, coincident, distances }

    // interaction — what a request here may move. A coupled point moves with its
    // coincident partner; a pinned or headed one does not move at all.
    const resolved = pinned || status !== 'accepted' || role === 'headed' ? [] : distances
        .filter((c) => c.radius > 0)
        .map((c) => ({
            normal: unit(sub(at, c.other)) ?? [1, 0, 0],   // coincident: a stated direction
            locus: { kind: 'sphere', center: [...c.other], radius: c.radius },
        }))
    const normals = resolved.map((r) => r.normal)
    const coupled = coincident && !pinned
    const dof = !known || role === 'headed' || status !== 'accepted' ? 0
        : pinned ? 0
            : coupled ? 3
                : Math.max(0, 3 - rankOf(normals))
    // Geometry is only named when there is an accepted position to name it from.
    const pointLocus = !known ? null
        : pinned
            ? (constraints.some((c) => c.pinned) ? { kind: 'point', at: [...at] }
                : { kind: 'point', at: [...distances.find((c) => c.radius === 0 && c.held).other] })
            : (resolved.length === 1 ? resolved[0].locus : null)
    const locus = pointLocus
    const offered = status === 'accepted' && role === 'point' && !pinned
    const interaction = {
        offered,
        movable: !offered ? 'none' : (coupled ? 'coupled' : (dof === 0 ? 'none' : 'point')),
        partners: coupled ? distances.filter((c) => c.radius === 0 && !c.held).map((c) => [...c.other]) : [],
        normals, dof, locus,
    }

    // The tag is a derived view label for the affordance, never the truth itself.
    const tag = status !== 'accepted' ? 'unresolved'
        : role === 'headed' ? 'headed'
            : pinned ? 'pinned' : 'free'

    return { role, truth, status, interaction, tag,
        at: known ? [...at] : null, headed, pinned, normals, dof, locus }
}

// Project a desired world point onto the state's locus. One distance is closed
// form (radial); a pin is its point; otherwise the target passes through.
// A slider is a caller of the one state query, not a second definition. It clamps
// the authored scalar within declared bounds and asks `stateOf` for the exact locus
// that scalar names. (id:laws-build-p3-slider)
export function slider({ at, other, value, min = 0, max = Infinity }) {
    const radius = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
    // A slider's reference is held: its zero is the reference point, not a
    // coincident pair that could translate. (id:laws-build-p3-slider)
    const state = stateOf({ at, constraints: [{ feature: 'distance', other, radius, otherHeld: true }] })
    return { value: radius, bounds: { min, max }, locus: state.locus, tag: state.tag }
}

export function project(state, target) {
    const locus = state?.locus
    if (!locus) return [...target]
    if (locus.kind === 'point') return [...locus.at]
    if (locus.kind === 'sphere') {
        // At the pole (target = centre) the radius is undefined: keep the stated
        // direction — a repeatable choice, disclosed as policy. (id:laws-decl-anchor)
        const u = unit(sub(target, locus.center)) ?? [1, 0, 0]
        return [0, 1, 2].map((i) => locus.center[i] + u[i] * locus.radius)
    }
    return [...target]
}

// The sphere's view-plane silhouette: the circle of radius r about the centre in
// the plane ⟂ the sight. Exact for an orthographic view, honest for perspective.
// The display names its question; it does not prove the whole locus. (id:laws-freedom)
export function silhouette(locus, viewDir, segments = 48) {
    if (!locus || locus.kind !== 'sphere') return null
    const d = unit(viewDir) ?? [0, 0, 1]
    const seed = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const u = unit(cross(d, seed)) ?? [1, 0, 0]
    const v = cross(d, u)
    const out = []
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2
        const c = Math.cos(a), s = Math.sin(a)
        out.push([0, 1, 2].map((k) => locus.center[k] + locus.radius * (c * u[k] + s * v[k])))
    }
    return out
}

// The axis a point rests on (the constraint normal) and the axes it may move
// along (a tangent basis), in world space and chosen WITHOUT the camera — so a
// camera turn carries them with the world, never pins them to the screen.
// (id:laws-freedom)
export function axesOf(state) {
    if (!state || state.tag !== 'free' || state.normals.length === 0) return null
    const n = unit(state.normals[0])
    if (!n) return null
    const seed = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const t1 = unit(cross(n, seed)) ?? [0, 1, 0]
    const t2 = cross(n, t1)
    return { normal: n, tangent: [t1, t2] }
}

// The sphere's coordinate curves through the point: its parallel (the latitude
// circle) and its meridian (a great semicircle through the poles). Real world
// curves — so the tangent basis is their tangents, the normal their cross, and a
// camera turn carries the whole frame with the surface. (id:laws-freedom)
export function sphereCurves(locus, at, segments = 48) {
    if (!locus || locus.kind !== 'sphere' || !finite3(at)) return null
    const { center, radius } = locus
    if (!(radius > 0)) return null
    const d = sub(at, center)
    const r = len(d)
    if (r < 1e-12) return null
    const el = Math.asin(Math.max(-1, Math.min(1, d[2] / r)))
    const az = Math.atan2(d[1], d[0])
    const pt = (a, e) => [
        center[0] + radius * Math.cos(e) * Math.cos(a),
        center[1] + radius * Math.cos(e) * Math.sin(a),
        center[2] + radius * Math.sin(e),
    ]
    const parallel = []
    for (let i = 0; i <= segments; i++) parallel.push(pt(az + (i / segments) * Math.PI * 2, el))
    const meridian = []
    for (let i = 0; i <= segments; i++) meridian.push(pt(az, -Math.PI / 2 + (i / segments) * Math.PI))
    return { parallel, meridian }
}
