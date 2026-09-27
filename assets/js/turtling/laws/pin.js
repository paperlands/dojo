// A free `let A` is a point one can touch; `as A` gives that same A a head.
// Then the point is a reading, not another handle. (id:laws-place-head-frame)
//
// The mark is a bodyless place's own presence: a flat dot — a point on paper is
// a dot, never a lit pearl — inside the ring whose radius IS the hit test, and one
// arm along the heading the place was born with, which opens to a ring when that
// heading lies along the sight line. A declaration is already the
// walk's reached pose, facing forward (seatPlace), so the arm reads a door the
// source opened rather than inventing a direction; and it is the only direction
// this mark may carry, because a place with a body gives its centre to the arrow,
// and the arrow is that place's own facing. (id:laws-decl-interface)

const TAU = Math.PI * 2
const PAPER = '243,237,223'

const DOT_REST = 2.5     // the place itself, at rest
const DOT_HELD = 3.5     // a hand is on it
const FACING_MIN = 4     // px: a facing the eye flattened away is no facing
const ARM_MIN = 4        // px: an arm shorter than its own base is no arm

// One coordinate, as the drawing states it: the plane is two numbers, and the
// third appears only when the point has actually left it. (id:laws-decl-interface)
export function coordinate(position) {
    const [x, y, z] = position
    const plane = `${x.toFixed(2)}, ${y.toFixed(2)}`
    if (!Number.isFinite(z)) return plane
    const depth = z.toFixed(2)
    // Nonzero at the shown precision, not below it: `, 0.00` is noise, not depth.
    return depth === '0.00' || depth === '-0.00' ? plane : `${plane}, ${depth}`
}

export function drawPin(ctx, { cx, cy, name = '', width = 0, withHead = false,
    touchable = false, held = false, accepted = null, outcome = null, ghost = null, facing = null, ink = null }) {
    const radius = touchable || withHead ? 18 : 9
    const dot = held ? DOT_HELD : DOT_REST
    // The arm is drawn under the ring: the world's mark beneath the hand's.
    // The projection gives the direction, the pin gives the length, so the arm
    // is the same size wherever the camera stands. (id:laws-decl-interface)
    const reach = radius - 5
    const base = dot + 0.5
    const span = facing ? Math.hypot(facing.x, facing.y) : 0
    if (!withHead && span >= FACING_MIN && reach - base >= ARM_MIN) {
        const ux = facing.x / span, uy = facing.y / span
        const half = held ? 2.2 : 1.6
        ctx.beginPath()
        ctx.moveTo(cx + ux * base - uy * half, cy + uy * base + ux * half)
        ctx.lineTo(cx + ux * reach, cy + uy * reach)
        ctx.lineTo(cx + ux * base + uy * half, cy + uy * base - ux * half)
        ctx.closePath()
        ctx.fillStyle = ink || `rgba(${PAPER},${held ? 0.75 : 0.62})`
        ctx.fill()
    }

    // A free point has a touch-sized ring. A headed point has a ring only to
    // couple it visibly to the arrow; neither steals the other's centre.
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, TAU)
    ctx.strokeStyle = ink || `rgba(${PAPER},${touchable ? held ? 0.85 : 0.5 : 0.28})`
    ctx.lineWidth = touchable && held ? 1.6 : 1
    ctx.stroke()

    if (!withHead) {
        ctx.beginPath()
        ctx.arc(cx, cy, dot, 0, TAU)
        const dotAlpha = held ? 0.95 : 0.82
        if (facing && span < FACING_MIN) {
            // The facing lies along the sight line, so it has no screen direction and
            // the compass has no bearing to give either. The dot opens instead of
            // vanishing — "it points at you", never "it has no facing". A facing we
            // did not read at all is not this case, and stays filled.
            ctx.strokeStyle = ink || `rgba(${PAPER},${dotAlpha})`
            ctx.lineWidth = 1
            ctx.stroke()
        } else {
            ctx.fillStyle = ink || `rgba(${PAPER},${dotAlpha})`
            ctx.fill()
        }
    }

    const lines = [name]
    // The pin IS the position; naming it again as a second, live coordinate
    // would say the same number twice. The verdict is the only other line.
    if (held && accepted) lines.push(coordinate(accepted))
    if (held && outcome && outcome !== 'accepted') lines.push(outcome)
    else if (!held && touchable && ghost?.fade > 0) lines.push(ghost.text)
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
    const gap = radius + 12
    const flip = cx + gap + Math.max(...lines.map(s => ctx.measureText(s).width)) > width
    ctx.textAlign = flip ? 'right' : 'left'
    ctx.textBaseline = 'alphabetic'
    lines.forEach((line, index) => {
        const fade = !held && index > 0 ? ghost?.fade ?? 1 : 1
        ctx.fillStyle = `rgba(${PAPER},${(index === 0 ? 0.52 : 0.34) * fade})`
        ctx.fillText(line, cx + (flip ? -gap : gap), cy - radius + 2 + index * 13)
    })
    ctx.textAlign = 'left'
}

// A dashed mark: one polyline, one stroke, so the dash reads as a cadence and not
// as per-segment dots. One cadence for the dashed ink; only the alphas differ.
// (id:laws-freedom)
const GHOST_DASH = [4, 5]
function strokeDashed(ctx, screenPoints, alpha) {
    if (!screenPoints || screenPoints.length < 2) return
    ctx.save()
    ctx.beginPath()
    let pen = false
    for (const p of screenPoints) {
        if (!p) { pen = false; continue }
        if (pen) ctx.lineTo(p.x, p.y)
        else ctx.moveTo(p.x, p.y)
        pen = true
    }
    ctx.setLineDash(GHOST_DASH)
    ctx.strokeStyle = `rgba(${PAPER},${alpha})`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
}


// A trace: a locus the play only ever SAMPLES — motion along it is a walk of
// samples, not the exact curve. Dashed, so the mark never claims the locus it
// samples; an exact continuation is earned only when play asks for one.
// (id:laws-freedom)
export function drawTrace(ctx, screenPoints) {
    strokeDashed(ctx, screenPoints, 0.26)
}

// A bounded shell's contour: the rim the eye sees. Every point of it is really on
// the surface at the stated distance, so it is no guess — but it is a fact about
// the eye as much as the world, so it never borrows the dashed cadence that means
// "where the point may go". A plain faint outline: the figure's edge, not a locus.
// (id:laws-freedom)
const RIM_ALPHA = 0.18
export function drawRim(ctx, screenPoints) {
    if (!screenPoints || screenPoints.length < 2) return
    ctx.save()
    ctx.beginPath()
    let pen = false
    for (const p of screenPoints) {
        if (!p) { pen = false; continue }
        if (pen) ctx.lineTo(p.x, p.y)
        else ctx.moveTo(p.x, p.y)
        pen = true
    }
    ctx.strokeStyle = `rgba(${PAPER},${RIM_ALPHA})`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
}

// One alternative solution, as a dotted ghost: the branch not taken is offered,
// never hidden. (id:laws-freedom)
export function drawGhostMark(ctx, x, y, r = 3.5) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.setLineDash(GHOST_DASH)
    ctx.strokeStyle = `rgba(${PAPER},0.4)`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
}

// The wish and where it landed: a light tether from the accepted point to the
// pointer's target when the projection absorbed part of the wish. A projection
// is a lawful response, so this is ink, never a refusal. Only drawn when the two
// differ on screen — a satisfied wish needs no tether. (id:laws-freedom)
const WISH_DASH = [1, 3]
export function drawWish(ctx, from, to) {
    if (!from || !to) return
    if (Math.hypot(from.x - to.x, from.y - to.y) < 1) return
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.setLineDash(WISH_DASH)
    ctx.strokeStyle = `rgba(${PAPER},0.32)`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(to.x, to.y, 3, 0, TAU)
    ctx.strokeStyle = `rgba(${PAPER},0.5)`
    ctx.stroke()
    ctx.restore()
}

// One axis, projected: a world segment between two screen points. The camera
// gives the direction; the world gives the axis. (id:laws-freedom)
// A radius spoke: the distance itself, drawn from the point to its centre — the
// quantity a distance names, not the normal it rests on. Dotted, like a trace.
// (id:laws-freedom)
const SPOKE_DASH = [1, 3]
export function drawSpoke(ctx, from, to) {
    if (!from || !to) return
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.setLineDash(SPOKE_DASH)
    ctx.strokeStyle = `rgba(${PAPER},0.34)`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
}

export function drawAxis(ctx, a, b, { strong = false } = {}) {
    if (!a || !b) return
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = `rgba(${PAPER},${strong ? 0.5 : 0.26})`
    ctx.lineWidth = strong ? 1.4 : 1
    if (!strong) ctx.setLineDash([2, 3])
    ctx.stroke()
    ctx.restore()
}

// One surface curve, depth-faded: near brighter, far fainter — the surface reads
// as a volume without transparency. Points carry `t` in [0,1], near to far.
// (id:laws-freedom)
export function drawCurve(ctx, points, { near = 0.5, far = 0.14 } = {}) {
    if (!points) return
    ctx.save()
    ctx.lineWidth = 1
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i]
        if (!a || !b) continue
        const t = ((a.t ?? 0) + (b.t ?? 0)) / 2
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = `rgba(${PAPER},${(near + (far - near) * t).toFixed(3)})`
        ctx.stroke()
    }
    ctx.restore()
}
