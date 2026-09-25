// The evaluator's relational and spatial vocabulary, in one place. (id:eval-relational)
//
// A relation measures a value from a target and an observer through a reading: the
// live read, or a proposed configuration. Both supply a `{ position, rotation, time }`
// to the SAME definition, so a source read and a legality check cannot disagree about
// what a distance means.

export const RELATIONAL_NAMES = ["distance", "bearing", "sync"]
export const SPATIAL_NAMES = ["x", "y", "z", "heading"]
export const DEG = 180 / Math.PI

export function headingOf(rotation) {
    return Math.atan2(
        2 * (rotation.w * rotation.y - rotation.x * rotation.z),
        1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z),
    ) * DEG
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
            return Math.atan2(dx, dy) * DEG - headingOf(o.rotation)
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
        default:
            return undefined
    }
}
