// Framing a bounded figure: the mark keeps its true size; only the eye moves.
// (id:laws-freedom)
// Run: node --test test/js/laws/fit_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { unionBounds, viewDirection, fitPose } from "../../../assets/js/turtling/laws/fit.js"
import { boundsOf } from "../../../assets/js/turtling/laws/constraints.js"

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const at3 = (p) => p.map((n) => +n.toFixed(6))

test("a bounded locus contributes its true radius, never a guess", () => {
    const circle = boundsOf({ kind: "circle", center: [1, 2, 3], normal: [0, 1, 0], radius: 5 })
    assert.deepEqual(circle, { center: [1, 2, 3], radius: 5 })
    const sphere = boundsOf({ kind: "sphere", center: [0, 0, 0], radius: 2 })
    assert.equal(sphere.radius, 2)
    assert.equal(boundsOf(null), null)
})

test("a cone's extent is the window at the point, not the infinite surface", () => {
    const locus = { kind: "cone", apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 45 }
    const b = boundsOf(locus, [4, 2, 0])
    assert.deepEqual(at3(b.center), [4, 0, 0])
    assert.ok(near(b.radius, 4), "the window radius at height 4 is 4 for a 45° tilt")
})

test("an envelope contains every extent it is grown from", () => {
    const b = unionBounds([
        { center: [0, 0, 0], radius: 1 },
        { center: [10, 0, 0], radius: 1 },
        { center: [0, 4, 0], radius: 0 },
    ])
    for (const s of [[0, 0, 0], [10, 0, 0], [0, 4, 0]]) {
        const d = Math.hypot(s[0] - b.center[0], s[1] - b.center[1], s[2] - b.center[2])
        assert.ok(d <= b.radius + 1e-9, `contains ${s}`)
    }
    assert.equal(unionBounds([]), null)
})

test("the fit direction tilts off the locus normal so a circle reads as a curve", () => {
    const dir = viewDirection([0, 1, 0])
    assert.ok(Math.abs(Math.hypot(...dir) - 1) < 1e-9, "unit direction")
    assert.ok(near(Math.abs(dir[1]), Math.cos(48 * Math.PI / 180), 1e-6),
        "tilted, not on the sight line")
    assert.deepEqual(viewDirection(null), [0.6, 0.5, 0.8], "no bounded mark: a studio view")
})

test("fit frames the radius and is floored, never inflated", () => {
    const bounds = { center: [0, 0, 0], radius: 5 }
    const free = fitPose(bounds, { dir: [0, 1, 0], fovDeg: 60, aspect: 1, floor: 0 })
    assert.ok(near(free.distance, (5 / Math.sin(Math.PI / 6)) * 1.12, 1e-9))
    assert.deepEqual(at3(free.target), [0, 0, 0])
    assert.deepEqual(at3(free.position), [0, +free.distance.toFixed(6), 0])

    const floored = fitPose(bounds, { dir: [0, 1, 0], floor: 30 })
    assert.equal(floored.distance, 30, "a small figure is framed by the floor")

    const wide = fitPose({ center: [0, 0, 0], radius: 500 }, { floor: 30 })
    assert.ok(wide.distance > 30, "a large figure earns its own standoff")
    assert.equal(fitPose({ center: [0, 0, 0], radius: 0 }, { floor: 30 }).distance, 30)
    assert.equal(fitPose(null), null)
})

test("the tighter half-FOV frames a portrait viewport", () => {
    const bounds = { center: [0, 0, 0], radius: 10 }
    const wide = fitPose(bounds, { aspect: 2 })
    const tall = fitPose(bounds, { aspect: 0.5 })
    assert.ok(tall.distance > wide.distance, "the narrower axis needs more room")
})
