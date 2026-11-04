// A derived display projection: pure geometry from a committed value. The view
// replaces it on commit; it is not ink and not command replay. (id:laws-build-p3-slider)
//
// The polygon is the slider's "live readout" with a shape: the scalar is authored
// once, the side count follows it, and the projection is recomputed from the
// accepted configuration rather than re-walking the turtle.

// Sides from a scalar: at least a triangle, bounded, truncated. Pure data.
export function polygonSides(value, { min = 3, max = 64 } = {}) {
    if (!Number.isFinite(value)) return 0
    return Math.min(max, Math.max(min, Math.trunc(value)))
}

// Regular polygon vertices in the plane of `center`, in world coordinates.
export function polygon(center, radius, sides, rotation = 0) {
    if (!(sides >= 1) || !Array.isArray(center)) return []
    const out = []
    for (let i = 0; i < sides; i++) {
        const a = rotation + (i / sides) * Math.PI * 2
        out.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a), center[2]])
    }
    return out
}
