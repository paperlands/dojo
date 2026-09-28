// laws/meet.js — a lean algebra of named solution sets, and their meet.
// (id:laws-freedom, id:relationships-todo-coordinate-authoring)
//
// A truth contributes ONE set: a coordinate a plane, a distance a sphere. The
// active truths meet. Where the meet is not named it is `unresolved` — never a
// wrong point. Adding a geometric phenomenon means adding one constructor and the
// meets it participates in; the shape of the algebra does not change.
//
// The set kinds, bounded to unbounded:
//   point · points · line · circle · plane · sphere · space
// and the three honest non-answers: empty · uncertain · unresolved.

import { meetPlaneSphere, REL_TOL, ACCEPT_TOL } from "./relationships.js"
import { sub, add, scale, dot, cross, len, finite3, unit as unitKernel } from "./vec3.js"
import { openAngle, coneLateral } from "./cone.js"

// A direction below meet's conditioning threshold is not one; the tolerance is
// meet's policy, so it is passed, not defaulted. (id:laws-contradiction)
const unit = (v) => unitKernel(v, REL_TOL)


// An orthonormal frame for a plane: n and a tangent pair, without the camera.
export function basisOf(normal) {
    const n = unit(normal)
    if (!n) return null
    const seed = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const u = unit(cross(n, seed)) ?? [1, 0, 0]
    return { n, u, v: cross(n, u) }
}

// A closed ring in that plane. The circle and the sphere's silhouette both are this.
export function ringOf(center, normal, radius, segments = 72) {
    const b = basisOf(normal)
    if (!b || !finite3(center) || !(radius > 0)) return null
    const out = []
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2
        const c = Math.cos(a), s = Math.sin(a)
        out.push(add(center, add(scale(b.u, radius * c), scale(b.v, radius * s))))
    }
    return out
}

export const SPACE = Object.freeze({ kind: "space" })
export const EMPTY = Object.freeze({ kind: "empty" })
export const UNCERTAIN = Object.freeze({ kind: "uncertain" })
export const UNRESOLVED = Object.freeze({ kind: "unresolved" })

export const point = (at) => ({ kind: "point", at: [...at] })
export const points = (at) => ({ kind: "points", at: at.map((p) => [...p]) })
export const line = (p, dir) => ({ kind: "line", point: [...p], dir: [...unit(dir) ?? dir] })
export const ray = (p, dir) => ({ kind: "ray", point: [...p], dir: [...unit(dir) ?? dir] })
export const circle = (center, normal, radius) => ({ kind: "circle", center: [...center], normal: [...unit(normal) ?? normal], radius })
export const plane = (point, normal) => ({ kind: "plane", point: [...point], normal: [...unit(normal) ?? normal] })
export const halfplane = (point, normal, dir) => ({ kind: "halfplane", point: [...point], normal: [...unit(normal) ?? normal], dir: [...unit(dir) ?? dir] })
export const sphere = (center, radius) => ({ kind: "sphere", center: [...center], radius })
export const cone = (apex, axis, halfAngle) => ({ kind: "cone", apex: [...apex], axis: [...unit(axis) ?? axis], halfAngle })
export const conic = (shape, origin, u, v, normal, Q) => ({ kind: "conic", shape, origin: [...origin], u: [...u], v: [...v], normal: [...normal], Q: [...Q] })

const samePoint = (a, b) => len(sub(a, b)) <= ACCEPT_TOL

// ---------------------------------------------------------------- named meets

// Two planes meet in a line. `1 − c²` cancels away every significant digit as the
// planes approach parallel (c → 1), so the sine comes from the cross product —
// computed without cancellation. Order matters: exact parallelism is decided
// first (same plane, or a real contradiction), then a real but unresolvable angle
// is UNCERTAIN, and only then is the line computed. REL_TOL is a declared
// conditioning threshold, not the limit of what doubles can represent.
// (id:laws-contradiction, id:laws-freedom)
function meetPlanePlane(a, b) {
    const c = dot(a.normal, b.normal)
    const cr = cross(a.normal, b.normal)
    const s2 = dot(cr, cr)                 // sin²θ, stable as θ → 0
    const d1 = dot(a.normal, a.point), d2 = dot(b.normal, b.point)
    if (s2 === 0) {
        // Exactly parallel: one plane, or two planes that never meet.
        return Math.abs(dot(a.normal, b.point) - d1) <= ACCEPT_TOL ? a : EMPTY
    }
    if (s2 <= REL_TOL * REL_TOL) {
        // A real angle below the conditioning threshold: the crossing line is not
        // established, and it is certainly not the plane itself.
        return UNCERTAIN
    }
    const p = add(scale(a.normal, (d1 - c * d2) / s2), scale(b.normal, (d2 - c * d1) / s2))
    if (!finite3(p)) return UNRESOLVED
    const dir = unit(cr)
    return dir ? line(p, dir) : UNRESOLVED
}


function onHalf(hp, p) {
    return dot(sub(p, hp.point), hp.dir) >= -ACCEPT_TOL
}

function supporting(hp) {
    return plane(hp.point, hp.normal)
}

function clipToHalf(set, hp) {
    if (!set || set.kind === "empty") return EMPTY
    if (set.kind === "uncertain" || set.kind === "unresolved") return set
    if (set.kind === "point") return onHalf(hp, set.at) ? set : EMPTY
    if (set.kind === "points") {
        const keep = set.at.filter((p) => onHalf(hp, p))
        return keep.length === 0 ? EMPTY : keep.length === 1 ? point(keep[0]) : points(keep)
    }
    if (set.kind === "plane") {
        if (Math.abs(Math.abs(dot(set.normal, hp.normal)) - 1) <= 1e-9) return hp
        return clipToHalf(meetPlanePlane(set, supporting(hp)), hp)
    }
    if (set.kind === "halfplane") return clipToHalf(clipToHalf(supporting(set), hp), set)
    if (set.kind === "line" || set.kind === "ray") {
        const g0 = dot(sub(set.point, hp.point), hp.dir)
        const gd = dot(set.dir, hp.dir)
        if (Math.abs(gd) <= REL_TOL) return g0 >= -ACCEPT_TOL ? set : EMPTY
        const t = -g0 / gd
        const origin = add(set.point, scale(set.dir, t))
        const along = gd > 0 ? set.dir : scale(set.dir, -1)
        if (set.kind === "ray" && dot(along, set.dir) < 0) return EMPTY
        return ray(origin, along)
    }
    if (set.kind === "circle") return { ...set, keep: [...hp.dir] }
    return UNRESOLVED
}

function meetHalfplane(hp, other) {
    if (other.kind === "halfplane") return clipToHalf(clipToHalf(meet(supporting(hp), supporting(other)), hp), other)
    return clipToHalf(meet(supporting(hp), other), hp)
}

// A line and a plane. `den = n·dir` is the sine of the line's angle to the plane,
// so a near-parallel line crosses it far away — the same illusion as the
// plane-plane case. Order matters: an exactly parallel line lies in the plane or
// never meets it; a real angle below the conditioning threshold is UNCERTAIN.
// (id:laws-contradiction, id:laws-freedom)
function meetPlaneLine(pl, ln) {
    const den = dot(pl.normal, ln.dir)
    const d = dot(pl.normal, pl.point)
    const offset = dot(pl.normal, ln.point) - d
    if (den === 0) {
        // Exactly parallel: the line lies in the plane, or never meets it.
        return Math.abs(offset) <= ACCEPT_TOL ? ln : EMPTY
    }
    if (Math.abs(den) <= REL_TOL) {
        // A real angle below the conditioning threshold: the far crossing is not
        // established, and it is certainly not the line lying in the plane.
        return UNCERTAIN
    }
    const t = -offset / den
    return point(add(ln.point, scale(ln.dir, t)))
}

function meetLineSphere(ln, sp) {
    const m = sub(ln.point, sp.center)
    const b = dot(m, ln.dir)
    const c = dot(m, m) - sp.radius * sp.radius
    const disc = b * b - c
    if (disc < -ACCEPT_TOL) return EMPTY
    if (disc <= ACCEPT_TOL) return point(add(ln.point, scale(ln.dir, -b)))
    const s = Math.sqrt(disc)
    return points([add(ln.point, scale(ln.dir, -b + s)), add(ln.point, scale(ln.dir, -b - s))])
}

function meetSphereSphere(a, b) {
    const d = len(sub(b.center, a.center))
    if (d <= REL_TOL) return Math.abs(a.radius - b.radius) <= ACCEPT_TOL ? a : EMPTY
    const u = unit(sub(b.center, a.center))
    const x = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d)
    const h2 = a.radius * a.radius - x * x
    if (h2 < -ACCEPT_TOL) return EMPTY
    const center = add(a.center, scale(u, x))
    return h2 <= ACCEPT_TOL ? point(center) : circle(center, u, Math.sqrt(Math.max(0, h2)))
}

function meetsPoint(pt, set) {
    switch (set.kind) {
        case "plane": return Math.abs(dot(set.normal, sub(pt.at, set.point))) <= ACCEPT_TOL
        case "line": return len(cross(sub(pt.at, set.point), set.dir)) <= ACCEPT_TOL
        case "sphere": return Math.abs(len(sub(pt.at, set.center)) - set.radius) <= ACCEPT_TOL
        case "cone": return meetsCone(pt, set)
        default: return false
    }
}

const ORDER = ["space", "empty", "uncertain", "unresolved", "point", "points", "ray", "line", "circle", "halfplane", "plane", "sphere", "cone", "conic"]
const rank = (k) => ORDER.indexOf(k)

// The meet of two named sets. Commutative by canonical pair order; a pair with no
// named meet is UNRESOLVED, never a guess. (id:laws-freedom)
export function meet(a, b) {
    if (!a) return b ?? UNRESOLVED
    if (!b) return a
    if (a.kind === "space") return b
    if (b.kind === "space") return a
    if (a.kind === "empty" || b.kind === "empty") return EMPTY
    if (a.kind === "uncertain" || b.kind === "uncertain") return UNCERTAIN
    if (a.kind === "unresolved" || b.kind === "unresolved") return UNRESOLVED
    if (a.kind === "halfplane") return meetHalfplane(a, b)
    if (b.kind === "halfplane") return meetHalfplane(b, a)
    const [x, y] = rank(a.kind) <= rank(b.kind) ? [a, b] : [b, a]
    switch (`${x.kind}∩${y.kind}`) {
        case "point∩point": return samePoint(x.at, y.at) ? x : EMPTY
        case "points∩point": return x.at.some((p) => samePoint(p, y.at)) ? y : EMPTY
        case "point∩line": return meetsPoint(x, y) ? x : EMPTY
        case "point∩circle": return Math.abs(dot(y.normal, sub(x.at, y.center))) <= ACCEPT_TOL
            && Math.abs(len(sub(x.at, y.center)) - y.radius) <= ACCEPT_TOL ? x : EMPTY
        case "point∩plane": return meetsPoint(x, y) ? x : EMPTY
        case "point∩sphere": return meetsPoint(x, y) ? x : EMPTY
        case "point∩cone": return meetsPoint(x, y) ? x : EMPTY
        case "points∩cone": return points(x.at.filter((p) => meetsCone({ at: p }, y)))
        case "points∩points": return points(x.at.filter((p) => y.at.some((q) => samePoint(p, q))))
        case "line∩line": return meetLineLine(x, y)
        case "line∩circle": return meetLineCircle(x, y)
        case "line∩plane": return meetPlaneLine(y, x)
        case "line∩sphere": return meetLineSphere(x, y)
        case "circle∩circle": return meetCircleCircle(x, y)
        case "circle∩plane": return meetCirclePlane(x, y)
        case "circle∩sphere": return meetCircleSphere(x, y)
        case "plane∩plane": return meetPlanePlane(x, y)
        case "plane∩sphere": return meetPlaneSphere(x, y.center, y.radius)
        case "sphere∩sphere": return meetSphereSphere(x, y)
        case "line∩cone": return meetLineCone(x, y)
        case "circle∩cone": return UNRESOLVED
        case "plane∩cone": return meetPlaneCone(x, y)
        case "sphere∩cone": return UNRESOLVED
        case "cone∩cone": return UNRESOLVED
        case "point∩conic": return meetsConic(x, y) ? x : EMPTY
        case "line∩conic": return meetLineConic(x, y)
        case "plane∩conic": return meetConicPlane(x, y)
        case "circle∩conic": return UNRESOLVED
        case "sphere∩conic": return UNRESOLVED
        case "cone∩conic": return UNRESOLVED
        case "conic∩conic": return UNRESOLVED
        default: return UNRESOLVED
    }
}

function meetLineLine(a, b) {
    const n = cross(a.dir, b.dir)
    const parallel = len(n) <= REL_TOL
    const between = sub(b.point, a.point)
    if (parallel) {
        return len(cross(between, a.dir)) <= ACCEPT_TOL ? a : EMPTY
    }
    const t = dot(cross(between, b.dir), n) / dot(n, n)
    return point(add(a.point, scale(a.dir, t)))
}

// A line and a circle: 0, 1 or 2 points. Cross the circle's plane first; a line
// parallel to that plane must lie in it to meet at all. (id:laws-freedom)
function meetLineCircle(ln, ci) {
    const n = ci.normal, d = ln.dir
    const m = sub(ln.point, ci.center)
    const nd = dot(n, d)
    if (Math.abs(nd) > REL_TOL) {
        const q = add(ln.point, scale(d, -dot(n, m) / nd))
        return Math.abs(len(sub(q, ci.center)) - ci.radius) <= ACCEPT_TOL ? point(q) : EMPTY
    }
    if (Math.abs(dot(n, m)) > ACCEPT_TOL) return EMPTY
    const foot = add(ln.point, scale(d, -dot(m, d)))
    const h = len(sub(foot, ci.center))
    if (h > ci.radius + ACCEPT_TOL) return EMPTY
    if (h >= ci.radius - ACCEPT_TOL) return point(foot)
    const s = Math.sqrt(Math.max(0, ci.radius * ci.radius - h * h))
    return points([add(foot, scale(d, s)), add(foot, scale(d, -s))])
}

// Two circles: named only when they share a plane; then a 2-D two-circle meet.
function meetCircleCircle(a, b) {
    if (len(cross(a.normal, b.normal)) > REL_TOL) return UNRESOLVED
    if (Math.abs(dot(a.normal, sub(b.center, a.center))) > ACCEPT_TOL) return UNRESOLVED
    const d = len(sub(b.center, a.center))
    if (d <= REL_TOL) return Math.abs(a.radius - b.radius) <= ACCEPT_TOL ? a : EMPTY
    if (d > a.radius + b.radius + ACCEPT_TOL) return EMPTY
    if (d < Math.abs(a.radius - b.radius) - ACCEPT_TOL) return EMPTY
    const x = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d)
    const h2 = a.radius * a.radius - x * x
    const foot = add(a.center, scale(unit(sub(b.center, a.center)), x))
    if (h2 <= ACCEPT_TOL) return point(foot)
    const perp = unit(cross(a.normal, sub(b.center, a.center)))
    const s = Math.sqrt(Math.max(0, h2))
    return perp ? points([add(foot, scale(perp, s)), add(foot, scale(perp, -s))]) : UNRESOLVED
}

// A circle cut by a plane: the plane's line (or coincidence) with the circle.
function meetCirclePlane(ci, pl) {
    if (Math.abs(1 - Math.abs(dot(ci.normal, pl.normal))) <= 1e-9) {
        return Math.abs(dot(ci.normal, sub(pl.point, ci.center))) <= ACCEPT_TOL ? ci : EMPTY
    }
    const cut = meetPlanePlane(plane(ci.center, ci.normal), pl)
    return cut.kind === "line" ? meetLineCircle(cut, ci) : (cut.kind === "empty" ? EMPTY : UNRESOLVED)
}

// A circle cut by a sphere: the sphere's meet with the circle's plane, then two
// circles in that plane. (id:laws-freedom)
function meetCircleSphere(ci, sp) {
    const inPlane = meetPlaneSphere(plane(ci.center, ci.normal), sp.center, sp.radius)
    if (inPlane.kind === "empty") return EMPTY
    if (inPlane.kind === "uncertain") return UNCERTAIN
    if (inPlane.kind === "point") {
        return Math.abs(len(sub(inPlane.at, ci.center)) - ci.radius) <= ACCEPT_TOL ? point(inPlane.at) : EMPTY
    }
    return inPlane.kind === "circle" ? meetCircleCircle(ci, inPlane) : UNRESOLVED
}

// A right circular cone: a fixed angle from an axis through an apex. The first
// quadric here — its plane sections are the conics. (id:laws-freedom)
const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const coneCos = (c) => Math.cos(openAngle(c.halfAngle) * RAD)

function meetsCone(pt, c) {
    const d = sub(pt.at, c.apex)
    const r = len(d)
    if (r <= REL_TOL) return true   // the vertex is on every nappe
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(d, c.axis) / r))) * DEG
    return Math.abs(angle - c.halfAngle) <= ACCEPT_TOL || Math.abs(angle - (180 - c.halfAngle)) <= ACCEPT_TOL
}

function meetLineCone(ln, c) {
    const m = sub(ln.point, c.apex)
    const A = dot(ln.dir, c.axis), B = dot(m, c.axis), C = dot(m, ln.dir), M = dot(m, m)
    const cs2 = coneCos(c) ** 2
    const qa = A * A - cs2
    const qb = 2 * (B * A - cs2 * C)
    const qc = B * B - cs2 * M
    if (Math.abs(qa) <= REL_TOL) {
        if (Math.abs(qb) <= REL_TOL) return Math.abs(qc) <= ACCEPT_TOL ? ln : EMPTY
        return point(add(ln.point, scale(ln.dir, -qc / qb)))
    }
    const disc = qb * qb - 4 * qa * qc
    if (disc < -ACCEPT_TOL) return EMPTY
    if (disc <= ACCEPT_TOL) return point(add(ln.point, scale(ln.dir, -qb / (2 * qa))))
    const s = Math.sqrt(disc)
    return points([add(ln.point, scale(ln.dir, (-qb + s) / (2 * qa))), add(ln.point, scale(ln.dir, (-qb - s) / (2 * qa)))])
}

function meetPlaneCone(pl, c) {
    // Perpendicular plane: a circle (or the vertex). Oblique: a conic section.
    if (Math.abs(Math.abs(dot(pl.normal, c.axis)) - 1) <= 1e-9) {
        const h = dot(c.axis, sub(pl.point, c.apex))
        if (Math.abs(h) <= ACCEPT_TOL) return point([...c.apex])
        if (c.halfAngle >= 90 - 1e-9) return UNRESOLVED
        return circle(add(c.apex, scale(c.axis, h)), c.axis, coneLateral(h, c.halfAngle))
    }
    return coneSection(pl, c)
}

// The section of a cone by an oblique plane: a conic, in the plane's own (u,v).
// The quadratic's discriminant names the family — ellipse, parabola, hyperbola.
// (id:laws-freedom)
function coneSection(pl, c) {
    const n = unit(pl.normal)
    const b = basisOf(n)
    if (!b) return UNRESOLVED
    const e1 = b.u, e2 = b.v
    const w = sub(pl.point, c.apex)
    const L0 = dot(w, c.axis), L1 = dot(e1, c.axis), L2 = dot(e2, c.axis)
    const w1 = dot(w, e1), w2 = dot(w, e2), ww = dot(w, w)
    const cc = coneCos(c), cc2 = cc * cc
    const A = L1 * L1 - cc2
    const B = 2 * L1 * L2
    const C = L2 * L2 - cc2
    const D = 2 * L0 * L1 - 2 * cc2 * w1
    const E = 2 * L0 * L2 - 2 * cc2 * w2
    const F = L0 * L0 - cc2 * ww
    const disc = B * B - 4 * A * C
    const shape = disc < -1e-9 ? "ellipse" : Math.abs(disc) <= 1e-9 ? "parabola" : "hyperbola"
    return conic(shape, pl.point, e1, e2, n, [A, B, C, D, E, F])
}

function localOf(co, p) {
    const d = sub(p, co.origin)
    return [dot(d, co.u), dot(d, co.v)]
}

function meetsConic(pt, co) {
    const [u, v] = localOf(co, pt.at)
    const [A, B, C, D, E, F] = co.Q
    return Math.abs(A * u * u + B * u * v + C * v * v + D * u + E * v + F) <= ACCEPT_TOL
}

function meetLineConic(ln, co) {
    const nd = dot(co.normal, ln.dir)
    const m = sub(ln.point, co.origin)
    if (Math.abs(nd) > REL_TOL) {
        const q = add(ln.point, scale(ln.dir, -dot(co.normal, m) / nd))
        return meetsConic({ at: q }, co) ? point(q) : EMPTY
    }
    if (Math.abs(dot(co.normal, m)) > ACCEPT_TOL) return EMPTY
    const [u0, v0] = localOf(co, ln.point)
    const du = dot(ln.dir, co.u), dv = dot(ln.dir, co.v)
    const [A, B, C, D, E, F] = co.Q
    const qa = A * du * du + B * du * dv + C * dv * dv
    const qb = 2 * A * u0 * du + B * (u0 * dv + v0 * du) + 2 * C * v0 * dv + D * du + E * dv
    const qc = A * u0 * u0 + B * u0 * v0 + C * v0 * v0 + D * u0 + E * v0 + F
    const world = (t) => add(co.origin, add(scale(co.u, u0 + t * du), scale(co.v, v0 + t * dv)))
    if (Math.abs(qa) <= REL_TOL) {
        if (Math.abs(qb) <= REL_TOL) return Math.abs(qc) <= ACCEPT_TOL ? ln : EMPTY
        return point(world(-qc / qb))
    }
    const disc = qb * qb - 4 * qa * qc
    if (disc < -ACCEPT_TOL) return EMPTY
    if (disc <= ACCEPT_TOL) return point(world(-qb / (2 * qa)))
    const s = Math.sqrt(disc)
    return points([world((-qb + s) / (2 * qa)), world((-qb - s) / (2 * qa))])
}

function meetConicPlane(co, pl) {
    if (Math.abs(Math.abs(dot(co.normal, pl.normal)) - 1) <= 1e-9) {
        return Math.abs(dot(co.normal, sub(pl.point, co.origin))) <= ACCEPT_TOL ? co : EMPTY
    }
    const cut = meetPlanePlane(plane(co.origin, co.normal), pl)
    return cut.kind === "line" ? meetLineConic(cut, co) : (cut.kind === "empty" ? EMPTY : UNRESOLVED)
}

// A bounded sample of a conic for the display: scan u, solve for v, one ordered
// point per branch. A trace, not the locus — the quadratic is the locus.
// (id:laws-freedom)
function conicScale(co) {
    const [A, B, C, D, E, F] = co.Q
    const lead = Math.max(Math.abs(A), Math.abs(C), Math.abs(B) / 2)
    const base = Math.abs(F) + Math.max(Math.abs(D), Math.abs(E)) + 1
    return Math.min(1e6, Math.max(2, Math.sqrt(base / Math.max(1e-9, lead))))
}

export function conicSamples(co, { range: rangeOverride = null, steps = 96 } = {}) {
    const range = rangeOverride ?? conicScale(co)
    const uMin = -range, uMax = range
    const [A, B, C, D, E, F] = co.Q
    const branches = [[], []]
    for (let i = 0; i <= steps; i++) {
        const u = uMin + (uMax - uMin) * (i / steps)
        const qb = B * u + E, qc = A * u * u + D * u + F
        const world = (v) => add(co.origin, add(scale(co.u, u), scale(co.v, v)))
        if (Math.abs(C) > 1e-12) {
            const disc = qb * qb - 4 * C * qc
            if (disc < -1e-9) continue
            const s = Math.sqrt(Math.max(0, disc))
            branches[0].push(world((-qb + s) / (2 * C)))
            if (s > 1e-9) branches[1].push(world((-qb - s) / (2 * C)))
        } else if (Math.abs(qb) > 1e-12) {
            branches[0].push(world(-qc / qb))
        }
    }
    return branches.filter((b) => b.length > 1)
}

// Fold the meet over a conjunction of sets. A non-answer anywhere is the answer.
export function meetAll(sets) {
    let cur = SPACE
    for (const s of sets) {
        if (!s) continue
        cur = meet(cur, s)
        if (cur.kind === "empty" || cur.kind === "uncertain" || cur.kind === "unresolved") return cur
    }
    return cur
}

// Degrees of freedom a named set leaves. `null` when the set is not named.
export function dofOf(set) {
    switch (set?.kind) {
        case "space": return 3
        case "plane": return 2
        case "halfplane": return 2
        case "sphere": return 2
        case "cone": return (set.halfAngle <= 1e-9 || set.halfAngle >= 180 - 1e-9) ? 1 : 2
        case "conic": return 1
        case "line": return 1
        case "ray": return 1
        case "circle": return 1
        case "point": return 0
        case "points": return 0
        case "empty": return 0
        default: return null
    }
}

// The nearest point of a named set to a request. A finite set of candidates is
// resolved by policy: keep the current branch when it is still valid, else the
// nearest. (id:laws-freedom)
export function nearest(set, target, { keep = null, margin = 0 } = {}) {
    if (!set || !finite3(target)) return { ok: false, kind: "unresolved" }
    switch (set.kind) {
        case "space": return { ok: true, at: [...target] }
        case "point": return { ok: true, at: [...set.at] }
        case "points": {
            const candidates = set.at
            let best = null, bestD = Infinity
            for (const p of candidates) { const d = len(sub(p, target)); if (d < bestD) { bestD = d; best = p } }
            if (!best) return { ok: false, kind: "unresolved" }
            // The current branch is kept only while the request cannot improve on
            // it by more than the margin. A deliberate move toward the other branch
            // crosses; an ambiguous one does not. (id:laws-freedom)
            if (keep && candidates.some((p) => samePoint(p, keep)) && len(sub(keep, target)) <= bestD + margin) {
                return { ok: true, at: [...keep], branch: "kept" }
            }
            return { ok: true, at: [...best], branch: "nearest" }
        }
        case "plane": {
            const off = dot(set.normal, sub(target, set.point))
            return { ok: true, at: sub(target, scale(set.normal, off)) }
        }
        case "halfplane": {
            const foot = nearest(supporting(set), target)
            if (!foot.ok) return foot
            const s = dot(sub(foot.at, set.point), set.dir)
            return s >= -REL_TOL ? foot : { ok: true, at: sub(foot.at, scale(set.dir, 2 * s)) }
        }
        case "line": {
            const t = dot(sub(target, set.point), set.dir)
            return { ok: true, at: add(set.point, scale(set.dir, t)) }
        }
        case "ray": {
            const t = Math.max(0, dot(sub(target, set.point), set.dir))
            return { ok: true, at: add(set.point, scale(set.dir, t)) }
        }
        case "sphere": {
            const u = unit(sub(target, set.center)) ?? [1, 0, 0]
            return { ok: true, at: add(set.center, scale(u, set.radius)) }
        }
        case "circle": {
            const n = set.normal
            const off = dot(sub(target, set.center), n)
            let u = sub(target, set.center).map((x, i) => x - off * n[i])
            if (len(u) <= REL_TOL) u = basisOf(n)?.u ?? [1, 0, 0]
            let at = add(set.center, scale(unit(u) ?? [1, 0, 0], set.radius))
            if (set.keep) {
                const k = sub(set.keep, scale(n, dot(set.keep, n)))
                const ku = unit(k)
                const s = ku ? dot(sub(at, set.center), ku) : 0
                if (s < -REL_TOL) at = sub(at, scale(ku, 2 * s))
            }
            return { ok: true, at }
        }
        case "cone": {
            const d = sub(target, set.apex)
            const r = len(d)
            if (r <= REL_TOL) return { ok: true, at: [...set.apex] }
            const open = openAngle(set.halfAngle)
            const held = Array.isArray(keep) && finite3(keep)
            const h = dot(d, set.axis)
            const perpRaw = sub(d, scale(set.axis, h))
            let dir = perpRaw
            if (len(dir) <= REL_TOL) {
                const kd = held ? sub(keep, set.apex) : null
                const kp = kd ? sub(kd, scale(set.axis, dot(kd, set.axis))) : null
                dir = kp && len(kp) > REL_TOL
                    ? kp
                    : cross(set.axis, Math.abs(set.axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])
            }
            const p = unit(dir) ?? [1, 0, 0]
            if (held) {
                // A held point speaks the cone's own coordinates: its height rides the
                // wish and its azimuth is the wish's, so crossing the apex plane passes
                // through the apex and out the other nappe — continuous, no teleport.
                // (id:laws-freedom)
                if (!(open < 90 - 1e-9)) return { ok: true, at: add(set.apex, perpRaw) }
                const lateral = coneLateral(h, open)
                return { ok: true, at: add(set.apex, add(scale(set.axis, h), scale(p, lateral))) }
            }
            // A plain projection keeps the radius and sets the angle, on the nappe the
            // folded opening and the wish's side name. (id:laws-freedom)
            const axial = h / r
            const ax = scale(set.axis, axial < 0 ? -1 : 1)
            const u = add(scale(ax, Math.cos(open * RAD)), scale(p, Math.sin(open * RAD)))
            return { ok: true, at: add(set.apex, scale(u, r)) }
        }
        case "conic": {
            // Projecting onto a conic is a quartic; a bounded trace is the disclosed
            // policy, never a claim of the exact locus. (id:laws-freedom)
            const branches = conicSamples(set, { steps: 128 })
            let best = null, bestD = Infinity
            for (const b of branches) for (const p of b) { const d = len(sub(p, target)); if (d < bestD) { bestD = d; best = p } }
            return best ? { ok: true, at: [...best], branch: "sampled" } : { ok: false, kind: "unresolved" }
        }
        case "empty": return { ok: false, kind: "contradiction" }
        case "uncertain": return { ok: false, kind: "unresolved" }
        default: return { ok: false, kind: "unresolved" }
    }
}
