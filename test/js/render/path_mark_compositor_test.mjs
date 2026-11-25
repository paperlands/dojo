// A declared path reaches the SCREEN as the binding's own mark: one keyed object in the
// declaring frame's layer, replaced in place, retracted whole, and never deposited ink.
// (D055, id:path-accepted-places)
// Run: node --test test/js/render/path_mark_compositor_test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Group, Vector3 } from '../../../assets/js/utils/three-entry.js'
import { createCompositor } from '../../../assets/js/turtling/compositor.js'
import { createFocus } from '../../../assets/js/turtling/focus.js'
import { createMaterialCache } from '../../../assets/js/turtling/render/line/material-cache.js'
import { buildWorld, fork, IDENT } from '../laws/harness.mjs'

function fixture(t) {
    const scheduler = buildWorld({ trace: true, capacity: 512, strokeMax: 0, breathEvery: 1000,
        clock: () => 0, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const scene = new Group()
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) }, materials: createMaterialCache(),
        requestRender() {}, viewOffset: () => IDENT,
    }, { focus: createFocus(scheduler), createText: () => { throw Error('no labels in this fixture') } })
    t.after(() => compositor.dispose())
    return { scheduler, scene, compositor }
}

// A layer per ambient; the lines the picture actually shows live inside them.
const lines = (scene) => scene.children.flatMap((layer) => layer.children).filter((c) => c.isLine2)
const spanOf = (line) => {
    const start = line.geometry.getAttribute('instanceStart')
    const end = line.geometry.getAttribute('instanceEnd')
    const last = line.geometry.instanceCount - 1
    return [start.getX(0), start.getY(0), end.getX(last), end.getY(last)]
}

test('a declared path is one keyed mark: visible, replaced in place, removed whole', (t) => {
    const { scheduler, scene, compositor } = fixture(t)
    const host = scheduler.hotSwapChild('H', fork('H', 'let rail = path((-6, 0, 0), (6, 0, 0))'))
    compositor.advance(0)
    assert.deepEqual(scheduler.errors, [])
    const first = lines(scene)
    assert.equal(first.length, 1, 'the declared segment is on screen')
    assert.deepEqual(spanOf(first[0]), [-6, 0, 6, 0])
    assert.deepEqual([...host.children.keys()], [], 'no walker was seated for a value')

    // The SAME frame re-declares the name: one object, newest shape, replaced in place.
    const same = fixture(t)
    same.scheduler.hotSwapChild('H', fork('H', [
        'let rail = path((-6, 0, 0), (6, 0, 0))',
        'let rail = path((-2, 3, 0), (2, 3, 0))',
    ].join('\n')))
    same.compositor.advance(0)
    const replaced = lines(same.scene)
    assert.equal(replaced.length, 1, 'a redefinition leaves only its latest mark')
    assert.deepEqual(spanOf(replaced[0]), [-2, 3, 2, 3], 'and the newest shape')

    // A re-seated frame is a new binding: exactly one mark, never two.
    scheduler.hotSwapChild('H', fork('H', 'let rail = path((-2, 3, 0), (2, 3, 0))'))
    compositor.advance(100)
    const second = lines(scene)
    assert.equal(second.length, 1, 'one mark across the re-seat')
    assert.deepEqual(spanOf(second[0]), [-2, 3, 2, 3])

    // The name stops naming a path: the mark leaves.
    scheduler.hotSwapChild('H', fork('H', 'let rail = 5'))
    compositor.advance(200)
    assert.deepEqual(lines(scene), [], 'the mark left with the binding')
})

test('a mark and a turtle\'s ink are separate: removing one leaves the other', (t) => {
    const { scheduler, scene, compositor } = fixture(t)
    scheduler.hotSwapChild('H', fork('H', 'let rail = path((-6, 0, 0), (6, 0, 0))'))
    scheduler.hotSwapChild('P', fork('P', 'fw 10'))
    compositor.advance(0)
    const inkBefore = lines(scene).length
    assert.ok(inkBefore >= 2, 'the mark and the stroke are both drawn')

    // Only the declaration's name goes; the turtle's stroke is untouched.
    scheduler.hotSwapChild('H', fork('H', 'let rail = 5'))
    compositor.advance(100)
    assert.equal(lines(scene).length, inkBefore - 1, 'exactly one object left, the mark')
})

test('disjoint runs draw as separate polylines, never one bridged line', (t) => {
    const { scheduler, scene, compositor } = fixture(t)
    scheduler.hotSwapChild('H', fork('H', [
        'as pen do', '  path (0, 0, 0) (4, 0, 0)', '  path (0, 2, 0) (4, 2, 0)', 'end',
        'let guide = pen.path',
    ].join('\n')))
    compositor.advance(0)
    assert.deepEqual(scheduler.errors, [])
    const drawn = lines(scene)
    // The pen's own ink plus the mark's two runs: three polylines, no bridge.
    const spans = drawn.map(spanOf)
    assert.ok(spans.some(([x0, y0, x1, y1]) => x0 === 0 && y0 === 0 && x1 === 4 && y1 === 0))
    assert.ok(spans.some(([x0, y0, x1, y1]) => x0 === 0 && y0 === 2 && x1 === 4 && y1 === 2))
    assert.ok(!spans.some(([x0, y0, x1, y1]) => y0 === 0 && y1 === 2),
        'no polyline joins the two runs')
})
