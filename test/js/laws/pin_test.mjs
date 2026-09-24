// The pin's drawing contract. The beauty cannot be asserted, but the honesty of
// it can: the ring is the hit radius, a hollow pin is not filled, a held pin
// carries the request, and a hairline appears only when there is a gap to show.
// (id:laws-decl-handle)
// Run: node --test test/js/laws/pin_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { drawPin } from "../../../assets/js/turtling/laws/pin.js"
import { HIT_RADIUS } from "../../../assets/js/turtling/laws/handle.js"

const stub = () => {
    const calls = []
    const ctx = {
        fillStyle: null, strokeStyle: null, lineWidth: 1, font: null,
        textAlign: 'left', textBaseline: null, lineCap: 'butt', lineJoin: 'miter',
        setTransform() {}, clearRect() {},
        save() { calls.push(['save']) },
        restore() { calls.push(['restore']) },
        beginPath() { calls.push(['beginPath']) },
        arc(x, y, r) { calls.push(['arc', r]) },
        moveTo(x, y) { calls.push(['moveTo', x, y]) },
        lineTo(x, y) { calls.push(['lineTo', x, y]) },
        stroke() { calls.push(['stroke', ctx.lineWidth, ctx.strokeStyle]) },
        fill() { calls.push(['fill', ctx.fillStyle]) },
        setLineDash(d) { calls.push(['dash', d.join(' ')]) },
        fillText(text) { calls.push(['text', text, ctx.textAlign]) },
        createRadialGradient() { calls.push(['bead']); return { addColorStop() {} } },
        // 6px per character, enough to tell a short name from a long one.
        measureText(text) { return { width: String(text).length * 6 } },
    }
    return { ctx, calls }
}
const draw = (state) => {
    const { ctx, calls } = stub()
    drawPin(ctx, { cx: 300, cy: 200, width: 600, name: 'a', ...state })
    return calls
}
const arcs = (calls) => calls.filter((c) => c[0] === 'arc').map((c) => c[1])
const strokes = (calls) => calls.filter((c) => c[0] === 'stroke')
const texts = (calls) => calls.filter((c) => c[0] === 'text')

test("the drawn ring is the hit radius, exactly", () => {
    const calls = draw({ state: 'rest' })
    assert.ok(arcs(calls).includes(HIT_RADIUS), `no arc at the hit radius: ${arcs(calls)}`)
    // And the stamped edge is a hair wider, never the hit radius itself.
    assert.ok(arcs(calls).includes(HIT_RADIUS + 0.6))
    // The band between the bead and the ring is empty: the dial is line ticks, not
    // concentric circles, so the ring reads as the one edge that means something.
    assert.equal(arcs(calls).filter((r) => r > 8 && r < HIT_RADIUS - 1).length, 0,
        `a circle in the dead band: ${arcs(calls)}`)
    assert.deepEqual([...new Set(arcs(calls))].sort((x, y) => x - y), [5, 6.2, HIT_RADIUS, HIT_RADIUS + 0.6],
        "exactly: bead, its knockout, the ring, its stamped edge")
})

test("a hollow pin is not filled, and says so", () => {
    const rest = draw({ state: 'rest' })
    const hollow = draw({ state: 'hollow', outcome: 'unsupported' })
    assert.ok(rest.some((c) => c[0] === 'fill'), "a graspable pin has a bead")
    assert.equal(hollow.filter((c) => c[0] === 'fill').length, 0, "a hollow pin has no body")
    assert.equal(hollow.filter((c) => c[0] === 'bead').length, 0, "and no sphere")
    assert.ok(hollow.some((c) => c[0] === 'dash' && c[1] === '2 4'), "its ring is broken")
    assert.deepEqual(texts(hollow).map((t) => t[1]), ['a', 'unsupported'])
})

test("a held pin is heavier, and carries the request", () => {
    const rest = draw({ state: 'rest' })
    const held = draw({ state: 'held', accepted: [3, 0, 0], requested: [7.25, 0, 0], outcome: 'accepted' })
    const ring = (calls) => Math.max(...strokes(calls).map((s) => s[1]))
    assert.ok(ring(held) > ring(rest), "the ring thickens when taken")
    const lines = texts(held).map((t) => t[1])
    assert.deepEqual(lines, ['a', '3.00, 0.00', '→ 7.25, 0.00'])
    assert.ok(!texts(rest).some((t) => t[1].startsWith('→')), "the rest state claims nothing")
})

test("a refusal is named, not implied", () => {
    const lines = texts(draw({ state: 'held', accepted: [3, 0, 0], outcome: 'rejected' })).map((t) => t[1])
    assert.deepEqual(lines, ['a', '3.00, 0.00', 'rejected'])
})

test("the birth hairline appears only when there is a gap to show", () => {
    const near = draw({ state: 'rest', from: { x: 300.5, y: 200 } })
    const far = draw({ state: 'rest', from: { x: 120, y: 260 } })
    const hairline = (calls) => calls.some((c) => c[0] === 'dash' && c[1] === '2 5')
    assert.equal(hairline(near), false, "a sub-pixel gap is a smudge, not a line")
    assert.equal(hairline(far), true)
    // And it is drawn from where the source placed the point to where it now is.
    const from = far.find((c) => c[0] === 'moveTo')
    assert.deepEqual([from[1], from[2]], [120, 260])
})

test("the annotation stays inside the field it annotates", () => {
    const align = (state) => texts(draw(state))[0][2]
    assert.equal(align({ state: 'rest', cx: 200 }), 'left')
    // Near the edge the decision is MEASURED, not a fixed guess: a short label at
    // 560 in a 600-wide field genuinely fits (560 + 30 + 6 = 596), so it is left
    // alone; a longer one does not, and flips.
    assert.equal(align({ state: 'rest', cx: 560, name: 'a' }), 'left')
    assert.equal(align({ state: 'rest', cx: 560, name: 'ambient' }), 'right')
    assert.equal(align({ state: 'rest', cx: 470, name: 'averylongambientname' }), 'right')
    assert.equal(align({ state: 'rest', cx: 470, name: 'a' }), 'left')
})
