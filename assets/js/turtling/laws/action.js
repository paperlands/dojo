// A hand action is a value in the declaring frame, not an event log. (id:laws-hand-action)
import { SE3 } from "../se3.js"
import { Versor } from "../mafs/versors.js"
import { add, sub, scale, dot, cross, unit, finite3 } from "./vec3.js"
import { coneFrame } from "./cone.js"
import { toLocalVector, toLocalPoint, toWorldPoint } from "../localize.js"

const EPS = 1e-10
// Capability only: a re-expressed unit normal can lose an ulp of its norm, so "half turn"
// needs machine roundoff, not exact ==. The retained magnitude is never snapped.
const HALF_TURN_ROUND_OFF = 4 * Math.PI * Number.EPSILON
const turn = (axis, angle, p) => Versor.fromAxisAngle({ x: axis[0], y: axis[1], z: axis[2] }, angle * 180 / Math.PI).rotateVec(...p)
const angle = (axis, a, b) => Math.atan2(dot(axis, cross(a, b)), dot(a, b))
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
const curved = kind => ["sphere", "circle", "cone"].includes(kind)
// A DIRECTION has no scale: normalize with a floor of actual zero, never unit()'s
// absolute length policy. (Zero vectors are the identity and compose with anything.)
const direction = (v) => unit(v, 0)
// Capability is a direction test, not a magnitude one: scaling either vector is not a
// different gesture.
const parallel = (a, b) => {
    const u = direction(a), v = direction(b)
    return !u || !v || Math.hypot(...cross(u, v)) <= EPS
}

// The action value is PLAIN DATA: a quaternion is four coefficients, not a class.
// Reified only where the existing algebra evaluates it; no second wire dialect.
// (id:laws-hand-action-algebra)
const quat = (q) => Versor.raw(q.w, q.x, q.y, q.z)
const plainQuat = (q) => ({ w: q.w, x: q.x, y: q.y, z: q.z })
// Capability validation, not an identity/deadzone epsilon: the retained turn is a UNIT
// quaternion within the same machine-roundoff budget the existing multiply repairs.
const UNIT_ROUND_OFF = 8 * Number.EPSILON
const unitQuat = (q) => {
    if (q == null || typeof q !== "object" || ![q.w, q.x, q.y, q.z].every((v) => Number.isFinite(v))) return false
    const normSq = q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z
    return Number.isFinite(normSq) && Math.abs(normSq - 1) <= UNIT_ROUND_OFF
}

// Boundary admission only. Preserve the coefficients exactly: no normalization, repair
// or identity tolerance. A sphere must already be unit within machine roundoff.
export function validAction(action) {
    if (!action || typeof action !== "object") return false
    switch (action.kind) {
    case "translation": return finite3(action.by)
    case "sphere": return unitQuat(action.rotation)
    case "circle": return finite3(action.phaseVector)
    case "cone": return Number.isFinite(action.angle) && Number.isFinite(action.height)
    default: return false
    }
}

// Copy at the ownership boundary; invalid input admits nothing.
export function copyAction(action) {
    if (!validAction(action)) return null
    switch (action.kind) {
    case "translation": return { kind: "translation", by: [...action.by] }
    case "sphere": return {
        kind: "sphere",
        rotation: { w: action.rotation.w, x: action.rotation.x, y: action.rotation.y, z: action.rotation.z },
    }
    case "circle": return { kind: "circle", phaseVector: [...action.phaseVector] }
    case "cone": return { kind: "cone", angle: action.angle, height: action.height }
    default: return null
    }
}

function localLocus(locus, frame) {
    if (locus?.kind === "sphere") return { ...locus, center: toLocalPoint(frame, locus.center) }
    if (locus?.kind === "circle") return { ...locus, center: toLocalPoint(frame, locus.center), normal: toLocalVector(frame, locus.normal) }
    if (locus?.kind === "cone") return { ...locus, apex: toLocalPoint(frame, locus.apex), axis: toLocalVector(frame, locus.axis) }
    return locus
}

function coneCoordinates(locus, p) {
    const frame = coneFrame(locus.apex, locus.axis, locus.halfAngle)
    if (!frame) return null
    const d = sub(p, frame.apex), h = dot(d, frame.axis)
    const radial = unit(sub(d, scale(frame.axis, h))) ?? frame.u
    return { frame, h, radial }
}

// null is identity. Only an accepted hand move chooses a new action. (id:laws-hand-action)
export function actionBetween(locus, from, to, frame = SE3.identity()) {
    if (!finite3(from) || !finite3(to)) return null
    const a = toLocalPoint(frame, from), b = toLocalPoint(frame, to)
    if (a.every((v, i) => v === b[i])) return null   // identity is exactly no displacement
    const local = localLocus(locus, frame)
    switch (local?.kind) {
    case "sphere": {
        const u = unit(sub(a, local.center)), v = unit(sub(b, local.center))
        if (!u || !v) return null
        const c = Math.max(-1, Math.min(1, dot(u, v)))
        const spin = cross(u, v), sine = Math.hypot(...spin)
        let rotation
        if (sine === 0) {
            const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
            rotation = c < 0 ? Versor.raw(0, ...unit(cross(u, seed))) : Versor.raw(1, 0, 0, 0)
        } else {
            const half = Math.atan2(sine, c) / 2
            rotation = Versor.raw(Math.cos(half), ...scale(spin, Math.sin(half) / sine))
        }
        return { kind: "sphere", rotation: plainQuat(rotation) }
    }
    case "circle": {
        const u = unit(sub(a, local.center)), v = unit(sub(b, local.center))
        const normal = direction(local.normal)
        // The phase is an AXIAL VECTOR in the action's baseline frame: (phi, n) and
        // (-phi, -n) are one turn, so an unoriented normal cannot leak its sign into
        // the retained intent. (id:laws-hand-action-algebra)
        return u && v && normal ? { kind: "circle", phaseVector: scale(normal, angle(normal, u, v)) } : null
    }
    case "cone": {
        const u = coneCoordinates(local, a), v = coneCoordinates(local, b)
        return u && v ? { kind: "cone", angle: angle(u.frame.axis, u.radial, v.radial), height: v.h - u.h } : null
    }
    default:
        return { kind: "translation", by: sub(b, a) }
    }
}

// The ONE explained evaluator: reasons exist only where a point was already refused.
// Identity and projection are separate questions, not this one. (id:laws-hand-action-algebra)
export function interpretAction(action, locus, base, frame = SE3.identity()) {
    if (!action) return { ok: true, at: [...base] }
    const local = localLocus(locus, frame), p = toLocalPoint(frame, base)
    let at
    if (action.kind === "translation") {
        if (curved(local?.kind)) return { ok: false, reason: "family" }
        at = add(p, action.by)
    } else {
        if (action.kind !== local?.kind) return { ok: false, reason: "family" }
        switch (action.kind) {
        case "sphere":
            at = add(local.center, quat(action.rotation).rotateVec(...sub(p, local.center)))
            break
        case "circle": {
            const magnitude = Math.hypot(...action.phaseVector)
            if (magnitude === 0) { at = [...p]; break }   // identity is no turn, not a small one
            const normal = direction(local.normal)
            if (!normal) return { ok: false, reason: "normal" }
            const along = dot(normal, action.phaseVector)
            // A half turn has no sense to align: pi about either sign is one rotation, so an
            // orthogonal chart is still answerable. Otherwise it cannot say which way round
            // the turn goes: inapplicability, never a guessed sign. (id:laws-hand-action-algebra)
            const half = Math.abs(magnitude - Math.PI) <= HALF_TURN_ROUND_OFF
            if (!half && Math.abs(along) <= EPS * magnitude) return { ok: false, reason: "chart" }
            at = add(local.center, turn(half || along >= 0 ? normal : scale(normal, -1), magnitude, sub(p, local.center)))
            break
        }
        case "cone": {
            const c = coneCoordinates(local, p)
            if (!c) return { ok: false, reason: "chart" }   // the cone chart cannot be formed
            const radial = turn(c.frame.axis, action.angle, c.radial)
            const h = c.h + action.height
            at = add(c.frame.along(h), scale(radial, c.frame.lateral(h)))
            break
        }
        default: return { ok: false, reason: "family" }
        }
    }
    return finite3(at) ? { ok: true, at: toWorldPoint(frame, at) } : { ok: false, reason: "nonfinite" }
}

// A changed locus must not reinterpret an old action as another kind of gesture.
export function applyAction(action, locus, base, frame = SE3.identity()) {
    const out = interpretAction(action, locus, base, frame)
    return out.ok ? out.at : null
}

// compose(a, b) applies b, then a. Incompatible action families do not compose.
export function composeActions(a, b) {
    if (!a) return b
    if (!b) return a
    if (a.kind !== b.kind) throw new TypeError("hand actions need the same family to compose")
    switch (a.kind) {
    case "translation": return { kind: a.kind, by: add(a.by, b.by) }
    case "sphere": return { kind: a.kind, rotation: plainQuat(quat(a.rotation).multiply(quat(b.rotation))) }
    case "circle": {
        // Turns about different lines are a general rotation, not one circle turn.
        if (!parallel(a.phaseVector, b.phaseVector)) throw new TypeError("circle turns about different lines do not compose")
        const sum = add(a.phaseVector, b.phaseVector), size = Math.hypot(...sum)
        // One canonical vector: the exponential chart repeats beyond a half turn.
        return { kind: a.kind, phaseVector: size > Math.PI ? scale(sum, 1 - 2 * Math.PI / size) : sum }
    }
    case "cone": return { kind: a.kind, angle: wrap(a.angle + b.angle), height: a.height + b.height }
    default: return null
    }
}
