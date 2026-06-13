// Phase 0 foundation primitive tests — run with: node --test test/js/primitives_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createAtom } from "../../assets/js/turtling/atom.js"
import { createRingBuffer } from "../../assets/js/turtling/ring-buffer.js"
import { Versor } from "../../assets/js/turtling/mafs/versors.js"
import { SE3 } from "../../assets/js/turtling/se3.js"

// ---------------------------------------------------------------------------
// Atom
// ---------------------------------------------------------------------------

describe("Atom", () => {
    test("deref returns initial value", () => {
        const a = createAtom(42)
        assert.equal(a.deref(), 42)
    })

    test("swap applies function and returns new value", () => {
        const a = createAtom(10)
        const result = a.swap(v => v + 5)
        assert.equal(result, 15)
        assert.equal(a.deref(), 15)
    })

    test("swap calls watchers with old and new", () => {
        const a = createAtom("hello")
        const calls = []
        a.watch("test", (old, nw) => calls.push([old, nw]))
        a.swap(() => "world")
        assert.deepEqual(calls, [["hello", "world"]])
    })

    test("unwatch stops notifications", () => {
        const a = createAtom(0)
        let count = 0
        a.watch("counter", () => count++)
        a.swap(v => v + 1)
        assert.equal(count, 1)
        a.unwatch("counter")
        a.swap(v => v + 1)
        assert.equal(count, 1)
    })
})

// ---------------------------------------------------------------------------
// RingBuffer
// ---------------------------------------------------------------------------

describe("RingBuffer", () => {
    test("put and drain", () => {
        const rb = createRingBuffer(8)
        rb.put("a")
        rb.put("b")
        rb.put("c")
        assert.equal(rb.length, 3)
        const items = rb.drain()
        assert.deepEqual(items, ["a", "b", "c"])
        assert.equal(rb.length, 0)
    })

    test("drain returns empty array when empty", () => {
        const rb = createRingBuffer(4)
        assert.deepEqual(rb.drain(), [])
    })

    test("overflow overwrites oldest", () => {
        const rb = createRingBuffer(3)
        rb.put(1)
        rb.put(2)
        rb.put(3)
        rb.put(4) // overwrites 1
        assert.equal(rb.length, 3)
        assert.deepEqual(rb.drain(), [2, 3, 4])
    })

    test("close prevents further puts", () => {
        const rb = createRingBuffer(4)
        rb.put("a")
        rb.close()
        assert.equal(rb.closed, true)
        rb.put("b") // should be no-op
        assert.deepEqual(rb.drain(), ["a"])
    })

    test("multiple drain cycles", () => {
        const rb = createRingBuffer(8)
        rb.put(1)
        rb.put(2)
        assert.deepEqual(rb.drain(), [1, 2])
        rb.put(3)
        rb.put(4)
        assert.deepEqual(rb.drain(), [3, 4])
    })

    test("wrap-around works correctly", () => {
        const rb = createRingBuffer(4)
        rb.put("a")
        rb.put("b")
        rb.put("c")
        rb.drain() // empty, head=3, tail=3
        rb.put("d")
        rb.put("e")
        rb.put("f")
        rb.put("g") // wraps around
        assert.deepEqual(rb.drain(), ["d", "e", "f", "g"])
    })
})

// ---------------------------------------------------------------------------
// Versor.raw — fast constructor
// ---------------------------------------------------------------------------

describe("Versor.raw", () => {
    test("creates Versor without normalization", () => {
        const v = Versor.raw(1, 0, 0, 0)
        assert.ok(v instanceof Versor)
        assert.equal(v.w, 1)
        assert.equal(v.x, 0)
    })

    test("skips sqrt in fromAxisAngle", () => {
        const v = Versor.fromAxisAngle({ x: 0, y: 0, z: 1 }, 90)
        assert.ok(v instanceof Versor)
        // sin(45°) ≈ 0.7071, cos(45°) ≈ 0.7071
        assert.ok(Math.abs(v.w - Math.cos(Math.PI / 4)) < 1e-10)
        assert.ok(Math.abs(v.z - Math.sin(Math.PI / 4)) < 1e-10)
    })

    test("multiply returns Versor instance", () => {
        const a = Versor.fromAxisAngle({ x: 0, y: 0, z: 1 }, 45)
        const b = Versor.fromAxisAngle({ x: 0, y: 0, z: 1 }, 45)
        const c = a.multiply(b)
        assert.ok(c instanceof Versor)
        // 45° + 45° = 90°
        const expected = Versor.fromAxisAngle({ x: 0, y: 0, z: 1 }, 90)
        assert.ok(Math.abs(c.w - expected.w) < 1e-10)
        assert.ok(Math.abs(c.z - expected.z) < 1e-10)
    })

    test("rotateVec returns tuple", () => {
        const v = Versor.fromAxisAngle({ x: 0, y: 0, z: 1 }, 90)
        const result = v.rotateVec(1, 0, 0)
        assert.ok(Array.isArray(result))
        assert.equal(result.length, 3)
        // 90° around Z: [1,0,0] → [0,1,0]
        assert.ok(Math.abs(result[0]) < 1e-10)
        assert.ok(Math.abs(result[1] - 1) < 1e-10)
        assert.ok(Math.abs(result[2]) < 1e-10)
    })

    test("rotateVec identity is fast path", () => {
        const v = Versor.raw(1, 0, 0, 0)
        const result = v.rotateVec(3, 4, 5)
        assert.deepEqual(result, [3, 4, 5])
    })
})

// ---------------------------------------------------------------------------
// SE3
// ---------------------------------------------------------------------------

describe("SE3", () => {
    test("identity has zero position and identity rotation", () => {
        const t = SE3.identity()
        assert.deepEqual(t.position, [0, 0, 0])
        assert.equal(t.rotation.w, 1)
        assert.equal(t.rotation.x, 0)
    })

    test("translateLocal along heading (+x)", () => {
        const t = SE3.identity()
        const moved = SE3.translateLocal(t, 100, 0, 0)
        assert.ok(Math.abs(moved.position[0] - 100) < 1e-10)
        assert.ok(Math.abs(moved.position[1]) < 1e-10)
        assert.ok(Math.abs(moved.position[2]) < 1e-10)
    })

    test("rotateLocal then translateLocal", () => {
        let t = SE3.identity()
        // Turn 90° around Z (yaw), then move forward
        t = SE3.rotateLocal(t, { x: 0, y: 0, z: 1 }, 90)
        t = SE3.translateLocal(t, 100, 0, 0)
        // Should move along +Y after 90° yaw
        assert.ok(Math.abs(t.position[0]) < 1e-8)
        assert.ok(Math.abs(t.position[1] - 100) < 1e-8)
        assert.ok(Math.abs(t.position[2]) < 1e-8)
    })

    test("compose is equivalent to sequential operations", () => {
        const a = SE3.translateLocal(SE3.identity(), 50, 0, 0)
        const b = SE3.rotateLocal(SE3.identity(), { x: 0, y: 0, z: 1 }, 90)
        const composed = SE3.compose(a, b)

        // a then b: position from a, rotation from both
        assert.ok(Math.abs(composed.position[0] - 50) < 1e-8)
        assert.ok(Math.abs(composed.position[1]) < 1e-8)
    })

    test("clone produces independent copy", () => {
        const t = SE3.translateLocal(SE3.identity(), 1, 2, 3)
        const c = SE3.clone(t)
        c.position[0] = 999
        assert.equal(t.position[0], 1) // original unchanged
    })

    test("isValid passes for valid transform", () => {
        const t = SE3.rotateLocal(SE3.identity(), { x: 1, y: 0, z: 0 }, 45)
        assert.ok(SE3.isValid(t))
    })

    test("isValid fails for NaN position", () => {
        const t = SE3.identity()
        t.position[0] = NaN
        assert.ok(!SE3.isValid(t))
    })

    test("fw 100 rt 90 fw 100 produces L-shape", () => {
        let t = SE3.identity()
        t = SE3.translateLocal(t, 100, 0, 0)  // fw 100
        t = SE3.rotateLocal(t, { x: 0, y: 0, z: 1 }, 90)  // rt 90 (yaw)
        t = SE3.translateLocal(t, 100, 0, 0)  // fw 100
        // Should be at (100, 100, 0) — classic L-shape
        assert.ok(Math.abs(t.position[0] - 100) < 1e-8)
        assert.ok(Math.abs(t.position[1] - 100) < 1e-8)
        assert.ok(Math.abs(t.position[2]) < 1e-8)
    })

    test("full rotation returns to start", () => {
        let t = SE3.identity()
        // 360 steps of fw 1 rt 1
        for (let i = 0; i < 360; i++) {
            t = SE3.translateLocal(t, 1, 0, 0)
            t = SE3.rotateLocal(t, { x: 0, y: 0, z: 1 }, 1)
        }
        // Should return near origin (it's a circle)
        assert.ok(Math.abs(t.position[0]) < 2, `x=${t.position[0]}`)
        assert.ok(Math.abs(t.position[1]) < 2, `y=${t.position[1]}`)
        // Rotation should be back to identity (360°)
        assert.ok(Math.abs(t.rotation.w - 1) < 1e-6 || Math.abs(t.rotation.w + 1) < 1e-6)
    })
})
