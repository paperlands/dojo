// One descriptor per authored relation. Entries stay explicit; wiring is uniform.
// A descriptor is not a registry that hides branches. (id:relationships-row-contract)

import { AXES, wrapDegrees, realizeBearing } from "./relationships.js"
import { forwardOf, DEG, headingOf, compassOf, wrapPositive, upOf } from "./relations.js"
import { realizeDistance, realizeFreeDistance, validateDistance, realizeTilt, ACCEPT_TOL } from "./realize.js"
import { nearest as meetNearest, plane as planeSet, sphere as sphereSet, point as pointSet, cone as coneSet, halfplane as halfplaneSet } from "./meet.js"
import { SE3 } from "../se3.js"
import { sub, dot, len, finite3 } from "./vec3.js"

const AXIS_IDX = { x: 0, y: 1, z: 2 }
const axisOk = (axis) => AXES.includes(axis)

const missing = (law, what) => ({ status: "cannot-measure", law, reason: `the ${law.feature} has a missing bound ${what}` })
const unreadable = (law) => ({ status: "cannot-measure", law, reason: `cannot measure the ${law.feature}` })
const violation = (law, residual) => ({ status: "violation", law, residual })

// The one predicate-evaluation core. The row supplies the reading, its residual and (via
// `payload`) its required value; the core owns the finite check and the tolerance verdict.
// Measurement and candidate checking consume the SAME bound payload. (D058)
const verdict = (law, residual) => !Number.isFinite(residual) ? unreadable(law)
    : Math.abs(residual) > ACCEPT_TOL ? violation(law, residual) : { status: "valid" }
const residualOf = (row, got, want) => (row.residual ? row.residual(got, want) : got - want)
const assess = (row, law, got, want) => (got == null || want == null)
    ? unreadable(law) : verdict(law, residualOf(row, got, want))

// Reading and replacement share the row's payload slot. (id:laws-payload-boundary)
const payloadSlot = (field) => ({
    payload: (term) => term[field],
    replacePayload: (term, payload) => ({ ...term, [field]: payload }),
})

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

// A legacy caller's fields, adapted through the SAME normalized binding shape binding
// uses — one construction recipe, not two. (D058)
function asLaw(row, spec) {
    const endpoints = row.endpoints(spec)
    const binding = { endpoints, frame: spec.observer.id, axis: spec.axis, predicate: spec.value, source: spec.expression ?? null }
    return { feature: row.name, ...binding, expression: normalizeExpression(row.name, binding) }
}

// The reach already carries the bound candidate; only a caller without one reconstructs.
const boundLaw = (row, spec) => spec.law ?? asLaw(row, spec)

// The row names a reading and a set. Measure and validate are that reading;
// propose is nearest on the set. A pin is the remaining policy override.
function defaults(row) {
    return {
        ...row,
        measure: row.measure ?? ((law, ctx) => {
            const t = boundTerm(law)
            if (!t) return { status: "cannot-measure", law, reason: `the ${law.feature} has no bound term` }
            const at = ctx.worldOf(t.references[0])
            if (!at) return missing(law, "reference")
            return assess(row, law, row.read(law, at, ctx), expectedOf(row, law, ctx))
        }),
        propose: row.propose ?? ((spec) => {
            const bound = boundLaw(row, spec)
            // The value is the BOUND CANDIDATE's payload, never the loose field a driver
            // happened to save. (id:laws-payload-boundary, D058)
            const value = payloadOf(row.name, boundTerm(bound)) ?? spec.value
            if (row.guard?.finite && !Number.isFinite(value)) {
                return { ok: false, kind: "relation", reason: `a ${row.name} needs a finite value` }
            }
            const set = row.set(bound, spec)
            if (!set) return { ok: false, kind: "unresolved", reason: `no ${row.name} locus` }
            const near = meetNearest(set, spec.worldOf(spec.target))
            return near.ok ? { ok: true, world: near.at,
                ...(near.selection ? { selection: near.selection } : {}) }
                : { ok: false, kind: "unresolved", reason: near.reason ?? `no point on the ${row.name}` }
        }),
        validate: row.validate ?? ((spec) => {
            const law = boundLaw(row, spec)
            const got = row.read(law, spec.world, spec)
            const want = expectedOf(row, law, spec)
            const check = assess(row, law, got, want)
            return check.status === "valid"
                ? { ok: true, residual: residualOf(row, got, want) }
                : { ok: false, reason: got == null ? `cannot read the ${row.name}` : `the ${row.name} is ${got}, not ${want}` }
        }),
    }
}

function bearingOf(at, pose) {
    if (!finite3(at) || !pose || !finite3(pose.position)) return null
    const d = sub(at, pose.position)
    const h = headingOf(pose.rotation)
    if (h === null || Math.hypot(d[0], d[1]) <= 1e-9) return null
    return wrapPositive(compassOf(d[0], d[1]) - h)
}

function bearingHalf(pose, value) {
    if (!pose || !finite3(pose.position) || !Number.isFinite(value)) return null
    const h = headingOf(pose.rotation)
    if (h === null) return null
    const c = (h + value) * (Math.PI / 180)
    const dir = [Math.sin(c), Math.cos(c), 0]
    return halfplaneSet(pose.position, [-dir[1], dir[0], 0], dir)
}

// A reference is an identity token: a non-empty name or a finite numeric id. A
// malformed reference never masquerades as a self-distance. (id:laws-distance-term-normalization)
const identityToken = (id) => (typeof id === 'string' && id.length > 0) ||
    (typeof id === 'number' && Number.isFinite(id))

// A distance input is a live entity (an identity token) or a framed point value fixed
// in a placement frame. The term carries two; the radius is theirs.
// (id:laws-distance-literal-address)
function isFramedInput(input) {
    return input != null && typeof input === 'object' && !Array.isArray(input) &&
        identityToken(input.frame) && finite3(input.value)
}

// A fixed point has coordinates, not a declaring frame. (id:world-coordinate-phase-3)
const isPointInput = (input) => input != null && typeof input === 'object' &&
    !Array.isArray(input) && input.frame == null && input.relative !== true && finite3(input.value)

// Live entity inputs are the only solve participants; a framed value never moves.
export const isLiveInput = (input) => identityToken(input)

// STRUCTURAL: both inputs are live entities. This is not an initialization choice — a
// dotted distance has two live inputs and is still target-only. (D058)
export const hasTwoLiveInputs = (term) => term?.references?.length === 2 && term.references.every(isLiveInput)
const distanceInputOk = (input) => identityToken(input) || isPointInput(input) || isFramedInput(input)


// One interpretation of an input's world position, over a reader context. A live
// entity reads its live position; a framed point its placement; a relative vector its
// live head. Every consumer — measurement, construction, continuation, conflicts and
// display — uses this one, so their meanings cannot drift.
// (id:laws-distance-literal-address)
export function inputPosition(input, ctx) {
    if (identityToken(input)) return ctx.worldOf(input)
    if (isPointInput(input)) return [...input.value]
    if (!isFramedInput(input)) return null
    const pose = input.relative ? ctx.livePoseOf(input.frame) : ctx.placementOf(input.frame)
    return pose ? SE3.apply(pose, input.value) : null
}

// The placement frames a law's inputs stand on (a framed centre's frame); retraction
// uses these, never as a solve participant. (id:laws-distance-literal-address)
export function inputFrames(law) {
    const refs = law?.expression?.references
    return Array.isArray(refs) ? refs.filter(isFramedInput).map((r) => r.frame) : []
}

// The one checked term accessor: an original typed term, or nothing. A malformed
// or unknown term never borrows the derived predicate. (id:laws-distance-term-normalization)
function checkedDistanceTerm(law) {
    const term = law?.expression
    return term?.type === 'distance' && Array.isArray(term.references) && term.references.length === 2 &&
        term.references.every(distanceInputOk) &&
        Number.isFinite(term.radius) && term.radius >= 0 ? term : null
}

// Build the term once, for both spellings. RHS text is provenance, never reparsed.
// (id:laws-distance-term-normalization, D058)
export function makeDistanceTerm(references, radius, source = null) {
    return { type: 'distance', references: Array.isArray(references) ? [...references] : [], radius, source }
}

// Numeric terms retain payload and participants; angular terms also name a placement reference.
// (id:world-coordinate-phase-3)
function makeValueTerm(type, { references, axis = null, value, source = null }) {
    return { type, references: Array.isArray(references) ? [...references] : [], axis, value, source }
}
function makeFramedTerm(type, binding) {
    return { ...makeValueTerm(type, binding), frame: binding.frame }
}
function checkedValueTerm(law, type, payloadOk) {
    const t = law?.expression
    if (t?.type !== type || !Array.isArray(t.references) || t.references.length !== 1) return null
    return identityToken(t.references[0]) && payloadOk(t.value) ? t : null
}
function checkedFramedTerm(law, type, payloadOk) {
    const t = checkedValueTerm(law, type, payloadOk)
    return t && identityToken(t.frame) ? t : null
}

// The shared binding normalizer: legacy callers without a term get the same shape.
export function normalizeExpression(feature, binding) {
    return AUTHORED[feature]?.normalizeTerm?.(binding) ?? null
}

// The row's authored payload from its term. The binder asks the row — it never reads
// distance's schema. (D058)
export function payloadOf(feature, term) {
    if (term == null) return null   // a malformed term has no payload, and never throws
    return AUTHORED[feature]?.payload?.(term) ?? null
}

// The row's REQUIRED value for a law: its own payload, or a world-space expectation the row
// derives (a position's declared point). Row validation is predicate-checking over THIS. (D058)
export function expectedOf(row, law, ctx) {
    return row.expected ? row.expected(law, ctx) : payloadOf(row.name, boundTerm(law))
}

// The one checked term accessor every view shares: the row's original typed term,
// or nothing. (id:laws-distance-term-normalization, D058)
export function boundTerm(law) {
    return AUTHORED[law?.feature]?.term?.(law) ?? null
}

// The two derived incidence views, from the rows. Validity references are the inputs
// whose change requires a recheck; participants are the positional entities a solve
// may move together. A shared frame is validity, never a solve edge.
// (id:laws-free-relations-read-validity, D058)
export function boundParticipants(law) {
    return AUTHORED[law?.feature]?.participants?.(law) ?? []
}

export function boundReferences(law) {
    return AUTHORED[law?.feature]?.references?.(law) ?? []
}

const distance = {
    name: "distance",
    family: "relational", kind: "length",
    guard: { finite: true, nonNegative: true }, bounds: { min: 0, max: Infinity },
    properties: ["distance"],
    reachPolicies: ["target-only", "balanced"],
    reachPolicy: ({ participants }) => participants?.length === 2 ? "balanced" : "target-only",
    // The declared symmetry: a distance is undirected, so a reversed pair is the SAME
    // relationship. Coordinate's (target, axis) is role-ordered and is NOT. (D058)
    symmetric: true,
    address: (endpoints, law) => checkedDistanceTerm(law)?.references ?? endpoints,
    endpoints: (spec) => spec.participants?.map((f) => f.id) ?? targetObserver(spec),
    participants: (law) => (checkedDistanceTerm(law)?.references ?? []).filter(identityToken),
    references: (law) => (checkedDistanceTerm(law)?.references ?? []).flatMap((r) => identityToken(r)
        ? [{ id: r, aspect: "position" }]
        : isFramedInput(r) ? [{ id: r.frame, aspect: r.relative ? "position" : "placement" }] : []),
    term: checkedDistanceTerm,
    ...payloadSlot("radius"),
    normalizeTerm: ({ endpoints, predicate, source }) => makeDistanceTerm(endpoints, predicate, source ?? null),
    // Identity facts precede search and numerical tolerance. (id:laws-free-relations-f1)
    staticVerdict(law) {
        const term = checkedDistanceTerm(law)
        const [a, b] = term?.references ?? []
        if (!term || !identityToken(a) || !identityToken(b) || a !== b) return null
        return term.radius === 0 ? { status: 'tautology' }
            : { status: 'contradiction', reason: 'self-distance is zero, not a positive radius' }
    },
    // A VERIFIED tautology constrains nothing, so it is a NEUTRAL contribution: it neither
    // disables a meet nor invents a hold. Retained for ownership and lifetime; its own
    // checking stands. (id:laws-freedom, D058)
    tautology: (law) => distance.staticVerdict(law)?.status === 'tautology',
    measure(law, ctx) {
        const term = checkedDistanceTerm(law)
        if (!term) return { status: 'cannot-measure', law, reason: 'the original distance expression is outside its domain' }
        const a = inputPosition(term.references[0], ctx)
        const b = inputPosition(term.references[1], ctx)
        if (!a || !b) return missing(law, 'participant')
        const d = len(sub(a, b))
        if (!Number.isFinite(d)) return unreadable(law)
        const residual = d - term.radius
        if (distance.staticVerdict(law)?.status === 'contradiction') return violation(law, residual)
        return verdict(law, residual)
    },
    propose({ law, reachPolicy, operation, pinWorld, tie, ...ctx }) {
        const term = checkedDistanceTerm(law)
        if (!term) return { ok: false, kind: "unresolved", reason: "the distance has no bound term" }
        const [first, second] = term.references
        if (reachPolicy === 'balanced' && hasTwoLiveInputs(term)) {
            const result = realizeFreeDistance(ctx.worldOf(first), ctx.worldOf(second), term.radius, tie)
            return result.ok ? { ok: true, worlds: new Map([[first, result.positions[0]], [second, result.positions[1]]]) } : result
        }
        if (reachPolicy !== 'target-only') return { ok: false, kind: "relation", reason: `unknown reach policy '${reachPolicy}'` }
        // The live end moves; the other end — a held live entity, or a framed centre —
        // is the sphere's centre. A framed value never moves. (id:laws-distance-literal-address)
        const moving = operation?.movable[0] ?? (identityToken(first) ? first : second)
        const centre = first === moving ? second : first
        if (!identityToken(moving) || moving === undefined) {
            return { ok: false, kind: "unresolved", reason: "the distance has no live endpoint to move" }
        }
        const o = inputPosition(centre, ctx)
        const pin = pinWorld?.(moving)
        if (pin) {
            return validateDistance(pin, o, term.radius).ok
                ? { ok: true, world: pin }
                : { ok: false, reason: "the pinned position conflicts with the distance", kind: "obstructed" }
        }
        const r = realizeDistance(ctx.worldOf(moving), o, term.radius)
        return r.ok ? { ok: true, world: r.pose } : { ok: false, reason: r.reason }
    },
    validate({ law, reachPolicy, operation, world, worlds, ...ctx }) {
        const term = checkedDistanceTerm(law)
        if (!term) return { ok: false, reason: "the distance has no bound term" }
        const [first, second] = term.references
        if (reachPolicy === 'balanced') return validateDistance(worlds.get(first), worlds.get(second), term.radius)
        if (reachPolicy !== 'target-only') return { ok: false, reason: `unknown reach policy '${reachPolicy}'` }
        const moving = operation?.movable[0] ?? (identityToken(first) ? first : second)
        const centre = first === moving ? second : first
        return validateDistance(world, inputPosition(centre, ctx), term.radius)
    },
    set(law, { writerId, ...ctx }) {
        const term = checkedDistanceTerm(law)
        if (!term) return null
        const other = term.references.find((r) => r !== writerId)
        const centre = inputPosition(other, ctx)
        // A zero distance is a POINT on both sides — the set and the constraint record name
        // the same geometry, so no consumer chooses its own representation. (D058)
        return finite3(centre) && Number.isFinite(term.radius)
            ? (term.radius === 0 ? pointSet(centre) : sphereSet(centre, term.radius)) : null
    },
    constraint(law, { writerId, heldOf, ...ctx }) {
        const term = checkedDistanceTerm(law)
        if (!term) return null
        const other = term.references.find((r) => r !== writerId)
        const centre = inputPosition(other, ctx)
        if (!finite3(centre)) return null
        // A framed centre is fixed in its frame: held, never a movable partner.
        const otherHeld = !identityToken(other) || heldOf?.(other) === true
        // The SET carries the geometry; only the policy fact stays beside it — a set cannot
        // tell a held partner from a free one. (D058)
        const c = { feature: "distance", otherHeld }
        c.set = term.radius > 0 ? sphereSet(centre, term.radius) : pointSet(centre)
        return c
    },
    points: (law) => (checkedDistanceTerm(law)?.references ?? []).filter(identityToken),
}

const position = defaults({
    name: "position",
    family: "spatial", kind: "point",
    guard: { finite3: true }, bounds: null,
    properties: ["position"],
    // A position ADMITS a dependency-driven revision: a live RHS becomes a place driver.
    // A capability is declared here; the scheduler enforces what it means.
    // (id:laws-dependency-driven-place)
    drive: true,
    // Only a position may PLACE a missing subject. The capability permits; ownership
    // and the environment decide (laws/resolution.js). (laws-first-two-pin-birth, D058)
    mayEstablish: true,
    address: one,
    endpoints: targetOnly,
    // Only the constrained being supplies geometry; the declaring scope owns lifetime.
    // (id:world-coordinate-phase-3)
    participants: (law) => [law.endpoints[0]],
    references: (law) => [{ id: law.endpoints[0], aspect: "position" }],
    term: (law) => checkedValueTerm(law, "position", finite3),
    ...payloadSlot("value"),
    normalizeTerm: ({ endpoints, predicate, source }) => makeValueTerm("position", { references: endpoints, value: predicate, source: source ?? null }),
    // The reading IS the point's live position; the expectation is its declared world point,
    // so a candidate is checked against the bound payload — not mere finiteness. (D058)
    read(law, at) {
        return finite3(at) ? [...at] : null
    },
    expected(law) {
        const t = boundTerm(law)
        return t ? [...t.value] : null
    },
    residual: (got, want) => Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]),
    propose({ law, target, conflictAt, ownerOf, value }) {
        // The bound payload is the world point; ownership supplies no implicit geometry.
        // (id:world-coordinate-phase-3)
        const t = boundTerm(law)
        const payload = t ? t.value : value
        // The guard's own predicate: a hole in a sparse array is not a coordinate.
        if (!finite3(payload)) {
            return { ok: false, reason: "a position needs three finite coordinates" }
        }
        const world = [...payload]
        const conflict = conflictAt?.(target, world)
        const at = conflict ? (ownerOf?.(conflict.law) ?? "source") : null
        return conflict
            ? (conflict.domain
                ? { ok: false, reason: `cannot measure the pin against the ${conflict.law.feature} at ${at}`, kind: "unresolved" }
                : { ok: false, reason: `the pin conflicts with the ${conflict.law.feature} at ${at}`, kind: "obstructed", conflict: conflict.law, residual: conflict.residual, world })
            : { ok: true, world }
    },
    set(law) {
        const t = boundTerm(law)
        return t ? pointSet(t.value) : null
    },
    // A pin's record carries its own set: no consumer reconstructs it. (D058)
    constraint(law, ctx) {
        const set = position.set(law, ctx)
        return { pinned: true, ...(set ? { set } : {}) }
    },
    points: (law) => [law.endpoints[0]],
})

const coordinate = defaults({
    name: "coordinate",
    family: null, kind: "scalar",
    drive: true,
    guard: { finite: true }, bounds: null,
    properties: ["x", "y", "z"],
    form: (property) => ({ feature: "coordinate", axis: property }),
    address: oneAxis,
    endpoints: targetOnly,
    participants: (law) => [law.endpoints[0]],
    references: (law) => [{ id: law.endpoints[0], aspect: "position" }],
    term: (law) => checkedValueTerm(law, "coordinate", Number.isFinite),
    ...payloadSlot("value"),
    normalizeTerm: ({ endpoints, axis, predicate, source }) => makeValueTerm("coordinate", { references: endpoints, axis, value: predicate, source: source ?? null }),
    meet: true,
    measure(law, { worldOf }) {
        const t = boundTerm(law)
        if (!t) return { status: "cannot-measure", law, reason: "the coordinate has no bound term" }
        if (!axisOk(t.axis)) return { status: "cannot-measure", law, reason: `the ${law.feature} has an unknown axis '${t.axis}'` }
        const at = worldOf(t.references[0])
        if (!at) return missing(law, "reference")
        return assess(coordinate, law, coordinate.read(law, at), t.value)
    },
    read(law, at) {
        const t = boundTerm(law)
        return t && axisOk(t.axis) && finite3(at) ? at[AXIS_IDX[t.axis]] : null
    },
    set(law) {
        const t = boundTerm(law)
        if (!t || !axisOk(t.axis)) return null
        const point = [0, 0, 0], normal = [0, 0, 0], index = AXIS_IDX[t.axis]
        point[index] = t.value
        normal[index] = 1
        return planeSet(point, normal)
    },
    constraint(law) {
        const t = boundTerm(law), set = coordinate.set(law)
        return set ? { feature: "coordinate", axis: t.axis, value: t.value, set } : null
    },
    points: (law) => [law.endpoints[0]],
})

const tilt = defaults({
    name: "tilt",
    reference: "placement",
    family: null, kind: "angle",
    guard: { finite: true }, bounds: { min: 0, max: 180 },
    properties: ["tilt"],
    address: one,
    endpoints: targetOnly,
    // A tilt reads the point's live position and its frame's placement.
    participants: (law) => [law.endpoints[0]],
    references: (law) => [
        { id: law.endpoints[0], aspect: "position" },
        { id: law.frame, aspect: "placement" },
    ],
    term: (law) => checkedFramedTerm(law, "tilt", Number.isFinite),
    ...payloadSlot("value"),
    normalizeTerm: ({ endpoints, frame, predicate, source }) => makeFramedTerm("tilt", { references: endpoints, frame, value: predicate, source: source ?? null }),
    meet: true,
    residual: tiltResidual,
    read(law, at, { placementOf }) {
        const t = boundTerm(law)
        if (!t) return null
        const reading = tiltAngle(at, placementOf(t.frame))
        return reading.ok ? reading.angle : null
    },
    set(law, { placementOf }) {
        const t = boundTerm(law)
        return t ? coneOf(placementOf(t.frame), normalizeTilt(t.value)) : null
    },
    // A tilt from a frame. A point on the apex has no direction to read, so the
    // declaration realizes a generator from the frame's own up and the paper-scale
    // arm instead of failing to measure. (id:laws-freedom)
    propose({ law, target, observer, value, worldOf, placementOf }) {
        const t = boundTerm(law)
        if (law && !t) return { ok: false, kind: "unresolved", reason: "the tilt has no bound term" }
        const pose = placementOf(t ? t.frame : observer)
        if (!pose || !finite3(pose.position)) return { ok: false, kind: "unresolved", reason: "the declaring frame has no pose" }
        const nose = forwardOf(pose.rotation)
        const up = upOf(pose.rotation)
        const moving = worldOf(target)
        if (!finite3(moving)) return { ok: false, kind: "unresolved", reason: "the point has no position" }
        const r = realizeTilt(pose.position, nose, up, moving, normalizeTilt(t ? t.value : value))
        return r.ok ? { ok: true, world: r.pose } : { ok: false, reason: r.reason }
    },
    constraint(law, { placementOf }) {
        const t = boundTerm(law)
        if (!t) return null
        const pose = placementOf(t.frame)
        if (!pose || !finite3(pose.position)) return null
        const axis = forwardOf(pose.rotation)
        if (!axis) return null
        const halfAngle = normalizeTilt(t.value)
        return { feature: "tilt", set: coneSet(pose.position, axis, halfAngle) }
    },
    points: (law) => [law.endpoints[0]],
})


const bearing = defaults({
    name: "bearing",
    reference: "placement",
    family: "relational", kind: "angle",
    guard: { finite: true }, bounds: null,
    properties: ["bearing"],
    address: one,
    endpoints: targetOnly,
    // A bearing reads the point's live position and its frame's placement.
    participants: (law) => [law.endpoints[0]],
    references: (law) => [
        { id: law.endpoints[0], aspect: "position" },
        { id: law.frame, aspect: "placement" },
    ],
    term: (law) => checkedFramedTerm(law, "bearing", Number.isFinite),
    ...payloadSlot("value"),
    normalizeTerm: ({ endpoints, frame, predicate, source }) => makeFramedTerm("bearing", { references: endpoints, frame, value: predicate, source: source ?? null }),
    meet: true,
    residual: (got, want) => wrapDegrees(got - want),
    read(law, at, { placementOf }) {
        const t = boundTerm(law)
        return t ? bearingOf(at, placementOf(t.frame)) : null
    },
    set(law, { placementOf }) {
        const t = boundTerm(law)
        return t ? bearingHalf(placementOf(t.frame), t.value) : null
    },
    // A bearing from a frame. A point on the vertex has no direction, so the
    // declaration realizes a paper-scale arm on the ray. (id:laws-freedom)
    propose({ law, target, observer, value, worldOf, placementOf }) {
        const t = boundTerm(law)
        if (law && !t) return { ok: false, kind: "unresolved", reason: "the bearing has no bound term" }
        const pose = placementOf(t ? t.frame : observer)
        if (!pose || !finite3(pose.position)) return { ok: false, kind: "unresolved", reason: "the declaring frame has no pose" }
        const heading = headingOf(pose.rotation)
        if (heading === null) return { ok: false, kind: "unresolved", reason: "the declaring frame has no heading" }
        const moving = worldOf(target)
        if (!finite3(moving)) return { ok: false, kind: "unresolved", reason: "the point has no position" }
        const r = realizeBearing({ vertex: pose.position, moving }, heading + (t ? t.value : value))
        return r.ok ? { ok: true, world: r.pose } : { ok: false, reason: r.reason }
    },
    constraint(law, { placementOf }) {
        const t = boundTerm(law)
        if (!t) return null
        const pl = bearingHalf(placementOf(t.frame), t.value)
        return pl ? { feature: "bearing", set: pl } : null
    },
    points: (law) => [law.endpoints[0]],
})


// Explicit rows. A new authored relation is one more object here, not a new seam.
export const AUTHORED = { distance, position, coordinate, tilt, bearing }

// Which features admit a dependency-driven revision, and the datum space a driver
// re-applies them in. A capability is DATA a row declares; the shared mechanisms
// enforce its consequences — registration, retirement, queueing, re-application.
// (id:laws-dependency-driven-place)
export const driveOf = (feature) => AUTHORED[feature]?.drive ?? null

// Which operators may PLACE a subject. Operator semantics, not a binding role: it
// permits establishment and decides nothing else. (laws-first-two-pin-birth, D058)
export const mayEstablishOf = (feature) => AUTHORED[feature]?.mayEstablish === true

// Replace ONLY the payload-bearing field of a term, keeping every other field — frame,
// references, axis, provenance and any future meaning. The row's schema decides which
// field that is; a view never enumerates them. (id:laws-payload-boundary)
export function withPayload(term, payload) {
    if (term == null) return null
    return AUTHORED[term.type]?.replacePayload?.(term, payload) ?? null
}

export function parseProperty(property) {
    for (const row of Object.values(AUTHORED)) {
        if (row.properties?.includes(property)) return row.form ? row.form(property) : { feature: row.name }
    }
    return null
}

// The INVERSE of parseProperty: the authored spelling of a feature (and axis). One
// home for the mapping, so a printer never enumerates features. (D058)
export function propertyOf(feature, axis = null) {
    const row = AUTHORED[feature]
    if (!row) return feature
    const properties = row.properties ?? []
    if (axis != null) {
        for (const property of properties) {
            const form = row.form ? row.form(property) : { feature: row.name }
            if (form.axis === axis) return property
        }
        return axis
    }
    return properties[0] ?? feature
}

export function parseSupport() {
    const names = Object.values(AUTHORED).flatMap((row) => row.properties ?? [])
    if (names.length === 0) return "a supported relation"
    if (names.length === 1) return `a supported relation (${names[0]})`
    return `a supported relation (${names.slice(0, -1).join(", ")} or ${names[names.length - 1]})`
}


export function addressShape(feature) {
    return AUTHORED[feature]?.address ?? null
}

// The row's declared symmetries — the ONLY canonicalization the address may apply.
export function symmetricOf(feature) {
    return AUTHORED[feature]?.symmetric === true
}


// One way to read the world, so every consumer wires the SAME two readings and identity
// resolution lives here alone. Both readers are required: a missing one is a wiring
// error, not a missing value. (id:laws-decl-interface, D058)
export function bindWorld(getFrame, { live, placement, ...extras } = {}) {
    if (typeof live !== 'function' || typeof placement !== 'function') {
        throw new Error('bindWorld needs a live and a placement reader')
    }
    const frameOf = (frameOrId) => {
        if (frameOrId == null) return null   // id 0 is a valid identity, not absent
        return typeof frameOrId === 'object' && frameOrId.id != null ? frameOrId : getFrame(frameOrId)
    }
    const read = (reader, frameOrId) => {
        const f = frameOf(frameOrId)
        return f ? reader(f) : null
    }
    return {
        livePoseOf: (frameOrId) => read(live, frameOrId),
        // A live position is the live pose's projection, never a third reading.
        worldOf: (frameOrId) => read(live, frameOrId)?.position ?? null,
        placementOf: (frameOrId) => read(placement, frameOrId),
        frameOf,
        ...extras,
    }
}

// Point incidence is enumerable, so indexed and scanning queries share the same row. (D058)
export const pointSubjects = (law) => AUTHORED[law?.feature]?.points?.(law) ?? []

// One point query: the laws that TOUCH one point, their resolved set contributions and their
// constraint records. OTHER INPUTS ARE HELD — this is the point's own truths, not the
// complete configuration space; a sphere cannot replace the relationship between two free
// ends. Callers keep every original obligation and apply their own selection policy. (D058)
export function pointQuery(id, laws, ctx) {
    const contributions = []
    for (const law of laws instanceof Map ? (laws.get(id) ?? []) : laws) {
        const row = AUTHORED[law.feature]
        if (!pointSubjects(law).includes(id)) continue
        // A verified tautology is NEUTRAL: it forms no set and names no unavailability, so
        // it can never disable an otherwise supported meet. (D058)
        const neutral = row.tautology?.(law) === true
        const constraint = row.constraint ? row.constraint(law, ctx) : null
        const set = neutral || !row.set ? null : row.set(law, ctx)
        // An UNAVAILABLE contribution is REPORTED with its reason, never silently dropped —
        // and a failed SET counts, even when a constraint record SURVIVES: a pin's fact is
        // retained while its geometry is not offered. (id:laws-activation-order, D058)
        const missing = boundTerm(law) == null ? 'unreadable' : 'unsupported'
        const reason = neutral ? null
            : row.set != null && set == null ? missing
                : constraint == null && row.constraint ? missing
                    : null
        contributions.push({ law, feature: law.feature, neutral, set, constraint, ...(reason ? { reason } : {}) })
    }
    const setBearing = contributions.filter((c) => AUTHORED[c.feature]?.set && !c.neutral)
    return {
        contributions,
        laws: contributions.map((c) => c.law),
        constraints: contributions.map((c) => c.constraint).filter(Boolean),
        unavailable: contributions.filter((c) => c.reason),
        meets: contributions.some((c) => AUTHORED[c.feature]?.meet === true),
        setBearing,
        sets: setBearing.map((c) => c.set),
        complete: setBearing.every((c) => c.set != null),
    }
}

// The view a point's state consumes: the surviving records AND the unavailable
// contributions, with reasons. (D058)
export function constraintsView(id, laws, ctx) {
    const q = pointQuery(id, laws, ctx)
    return { constraints: q.constraints, unavailable: q.unavailable, complete: q.complete }
}

export function constraintsOn(id, laws, ctx) {
    return pointQuery(id, laws, ctx).constraints
}
