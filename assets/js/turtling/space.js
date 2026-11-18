// The engine's space is three; a VALUE is an n-array. A pose is the PROJECTION of a
// value into that space, and this is the one place the three lives — a pin, a
// displacement and a rendered shadow all project through here, so they agree by
// construction. The value keeps its own dimension everywhere else; the tower's
// operations are shape-generic and own their domains (equal lengths for + - ., exactly
// three for the cross). (id:notation-coordinate-vector)
//
// `n < 3` EMBEDS: the value's own space is a subspace — `(x)` → `(x,0,0)`, `(x,y)` →
// `(x,y,0)`. `n == 3` is the identity. `n > 3` PROJECTS: a real, lossy map — truncate to
// the first three. The homogeneous divide `(x,y,z,w) → (x/w, y/w, z/w)` is the horizon,
// the one that gives `w` its meaning (a point at infinity when `w = 0`).
//
// An empty list, a non-array and a non-finite component do not land in the space.

import { conditionOf, FINITE } from "./numerics.js"

export const SPACE = 3

export function toSpace(value) {
    if (!Array.isArray(value) || value.length < 1) return null
    const n = [value[0], value.length > 1 ? value[1] : 0, value.length > 2 ? value[2] : 0]
    return n.every((x) => conditionOf(x) === FINITE) ? n : null
}
