import { test } from "node:test"
import assert from "node:assert/strict"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { SE3, AXIS_X, AXIS_Y, AXIS_Z } from "../../../assets/js/turtling/se3.js"
import { COMMANDS, DEFAULT_STYLE } from "../../../assets/js/turtling/commands.js"
import { ANGULAR_EPS } from "../../../assets/js/turtling/rigid_precision.js"

const nz = v => v.map(n => n === 0 ? 0 : n)

test("below-budget angles are deliberately unresolved, not accumulated invisibly", () => {
    const step = Versor.fromAxisAngle(AXIS_Z, 1e-17)
    let q = SE3.identity().rotation
    for (let i = 0; i < 100000; i++) q = q.multiply(step)
    assert.deepEqual(q.rotateVec(1, 0, 0), [1, 0, 0])
    assert.deepEqual(nz(step.rotateVec(1, 0, 0)), [1, 0, 0])
    assert.deepEqual(Object.values(step.rotate({ x: 1, y: 0, z: 0 })), [1, 0, 0])
})

test("above-budget small angular motion continues accumulating", () => {
    const angle = 1e-8
    const step = Versor.fromAxisAngle(AXIS_Z, angle)
    let q = SE3.identity().rotation
    for (let i = 0; i < 100000; i++) q = q.multiply(step)
    const actual = q.rotateVec(1, 0, 0)
    const theta = angle * 100000 * Math.PI / 180
    assert.ok(actual[1] > 0)
    assert.ok(Math.abs(actual[0] - Math.cos(theta)) < ANGULAR_EPS)
    assert.ok(Math.abs(actual[1] - Math.sin(theta)) < ANGULAR_EPS)
})

test("a million decomposed quarter-turn steps have no sideways or closure drift", () => {
    let t = SE3.identity()
    const half = Versor.fromAxisAngle(AXIS_Z, -45)
    for (let i = 0; i < 1000000; i++) {
        t.rotation = t.rotation.multiply(half).multiply(half)
        t = SE3.translateLocal(t, 10, 0, 0)
        if (i % 4 === 3) assert.deepEqual(nz(t.position), [0, 0, 0])
    }
})

test("mixed-axis words followed by their inverse do not accumulate angular drift", () => {
    const word = [[AXIS_X, 37], [AXIS_Z, -19], [AXIS_Y, 13], [AXIS_Z, 22.5], [AXIS_X, -11]]
    const forwards = word.map(([axis, angle]) => Versor.fromAxisAngle(axis, angle))
    const backwards = word.toReversed().map(([axis, angle]) => Versor.fromAxisAngle(axis, -angle))
    let q = SE3.identity().rotation
    for (let i = 0; i < 10000; i++) {
        for (const turn of forwards) q = q.multiply(turn)
        for (const turn of backwards) q = q.multiply(turn)
    }
    assert.deepEqual(nz(q.rotateVec(3, 5, 7)), [3, 5, 7])
})

test("tiny actual distances and tiny independent vector components survive", () => {
    const q = Versor.fromAxisAngle(AXIS_Z, 90)
    assert.deepEqual(nz(q.rotateVec(1e-15, 1, 0)), [-1, 1e-15, 0])
    const ctx = { transform: { rotation: q, position: [0, 0, 0] }, style: DEFAULT_STYLE }
    assert.deepEqual(nz(COMMANDS.get("fw")(ctx, 1e-15).transform.position), [0, 1e-15, 0])
})

test("frame subtraction preserves an exactly representable small separation at a large offset", () => {
    const t = { ...SE3.identity(), position: [1e12, 0, 0] }
    const point = [1e12 + 2 ** -13, 0, 0]
    assert.deepEqual(SE3.unapply(t, point), [2 ** -13, 0, 0])
    assert.deepEqual(SE3.apply(SE3.invert(t), point), [2 ** -13, 0, 0])
})

test("cancellation in vector action is cleaned without an absolute coordinate floor", () => {
    const q = Versor.fromAxisAngle(AXIS_Z, 45)
    for (const scale of [1e-200, 1, 1e200]) {
        const [x, y, z] = q.rotateVec(scale, scale, 0)
        assert.equal(x, 0)
        assert.ok(Math.abs(y / scale - Math.SQRT2) < ANGULAR_EPS)
        assert.equal(z, 0)
    }
})

test("admitted near-unit imported rotations do not change vector length", () => {
    const q = Versor.raw(0.7071067811865476 * (1 + 1e-8), 0, 0, 0.7071067811865476 * (1 + 1e-8))
    assert.ok(SE3.isValid({ rotation: q, position: [0, 0, 0] }))
    assert.deepEqual(nz(q.rotateVec(3, 5, 7)), [-5, 3, 7])
})
