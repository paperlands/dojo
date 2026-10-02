import { test } from "node:test"
import assert from "node:assert/strict"
import { Group } from "../../../assets/js/utils/three-entry.js"
import Shape from "../../../assets/js/turtling/render/shape.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

// Independent oracle: sum triangle areas in the actual indexed render geometry.
const area = (geometry) => {
    const p = geometry.getAttribute("position")
    const ix = geometry.getIndex()
    let sum = 0
    for (let i = 0; i < ix.count; i += 3) {
        const [a, b, c] = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)]
        sum += Math.abs((p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
            (p.getX(c) - p.getX(a)) * (p.getY(b) - p.getY(a))) / 2
    }
    return sum
}
const square = (s) => [{ x: 0, y: 0, z: 0 }, { x: s, y: 0, z: 0 },
    { x: s, y: s, z: 0 }, { x: 0, y: s, z: 0 }]

for (const scale of [1e-12, 1e-9, 1, 1e9]) {
    for (const closed of [false, true]) {
        test(`fill keeps all four corners at scale ${scale}, repeated endpoint=${closed}`, () => {
            const shape = new Shape(new Group())
            const vertices = square(scale)
            if (closed) vertices.push({ ...vertices[0] })
            const before = structuredClone(vertices)
            const mesh = shape.addPolygon(vertices)
            assert.ok(mesh)
            assert.ok(Math.abs(area(mesh.geometry) / (scale * scale) - 1) < 1e-6,
                "the last corner is not a disposable closing vertex")
            assert.deepEqual(vertices, before, "rendering must not snap authored points")
            shape.dispose()
        })
    }
}

test("a small but real closing edge is not collapsed by an epsilon", () => {
    const shape = new Shape(new Group())
    const vertices = square(1)
    vertices.push({ x: -5e-11, y: 0, z: 0 })
    const mesh = shape.addPolygon(vertices)
    assert.ok(mesh)
    assert.ok(Math.abs(area(mesh.geometry) - 1) < 1e-6)
    assert.ok(Array.from(mesh.geometry.getIndex().array).includes(4), "the closing edge keeps its corner")
    shape.dispose()
})

for (const bad of [NaN, Infinity, null, "0"]) {
    test(`a malformed polygon coordinate (${bad}) cannot enter a mesh`, () => {
        const scene = new Group()
        const shape = new Shape(scene)
        const vertices = square(1)
        vertices[2].x = bad
        assert.equal(shape.addPolygon(vertices), null)
        assert.equal(scene.children.length, 0)
        assert.equal(shape.getStats().totalPolygons, 0)
    })
}

for (const scale of [1e-12, 1, 1e9]) {
    test(`an evaluated 36-sided walk fills the expected area at scale ${scale}`, () => {
        const events = drainEvents(parseProgram(`loop 36 do\n fw ${scale}\n rt 10\nend\nfill`),
            { mathParser: new Parser(), mathEvaluator: new Evaluator() })
        const path = events.find(e => e.type === "path" && e.filled)
        assert.ok(path)
        const shape = new Shape(new Group())
        const mesh = shape.addPolygon(path.points.map(([x, y, z]) => ({ x, y, z })))
        assert.ok(mesh)
        const expected = 36 * scale * scale / (4 * Math.tan(Math.PI / 36))
        assert.ok(Math.abs(area(mesh.geometry) / expected - 1) < 1e-6)
        shape.dispose()
    })
}
