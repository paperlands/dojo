// The pin: how a declared place is drawn. (id:laws-decl-handle)
//
// One affordance, four states, and no state told by tint alone. The pin is
// stamped — a bead with a knockout rim and a second ring a hair wider, because a
// printed circle is never vector-perfect — and the ring IS the hit radius, so
// what you see is what you can hit.
//
// Pure drawing: it takes a 2d context and a state, and touches nothing else.
import { HIT_RADIUS } from "./handle.js"

const TAU = Math.PI * 2
const PAPER = '243,237,223'      // the ink we write with, on the dark ground
const GROUND = '16,20,24'        // the canvas it is stamped into

const rgba = (rgb, a) => `rgba(${rgb},${a})`

// Up and to the right, or flipped left near the edge, so a label never leaves
// the field it annotates.
function annotate(ctx, { cx, cy, lines, width }) {
    const gap = HIT_RADIUS + 12
    // Measured, not guessed: a long name must not leave the field either.
    const widest = Math.max(0, ...lines.map((line) => ctx.measureText(line).width))
    const flip = cx + gap + widest > width
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = flip ? 'right' : 'left'
    ctx.textBaseline = 'alphabetic'
    const x = cx + (flip ? -gap : gap)
    const y = cy - HIT_RADIUS + 2
    lines.forEach((line, i) => {
        ctx.fillStyle = rgba(PAPER, i === 0 ? 0.52 : 0.34)
        ctx.fillText(line, x, y + i * 13)
    })
    ctx.textAlign = 'left'
}

export function drawPin(ctx, state) {
    const {
        cx, cy, state: phase = 'rest', from = null, width = 0,
        name = '', accepted = null, requested = null, outcome = 'accepted',
    } = state

    const held = phase === 'held'
    const hover = phase === 'hover'
    const hollow = phase === 'hollow'      // outside the supported domain

    // The birth → live hairline. Not decoration: it is the distance between where
    // the source placed the point and where it now stands.
    if (from) {
        const dx = cx - from.x
        const dy = cy - from.y
        if (Math.hypot(dx, dy) > 2.5) {
            ctx.save()
            ctx.setLineDash([2, 5])
            ctx.strokeStyle = rgba(PAPER, 0.20)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(from.x, from.y)
            ctx.lineTo(cx, cy)
            ctx.stroke()
            ctx.restore()
        }
    }

    // The stamped edge: one hair wider, at a whisper.
    ctx.beginPath()
    ctx.arc(cx, cy, HIT_RADIUS + 0.6, 0, TAU)
    ctx.strokeStyle = rgba(PAPER, 0.09)
    ctx.lineWidth = 1
    ctx.stroke()

    // The ring is the hit radius, drawn true.
    ctx.beginPath()
    ctx.arc(cx, cy, HIT_RADIUS, 0, TAU)
    ctx.strokeStyle = rgba(PAPER, hollow ? 0.34 : held ? 0.85 : hover ? 0.52 : 0.28)
    ctx.lineWidth = held ? 1.6 : 1
    if (hollow) ctx.setLineDash([2, 4])
    ctx.stroke()
    ctx.setLineDash([])

    // A dial, not ornament: every third tick longer, every sixth longest.
    const tickAlpha = hollow ? 0.18 : held ? 0.58 : hover ? 0.42 : 0.24
    ctx.strokeStyle = rgba(PAPER, tickAlpha)
    ctx.lineWidth = 0.65
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU - Math.PI / 2
        const len = i % 6 === 0 ? 7 : i % 3 === 0 ? 5 : 3
        const r0 = HIT_RADIUS - 1
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        ctx.lineTo(cx + Math.cos(a) * (r0 - len), cy + Math.sin(a) * (r0 - len))
        ctx.stroke()
    }

    if (!hollow) {
        const r = held ? 5.6 : 5
        // The knockout first, so the bead sits ON the drawing rather than in it.
        ctx.beginPath()
        ctx.arc(cx, cy, r + 1.2, 0, TAU)
        ctx.fillStyle = rgba(GROUND, 0.92)
        ctx.fill()
        // A bead pressed into the surface, lit from the upper left.
        const bead = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r)
        bead.addColorStop(0, rgba(PAPER, 0.98))
        bead.addColorStop(0.55, rgba(PAPER, 0.82))
        bead.addColorStop(1, rgba(PAPER, held ? 0.72 : 0.56))
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, TAU)
        ctx.fillStyle = bead
        ctx.fill()
    }

    const lines = [name]
    if (accepted) lines.push(`${accepted[0].toFixed(2)}, ${accepted[1].toFixed(2)}`)
    if (outcome && outcome !== 'accepted') lines.push(outcome)
    else if (held && requested) lines.push(`→ ${requested[0].toFixed(2)}, ${requested[1].toFixed(2)}`)
    annotate(ctx, { cx, cy, lines, width })
}
