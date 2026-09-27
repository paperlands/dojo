// Pure analytic candidates for relationships that are not a distance: a point in
// an authored plane, and a signed angle that holds its opening.
// (id:relationships-row-contract, id:relationships-rung-angle)
//
// One semantic definition feeds reading, validation and explanation: the signed
// angle reuses =compassOf= from laws/relations.js — the SAME definition
// =measure("bearing")= uses — and the plane is a *reading* of a frame's own pose,
// never a new ambient tree.
//
// These are candidate PRODUCERS and independent VALIDATORS. They are not an
// authored law form and they are not wired into the runtime.

import { compassOf } from "./relations.js"
import { DEFAULT_ARM } from "./realize.js"

export const REL_TOL = 1e-9
export const ACCEPT_TOL = 1e-6

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)

// Degrees in (-180, 180]. The angular display boundary is not a geometric
// discontinuity: 179 and -179 are two degrees apart, and this says so.
export function wrapDegrees(degrees) {
    let w = degrees % 360
    if (w <= -180) w += 360
    if (w > 180) w -= 360
    return w
}

// Direction of a compass angle: the paper's compass has zero at +y and grows
// clockwise, so compassOf(dx, dy) = c means (dx, dy) = (sin c, cos c).
const dirOf = (compass) => {
    const r = (compass * Math.PI) / 180
    return [Math.sin(r), Math.cos(r)]
}

// ---------------------------------------------------------------------------
// Signed angle between two arms VA and VB, in the paper compass.
// ---------------------------------------------------------------------------
export function signedAngle(vertex, a, b) {
    if (!finite3(vertex) || !finite3(a) || !finite3(b)) return null
    const da = sub(a, vertex), db = sub(b, vertex)
    if (Math.hypot(da[0], da[1]) <= REL_TOL || Math.hypot(db[0], db[1]) <= REL_TOL) return null
    return wrapDegrees(compassOf(db[0], db[1]) - compassOf(da[0], da[1]))
}

// Candidate: rotate the moving arm about the vertex until the signed angle from
// the fixed arm to it is `want`, preserving the moving arm's own length.
export function realizeAngle({ vertex, fixed, moving }, want) {
    if (!finite3(vertex) || !finite3(fixed) || !finite3(moving)) return { ok: false, reason: "non-finite geometry" }
    if (!Number.isFinite(want)) return { ok: false, reason: "the required angle must be finite" }
    const df = sub(fixed, vertex), dm = sub(moving, vertex)
    if (Math.hypot(df[0], df[1]) <= REL_TOL) return { ok: false, reason: "the fixed arm has no direction" }
    const r = len(dm)
    if (r <= REL_TOL) return { ok: false, reason: "the moving arm has zero length" }
    const [ux, uy] = dirOf(compassOf(df[0], df[1]) + want)
    const pose = [vertex[0] + ux * r, vertex[1] + uy * r, vertex[2]]
    return { ok: true, pose, moved: len(sub(pose, moving)) > REL_TOL }
}

// Independent check: does the configuration hold the required signed opening?
export function validateAngle({ vertex, fixed, moving }, want, tol = ACCEPT_TOL) {
    const s = signedAngle(vertex, fixed, moving)
    if (s === null) return { ok: false, reason: "an arm has no direction (zero length or non-finite)" }
    if (!Number.isFinite(want)) return { ok: false, reason: "the required angle must be finite" }
    const residual = Math.abs(wrapDegrees(s - want))
    return residual <= tol
        ? { ok: true, angle: s, residual }
        : { ok: false, angle: s, residual, reason: `the opening is ${s}, not ${want}` }
}

// The visual explanation uses the same convention as the reading and the check.
export function arcSamples(vertex, radius, fromCompass, toCompass, segments = 32) {
    if (!finite3(vertex) || !(radius > 0) || !Number.isFinite(fromCompass) || !Number.isFinite(toCompass)) return []
    const out = []
    for (let i = 0; i <= segments; i++) {
        const [dx, dy] = dirOf(fromCompass + (toCompass - fromCompass) * (i / segments))
        out.push([vertex[0] + radius * dx, vertex[1] + radius * dy, vertex[2]])
    }
    return out
}

// ---------------------------------------------------------------------------
// A fixed bearing is a ray, not a point: the arm may sit anywhere along it.
// ---------------------------------------------------------------------------
export function compassFrom(vertex, p) {
    if (!finite3(vertex) || !finite3(p)) return null
    const d = sub(p, vertex)
    if (Math.hypot(d[0], d[1]) <= REL_TOL) return null
    return compassOf(d[0], d[1])
}

export function pointAtBearing(vertex, bearing, distance) {
    if (!finite3(vertex) || !Number.isFinite(bearing) || !(distance > 0)) return null
    const [ux, uy] = dirOf(bearing)
    return [vertex[0] + ux * distance, vertex[1] + uy * distance, vertex[2]]
}

export function validateBearing({ vertex, moving }, bearing, tol = ACCEPT_TOL) {
    if (!Number.isFinite(bearing)) return { ok: false, reason: "the required bearing must be finite" }
    const c = compassFrom(vertex, moving)
    if (c === null) return { ok: false, reason: "the arm has no direction (zero length or non-finite)" }
    const residual = Math.abs(wrapDegrees(c - bearing))
    return residual <= tol
        ? { ok: true, bearing: c, residual }
        : { ok: false, bearing: c, residual, reason: `the arm bears ${c}, not ${bearing}` }
}

// Candidate: put the arm on the required bearing at its own horizontal reach; the
// height stands. A zero-reach arm has no direction, so a unit arm is taken —
// policy, not truth. (id:relationships-row-contract, id:laws-freedom)
export function realizeBearing({ vertex, moving }, bearing, distance = null, arm = DEFAULT_ARM) {
    if (!finite3(vertex) || !finite3(moving)) return { ok: false, reason: "non-finite geometry" }
    if (!Number.isFinite(bearing)) return { ok: false, reason: "the required bearing must be finite" }
    const reach = Math.hypot(moving[0] - vertex[0], moving[1] - vertex[1])
    const r = distance ?? (reach > REL_TOL ? reach : arm)
    if (!(r > REL_TOL)) return { ok: false, reason: "the arm has zero length" }
    const pose = pointAtBearing(vertex, bearing, r)
    pose[2] = moving[2]
    return { ok: true, pose, moved: true }
}

// ---------------------------------------------------------------------------
// Two fixed arm lengths and a fixed opening: the arrangement rotates together.
// This is the component response the midpoint taught, not a new mechanism.
// ---------------------------------------------------------------------------
export function rotatePointAbout(vertex, p, deltaDegrees) {
    const c = compassFrom(vertex, p)
    const r = len(sub(p, vertex))
    if (c === null || !Number.isFinite(deltaDegrees)) return null
    const [ux, uy] = dirOf(c + deltaDegrees)
    return [vertex[0] + ux * r, vertex[1] + uy * r, vertex[2]]
}

export function realizeRigidOpening({ vertex, a, b }, requestedA) {
    const ca = compassFrom(vertex, a), cb = compassFrom(vertex, b)
    const ra = len(sub(a, vertex)), rb = len(sub(b, vertex))
    if (ca === null || cb === null) return { ok: false, reason: "an arm has no direction (zero length or non-finite)" }
    const want = compassFrom(vertex, requestedA)
    if (want === null) return { ok: false, reason: "the request has no direction (on the vertex)" }
    const delta = wrapDegrees(want - ca)
    const [ax, ay] = dirOf(want)
    const [bx, by] = dirOf(cb + delta)
    return {
        ok: true, delta,
        a: [vertex[0] + ax * ra, vertex[1] + ay * ra, vertex[2]],
        b: [vertex[0] + bx * rb, vertex[1] + by * rb, vertex[2]],
    }
}

// ---------------------------------------------------------------------------
// An authored plane — a reading of a frame's own XY plane.
// ---------------------------------------------------------------------------
export function planeOf(pose) {
    if (!pose || !finite3(pose.position) || !pose.rotation?.rotateVec) return null
    const normal = pose.rotation.rotateVec(0, 0, 1)
    if (!normal || !normal.every(Number.isFinite)) return null
    return { point: [...pose.position], normal }
}

export function projectToPlane(p, plane) {
    if (!plane || !finite3(p)) return finite3(p) ? [...p] : null
    const d = dot(sub(p, plane.point), plane.normal)
    return [p[0] - d * plane.normal[0], p[1] - d * plane.normal[1], p[2] - d * plane.normal[2]]
}

export function validateInPlane(p, plane, tol = ACCEPT_TOL) {
    if (!plane || !finite3(p)) return { ok: false, reason: "non-finite geometry" }
    const offset = dot(sub(p, plane.point), plane.normal)
    return Math.abs(offset) <= tol
        ? { ok: true, offset }
        : { ok: false, offset, reason: `the point is ${offset} off the plane` }
}

// ---------------------------------------------------------------------------
// A framed coordinate truth and its bounded meet with a distance.
// (id:relationships-todo-coordinate-spike)
//
// The declaring frame's own axis is the plane normal, read once. The meet names
// a circle, a near-tangent uncertainty, or nothing: exact topology is not claimed
// inside the tangency tolerance. (id:laws-freedom)
// ---------------------------------------------------------------------------

const AXIS_VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
export const AXES = Object.freeze(Object.keys(AXIS_VEC))

// The plane `local_axis(p) = value` in the frame's stable pose, in world space.
export function planeOfAxis(pose, axis, value) {
    const e = AXIS_VEC[axis]
    if (!e || !pose || !finite3(pose.position) || typeof pose.rotation?.rotateVec !== "function") return null
    if (!Number.isFinite(value)) return null
    const normal = pose.rotation.rotateVec(e[0], e[1], e[2])
    if (!normal || !normal.every(Number.isFinite)) return null
    return { point: pose.position.map((c, i) => c + value * normal[i]), normal }
}

// A plane cut by a sphere: a circle, a tangent uncertainty, a point, or nothing.
export function meetPlaneSphere(plane, center, radius, tol = ACCEPT_TOL) {
    if (!plane || !finite3(center) || !Number.isFinite(radius) || radius < 0) return null
    const n = plane.normal
    const d = dot(sub(center, plane.point), n)
    if (radius <= REL_TOL) {
        return Math.abs(d) <= tol
            ? { kind: "point", at: [...center], d, gap: -Math.abs(d) }
            : { kind: "empty", gap: -Math.abs(d), d }
    }
    const foot = [center[0] - d * n[0], center[1] - d * n[1], center[2] - d * n[2]]
    const gap = radius - Math.abs(d)
    if (gap < -tol) return { kind: "empty", gap, d }
    if (Math.abs(gap) <= tol) return { kind: "uncertain", gap, d }
    const rho = Math.sqrt(gap * (radius + Math.abs(d)))
    return { kind: "circle", center: foot, radius: rho, normal: [...n], d, gap }
}

// The nearest point of a named plane-sphere meet to a request. A request on the
// circle's centre takes a disclosed in-plane direction: policy, not a truth.
export function nearestOnMeet(feasible, request) {
    if (!feasible || !finite3(request)) return { ok: false, kind: "unresolved", reason: "non-finite geometry" }
    if (feasible.kind === "empty") return { ok: false, kind: "contradiction", reason: "the plane misses the sphere" }
    if (feasible.kind === "uncertain") return { ok: false, kind: "unresolved", reason: "within the tangency tolerance" }
    if (feasible.kind === "point") return { ok: true, at: [...feasible.at] }
    if (feasible.kind === "circle") {
        const n = feasible.normal
        const off = dot(sub(request, feasible.center), n)
        let u = sub(request, feasible.center).map((x, i) => x - off * n[i])
        if (len(u) <= REL_TOL) {
            const seed = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
            u = [n[1] * seed[2] - n[2] * seed[1], n[2] * seed[0] - n[0] * seed[2], n[0] * seed[1] - n[1] * seed[0]]
        }
        const m = len(u) || 1
        return { ok: true, at: feasible.center.map((c, i) => c + feasible.radius * u[i] / m) }
    }
    return { ok: false, kind: "unresolved", reason: "no named meet for this component" }
}
