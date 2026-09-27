// The wish and where it landed: a light tether when the projection absorbed part
// of the pointer's wish. (id:laws-freedom)
// Run: node --test test/js/laws/wish_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { drawWish } from "../../../assets/js/turtling/laws/pin.js"

const stub = () => {
    const calls = []
    const ctx = {
        beginPath() { calls.push(['begin']) },
        moveTo(x, y) { calls.push(['moveTo', x, y]) },
        lineTo(x, y) { calls.push(['lineTo', x, y]) },
        arc(x, y, r) { calls.push(['arc', x, y, r]) },
        stroke() { calls.push(['stroke']) },
        save() { calls.push(['save']) },
        restore() { calls.push(['restore']) },
        setLineDash(d) { calls.push(['dash', ...d]) },
    }
    return { ctx, calls }
}

test("a wish displaced from where it landed shows a tether to the target", () => {
    const { ctx, calls } = stub()
    drawWish(ctx, { x: 100, y: 50 }, { x: 130, y: 50 })
    assert.deepEqual(calls.filter(c => c[0] === 'moveTo'), [['moveTo', 100, 50]],
        "the tether starts at the accepted point")
    assert.deepEqual(calls.filter(c => c[0] === 'lineTo'), [['lineTo', 130, 50]],
        "and ends at the pointer's wish")
    assert.deepEqual(calls.filter(c => c[0] === 'arc'), [['arc', 130, 50, 3]],
        "the target is marked, the accepted point is already the pin")
    assert.ok(calls.some(c => c[0] === 'dash' && c[1] === 1 && c[2] === 3), "dashed, like a trace")
})

test("a satisfied wish draws no tether", () => {
    const { ctx, calls } = stub()
    drawWish(ctx, { x: 100, y: 50 }, { x: 100, y: 50 })
    assert.deepEqual(calls, [], "nothing to say when the wish landed where it asked")
})

test("a missing endpoint is not a tether", () => {
    const { ctx, calls } = stub()
    drawWish(ctx, null, { x: 1, y: 2 })
    drawWish(ctx, { x: 1, y: 2 }, null)
    assert.deepEqual(calls, [])
})
