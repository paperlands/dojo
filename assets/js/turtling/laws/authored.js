// One descriptor per authored relation. Entries stay explicit; wiring is uniform.
// A descriptor is not a registry that hides branches. (id:relationships-row-contract)

import { planeOfAxis, AXES, wrapDegrees, realizeBearing } from "./relationships.js"
import { forwardOf, DEG, headingOf, compassOf, upOf } from "./relations.js"
import { realizeDistance, validateDistance, realizeTilt, ACCEPT_TOL } from "./realize.js"
import { nearest as meetNearest, plane as planeSet, sphere as sphereSet, point as pointSet, cone as coneSet, halfplane as halfplaneSet } from "./meet.js"
import { SE3 } from "../se3.js"

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
const AXIS_IDX = { x: 0, y: 1, z: 2 }
const axisOk = (axis) => AXES.includes(axis)

const missing = (law, what) => ({ status: "cannot-measure", law, reason: `the ${law.feature} has a missing bound ${what}` })
const unreadable = (law) => ({ status: "cannot-measure", law, reason: `cannot measure the ${law.feature}` })
const violation = (law, residual) => ({ status: "violation", law, residual })

const pair = (endpoints) => [...endpoints]
const one = (endpoints) => [endpoints[0]]
const oneAxis = (endpoints, law) => [endpoints[0], law.axis]
const targetObserver = ({ target, observer }) => [target.id, observer.id]
const targetOnly = ({ target }) => [target.id]

function tiltAngle(world, pose) {
    if (!finite3(world) || !pose || !finite3(pose.position)) return { ok: false, reason: "non-finite position" }
    const d = sub(world, pose.position)
    const r = len(d)
    if (r <= 1e-9) return { ok: false, reason: "the point is at the apex" }
    const nose = forwardOf(pose.rotation)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(d, nose) / r))) * DEG
    return Number.isFinite(angle) ? { ok: true, angle } : { ok: false, reason: "cannot measure the tilt" }
}

// A cone is symmetric: half-angle θ and 180 − θ are one double nappe, and whole
// turns are the same cone. A child's 190 is 170, 360 is 0 — forgiving folds, never
// a domain error for an inane reason. (id:laws-freedom)
function normalizeTilt(deg) {
    if (!Number.isFinite(deg)) return deg
    const turn = ((deg % 360) + 360) % 360
    return turn > 180 ? 360 - turn : turn
}

// The distance to the cone: the nearer of its two nappe angles. (id:laws-freedom)
function tiltResidual(got, want) {
    const w = normalizeTilt(want)
    return Math.min(Math.abs(got - w), Math.abs(got - (180 - w)))
}

function coneOf(pose, halfAngle) {
    if (!pose || !finite3(pose.position) || !(Number.isFinite(halfAngle))) return null
    const axis = forwardOf(pose.rotation)
    return axis ? coneSet(pose.position, axis, halfAngle) : null
}

function asLaw(row, spec) {
    return { feature: row.name, endpoints: row.endpoints(spec), frame: spec.observer.id, predicate: spec.value, axis: spec.axis }

}

// The row names a reading and a set. Measure and validate are that reading;
// propose is nearest on the set. A pin is the remaining policy override.
function defaults(row) {
    const residualOf = (got, want) => row.residual ? row.residual(got, want) : got - want
    return {
        ...row,
        measure: row.measure ?? ((law, ctx) => {
            const at = ctx.worldOf(law.endpoints[0])
            const got = at ? row.read(law, at, ctx) : null
            if (got == null) return at ? unreadable(law) : missing(law, "reference")
            const residual = residualOf(got, law.predicate)
            if (!Number.isFinite(residual)) return unreadable(law)
            return Math.abs(residual) > ACCEPT_TOL ? violation(law, residual) : { status: "valid" }
        }),
        propose: row.propose ?? ((spec) => {
            if (row.guard?.finite && !Number.isFinite(spec.value)) {
                return { ok: false, kind: "relation", reason: `a ${row.name} needs a finite value` }
            }
            const set = row.set(asLaw(row, spec), spec)
            if (!set) return { ok: false, kind: "unresolved", reason: `no ${row.name} locus` }
            const near = meetNearest(set, spec.worldOf(spec.target))
            return near.ok ? { ok: true, world: near.at } : { ok: false, kind: "unresolved", reason: `no point on the ${row.name}` }
        }),
        validate: row.validate ?? ((spec) => {
            const got = row.read(asLaw(row, spec), spec.world, spec)
            if (got == null) return { ok: false, reason: `cannot read the ${row.name}` }
            const residual = residualOf(got, spec.value)
            return Math.abs(residual) <= ACCEPT_TOL
                ? { ok: true, residual }
                : { ok: false, reason: `the ${row.name} is ${got}, not ${spec.value}` }
        }),
    }
}

function bearingOf(at, pose) {
    if (!finite3(at) || !pose || !finite3(pose.position)) return null
    const d = sub(at, pose.position)
    const h = headingOf(pose.rotation)
    if (h === null || Math.hypot(d[0], d[1]) <= 1e-9) return null
    return wrapDegrees(compassOf(d[0], d[1]) - h)
}

function bearingHalf(pose, value) {
    if (!pose || !finite3(pose.position) || !Number.isFinite(value)) return null
    const h = headingOf(pose.rotation)
    if (h === null) return null
    const c = (h + value) * (Math.PI / 180)
    const dir = [Math.sin(c), Math.cos(c), 0]
    return halfplaneSet(pose.position, [-dir[1], dir[0], 0], dir)
}

const distance = {
    name: "distance",
    family: "relational", kind: "length",
    guard: { finite: true, nonNegative: true }, bounds: { min: 0, max: Infinity },
    properties: ["distance"],
    payload: "expr",
    address: pair,
    endpoints: targetObserver,
    measure(law, { worldOf }) {
        const a = worldOf(law.endpoints[0]), b = worldOf(law.endpoints[1])
        if (!a || !b) return missing(law, "participant")
        const d = len(sub(a, b))
        if (!Number.isFinite(d)) return unreadable(law)
        return Math.abs(d - law.predicate) > ACCEPT_TOL ? violation(law, d - law.predicate) : { status: "valid" }
    },
    propose({ target, observer, value, worldOf, pinWorld }) {
        const o = worldOf(observer)
        const pin = pinWorld?.(target)
        if (pin) {
            return validateDistance(pin, o, value).ok
                ? { ok: true, world: pin }
                : { ok: false, reason: "the pinned position conflicts with the distance", kind: "obstructed" }
        }
        const r = realizeDistance(worldOf(target), o, value)
        return r.ok ? { ok: true, world: r.pose } : { ok: false, reason: r.reason }
    },
    validate({ observer, value, world, worldOf }) {
        return validateDistance(world, worldOf(observer), value)
    },
    set(law, { worldOf, writerId }) {
        const otherId = law.endpoints.find((id) => id !== writerId)
        const other = worldOf(otherId)
        return finite3(other) && Number.isFinite(law.predicate) ? sphereSet(other, law.predicate) : null
    },
    constraint(law, { worldOf, heldOf, writerId }) {
        const otherId = law.endpoints.find((id) => id !== writerId)
        const other = worldOf(otherId)
        if (!finite3(other)) return null
        const c = { feature: "distance", other, radius: law.predicate, otherHeld: heldOf?.(otherId) === true }
        if (law.predicate > 0) c.set = sphereSet(other, law.predicate)
        return c
    },
    touches: (law, id) => law.endpoints.includes(id),
}

const position = {
    name: "position",
    family: "spatial", kind: "point",
    guard: { finite3: true }, bounds: null,
    properties: [],
    payload: "coords",
    address: one,
    endpoints: targetOnly,
    measure(law, { worldOf, poseOf }) {
        const w = worldOf(law.endpoints[0])
        const frame = poseOf(law.frame)
        if (!w || !frame) return missing(law, "reference")
        const p = SE3.apply(frame, law.predicate)
        if (!finite3(w) || !finite3(p)) return unreadable(law)
        const residual = Math.hypot(w[0] - p[0], w[1] - p[1], w[2] - p[2])
        return residual > ACCEPT_TOL ? violation(law, residual) : { status: "valid" }
    },
    propose({ target, observer, value, poseOf, conflictAt, ownerOf }) {
        if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
            return { ok: false, reason: "a position needs three finite coordinates" }
        }
        const world = SE3.apply(poseOf(observer), value)
        const conflict = conflictAt?.(target, world)
        const at = conflict ? (ownerOf?.(conflict.law) ?? "source") : null
        return conflict
            ? (conflict.domain
                ? { ok: false, reason: `cannot measure the pin against the ${conflict.law.feature} at ${at}`, kind: "unresolved" }
                : { ok: false, reason: `the pin conflicts with the ${conflict.law.feature} at ${at}`, kind: "obstructed", conflict: conflict.law, residual: conflict.residual, world })
            : { ok: true, world }
    },
    validate({ world }) {
        return finite3(world) ? { ok: true } : { ok: false, reason: "non-finite position" }
    },
    set(law, { poseOf }) {
        const frame = poseOf(law.frame)
        return frame ? pointSet(SE3.apply(frame, law.predicate)) : null
    },
    constraint() { return { pinned: true } },
    touches: (law, id) => law.endpoints[0] === id,
}

const coordinate = defaults({
    name: "coordinate",
    family: null, kind: "scalar",
    guard: { finite: true }, bounds: null,
    properties: ["x", "y", "z"],
    payload: "expr",
    form: (property) => ({ feature: "coordinate", axis: property }),
    address: oneAxis,
    endpoints: targetOnly,
    meet: true,
    measure(law, { worldOf, poseOf }) {
        const w = worldOf(law.endpoints[0])
        const frame = poseOf(law.frame)
        if (!w || !frame) return missing(law, "reference")
        if (!axisOk(law.axis)) return { status: "cannot-measure", law, reason: `the ${law.feature} has an unknown axis '${law.axis}'` }
        const local = SE3.unapply(frame, w)
        if (!finite3(local)) return unreadable(law)
        const residual = local[AXIS_IDX[law.axis]] - law.predicate
        if (!Number.isFinite(residual)) return unreadable(law)
        return Math.abs(residual) > ACCEPT_TOL ? violation(law, residual) : { status: "valid" }
    },
    read(law, at, { poseOf }) {
        if (!axisOk(law.axis) || !finite3(at)) return null
        const frame = poseOf(law.frame)
        if (!frame) return null
        const local = SE3.unapply(frame, at)
        return finite3(local) ? local[AXIS_IDX[law.axis]] : null
    },
    set(law, { poseOf }) {
        if (!axisOk(law.axis)) return null
        const pl = planeOfAxis(poseOf(law.frame), law.axis, law.predicate)
        return pl ? planeSet(pl.point, pl.normal) : null
    },
    constraint(law, { poseOf }) {
        const pl = planeOfAxis(poseOf(law.frame), law.axis, law.predicate)
        return pl ? { feature: "coordinate", axis: law.axis, value: law.predicate, plane: pl, set: planeSet(pl.point, pl.normal) } : null
    },
    touches: (law, id) => law.endpoints[0] === id,
})

const tilt = defaults({
    name: "tilt",
    family: null, kind: "angle",
    guard: { finite: true }, bounds: { min: 0, max: 180 },
    properties: ["tilt"],
    payload: "expr",
    address: one,
    endpoints: targetOnly,
    meet: true,
    residual: tiltResidual,
    read(law, at, { poseOf }) {
        const reading = tiltAngle(at, poseOf(law.frame))
        return reading.ok ? reading.angle : null
    },
    set(law, { poseOf }) {
        return coneOf(poseOf(law.frame), normalizeTilt(law.predicate))
    },
    // A tilt from a frame. A point on the apex has no direction to read, so the
    // declaration realizes a generator from the frame's own up and the paper-scale
    // arm instead of failing to measure. (id:laws-freedom)
    propose({ target, observer, value, worldOf, poseOf }) {
        const pose = poseOf(observer)
        if (!pose || !finite3(pose.position)) return { ok: false, kind: "unresolved", reason: "the declaring frame has no pose" }
        const nose = forwardOf(pose.rotation)
        const up = upOf(pose.rotation)
        const moving = worldOf(target)
        if (!finite3(moving)) return { ok: false, kind: "unresolved", reason: "the point has no position" }
        const r = realizeTilt(pose.position, nose, up, moving, normalizeTilt(value))
        return r.ok ? { ok: true, world: r.pose } : { ok: false, reason: r.reason }
    },
    constraint(law, { poseOf }) {
        const pose = poseOf(law.frame)
        if (!pose || !finite3(pose.position)) return null
        const axis = forwardOf(pose.rotation)
        if (!axis) return null
        const halfAngle = normalizeTilt(law.predicate)
        return { feature: "tilt", apex: [...pose.position], axis: [...axis], halfAngle, set: coneSet(pose.position, axis, halfAngle) }
    },
    touches: (law, id) => law.endpoints[0] === id,
})


const bearing = defaults({
    name: "bearing",
    family: "relational", kind: "angle",
    guard: { finite: true }, bounds: null,
    properties: ["bearing"],
    payload: "expr",
    address: one,
    endpoints: targetOnly,
    meet: true,
    residual: (got, want) => wrapDegrees(got - want),
    read(law, at, { poseOf }) {
        return bearingOf(at, poseOf(law.frame))
    },
    set(law, { poseOf }) {
        return bearingHalf(poseOf(law.frame), law.predicate)
    },
    // A bearing from a frame. A point on the vertex has no direction, so the
    // declaration realizes a paper-scale arm on the ray. (id:laws-freedom)
    propose({ target, observer, value, worldOf, poseOf }) {
        const pose = poseOf(observer)
        if (!pose || !finite3(pose.position)) return { ok: false, kind: "unresolved", reason: "the declaring frame has no pose" }
        const heading = headingOf(pose.rotation)
        if (heading === null) return { ok: false, kind: "unresolved", reason: "the declaring frame has no heading" }
        const moving = worldOf(target)
        if (!finite3(moving)) return { ok: false, kind: "unresolved", reason: "the point has no position" }
        const r = realizeBearing({ vertex: pose.position, moving }, heading + value)
        return r.ok ? { ok: true, world: r.pose } : { ok: false, reason: r.reason }
    },
    constraint(law, { poseOf }) {
        const pl = bearingHalf(poseOf(law.frame), law.predicate)
        return pl ? { feature: "bearing", set: pl } : null
    },
    touches: (law, id) => law.endpoints[0] === id,
})


// Explicit rows. A new authored relation is one more object here, not a new seam.
export const AUTHORED = { distance, position, coordinate, tilt, bearing }

export function parseProperty(property) {
    for (const row of Object.values(AUTHORED)) {
        if (row.properties?.includes(property)) return row.form ? row.form(property) : { feature: row.name }
    }
    return null
}

export function parseSupport() {
    const names = Object.values(AUTHORED).flatMap((row) => row.properties ?? [])
    if (names.length === 0) return "a supported relation"
    if (names.length === 1) return `a supported relation (${names[0]})`
    return `a supported relation (${names.slice(0, -1).join(", ")} or ${names[names.length - 1]})`
}

export function payloadOf(feature) {
    return AUTHORED[feature]?.payload ?? null
}

export function addressShape(feature) {
    return AUTHORED[feature]?.address ?? null
}


// One way to read the world: frames or ids, a position and a pose. Scheduler and
// turtle both bind this; the rows never name either.
export function bindWorld(getFrame, { positionOf, poseOf, ...extras } = {}) {
    const frameOf = (frameOrId) => {
        if (!frameOrId) return null
        return typeof frameOrId === "object" && frameOrId.id != null ? frameOrId : getFrame(frameOrId)
    }
    return {
        worldOf: (frameOrId) => {
            const f = frameOf(frameOrId)
            return f && positionOf ? positionOf(f) : null
        },
        poseOf: (frameOrId) => {
            const f = frameOf(frameOrId)
            return f && poseOf ? poseOf(f) : null
        },
        ...extras,
    }
}

export function constraintsOn(id, laws, ctx) {
    const out = []
    for (const law of laws) {
        const row = AUTHORED[law.feature]
        if (!row?.constraint || !row.touches?.(law, id)) continue
        const c = row.constraint(law, ctx)
        if (c) out.push(c)
    }
    return out
}
