import { test } from "node:test"
import assert from "node:assert/strict"
import { actionBetween, applyAction, composeActions } from "../../../assets/js/turtling/laws/action.js"
import { SE3, AXIS_Z, AXIS_Y } from "../../../assets/js/turtling/se3.js"
import { coneFrame } from "../../../assets/js/turtling/laws/cone.js"

const near = (actual, expected) => assert.ok(actual && Math.hypot(...actual.map((x, i) => x - expected[i])) < 1e-8, `${actual} != ${expected}`)

test("identity is null and a translation follows the new baseline", () => {
    assert.equal(actionBetween(null, [2, 0, 0], [2, 0, 0]), null)
    const action = actionBetween(null, [2, 0, 0], [3, 4, 0])
    assert.deepEqual(action, { kind: "translation", by: [1, 4, 0] })
    near(applyAction(action, null, [10, 0, 0]), [11, 4, 0])
    near(applyAction(null, null, [10, 0, 0]), [10, 0, 0])
})

test("a sphere keeps a turn, not the old radius or an absolute point", () => {
    const locus = { kind: "sphere", center: [2, 3, 0], radius: 5 }
    const action = actionBetween(locus, [7, 3, 0], [2, 8, 0])
    const next = { ...locus, center: [10, 20, 0], radius: 10 }
    near(applyAction(action, next, [20, 20, 0]), [10, 30, 0])
    near(applyAction(composeActions(action, action), next, [20, 20, 0]), [0, 20, 0])
    assert.equal(applyAction(action, { kind: "plane" }, [20, 20, 0]), null)
})

test("antipodal sphere motion has a finite deterministic turn", () => {
    const sphere = { kind: "sphere", center: [0, 0, 0], radius: 5 }
    const action = actionBetween(sphere, [5, 0, 0], [-5, 0, 0])
    near(applyAction(action, sphere, [5, 0, 0]), [-5, 0, 0])
    near(applyAction(composeActions(action, action), sphere, [5, 0, 0]), [5, 0, 0])
})

test("a circle stores one phase and a cone one phase plus axial adjustment", () => {
    const circle = { kind: "circle", center: [0, 0, 0], normal: [0, 0, 1], radius: 5 }
    const phase = actionBetween(circle, [5, 0, 0], [0, 5, 0])
    near(applyAction(phase, { ...circle, radius: 8 }, [8, 0, 0]), [0, 8, 0])
    const cone = { kind: "cone", apex: [0, 0, 0], axis: [0, 0, 1], halfAngle: 30 }
    const a = coneFrame(cone.apex, cone.axis, cone.halfAngle)
    const action = actionBetween(cone, a.point(3, 0), a.point(5, Math.PI / 2))
    const next = { ...cone, apex: [2, 3, 4], halfAngle: 45 }
    const b = coneFrame(next.apex, next.axis, next.halfAngle)
    near(applyAction(action, next, b.point(4, 0)), b.point(6, Math.PI / 2))
})

test("a change of world coordinates preserves every framed action", () => {
    const frame = SE3.translateLocal(SE3.rotateLocal(SE3.rotateLocal(SE3.identity(), AXIS_Z, 70), AXIS_Y, 35), 10, 20, 30)
    const vector = p => frame.rotation.rotateVec(...p)
    const point = p => SE3.apply(frame, p)
    const cases = [
        [null, [2, 0, 0], [3, 4, 1]],
        [{ kind: "sphere", center: [0, 0, 0], radius: 5 }, [5, 0, 0], [0, 3, 4]],
        [{ kind: "circle", center: [0, 0, 0], normal: [0, 0, 1], radius: 5 }, [5, 0, 0], [0, 5, 0]],
        [{ kind: "cone", apex: [0, 0, 0], axis: [0, 0, 1], halfAngle: 45 }, [3, 0, 3], [0, 5, 5]],
    ]
    for (const [locus, from, to] of cases) {
        const transformed = locus && { ...locus,
            ...(locus.center ? { center: point(locus.center) } : {}),
            ...(locus.normal ? { normal: vector(locus.normal) } : {}),
            ...(locus.apex ? { apex: point(locus.apex), axis: vector(locus.axis) } : {}) }
        const action = actionBetween(locus, from, to)
        near(applyAction(action, transformed, point(from), frame), point(to))
        const reexpressed = actionBetween(transformed, point(from), point(to), frame)
        near(applyAction(reexpressed, locus, from), to)
    }
})


test("composition respects the action, and incompatible families are never identity", () => {
    const translation = actionBetween(null, [0, 0, 0], [1, 2, 3])
    near(applyAction(composeActions(translation, translation), null, [0, 0, 0]), [2, 4, 6])
    const circle = { kind: "circle", center: [0, 0, 0], normal: [0, 0, 1], radius: 5 }
    const phase = actionBetween(circle, [5, 0, 0], [0, 5, 0])
    near(applyAction(composeActions(phase, phase), circle, [5, 0, 0]), [-5, 0, 0])
    assert.equal(composeActions(null, phase), phase)
    assert.throws(() => composeActions(translation, phase), TypeError)
})
