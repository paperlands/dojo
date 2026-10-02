import { test } from "node:test"
import assert from "node:assert/strict"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { SE3, AXIS_Z } from "../../../assets/js/turtling/se3.js"
import { COMMANDS, DEFAULT_STYLE } from "../../../assets/js/turtling/commands.js"

for (const scale of [1e-9, 1, 1e9]) {
    test(`a 100,000-turn polygon stays rigid at scale ${scale}`, () => {
        const ctx = { transform: SE3.identity(), style: DEFAULT_STYLE }
        const step = Versor.fromAxisAngle(AXIS_Z, -360 / 100000)
        for (let i = 0; i < 100000; i++) {
            ctx.transform = COMMANDS.get("fw")(ctx, scale).transform
            ctx.transform.rotation = ctx.transform.rotation.multiply(step)
        }
        const q = ctx.transform.rotation
        assert.ok(Math.abs(Math.hypot(q.w, q.x, q.y, q.z) - 1) <= 8 * Number.EPSILON,
            "quaternion norm must not accumulate drift")
        const perimeter = scale * 100000
        assert.ok(Math.hypot(...ctx.transform.position) / perimeter < 1e-13,
            "closure is bounded relative to the walked length, never snapped")
    })
}

test("a tiny authored turn survives and both rotation APIs agree", () => {
    const q = Versor.fromAxisAngle(AXIS_Z, 1e-17)
    const v = q.rotate({ x: 1, y: 0, z: 0 })
    const tuple = q.rotateVec(1, 0, 0)
    assert.ok(tuple[1] > 0)
    assert.deepEqual([v.x, v.y, v.z], tuple)
})
