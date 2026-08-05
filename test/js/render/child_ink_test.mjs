// Child ink spike — colour in the stroke, not the stroke identity.
// Run with: node --test test/js/render/child_ink_test.mjs
//
// Headless instrument for id:child-ink predictions (no materializer import —
// that pulls threetext/WebGL). Mirrors accumulateTrail's child path with
// GrowLine + material cache only.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { GrowLine } from "../../../assets/js/turtling/render/line/GrowLine.js"
import { createMaterialCache } from "../../../assets/js/turtling/render/line/material-cache.js"

function fakeMaterial(color, thickness, opts = {}) {
    return {
        color: opts.vertexColors ? 0xffffff : (color || 0xe77808),
        linewidth: thickness || 2,
        vertexColors: !!opts.vertexColors,
        resolution: { set() {} },
        dispose() {},
    }
}

// Simulate scheduler runIds under child rules: thickness + join only.
function tagChild(events) {
    let run = 0, end = null, thick = null
    const same = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-6
        && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6
    return events.map(e => {
        const style = `${e.thickness}`
        const cont = style === thick && same(e.points[0], end)
        if (!cont) run++
        end = e.points[e.points.length - 1]
        thick = style
        return { ...e, runId: run }
    })
}

// Engine rules: colour:thickness + join
function tagEngine(events) {
    let run = 0, end = null, style = null
    const same = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-6
        && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6
    return events.map(e => {
        const s = `${e.color}:${e.thickness}`
        const cont = s === style && same(e.points[0], end)
        if (!cont) run++
        end = e.points[e.points.length - 1]
        style = s
        return { ...e, runId: run }
    })
}

// N monochrome path slices of a continuous polyline (Option A executor flush)
function rainbowEvents(n) {
    const events = []
    for (let i = 0; i < n; i++) {
        events.push({
            type: "path",
            points: [[i * 10, 0, 0], [(i + 1) * 10, 0, 0]],
            color: `hsla(${(i / n) * 360}, 70%, 72%)`,
            thickness: 2,
            // fake rgb as production ColorConverter would produce (distinct per i)
            rgb: [i / n, 0.5, 1 - i / n],
        })
    }
    return events
}

// Minimal trail accumulate mirroring materializer child path (no THREE Text).
function accumulate(events, materials) {
    const children = []
    let tr = null
    for (const e of events) {
        if (!(tr && tr.runId === e.runId)) {
            if (tr) tr.line.sync()
            const line = new GrowLine(materials.getInk(e.thickness))
            children.push(line.mesh)
            tr = { runId: e.runId, line }
        }
        tr.line.append(e.points, e.rgb)
    }
    if (tr) tr.line.sync()
    return { children, tr, materials }
}

describe("child ink spike", () => {
    test("engine model: N colours → N runIds", () => {
        assert.equal(new Set(tagEngine(rainbowEvents(24)).map(e => e.runId)).size, 24)
    })

    test("child model: N colours → 1 runId", () => {
        assert.equal(new Set(tagChild(rainbowEvents(24)).map(e => e.runId)).size, 1)
    })

    test("child accumulate: 1 mesh, 1 ink mat, 24 coloured segments", () => {
        const materials = createMaterialCache({ createMaterial: fakeMaterial })
        const { children, tr } = accumulate(tagChild(rainbowEvents(24)), materials)

        assert.equal(children.length, 1, "one GrowLine mesh")
        assert.equal(materials.size, 1, "one ink material (not 24)")
        assert.equal(tr.line.segmentCount, 24)
        // first vs last segment ink differs
        const c = tr.line._colors
        assert.ok(c[0] !== c[23 * 6] || c[1] !== c[23 * 6 + 1], "segments carry different ink")
    })

    test("engine accumulate (for contrast): N meshes if runIds split", () => {
        const materials = createMaterialCache({ createMaterial: fakeMaterial })
        const { children } = accumulate(tagEngine(rainbowEvents(24)), materials)
        assert.equal(children.length, 24, "engine pays one mesh per colour")
        assert.equal(materials.size, 1, "ink mat still one — but mesh count is the tax")
    })

    test("thickness change still opens a new run", () => {
        const materials = createMaterialCache({ createMaterial: fakeMaterial })
        const events = tagChild([
            { points: [[0, 0, 0], [10, 0, 0]], color: "red", thickness: 2, rgb: [1, 0, 0] },
            { points: [[10, 0, 0], [20, 0, 0]], color: "blue", thickness: 4, rgb: [0, 0, 1] },
        ])
        const { children } = accumulate(events, materials)
        assert.equal(children.length, 2)
        assert.equal(materials.size, 2)  // ink:2 and ink:4
    })
})
