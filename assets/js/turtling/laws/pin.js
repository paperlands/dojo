// A free `let A` is a point one can touch; `as A` gives that same A a head.
// Then the point is a reading, not another handle. (id:laws-place-head-frame)

const TAU = Math.PI * 2
const PAPER = '243,237,223'
const BEADS = new WeakMap()

function beadOf(ctx) {
    let bead = BEADS.get(ctx)
    if (!bead) {
        bead = ctx.createRadialGradient(-1.75, -2, 0.75, 0, 0, 5)
        bead.addColorStop(0, `rgba(${PAPER},0.98)`)
        bead.addColorStop(0.55, `rgba(${PAPER},0.82)`)
        bead.addColorStop(1, `rgba(${PAPER},0.56)`)
        BEADS.set(ctx, bead)
    }
    return bead
}

export function drawPin(ctx, { cx, cy, name = '', width = 0, withHead = false,
    touchable = false, held = false, accepted = null, requested = null, outcome = null, ghost = null }) {
    // A free point has a touch-sized ring. A headed point has a ring only to
    // couple it visibly to the arrow; neither steals the other's centre.
    const radius = touchable || withHead ? 18 : 9
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, TAU)
    ctx.strokeStyle = `rgba(${PAPER},${touchable ? held ? 0.85 : 0.5 : 0.28})`
    ctx.lineWidth = touchable && held ? 1.6 : 1
    ctx.stroke()

    if (!withHead) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.beginPath()
        ctx.arc(0, 0, 5, 0, TAU)
        ctx.fillStyle = beadOf(ctx)
        ctx.fill()
        ctx.restore()
    }

    const lines = [name]
    if (held && accepted) lines.push(`${accepted[0].toFixed(2)}, ${accepted[1].toFixed(2)}`)
    if (held && outcome && outcome !== 'accepted') lines.push(outcome)
    else if (held && requested) lines.push(`→ ${requested[0].toFixed(2)}, ${requested[1].toFixed(2)}`)
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

// A ghost locus: where a constrained point MAY go, dashed, never the point
// itself. The display names its question; it does not prove the whole locus.
// (id:laws-freedom)
const GHOST_DASH = [4, 5]
export function drawGhost(ctx, screenPoints) {
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
    ctx.strokeStyle = `rgba(${PAPER},0.22)`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
}

// One axis, projected: a world segment between two screen points. The camera
// gives the direction; the world gives the axis. (id:laws-freedom)
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
