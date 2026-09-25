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
        stroke() { calls.push(['stroke']) },
        fill() { calls.push(['fill']) },
        save() { calls.push(['save']) },
        restore() { calls.push(['restore']) },
        translate(x, y) { calls.push(['translate', x, y]) },
        fillText(text, x, y) { calls.push(['text', text, x, y, ctx.textAlign]) },
        measureText(s) { return { width: s.length * 6 } },
        createRadialGradient() { calls.push(['gradient']); return { addColorStop() {} } },
    }
    return { ctx, calls }
}

test("an empty A has a visible point, with no imaginary arrow", () => {
    const { ctx, calls } = stub()
    drawPin(ctx, { cx: 100, cy: 50, name: 'A', width: 200 })
    assert.deepEqual(calls.filter(c => c[0] === 'arc').map(c => c[3]), [9, 5])
    assert.ok(calls.some(c => c[0] === 'fill'), "the empty point has a centre")
    assert.deepEqual(calls.find(c => c[0] === 'text').slice(1, 2), ['A'])
})


test("the free point is touch-sized; an anchored point is only a reading", () => {
    const free = stub(), anchored = stub()
    drawPin(free.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true, held: true,
        accepted: [1, 2, 0], requested: [3, 4, 0] })
    drawPin(anchored.ctx, { cx: 100, cy: 50, name: 'A', width: 200, withHead: true,
        accepted: [1, 2, 0], requested: [3, 4, 0], outcome: 'accepted' })
    assert.equal(free.calls.find(c => c[0] === 'arc')[3], 18)
    assert.deepEqual(free.calls.filter(c => c[0] === 'text').map(c => c[1]),
        ['A', '1.00, 2.00', '→ 3.00, 4.00'])
    assert.deepEqual(anchored.calls.filter(c => c[0] === 'text').map(c => c[1]), ['A'],
        "an anchored point advertises no separate gesture")
})

test("a free point can show a refusal without turning an anchored point into a handle", () => {
    const free = stub(), anchored = stub()
    drawPin(free.ctx, { cx: 100, cy: 50, name: 'A', width: 200, touchable: true,
        ghost: { text: 'rejected', fade: 0.25 } })
    drawPin(anchored.ctx, { cx: 100, cy: 50, name: 'A', width: 200, withHead: true,
        ghost: { text: 'rejected', fade: 0.25 } })
    const lines = free.calls.filter(c => c[0] === 'text').map(c => c[1])
    assert.deepEqual(lines, ['A', 'rejected'])
    assert.deepEqual(anchored.calls.filter(c => c[0] === 'text').map(c => c[1]), ['A'])
})
test("A with a head has a ring at its pose, leaving the arrow visible", () => {
    const { ctx, calls } = stub()
    drawPin(ctx, { cx: 100, cy: 50, name: 'A', width: 200, withHead: true })
    assert.deepEqual(calls.filter(c => c[0] === 'arc'), [['arc', 100, 50, 18]])
    assert.equal(calls.some(c => c[0] === 'fill'), false, "no bead hides the arrow")
    assert.equal(calls.some(c => c[0] === 'gradient'), false)
})

test("the label stays on the visible field and the bead is cached per canvas", () => {
    const { ctx, calls } = stub()
    drawPin(ctx, { cx: 470, cy: 50, name: 'longname', width: 500 })
    drawPin(ctx, { cx: 100, cy: 50, name: 'A', width: 500 })
    assert.equal(calls.filter(c => c[0] === 'gradient').length, 1)
    assert.deepEqual(calls.filter(c => c[0] === 'translate'), [['translate', 470, 50], ['translate', 100, 50]])
    assert.equal(calls.filter(c => c[0] === 'text')[0][4], 'right')
    assert.equal(calls.filter(c => c[0] === 'text')[1][4], 'left')
})
