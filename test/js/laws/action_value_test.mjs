// The action value is ordinary data: a quaternion is four coefficients, reified only
// where the existing algebra evaluates it. Admission preserves exact values.
// (id:laws-hand-action-algebra)
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import {
    actionBetween, applyAction, composeActions, copyAction, validAction,
} from "../../../assets/js/turtling/laws/action.js"

const near = (a, b, eps = 1e-9) => {
    assert.equal(a.length, b.length)
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps, `${a} != ${b}`)
}

const clone = (v) => JSON.parse(JSON.stringify(v))

test("a sphere action is plain data and survives both clone paths", () => {
    const locus = { kind: "sphere", center: [0, 0, 0], radius: 5 }
    const action = actionBetween(locus, [5, 0, 0], [0, 5, 0])
    assert.equal(Object.getPrototypeOf(action.rotation), Object.prototype, "no live Versor")
    assert.deepEqual(structuredClone(action), action)
    assert.deepEqual(clone(action), action)
    near(applyAction(action, locus, [5, 0, 0]), [0, 5, 0])
})

test("composition stays plain and applies through the same evaluator", () => {
    const locus = { kind: "sphere", center: [0, 0, 0], radius: 5 }
    const quarter = actionBetween(locus, [5, 0, 0], [0, 5, 0])
    const half = composeActions(quarter, quarter)
    assert.equal(Object.getPrototypeOf(half.rotation), Object.prototype)
    near(applyAction(half, locus, [5, 0, 0]), [-5, 0, 0])
})

test("every admitted family validates and copies without sharing arrays", () => {
    const actions = [
        { kind: "translation", by: [3, -2, 0] },
        { kind: "sphere", rotation: { w: 0.5, x: 0.5, y: 0.5, z: 0.5 } },
        { kind: "circle", phaseVector: [0, 0, Math.PI] },
        { kind: "cone", angle: 0.25, height: -1 },
    ]
    for (const action of actions) {
        assert.equal(validAction(action), true, action.kind)
        const copied = copyAction(action)
        assert.deepEqual(copied, action)
        assert.notEqual(copied, action)
        assert.deepEqual(clone(action), action)
    }
    assert.notEqual(copyAction(actions[0]).by, actions[0].by)
})

test("copy admits only the plain coefficients, never an extra field or alias", () => {
    const action = { kind: "sphere", rotation: { w: 1, x: 0, y: 0, z: 0, extra: () => {} } }
    assert.equal(validAction(action), true)
    const copied = copyAction(action)
    assert.deepEqual(copied, { kind: "sphere", rotation: { w: 1, x: 0, y: 0, z: 0 } })
    assert.deepEqual(Object.keys(copied.rotation).sort(), ["w", "x", "y", "z"])
    assert.doesNotThrow(() => structuredClone(copied))
})

test("admission rejects malformed values instead of repairing them", () => {
    for (const bad of [
        null, undefined, {}, { kind: "bogus" },
        { kind: "translation", by: [0, 0] },
        { kind: "translation", by: [0, 0, NaN] },
        { kind: "sphere", rotation: { w: 0, x: 0, y: 0, z: 0 } },
        { kind: "sphere", rotation: { w: 2, x: 0, y: 0, z: 0 } },
        { kind: "sphere", rotation: { w: 0.5, x: 0, y: 0, z: 0 } },
        { kind: "sphere", rotation: { w: 1e308, x: 0, y: 0, z: 0 } },
        { kind: "sphere", rotation: { w: 1, x: 0, y: 0 } },
        { kind: "sphere", rotation: { w: Infinity, x: 0, y: 0, z: 0 } },
        { kind: "circle", phaseVector: [0, 0, 0, 0] },
        { kind: "cone", angle: 0, height: NaN },
    ]) {
        assert.equal(validAction(bad), false, JSON.stringify(bad))
        assert.equal(copyAction(bad), null)
    }
})

test("a tiny accepted action is preserved, never snapped to identity", () => {
    const tiny = { kind: "translation", by: [1e-300, 0, 0] }
    assert.equal(validAction(tiny), true)
    assert.deepEqual(copyAction(tiny), tiny)
    const sphere = { kind: "sphere", rotation: { w: 1, x: 1e-300, y: 0, z: 0 } }
    assert.equal(validAction(sphere), true)
    assert.deepEqual(copyAction(sphere), sphere)
    const small = applyAction(
        { kind: "sphere", rotation: { w: 1, x: 1e-12, y: 0, z: 0 } },
        { kind: "sphere", center: [0, 0, 0], radius: 1 }, [0, 1, 0])
    assert.ok(small[2] > 0, "a small turn is still applied")
})

test("SE3 carries no authority in the action value", () => {
    const action = actionBetween({ kind: "translation" }, [0, 0, 0], [1, 2, 0],
        SE3.translateLocal(SE3.identity(), 5, 0, 0))
    assert.equal(validAction(action), true)
    assert.deepEqual(Object.keys(action).sort(), ["by", "kind"])
})
