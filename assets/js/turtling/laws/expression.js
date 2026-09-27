// Typed, framed predicates. (id:laws-build-p3a, id:eval-relational)
//
// The relation vocabulary is the evaluator's own: RELATIONAL (distance, bearing,
// sync) and SPATIAL (x, y, z, heading). A law reads its meaning from the same names
// and does not invent a parallel taxonomy. Lowering preserves identities, kinds,
// domain guards and source ownership; the address excludes the value, so revising
// the payload revises in place.

export const KIND = { length: "length", angle: "angle", duration: "duration", scalar: "scalar", point: "point" }

import { RELATIONAL_NAMES, SPATIAL_NAMES } from "./relations.js"
import { AXES } from "./relationships.js"
import { AUTHORED } from "./authored.js"

// The family is the evaluator's, derived from its own name lists — not a second
// classification. A law and a read therefore see the same relations.
const familyOf = (name) =>
    RELATIONAL_NAMES.includes(name) ? "relational"
        : SPATIAL_NAMES.includes(name) ? "spatial" : null

const row = (name, kind, guard, bounds) => ({ family: familyOf(name), kind, guard, bounds })

// The axis is part of a coordinate law's meaning, so it carries its own domain
// guard: a framed coordinate names one of the declaring frame's own axes.
export const axisOk = (axis) => AXES.includes(axis)

// One table: authored rows are the same objects as AUTHORED. Reads (bearing, x, …)
// live here only. (id:relationships-row-contract)
export const RELATION = {
    distance: AUTHORED.distance,
    bearing: AUTHORED.bearing,
    sync: row("sync", KIND.duration, { finite: true }, null),
    x: row("x", KIND.scalar, { finite: true }, null),
    y: row("y", KIND.scalar, { finite: true }, null),
    z: row("z", KIND.scalar, { finite: true }, null),
    heading: row("heading", KIND.angle, { finite: true }, null),
    // Elevation is bounded by its meaning, not by policy: ±90 IS the paper's normal.
    elevation: row("elevation", KIND.angle, { finite: true }, { min: -90, max: 90 }),
    position: AUTHORED.position,
    coordinate: AUTHORED.coordinate,
    tilt: AUTHORED.tilt,
}

export function relationOf(feature) {
    return RELATION[feature] ?? null
}

export function kindOf(feature) {
    return relationOf(feature)?.kind ?? KIND.scalar
}

export function guardsOf(feature) {
    const row = relationOf(feature)
    return row ? { ...row.guard } : null
}

// The bounded scalar a slider may vary. Bounds are data, disclosed before use.
export function boundsOf(feature) {
    const row = relationOf(feature)
    return row?.bounds ? { ...row.bounds } : null
}

// The domain guard, evaluated from the bound relation — not from the source spelling.
export function predicateOk(feature, value) {
    const guard = relationOf(feature)?.guard
    if (!guard) return true
    if (guard.finite3) return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    if (guard.finite && !Number.isFinite(value)) return false
    if (guard.nonNegative && value < 0) return false
    return true
}

export function boundedValue(value, bounds = { min: -Infinity, max: Infinity }) {
    const v = Number.isFinite(value) ? value : bounds.min
    return Math.min(bounds.max, Math.max(bounds.min, v))
}
