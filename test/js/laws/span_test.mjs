// One dotted segment between two screen points, at the weight the caller names: the
// radius spoke, the pointer's wish and a held point's origin span are one primitive.
// (id:laws-freedom)
// Run: node --test test/js/laws/span_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { drawSpan } from "../../../assets/js/turtling/laws/pin.js"

const stub = () => {
    const calls = []
    let style = null
    const ctx = {
        beginPath() { calls.push(['begin']) },
        moveTo(x, y) { calls.push(['moveTo', x, y]) },
        lineTo(x, y) { calls.push(['lineTo', x, y]) },
        arc(x, y, r) { calls.push(['arc', x, y, r]) },
        stroke() { calls.push(['stroke']) },
        save() { calls.push(['save']) },
        restore() { calls.push(['restore']) },
        setLineDash(d) { calls.push(['dash', ...d]) },
        get strokeStyle() { return style },
        set strokeStyle(v) { style = v; calls.push(['ink', v]) },
    }
    return { ctx, calls }
}

const inks = (calls) => calls.filter(c => c[0] === 'ink').map(c => c[1])

test("a span joins two screen points in one dotted ink", () => {
    const { ctx, calls } = stub()
    drawSpan(ctx, { x: 100, y: 50 }, { x: 130, y: 50 }, { alpha: 0.34 })
    assert.deepEqual(calls.filter(c => c[0] === 'moveTo'), [['moveTo', 100, 50]], "from the first point")
    assert.deepEqual(calls.filter(c => c[0] === 'lineTo'), [['lineTo', 130, 50]], "to the second")
    assert.ok(calls.some(c => c[0] === 'dash' && c[1] === 1 && c[2] === 3), "dotted, like a trace")
    assert.deepEqual(inks(calls), ['rgba(243,237,223,0.34)'], "the weight the caller named")
    assert.equal(calls.filter(c => c[0] === 'stroke').length, 1, "one stroke, and no mark unless asked")
    assert.equal(calls.at(0)[0], 'save')
    assert.equal(calls.at(-1)[0], 'restore', "the dash does not leak into the next mark")
})

test("the far end may be marked, and the mark is drawn solid", () => {
    const { ctx, calls } = stub()
    drawSpan(ctx, { x: 100, y: 50 }, { x: 130, y: 50 }, { alpha: 0.32, mark: true })
    assert.deepEqual(calls.filter(c => c[0] === 'arc'), [['arc', 130, 50, 3]],
        "the wish's target is marked; the accepted point is already the pin")
    assert.deepEqual(calls.filter(c => c[0] === 'dash'), [['dash', 1, 3], ['dash']],
        "dotted for the segment, plain for the mark")
    assert.deepEqual(inks(calls), ['rgba(243,237,223,0.32)', 'rgba(243,237,223,0.5)'],
        "the mark carries its own ink")
    assert.equal(calls.filter(c => c[0] === 'stroke').length, 2, "segment and mark are two strokes")
})

test("a span with no length, no weight, or a missing endpoint draws nothing", () => {
    const { ctx, calls } = stub()
    drawSpan(ctx, { x: 100, y: 50 }, { x: 100, y: 50 }, { alpha: 0.34 })
    drawSpan(ctx, { x: 100, y: 50 }, { x: 130, y: 50 }, {})
    drawSpan(ctx, null, { x: 1, y: 2 }, { alpha: 0.34 })
    drawSpan(ctx, { x: 1, y: 2 }, null, { alpha: 0.34 })
    assert.deepEqual(calls, [], "a segment needs two points apart, and a weight to be drawn at")
})
