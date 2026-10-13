import { test } from "node:test"
import assert from "node:assert/strict"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { SE3, AXIS_X, AXIS_Y, AXIS_Z } from "../../../assets/js/turtling/se3.js"
import { COMMANDS, DEFAULT_STYLE } from "../../../assets/js/turtling/commands.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { buildWorld, fork, drive } from "../laws/harness.mjs"

const nz = (v) => v.map(n => n === 0 ? 0 : n)
const axes = [AXIS_X, AXIS_Y, AXIS_Z]
const quarter = [([x, y, z]) => [x, -z, y], ([x, y, z]) => [z, y, -x], ([x, y, z]) => [-y, x, z]]
const act = (columns, v) => columns[0].map((_, i) => columns.reduce((sum, col, j) => sum + col[i] * v[j], 0))

for (const source of ["rt 90\nlabel x 10", "rt 90\nfw 10\nlabel x 10", "lt 270\nfw 10\nlabel x 10", "rt 45\nrt 45\nfw 100\nlabel x 10", "loop 4 do\nrt 22.5\nend\nfw 100\nlabel x 10", "loop 90 do\nrt 1\nend\nfw 100\nlabel x 10"]) {
    test(`${source.replaceAll("\n", "; ")}: raw position and label agree on zero`, () => {
        const scheduler = buildWorld()
        scheduler.hotSwapChild("host", fork("host", source))
        const events = drive(scheduler).get("host")
        const label = events.find(e => e.type === "label")
        assert.equal(label.text, "0")
        assert.equal(label.position[0], 0)
        assert.equal(frameWorldTransform(scheduler.root.children.get("host")).position[0], 0)
    })
}

for (const scale of [1e-200, 10, 1e200, Number.MAX_VALUE]) {
    test(`cardinal turns act exactly at scale ${scale}`, () => {
        for (const [i, axis] of axes.entries()) {
            for (const angle of [-450, -270, -180, -90, 0, 90, 180, 270, 450]) {
                const q = Versor.fromAxisAngle(axis, angle)
                let expected = [scale, -scale, scale]
                for (let j = 0; j < ((angle / 90) % 4 + 4) % 4; j++) expected = quarter[i](expected)
                assert.deepEqual(nz(q.rotateVec(scale, -scale, scale)), nz(expected))
                assert.deepEqual(nz(Object.values(q.rotate({ x: scale, y: -scale, z: scale }))), nz(expected))
            }
        }
    })
}

test("all 24 cube orientations share exact action across composition, clone and inverse", () => {
    const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    const queue = [{ q: SE3.identity().rotation, columns: basis }]
    const seen = new Set([String(basis)])
    for (let head = 0; head < queue.length; head++) {
        const { q, columns } = queue[head]
        const v = [3, -5, 7]
        const expected = act(columns, v)
        const transform = { rotation: q, position: [11, 13, 17] }
        assert.deepEqual(nz(q.rotateVec(...v)), nz(expected))
        const point = SE3.apply(SE3.clone(transform), v)
        assert.deepEqual(point, expected.map((n, i) => n + transform.position[i]))
        assert.deepEqual(nz(SE3.unapply(transform, point)), v)
        assert.deepEqual(nz(SE3.apply(SE3.invert(transform), point)), v)
        assert.deepEqual(nz(SE3.compose(transform, SE3.invert(transform)).position), [0, 0, 0])
        for (const [i, axis] of axes.entries()) {
            const next = basis.map(v => nz(act(columns, quarter[i](v))))
            const key = String(next)
            if (seen.has(key)) continue
            seen.add(key)
            queue.push({ q: q.multiply(Versor.fromAxisAngle(axis, 90)), columns: next })
        }
    }
    assert.equal(seen.size, 24)
})

for (const scale of [1e-9, 10, 1e9]) {
    test(`100,000 quarter-turn steps close without drift at scale ${scale}`, () => {
        const ctx = { transform: SE3.identity(), style: DEFAULT_STYLE }
        for (let i = 0; i < 100000; i++) {
            ctx.transform = COMMANDS.get("rt")(ctx, 90).transform
            ctx.transform = COMMANDS.get("fw")(ctx, scale).transform
            assert.equal(ctx.transform.position[2], 0)
            if (i % 4 === 3) assert.deepEqual(nz(ctx.transform.position), [0, 0, 0])
        }
    })
}

test("above-budget near-quarter turns remain distinct", () => {
    for (const angle of [90 - 1e-10, 90 + 1e-10]) {
        const q = Versor.fromAxisAngle(AXIS_Z, angle)
        const [x, y] = q.rotateVec(1, 0, 0)
        assert.ok(angle < 90 ? x > 0 : x < 0)
        assert.ok(Math.abs(x - Math.cos(angle * Math.PI / 180)) < 1e-15)
        assert.ok(Math.abs(y - Math.sin(angle * Math.PI / 180)) < 1e-15)
    }
})

test("the planar matrix agrees with vector action", () => {
    for (const angle of [90, 180, 270, 37]) {
        const q = Versor.fromAxisAngle(AXIS_Z, angle)
        const { a, b, c, d } = q.getTransformValues()
        assert.deepEqual(nz([a, b, 0]), nz(q.rotateVec(1, 0, 0)))
        assert.deepEqual(nz([c, d, 0]), nz(q.rotateVec(0, 1, 0)))
    }
})
