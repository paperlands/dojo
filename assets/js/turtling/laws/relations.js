// The evaluator's relational and spatial vocabulary, in one place. (id:eval-relational)
//
// A relation measures a value from a target and an observer through a reading: the
// live read, or a proposed configuration. Both supply a `{ position, rotation, time }`
// to the SAME definition, so a source read and a legality check cannot disagree about
// what a distance means.

export const RELATIONAL_NAMES = ["distance", "bearing", "sync"]
export const SPATIAL_NAMES = ["x", "y", "z", "heading", "elevation"]
export const DEG = 180 / Math.PI

// The paper's compass. Zero is +y — the screen's up, the paper's north — and the
// angle grows clockwise, so +x is due east and a right turn adds. ONE definition,
// read twice: a frame's heading is the compass bearing of its forward, and a
// bearing is the compass of a target less the observer's heading — so a bearing of
// zero is dead ahead, positive is to the right. (id:eval-relational)
export const compassOf = (dx, dy) => Math.atan2(dx, dy) * DEG

// The one definition both aim readings project: the turtle's forward, +x turned by
// the rotation. Components rather than a Versor call — a rotation is a plain
// {x,y,z,w} to every reader. (id:eval-relational)
export function forwardOf(rotation) {
    const { x, y, z, w } = rotation
    return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)]
}

// A direction in space is TWO numbers, not one. Heading is the compass in the
// paper's plane; elevation is how far off that plane the nose points, signed, ±90 at
// the normal. Neither is invented: both project the same forward, so they cannot
// disagree. Elevation still answers where the compass cannot (±90 at the normal),
// so the pair is never both blind; and roll, which moves the nose not at all,
// appears in neither. (id:eval-relational)
const PLANE_MIN = 1e-9

// One compass rule, whoever projects it: zero projected direction has NO bearing —
// atan2(0, 0) is a number, and it is a lie. `null` is the honest answer, whether the
// projection is a nose along the normal or a sight line with no direction to name:
// coincident endpoints, or one straight above the other. (id:eval-relational)
const compassOrNull = (dx, dy) => Math.hypot(dx, dy) <= PLANE_MIN ? null : compassOf(dx, dy)

export function headingOf(rotation) {
    const [fx, fy] = forwardOf(rotation)
    return compassOrNull(fx, fy)
}

export function elevationOf(rotation) {
    const fz = forwardOf(rotation)[2]
    return Math.asin(Math.max(-1, Math.min(1, fz))) * DEG
}

// One measurement. `read(frame) -> { position: [x, y, z], rotation: q, time }`.
export function measure(relation, target, observer, read) {
    const t = read(target)
    switch (relation) {
        case "distance": {
            const o = read(observer)
            const [ax, ay, az] = t.position
            const [bx, by, bz] = o.position
            return Math.hypot(ax - bx, ay - by, az - bz)
        }
        case "bearing": {
            const o = read(observer)
            const dx = t.position[0] - o.position[0]
            const dy = t.position[1] - o.position[1]
            const h = headingOf(o.rotation)
            // A turn relative to a nose with no compass bearing is nothing, too.
            if (h === null) return null
            // And so is a turn toward a target that projects no direction at all:
            // the coincident case names no way to turn, only an angle atan2 invents.
            const c = compassOrNull(dx, dy)
            return c === null ? null : c - h
        }
        case "sync":
            return (t.time ?? 0) - (read(observer).time ?? 0)
        case "x":
            return t.position[0]
        case "y":
            return t.position[1]
        case "z":
            return t.position[2]
        case "heading":
            return headingOf(t.rotation)
        case "elevation":
            return elevationOf(t.rotation)
        default:
            return undefined
    }
}
