// The vector kernel the law modules share. (id:laws-decl-vector)
//
// Pure tuples in, pure tuples out. One arithmetic kernel and its degenerate answers
// named once, so a locus's geometry is spelled once. Where a tolerance is a *policy* —
// meet's conditioning REL_TOL, realize's exact REALIZE_TOL — the caller passes it; the
// default EPS is floating noise only — an ABSOLUTE length floor, never a scale.
import { conditionOf, FINITE } from "../numerics.js"

export const EPS = 1e-12

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (v) => Math.hypot(v[0], v[1], v[2])

export const finite3 = (p) => Array.isArray(p) && p.length === 3 &&
    conditionOf(p[0]) === FINITE && conditionOf(p[1]) === FINITE && conditionOf(p[2]) === FINITE

// One normalizer. Scale the largest component out FIRST: a finite nonzero vector has
// a direction at any magnitude — its norm cannot overflow the reciprocal once the
// components are scaled, and a tiny one cannot fail it. The result is admitted by
// construction: the scaled components sit in [−1, 1] with one at unit length, so
// their norm lands in [1, √3] and no step leaves the finite numbers.
const normalized = (v) => {
    const m = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]))
    if (!(m > 0) || conditionOf(m) !== FINITE) return null
    const w = [v[0] / m, v[1] / m, v[2] / m]
    return scale(w, 1 / len(w))
}

// A GIVEN direction, null below `eps`. An ABSOLUTE floor on purpose: the vector passed
// in IS the quantity under question, and a tolerance needs a scale this function does
// not have. A caller holding two POINTS should ask `directionBetween` instead — the
// subtraction of two doubles answers without one.
export const unit = (v, eps = EPS) => (finite3(v) && len(v) > eps ? normalized(v) : null)

// Not every question has an answer, and its two ways of failing are not one. A
// COINCIDENT pair is a fact about geometry: `null`, so a caller may state its own
// fallback (`?? [1, 0, 0]`). An INVALID question is a fact about the input: it
// licenses nothing — never a guessed bearing. (P2: an invalid subtraction must not
// share the coincident-pair answer)
export const INVALID = Symbol("invalid direction request")

// The direction FROM `a` TO `b`, null when they COINCIDE, INVALID when the question
// cannot be asked. The displacement IS the question: IEEE subtraction of the given
// doubles is exact to half an ulp of its own result, so where the pair stands can
// never make a resolvable displacement vanish or appear — acceptance is judged on
// the displacement alone, and the coordinate origin is no one's policy. (P1: the
// same figure keeps its bearing in every frame)
// The pair coincides ONLY when its displacement is exactly zero. A consumer with a
// coarser notion of "the same place" names its own scale and judges before asking
// (ruling 4: a tolerance is a number plus the scale it was chosen at).
export const directionBetween = (a, b) => {
    if (!finite3(a) || !finite3(b)) return INVALID
    let d = sub(b, a)
    if (!finite3(d)) {
        // Some component's subtraction overflowed its own difference. Keep every
        // displacement the subtraction ALREADY resolved — divided by the common
        // scale, never multiplied by its possibly-subnormal reciprocal — and repair
        // only the overflowed components, from the scaled endpoints.
        const m = Math.max(
            Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]),
            Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]))
        d = [0, 1, 2].map((i) => {
            const di = b[i] - a[i]
            return conditionOf(di) === FINITE ? di / m : b[i] / m - a[i] / m
        })
    }
    return d[0] === 0 && d[1] === 0 && d[2] === 0 ? null : normalized(d)
}
