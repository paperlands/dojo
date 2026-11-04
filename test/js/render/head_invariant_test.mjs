// Head invariant sizing — the world scale that keeps the head's on-screen size
// constant is snapped to a ratio ladder, so a zoom re-scales in uniform ~5%
// steps instead of doubling at decade edges. (id:laws-decl-interface)
//
// Run with: node --test test/js/render/head_invariant_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { Group } from "../../../assets/js/utils/three-entry.js"
import Head from "../../../assets/js/turtling/render/head.js"

const STEP = 1.05 // the ladder ratio; the fence is the RATIO, not the number

describe("head invariant sizing", () => {
    test("`show 10` at the reference distance draws the authored shape 1:1", () => {
        const head = new Head(new Group())
        head.scale(1) // distance 250 / 250
        assert.equal(head.turtleGroup.scale.x, 1)
    })

    test("the world scale tracks the camera distance", () => {
        const head = new Head(new Group())
        head.scale(1)
        const near = head.turtleGroup.scale.x
        head.scale(4) // distance 1000
        const far = head.turtleGroup.scale.x
        // within one ladder step of 4× (the ladder quantises)
        assert.ok(Math.abs((far / near) - 4) / 4 < STEP / 2, `far/near = ${far / near}`)
    })

    test("a zoom re-scales in uniform ratio steps, never doubling", () => {
        const head = new Head(new Group())
        let prev = null
        let maxStep = 0
        for (let d = 20; d < 3000; d *= 1.01) {
            head.scale(d / 250)
            const s = head.turtleGroup.scale.x
            if (prev !== null) maxStep = Math.max(maxStep, Math.abs(s - prev) / prev)
            prev = s
        }
        assert.ok(maxStep <= STEP * 1.0001, `a step exceeded the ladder ratio: ${maxStep}`)
        assert.ok(maxStep < 0.2, `expected gentle steps, worst was ${(maxStep * 100).toFixed(1)}%`)
    })

    test("`show n` rides through scale(), with no mesh rebuild", () => {
        const head = new Head(new Group())
        const mesh = head.turtleMesh
        head.update([0, 0, 0], null, "#e77808", 40)
        head.scale(1) // value = 1 · 40/10, snapped
        assert.ok(Math.abs(head.turtleGroup.scale.x - 4) / 4 < STEP / 2)
        assert.equal(head.turtleMesh, mesh, "a size change must not rebuild the mesh")
    })

    test("the drawn head is 10% smaller than the symbolic size", () => {
        const head = new Head(new Group())
        assert.equal(head.turtleMesh.scale.x, 0.9)
        assert.equal(head.wireframeMesh.scale.x, 0.9)
    })

    test("scale() ignores a degenerate value", () => {
        const head = new Head(new Group())
        head.scale(0)
        assert.equal(head.turtleGroup.scale.x, 1, "a zero distance must not collapse the head")
    })
})
