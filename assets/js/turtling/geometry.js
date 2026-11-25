// Finite runs of places. A run boundary is an explicit break, never a hidden edge.
// A declaration and a walk answer `.path` the same way. Unresolved is not empty.
// (id:path-a-walk-of-places, id:path-accepted-places, id:path-touch)

import { DomainRefusal, KIND, asKind } from './mafs/tower.js'
import { conditionOf, FINITE } from './numerics.js'
import { toSpace } from './space.js'
import { cross, dot, len, sub } from './laws/vec3.js'

// Three world components, exactly. Unclassified is unresolved; proved apart is empty.
// Length tolerance is relative to the geometry's own size, never an absolute grid.
const RELATIVE = 1e-9
// Angle sines: exactly parallel, and the band that is too close to call either way.
const PARALLEL_SINE = 1e-12
const CONDITION_SINE = 1e-9

const tag = (value, kind) => Object.defineProperty(value, KIND, { value: kind, enumerable: false })
const speciesOf = (value) => value != null && typeof value === 'object' && !Array.isArray(value)
    ? value[KIND] ?? null : null

export const isPath = (value) => speciesOf(value) === 'path'
export const isCrossing = (value) => speciesOf(value) === 'crossing'
// A geometry value is a retained shape, not a coordinate: a consumer that needs a
// measure must refuse it, and `.path` reads it as itself.
export const isGeometry = (value) => isPath(value) || isCrossing(value)

// A read copies places and runs. The walk may keep appending. (id:path-accepted-places)
const copyRun = (run) => run.map((place) => [place[0], place[1], place[2]])
const copyRuns = (runs) => Object.freeze(runs.map(copyRun))

// A retained shape cannot be rewritten by the consumer that reads it.
export function makePath(runs = []) {
    return tag({ runs: copyRuns(runs) }, 'path')
}

// One place set: what a set operation includes, in storage order. Not a walk.
export function makeCrossing(points = []) {
    return tag({ points: Object.freeze(copyRun(points)) }, 'crossing')
}

// A copy of a live trace, so a consumer's read is one coherent cut even while the
// walk that owns it keeps appending. The copy is paid at the READ, never per step.
export const snapshotPath = (runs) => makePath(runs)

// Append one ACCEPTED place. `extend` continues the current run; anything else
// (a jump, a fresh run, a rebase) starts a new one, so no edge is fabricated.
export function recordPlace(runs, point, extend) {
    const last = runs.length ? runs[runs.length - 1] : null
    if (extend && last) last.push(point)
    else runs.push([point])
    return point
}

// A declared place is ONE value projected into the space — the value algebra's own
// embedding (missing components are 0). It does not inherit a turtle's height: a
// declaration has no cursor to inherit from. (id:path-a-walk-of-places)
function declaredPlace(place) {
    const point = toSpace(place)
    // A refusal, not a wound of the walk: the DECLARATION is what cannot mean what it
    // says, so nothing is installed and whatever the name answered before still stands.
    // (id:eval-relational, id:path-accepted-places)
    if (!point) throw new DomainRefusal('path', 'a finite place', describe(place))
    return point
}

const describe = (value) => isPath(value) ? 'a path'
    : isCrossing(value) ? 'a set of crossings'
        : Array.isArray(value) ? `[${value.map(String).join(', ')}]` : String(value)

const finitePoint = (point) => Array.isArray(point) && point.length === 3 &&
    point.every((component) => conditionOf(component) === FINITE)

// The geometry's own size sets the length tolerance. A place whose components leave the
// number line has no size, and the pair is unresolved rather than convenient.
function sizeOf(origin, ...points) {
    let size = 0
    for (const point of points) {
        for (let i = 0; i < point.length; i++) {
            const magnitude = Math.abs(point[i] - origin[i])
            if (!Number.isFinite(magnitude)) return null
            if (magnitude > size) size = magnitude
        }
    }
    return size
}

// Two spans whose extents are separated on ANY axis cannot meet. Exact, no tolerance,
// no index: short disjoint spans stay disjoint.
function separated(a, b) {
    for (let i = 0; i < 3; i++) {
        const aLo = Math.min(a.from[i], a.to[i]), aHi = Math.max(a.from[i], a.to[i])
        const bLo = Math.min(b.from[i], b.to[i]), bHi = Math.max(b.from[i], b.to[i])
        if (aHi < bLo || bHi < aLo) return true
    }
    return false
}

const clamp01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t)
const spanAt = (span, t) => t === 0 ? [...span.from] : t === 1 ? [...span.to]
    : sub(span.to, span.from).map((component, i) => span.from[i] + component * t)
const spanFraction = (span, point) => {
    const g = sub(span.to, span.from)
    const length = len(g)
    return length > 0 ? clamp01(dot(sub(point, span.from), g) / (length * length)) : 0
}

// The fraction along `span` at which `point` sits on it, or null. A span shorter than
// the tolerance is a place and meets only its own position.
function placeOn(span, point, tol) {
    const g = sub(span.to, span.from)
    const length = len(g)
    if (length <= tol) return len(sub(point, span.from)) <= tol ? [...span.from] : null
    const s = dot(sub(point, span.from), g) / (length * length)
    if (s < -tol / length || s > 1 + tol / length) return null
    const at = spanAt(span, clamp01(s))
    return len(sub(point, at)) <= tol ? at : null
}

// A span that is a place still meets a span: it is one included point, not no geometry.
function placeCrossing(a, b, aIsPlace, bIsPlace, tol) {
    if (aIsPlace && bIsPlace) {
        return len(sub(a.from, b.from)) <= tol
            ? { kind: 'point', t: 0, s: 0, at: [...a.from] } : { kind: 'none' }
    }
    if (aIsPlace) {
        const at = placeOn(b, a.from, tol)
        return at ? { kind: 'point', t: 0, s: spanFraction(b, at), at: [...a.from] } : { kind: 'none' }
    }
    const at = placeOn(a, b.from, tol)
    return at ? { kind: 'point', t: spanFraction(a, at), s: 0, at } : { kind: 'none' }
}

// Return the shared interval in the first span's travel order. The caller chooses
// whether it needs the whole set or just its first place. (id:path-touch)
function parallelCrossing(a, b, unit, dLen, tol) {
    const offset = sub(b.from, a.from)
    if (len(cross(offset, unit)) > tol) return { kind: 'none' }
    const start = Math.min(dot(offset, unit), dot(sub(b.to, a.from), unit)) / dLen
    const end = Math.max(dot(offset, unit), dot(sub(b.to, a.from), unit)) / dLen
    const tEps = tol / dLen
    const sharedLo = start <= 0 ? 0 : start
    const sharedHi = end >= 1 ? 1 : end
    if (sharedHi < sharedLo - tEps) return { kind: 'none' }
    if (sharedHi - sharedLo <= tEps) {
        const at = spanAt(a, clamp01(sharedLo))
        return { kind: 'point', t: clamp01(sharedLo), s: spanFraction(b, at), at }
    }
    return { kind: 'overlap', enter: clamp01(sharedLo), exit: clamp01(sharedHi) }
}

// First meeting of one straight span with another, in ONE chart. This is a fact, not a
// policy: whether, where, at what fraction — or that the pair is not representable here.
// A bounded span is never read as an infinite line, and the arithmetic is done on unit
// directions so a large figure cannot overflow into a false answer.
export function spanCrossing(a, b) {
    if (!a || !b || !finitePoint(a.from) || !finitePoint(a.to) ||
        !finitePoint(b.from) || !finitePoint(b.to)) {
        return { kind: 'unresolved', reason: 'a span endpoint is not a finite place' }
    }
    if (separated(a, b)) return { kind: 'none' }
    const size = sizeOf(a.from, a.to, b.from, b.to)
    if (size == null) return { kind: 'unresolved', reason: 'the spans are not sized in the number line' }
    const tol = size * RELATIVE
    const d = sub(a.to, a.from), e = sub(b.to, b.from)
    const dLen = len(d), eLen = len(e)
    if (dLen <= tol || eLen <= tol) return placeCrossing(a, b, dLen <= tol, eLen <= tol, tol)

    const du = d.map((component) => component / dLen)
    const eu = e.map((component) => component / eLen)
    const normal = cross(du, eu)
    const sine = len(normal)
    if (sine <= PARALLEL_SINE) return parallelCrossing(a, b, du, dLen, tol)
    if (sine <= CONDITION_SINE) {
        return { kind: 'unresolved', reason: 'the spans are too close to parallel to classify' }
    }
    // Closest approach in each span's own parameter, from unit directions only:
    // t is in units of |d|, s in units of |e|, and neither product can overflow.
    const offset = sub(b.from, a.from)
    const square = dot(normal, normal)
    const t = dot(cross(offset, eu), normal) / (dLen * square)
    const s = dot(cross(offset, du), normal) / (eLen * square)
    if (!Number.isFinite(t) || !Number.isFinite(s)) {
        return { kind: 'unresolved', reason: 'the crossing arithmetic left the number line' }
    }
    const tEps = tol / dLen, sEps = tol / eLen
    if (t < -tEps || t > 1 + tEps || s < -sEps || s > 1 + sEps) return { kind: 'none' }
    const travel = clamp01(t), screen = clamp01(s)
    const at = spanAt(a, travel)
    // The tolerated hit may land at an endpoint, never on an extrapolated suffix.
    if (len(sub(at, spanAt(b, screen))) > tol) return { kind: 'none' }
    return { kind: 'point', t: travel, s: screen, at }
}

// Every place a path INCLUDES: the places a run visits, and the spans between them. A
// one-place run is one place, exactly as a traced single visit is — one policy for both
// makers. (id:path-accepted-places)
const spansOf = (path) => {
    const spans = []
    path.runs.forEach((run, runIndex) => {
        if (run.length === 1) {
            spans.push({ run: runIndex, span: 0, from: run[0], to: run[0] })
            return
        }
        for (let i = 1; i < run.length; i++) {
            spans.push({ run: runIndex, span: i - 1, from: run[i - 1], to: run[i] })
        }
    })
    return spans
}

const samePlace = (a, b, tol) => len(sub(a, b)) <= tol

// Is this place ON the shape? An INCIDENCE test in its own right — the place against
// every span — so entry is decided by where the walk stands, never by a swept fraction
// that happened to round to the start. (id:path-touch)
export function incidence(screen, point) {
    if (!isPath(screen) || !finitePoint(point)) return false
    for (const span of spansOf(screen)) {
        const size = sizeOf(span.from, span.to, point)
        if (size == null) return false
        if (placeOn(span, point, size * RELATIVE) !== null) return true
    }
    return false
}

// The FIRST meeting of one bounded straight step with a path, in TRAVEL order. A fact,
// not a policy: where the step first meets the shape, or that the pair cannot be
// classified at all. Entry is t = 0 — the step's own start — and NO length epsilon is
// applied to t (a world length is not a fraction). (id:path-touch)
export function firstMeeting(screen, from, to) {
    if (!isPath(screen)) return { kind: 'unresolved', reason: 'the screen is not a path' }
    if (!finitePoint(from) || !finitePoint(to)) {
        return { kind: 'unresolved', reason: 'the step endpoints are not finite places' }
    }
    const step = { from, to }
    let best = null
    for (const span of spansOf(screen)) {
        const hit = spanCrossing(step, span)
        if (hit.kind === 'unresolved') return hit
        const t = hit.kind === 'overlap' ? hit.enter : hit.t
        if (t === undefined || (best !== null && t >= best.t)) continue
        best = { kind: 'point', t, at: hit.kind === 'overlap' ? spanAt(step, t) : hit.at }
    }
    return best ?? { kind: 'none' }
}

// Every place two paths have in common, in storage order — the set view. A unique point
// is returned as a PLACE, so it composes straight back into authorship; zero or several
// are a place SET, which is not a walk. (id:path-sufficiency)
export function intersectPaths(a, b) {
    if (!isPath(a) || !isPath(b)) {
        // A declaration that cannot mean what it says is refused by name, not installed.
        // (id:eval-relational)
        throw new DomainRefusal('intersect', 'two paths', `${describe(a)} and ${describe(b)}`)
    }
    const points = []
    let tol = 0
    for (const left of spansOf(a)) {
        for (const right of spansOf(b)) {
            const hit = spanCrossing(left, right)
            if (hit.kind === 'unresolved') {
                // An unanswered pair is not an empty answer: the set is not certified.
                throw new Error(`intersect is unresolved: ${hit.reason}`)
            }
            if (hit.kind === 'overlap') throw new Error('intersect is unresolved: the spans overlap along one line')
            if (hit.kind !== 'point') continue
            // One tolerance for the whole query, from the geometry it was given.
            tol = Math.max(tol, (sizeOf(left.from, left.to, right.from, right.to) ?? 0) * RELATIVE)
            if (!points.some((found) => samePlace(found, hit.at, tol))) points.push(hit.at)
        }
    }
    if (points.length === 1) return asKind(points[0], 'point')
    return makeCrossing(points)
}

// A geometry name has TWO spellings and they are not synonyms:
//
//   path(A, B)   a VALUE — the places, no turtle, no motion, no ink.
//   path A B     a WALK — one command, lowered to the moves that already exist, so a
//                `let` naming it spawns an ordinary figure and `.path` reads a trail.
//
// The bracket right after the name is the whole difference, so the caller that decides
// between them needs the source, not only the name. (id:path-append-composition)
export const isWalkName = (name) => name === 'path'

// The value-side callables the algebra does not own: a shape is not a measure, and
// a set operation is not scalar arithmetic. One list, two views — the parser's arity
// and this dispatcher cannot disagree. (id:tower-center-identity)
export const CALLABLE_ARITY = Object.freeze({ path: '*', intersect: 2 })
export function geometryCall(name, args) {
    if (name === 'path') {
        if (!Array.isArray(args) || args.length === 0) {
            throw new Error('a path needs at least one place')
        }
        return makePath([args.map(declaredPlace)])
    }
    if (name === 'intersect') return intersectPaths(args?.[0], args?.[1])
    return undefined
}
