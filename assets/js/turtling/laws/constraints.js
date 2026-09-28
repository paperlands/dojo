// A point's state: what it is, and where it may go. (id:laws-decl-point-agent)
//
// Pure. One query — tag, normals, degrees of freedom, and the exact locus when the
// form names one — so the view, the gesture and the compositor cannot disagree.
// A constraint contributes its gradient (a normal) at the point; freedom is the
// null space. Resolution is projection onto the locus, never a solve.

import { meetAll, dofOf, nearest, plane as planeSet, point as pointSet, sphere as sphereSet, cone as coneSet, conicSamples, basisOf, ringOf } from "./meet.js"
import { unionBounds } from "./fit.js"
import { sub, dot, len, unit, finite3 } from "./vec3.js"
import { openAngle, coneLateral } from "./cone.js"


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
    // A framed coordinate is a truth about the point, carried as its own plane.
    const coordinates = constraints
        .filter((c) => c.feature === 'coordinate' && c.plane && finite3(c.plane.point) && c.plane.normal)
        .map((c) => ({ axis: c.axis, value: c.value, plane: { point: [...c.plane.point], normal: [...c.plane.normal] } }))
    // A tilt is a cone about the declaring frame's nose, apex at its origin.
    const cones = constraints
        .filter((c) => c.feature === 'tilt' && finite3(c.apex) && finite3(c.axis) && Number.isFinite(c.halfAngle))
        .map((c) => ({ apex: [...c.apex], axis: [...c.axis], halfAngle: c.halfAngle }))
    const truth = { pinned, coincident, distances, coordinates, cones }

    // interaction — what a request here may move. This query HOLDS the other
    // participants, so a coincident partner is held with them: the point has no
    // independent freedom. The pair's common translation is a different query —
    // one that names the partner as movable — and the shipped request method
    // does not offer it yet. (id:laws-freedom, id:laws-experiment-7-ruling)
    const resolved = pinned || status !== 'accepted' || role === 'headed' ? [] : distances
        .filter((c) => c.radius > 0)
        .map((c) => ({
            normal: unit(sub(at, c.other)) ?? [1, 0, 0],   // coincident: a stated direction
            locus: { kind: 'sphere', center: [...c.other], radius: c.radius },
        }))
    const normals = resolved.map((r) => r.normal)
    const coupled = coincident && !pinned
    let dof = !known || role === 'headed' || status !== 'accepted' ? 0
        : pinned ? 0
            : coupled ? 0
                : Math.max(0, 3 - rankOf(normals))
    // Geometry is only named when there is an accepted position to name it from.
    const pointLocus = !known ? null
        : pinned
            ? (constraints.some((c) => c.pinned) ? { kind: 'point', at: [...at] }
                : { kind: 'point', at: [...distances.find((c) => c.radius === 0 && c.held).other] })
            : (resolved.length === 1 ? resolved[0].locus : null)
    const setOf = (c) => {
        if (c.set) return c.set
        if (c.feature === 'coordinate' && c.plane) return planeSet(c.plane.point, c.plane.normal)
        if (c.feature === 'tilt' && finite3(c.apex) && finite3(c.axis) && Number.isFinite(c.halfAngle)) {
            return coneSet(c.apex, c.axis, c.halfAngle)
        }
        if (c.feature === 'distance' && Number.isFinite(c.radius) && finite3(c.other)) {
            // The query holds the other participants. A zero distance therefore
            // names an EXISTING point — a set like any other, so locus, projection
            // and freedom all come from the one meet. (id:laws-freedom)
            if (c.radius > 0) return sphereSet(c.other, c.radius)
            if (c.radius === 0) return pointSet(c.other)
            return null
        }
        return null
    }
    const sets = constraints.map(setOf).filter(Boolean)
    let locus = pointLocus
    if (status === 'accepted' && role === 'point' && !pinned && sets.length > 0) {
        const met = meetAll(sets)
        const named = (kind, extra = {}) => ({ kind, ...extra })
        if (met.kind === 'plane') locus = named('plane', { point: [...met.point], normal: [...met.normal] })
        else if (met.kind === 'halfplane') locus = named('halfplane', { point: [...met.point], normal: [...met.normal], dir: [...met.dir] })
        else if (met.kind === 'line') locus = named('line', { point: [...met.point], dir: [...met.dir] })
        else if (met.kind === 'ray') locus = named('ray', { point: [...met.point], dir: [...met.dir] })
        else if (met.kind === 'circle') locus = named('circle', { center: [...met.center], normal: [...met.normal], radius: met.radius, ...(met.keep ? { keep: [...met.keep] } : {}) })
        else if (met.kind === 'sphere') locus = named('sphere', { center: [...met.center], radius: met.radius })
        else if (met.kind === 'cone') locus = named('cone', { apex: [...met.apex], axis: [...met.axis], halfAngle: met.halfAngle })
        else if (met.kind === 'point') locus = named('point', { at: [...met.at] })
        else if (met.kind === 'conic') locus = named('conic', { shape: met.shape, origin: [...met.origin], u: [...met.u], v: [...met.v], normal: [...met.normal], Q: [...met.Q] })
        else if (met.kind === 'points') locus = named('points', { at: met.at.map((p) => [...p]) })
        else locus = null
        dof = dofOf(met)
    }
    const offered = status === 'accepted' && role === 'point' && !pinned
    const interaction = {
        offered,
        movable: !offered ? 'none' : (dof ? 'point' : 'none'),
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


// A point is held when a hand cannot move it: it carries a body, a position pin
// fixes it, or it coincides with something already held. Coincidence alone is
// not a pin — two movable points keep their common translation. (id:laws-freedom)
export function heldIdentity(candidate, laws, registry, seen = new Set()) {
    if (!candidate) return true
    if (seen.has(candidate.id)) return false
    if (candidate.generator != null || candidate.actorState != null) return true
    seen.add(candidate.id)
    for (const law of laws) {
        if (law.feature === 'position' && law.endpoints[0] === candidate.id) return true
        if (law.feature === 'distance' && law.predicate === 0 &&
            (law.endpoints[0] === candidate.id || law.endpoints[1] === candidate.id)) {
            const otherId = law.endpoints[0] === candidate.id ? law.endpoints[1] : law.endpoints[0]
            if (heldIdentity(registry.get(otherId), laws, registry, seen)) return true
        }
    }
    return false
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
    const hit = nearest(locus, target)
    return hit.ok ? hit.at : [...target]
}

// The sphere's silhouette: the rim the eye sees. With an eye, the tangent circle —
// nearer the eye and smaller in the world, so it is the envelope no parallel can
// outgrow; under perspective it therefore renders WIDER than a parallel, by
// d/√(d²−R²). That is the truth of the image, not of the metric. Without an eye,
// the great circle ⟂ the sight — orthographic, where the two agree. (id:laws-freedom)
export function silhouette(locus, viewDir, segments = 48, eye = null) {
    if (!locus || locus.kind !== 'sphere') return null
    const { center, radius } = locus
    if (!(radius > 0)) return null
    if (finite3(eye)) {
        const oc = sub(center, eye)
        const d = len(oc)
        if (d > radius) {
            const axis = unit(oc)
            const shift = (radius * radius) / d
            const rim = radius * Math.sqrt(1 - (radius * radius) / (d * d))
            const mid = [center[0] - axis[0] * shift, center[1] - axis[1] * shift, center[2] - axis[2] * shift]
            return ringOf(mid, axis, rim, segments)
        }
    }
    return ringOf(center, unit(viewDir) ?? [0, 0, 1], radius, segments)
}

// The axis a point rests on (the constraint normal) and the axes it may move
// along (a tangent basis), in world space and chosen WITHOUT the camera — so a
// camera turn carries them with the world, never pins them to the screen.
// (id:laws-freedom)
export function axesOf(state) {
    if (!state || state.tag !== 'free' || state.normals.length === 0) return null
    const b = basisOf(state.normals[0])
    return b ? { normal: b.n, tangent: [b.u, b.v] } : null
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

// The exact world circle a coordinate·distance meet names: one closed loop,
// depth-faded by the caller. (id:laws-freedom)
export function circleCurve(locus, segments = 72) {
    if (!locus || locus.kind !== 'circle') return null
    return ringOf(locus.center, locus.normal, locus.radius, segments)
}

// A bounded patch of the plane through the point: a closed square and its two
// in-plane tangents. A finite patch is a hint, never the whole plane to infinity.
// (id:laws-freedom)
// The cone's local geometry at a point: the cross-section circle through it and
// four generators from the apex. A bounded window on an unbounded surface.
// (id:laws-freedom)
export function coneCurve(cone, at, segments = 48) {
    const axis = unit(cone.axis)
    if (!axis || !finite3(cone.apex) || !finite3(at)) return null
    const h = dot(sub(at, cone.apex), axis)
    // The double nappe means θ and 180 − θ are one opening; draw the narrow one.
    const open = openAngle(cone.halfAngle)
    // A closed (0) or fully open (180) opening is the axis itself: the line, not a
    // surface. One generator, so the mark is a dotted line rather than blank.
    // (id:laws-freedom)
    if (open <= 1e-9) {
        const reach = Math.abs(h) > 1e-9 ? h : 1
        const tip = [0, 1, 2].map((k) => cone.apex[k] + axis[k] * reach)
        return { ring: null, generators: [[[...cone.apex], tip]] }
    }
    if (!(open < 90) || Math.abs(h) <= 1e-9) return null
    const radius = coneLateral(h, open)
    const centre = [0, 1, 2].map((k) => cone.apex[k] + axis[k] * h)
    // The window is the circle the locus names at this height.
    const ring = circleCurve({ kind: 'circle', center: centre, normal: axis, radius }, segments)
    if (!ring) return null
    const pick = (i) => ring[Math.round((i / 4) * segments)]
    return { ring, generators: [pick(0), pick(1), pick(2), pick(3)].map((p) => [[...cone.apex], p]) }
}

export function planePatch(locus, at, size = 3.5) {
    if (!locus || locus.kind !== 'plane' || !finite3(at)) return null
    const b = basisOf(locus.normal)
    if (!b) return null
    const r = Number.isFinite(size) ? size : 3.5
    const corner = (s, t) => [0, 1, 2].map((k) => at[k] + r * (s * b.u[k] + t * b.v[k]))
    const along = (d) => [
        [0, 1, 2].map((k) => at[k] - r * d[k]),
        [0, 1, 2].map((k) => at[k] + r * d[k]),
    ]
    return {
        corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)],
        axes: [{ from: along(b.u)[0], to: along(b.u)[1] }, { from: along(b.v)[0], to: along(b.v)[1] }],
    }
}


// A near-axis sight is the one view where the rim lies: it flattens the parallel
// into a circle the rim can be mistaken for, so the wider rim reads as a second
// circumference with no volume to add. Only a finite eye tells that lie — an
// orthographic rim agrees with the metric plane — so the gate belongs to the eye.
// 25° is where the parallel is foreshortened by a tenth (1 − cos 25°), and so
// reads as the ellipse it is. (id:laws-freedom)
const RIM_AXIS_COS = Math.cos((25 * Math.PI) / 180)
const POLE = [0, 0, 1]        // the pole sphereCurves measures latitude from

function rimReads(locus, viewDir, eye) {
    if (locus?.kind !== 'sphere' || !finite3(eye)) return true
    const sight = Array.isArray(viewDir) ? unit(viewDir) : null
    return !sight || Math.abs(dot(sight, POLE)) < RIM_AXIS_COS
}

// Marks from a named locus: curves, traces, axes, ghosts, view-rings. An EXACT
// locus draws solid (a circle is parametric from the same fields; a cone's window
// is that circle at the point's height). A conic is only ever a bounded sample —
// the quadratic is the locus, the drawing is a trace — so it draws dashed and
// never claims the exact curve. (id:laws-freedom)
export function marksOf(locus, { at = null, size = 3.5, viewDir = null, eye = null, segments } = {}) {
    const empty = { curves: [], traces: [], axes: [], ghosts: [], rings: [], spokes: [] }
    if (!locus) return empty
    switch (locus.kind) {
        case 'conic':
            // Sampled, so it is a trace: the mark discloses the walk, not the locus.
            return { ...empty, traces: conicSamples(locus) }
        case 'circle': {
            let c = circleCurve(locus, segments ?? 72)
            if (c && locus.keep) c = c.filter((p) => {
                const d = p.map((x, i) => x - locus.center[i])
                return d[0] * locus.keep[0] + d[1] * locus.keep[1] + d[2] * locus.keep[2] >= -1e-9
            })
            const spokes = at && finite3(locus.center) ? [[[...locus.center], [...at]]] : []
            return c && c.length > 1 ? { ...empty, curves: [c], spokes } : { ...empty, spokes }
        }
        case 'cone': {
            // A half-angle of 90° is not a line: the locus is the plane through the
            // apex perpendicular to the axis (dof 2). Mark it as the plane it is.
            // (id:laws-freedom)
            const open = openAngle(locus.halfAngle)
            if (open >= 90 - 1e-9) {
                const patch = planePatch({ kind: 'plane', point: locus.apex, normal: locus.axis }, at, size)
                return patch
                    ? { ...empty, curves: [patch.corners], axes: patch.axes.map((ax) => [ax.from, ax.to]) }
                    : empty
            }
            const cc = coneCurve(locus, at, segments ?? 48)
            return cc ? { ...empty, curves: cc.ring ? [cc.ring] : [], axes: cc.generators } : empty
        }
        case 'plane':
        case 'halfplane': {
            const patch = planePatch({ kind: 'plane', point: locus.point, normal: locus.normal }, at, size)
            return patch
                ? { ...empty, curves: [patch.corners], axes: patch.axes.map((ax) => [ax.from, ax.to]) }
                : empty
        }
        case 'line': {
            if (!finite3(at) || !locus.dir) return empty
            const half = Number.isFinite(size) ? size : 3.5
            const a = [0, 1, 2].map((k) => at[k] - locus.dir[k] * half)
            const b = [0, 1, 2].map((k) => at[k] + locus.dir[k] * half)
            return { ...empty, axes: [[a, b]] }
        }
        case 'ray': {
            if (!finite3(at) || !locus.dir) return empty
            const half = Number.isFinite(size) ? size : 3.5
            const b = [0, 1, 2].map((k) => at[k] + locus.dir[k] * half)
            return { ...empty, axes: [[at, b]] }
        }
        case 'points':
            return { ...empty, ghosts: locus.at ?? [] }
        case 'sphere': {
            // The rim is drawn only where it reads as a contour, never as a second
            // circumference on the paper. (id:laws-freedom)
            const ring = (eye || viewDir) && rimReads(locus, viewDir, eye)
                ? silhouette(locus, viewDir, segments ?? 48, eye)
                : null
            const curves = at ? sphereCurves(locus, at, segments ?? 48) : null
            return {
                ...empty,
                // Parallel and meridian through the point — the axes made real. (id:laws-freedom)
                curves: [curves?.parallel, curves?.meridian].filter(Boolean),
                rings: ring ? [ring] : [],
                spokes: at && finite3(locus.center) ? [[[...locus.center], [...at]]] : [],
            }
        }
        default:
            return empty
    }
}

// The world extent of a named locus, as a bounding sphere. A bounded locus
// (circle, sphere, a sampled conic) contributes its true radius; an unbounded
// mark contributes only its anchor. This is what `fit` frames, so the camera
// moves and the mark is never enlarged. (id:laws-freedom)
export function boundsOf(locus, at = null) {
    if (!locus) return null
    switch (locus.kind) {
        case 'point':
            return finite3(locus.at) ? { center: [...locus.at], radius: 0 } : null
        case 'points':
            return unionBounds((locus.at ?? []).map((p) => ({ center: [...p], radius: 0 })))
        case 'line':
        case 'ray':
        case 'plane':
        case 'halfplane':
            return finite3(locus.point) ? { center: [...locus.point], radius: 0 } : null
        case 'circle':
        case 'sphere':
            return finite3(locus.center) ? { center: [...locus.center], radius: Math.abs(locus.radius) } : null
        case 'cone': {
            // The bounded window at the point's height, not the infinite cone.
            const axis = unit(locus.axis)
            if (!axis || !finite3(locus.apex) || !(locus.halfAngle > 0 && locus.halfAngle < 90)) {
                return finite3(locus.apex) ? { center: [...locus.apex], radius: 0 } : null
            }
            const h = at ? dot(sub(at, locus.apex), axis) : 0
            const radius = coneLateral(h, locus.halfAngle)
            return { center: locus.apex.map((a, k) => a + axis[k] * h), radius }
        }
        case 'conic': {
            const pts = conicSamples(locus).flat()
            return pts.length ? unionBounds(pts.map((p) => ({ center: [...p], radius: 0 }))) : null
        }
        default:
            return null
    }
}
