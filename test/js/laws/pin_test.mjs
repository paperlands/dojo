// A declared place is a reading, not a second movable actor.
// Run: node --test test/js/laws/pin_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { drawPin } from "../../../assets/js/turtling/laws/pin.js"

const stub = () => {
    const calls = []
    const ctx = {
        textAlign: 'left',
        beginPath() { calls.push(['begin']) },
        arc(x, y, r) { calls.push(['arc', x, y, r]) },
        moveTo(x, y) { calls.push(['moveTo', x, y]) },
        lineTo(x, y) { calls.push(['lineTo', x, y]) },
        closePath() { calls.push(['close']) },
        stroke() { calls.push(['stroke']) },
        fill() { calls.push(['fill']) },
        save() { calls.push(['save']) },
        restore() { calls.push(['restore']) },
        fillText(text, x, y) { calls.push(['text', text, x, y, ctx.textAlign]) },
        measureText(s) { return { width: s.length * 6 } },
    }
    return { ctx, calls }
}

const texts = (calls) => calls.filter(c => c[0] === 'text').map(c => c[1])
const arcs = (calls) => calls.filter(c => c[0] === 'arc')
const fills = (calls) => calls.filter(c => c[0] === 'fill').length
const strokes = (calls) => calls.filter(c => c[0] === 'stroke').length

test("an empty A is a dot in its ring, and no arm the world did not give", () => {
    const { ctx, calls } = stub()
    drawPin(ctx, { cx: 100, cy: 50, name: 'A', width: 200 })
    assert.deepEqual(arcs(calls).map(c => c[3]), [9, 2.5], "the ring, then the place itself")
    assert.equal(fills(calls), 1, "a pearl is not a point; a dot is")
    assert.equal(calls.some(c => c[0] === 'close'), false, "no north was given, so no arm")
    assert.deepEqual(texts(calls), ['A'])
})

test("the free point is touch-sized; an anchored point is only a reading", () => {
    const free = stub(), anchored = stub()
    drawPin(free.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true, held: true,
        accepted: [1, 2, 0] })
    drawPin(anchored.ctx, { cx: 100, cy: 50, name: 'A', width: 200, withHead: true,
        accepted: [1, 2, 0], outcome: 'accepted' })
    assert.equal(arcs(free.calls)[0][3], 18)
    assert.equal(arcs(free.calls)[1][3], 3.5, "held, the place grows")
    assert.deepEqual(texts(free.calls), ['A', '1.00, 2.00'],
        "a held point names its position once; the pin itself is where it is")
    assert.deepEqual(arcs(anchored.calls).map(c => c[3]), [18],
        "the arrow holds that centre; the mark shows only the field around it")
    assert.equal(fills(anchored.calls), 0, "no dot where a body stands")
    assert.deepEqual(texts(anchored.calls), ['A'], "an anchored point advertises no separate gesture")
})

test("a held point shows z only once it has left the plane", () => {
    const flat = stub(), lifted = stub()
    drawPin(flat.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true, held: true,
        accepted: [1, 2, 0] })
    drawPin(lifted.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true, held: true,
        accepted: [1, 2, -3.5] })
    assert.deepEqual(texts(flat.calls), ['A', '1.00, 2.00'])
    assert.deepEqual(texts(lifted.calls), ['A', '1.00, 2.00, -3.50'])
})

test("the arm points along the facing it is given — the heading the place was born", () => {
    const east = stub(), west = stub()
    drawPin(east.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true, facing: { x: 30, y: 0 } })
    drawPin(west.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true, facing: { x: -30, y: 0 } })
    const tipOf = (calls) => calls.filter(c => c[0] === 'lineTo')[0].slice(1)
    assert.deepEqual(tipOf(east.calls), [113, 50], "the tip is radius - 5 along the facing")
    assert.deepEqual(tipOf(west.calls), [87, 50], "the shaft follows the source's direction, not a north")
    assert.equal(west.calls.filter(c => c[0] === 'close').length, 1, "the arm is a closed blade")
    assert.equal(fills(west.calls), 2, "the arm, then the dot: two fills, in that order")
    assert.ok(west.calls.findIndex(c => c[0] === 'fill') < west.calls.findIndex(c => c[0] === 'stroke'),
        "the arm is under the ring — it is drawn first")
    // The blade is the pin's size, not the projection's, so every bodyless place
    // wears the same arm however far the camera stands.
    const arm = west.calls.filter(c => c[0] === 'moveTo' || c[0] === 'lineTo')
    const [first, tip, last] = arm
    assert.deepEqual(first.slice(0, 1), ['moveTo'])
    assert.equal(Math.hypot(tip[1] - 100, tip[2] - 50), 13)
    assert.equal(Math.hypot((first[1] + last[1]) / 2 - 100, (first[2] + last[2]) / 2 - 50), 3,
        "the blade starts at the dot's edge")
    assert.ok(Math.abs(Math.hypot(first[1] - last[1], first[2] - last[2]) - 3.2) < 1e-9,
        "the base is square to the shaft, not collapsed onto it")
})

test("a facing the eye flattened opens the dot; an arm with no room is no arm", () => {
    const flattened = stub(), nub = stub(), headed = stub()
    drawPin(flattened.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true,
        facing: { x: 2, y: 0 } })
    drawPin(nub.ctx, { cx: 100, cy: 50, name: 'A', width: 200, facing: { x: 0, y: -20 } })
    drawPin(headed.ctx, { cx: 100, cy: 50, name: 'A', width: 200, withHead: true,
        facing: { x: 0, y: -20 } })
    assert.equal(flattened.calls.some(c => c[0] === 'close'), false, "a flattened facing draws no blade")
    assert.equal(fills(flattened.calls), 0, "the dot OPENS rather than vanish: it points at you")
    assert.equal(strokes(flattened.calls), 2, "the ring, and the open dot")
    assert.equal(nub.calls.some(c => c[0] === 'close'), false, "a 9px ring has no room for an arm")
    assert.equal(fills(nub.calls), 1)
    assert.equal(headed.calls.some(c => c[0] === 'close'), false,
        "a place with a body already wears its facing: the arrow's")
    assert.equal(fills(headed.calls), 0)
})

test("a free point can show a refusal without turning an anchored point into a handle", () => {
    const free = stub(), anchored = stub()
    drawPin(free.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true,
        ghost: { text: 'rejected', fade: 0.25 } })
    drawPin(anchored.ctx, { cx: 100, cy: 50, name: 'A', width: 200, withHead: true,
        ghost: { text: 'rejected', fade: 0.25 } })
    assert.deepEqual(texts(free.calls), ['A', 'rejected'])
    assert.deepEqual(texts(anchored.calls), ['A'])
})

test("A with a head has a ring at its pose, leaving the arrow visible", () => {
    const { ctx, calls } = stub()
    drawPin(ctx, { cx: 100, cy: 50, name: 'A', width: 200, withHead: true })
    assert.deepEqual(arcs(calls), [['arc', 100, 50, 18]])
    assert.equal(fills(calls), 0, "no dot hides the arrow")
})

test("the label stays on the visible field", () => {
    const { ctx, calls } = stub()
    drawPin(ctx, { cx: 470, cy: 50, name: 'longname', width: 500 })
    drawPin(ctx, { cx: 100, cy: 50, name: 'A', width: 500 })
    assert.equal(calls.filter(c => c[0] === 'text')[0][4], 'right')
    assert.equal(calls.filter(c => c[0] === 'text')[1][4], 'left')
})
