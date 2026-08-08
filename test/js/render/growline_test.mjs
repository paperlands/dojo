// GrowLine tests — append/grow/sync buffer logic (no GL context needed).
// Run with: node --test test/js/render/growline_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { GrowLine } from "../../../assets/js/turtling/render/line/GrowLine.js"

const seg = (a, i) => [...a.slice(i * 6, i * 6 + 6)]

describe("GrowLine", () => {
    test("N points become N-1 segments with correct start/end", () => {
        const gl = new GrowLine({})
        gl.append([[0, 0, 0], [10, 0, 0], [10, 5, 0]])
        assert.equal(gl.segmentCount, 2)
        assert.deepEqual(seg(gl._array, 0), [0, 0, 0, 10, 0, 0])
        assert.deepEqual(seg(gl._array, 1), [10, 0, 0, 10, 5, 0])
    })

    test("a continuing append joins from the previous endpoint (skips shared start)", () => {
        const gl = new GrowLine({})
        gl.append([[0, 0, 0], [10, 0, 0]])
        gl.append([[10, 0, 0], [20, 0, 0]])   // shared start [10,0,0]
        assert.equal(gl.segmentCount, 2)
        assert.deepEqual(seg(gl._array, 1), [10, 0, 0, 20, 0, 0])  // no zero-length junk segment
    })

    test("sync sets instanceCount and uploads only the appended range", () => {
        const gl = new GrowLine({})
        gl.append([[0, 0, 0], [1, 0, 0], [2, 0, 0]])  // 2 segs
        gl.sync()
        assert.equal(gl.geometry.instanceCount, 2)
        assert.equal(gl._synced, 2)
        assert.deepEqual(gl._ibuf.updateRanges, [])   // first sync uploads the whole (new) buffer
        gl.append([[2, 0, 0], [3, 0, 0]])             // +1 seg
        gl.sync()
        assert.equal(gl.geometry.instanceCount, 3)
        // partial: range starts at the previously-synced segment (2*6 floats)
        assert.deepEqual(gl._ibuf.updateRanges, [{ start: 12, count: 6 }])
    })

    test("sync is a no-op when nothing was appended", () => {
        const gl = new GrowLine({})
        gl.append([[0, 0, 0], [1, 0, 0]])
        gl.sync()
        const before = gl._synced
        gl.sync()
        assert.equal(gl._synced, before)
    })

    test("grows (doubles) on overflow, preserving prior segments", () => {
        const gl = new GrowLine({})
        const pts = []
        for (let i = 0; i < 600; i++) pts.push([i, 0, 0])   // 599 segs > 512 cap
        gl.append(pts)
        assert.equal(gl.segmentCount, 599)
        assert.equal(gl._cap, 1024)
        assert.deepEqual(seg(gl._array, 0), [0, 0, 0, 1, 0, 0])      // earliest preserved
        assert.deepEqual(seg(gl._array, 598), [598, 0, 0, 599, 0, 0]) // wait: 599 segs -> last index 598
    })

    test("grow replaces geometry so the GPU VAO tracks the larger buffer", () => {
        // Same-geometry setAttribute left the VAO on the old 512-slot buffer —
        // live trails stopped drawing past the first double (~count 550).
        const gl = new GrowLine({})
        const oldGeom = gl.geometry
        const pts = []
        for (let i = 0; i < 600; i++) pts.push([i, 0, 0])
        gl.append(pts)
        assert.notEqual(gl.geometry, oldGeom)
        assert.equal(gl.mesh.geometry, gl.geometry)
        assert.equal(gl._ibuf.array, gl._array)
        assert.equal(gl._ibuf.array.length, 1024 * 6)
        assert.equal(gl._cbuf.array.length, 1024 * 6)
        assert.equal(gl._synced, 0)               // full re-upload on next sync
        gl.sync()
        assert.equal(gl.geometry.instanceCount, 599)
        assert.equal(gl._synced, 599)
        // continuous appends past the double keep writing
        gl.append([[599, 0, 0], [600, 0, 0], [601, 0, 0]])
        gl.sync()
        assert.equal(gl.segmentCount, 601)
        assert.equal(gl.geometry.instanceCount, 601)
    })

    test("append writes instance colours (hard edge: both ends share segment ink)", () => {
        const gl = new GrowLine({})
        gl.append([[0, 0, 0], [10, 0, 0]], [1, 0, 0])       // red segment
        gl.append([[10, 0, 0], [20, 0, 0]], [0, 1, 0])      // green segment
        assert.equal(gl.segmentCount, 2)
        assert.deepEqual(seg(gl._colors, 0), [1, 0, 0, 1, 0, 0])
        assert.deepEqual(seg(gl._colors, 1), [0, 1, 0, 0, 1, 0])
        // colour attributes present for LineMaterial vertexColors path
        assert.ok(gl.geometry.attributes.instanceColorStart)
        assert.ok(gl.geometry.attributes.instanceColorEnd)
    })
})
