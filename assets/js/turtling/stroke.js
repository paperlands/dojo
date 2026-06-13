// Stroke — path accumulator state machine.
//
// Batches consecutive line segments into a single path event.
// Lifecycle: null → extend → extend → ... → flush/fill → null
//
// The executor updates stroke.lastPos before each command call
// (the position before the move) so new paths start correctly.

export function createStroke() {
    return { path: null, lastPos: [0, 0, 0] }
}

// Extend the current path with a new point.
// If no path exists, starts one from lastPos with the given style.
export function extend(stroke, point, style) {
    if (!stroke.path) {
        stroke.path = {
            color: style.color,
            thickness: style.thickness,
            points: [stroke.lastPos],
            filled: false,
        }
    }
    stroke.path.points.push(point)
}

// Flush the current path as an event. Returns the event or null.
export function flush(stroke) {
    if (!stroke.path) return null
    const event = { type: "path", ...stroke.path }
    stroke.path = null
    return event
}

// Mark filled, then flush. Returns the event or null.
export function fill(stroke) {
    if (!stroke.path) return null
    stroke.path.filled = true
    return flush(stroke)
}
