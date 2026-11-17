// A target outlives its depositors, including one retired before acquiring a layer.
// (id:ft-d2)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Vector3 } from '../../../assets/js/utils/three-entry.js'
import { LineMaterial } from '../../../assets/js/utils/three-addons/lines/LineMaterial.js'
import { createCompositor } from '../../../assets/js/turtling/compositor.js'
import Shape from '../../../assets/js/turtling/render/shape.js'
import { createFocus } from '../../../assets/js/turtling/focus.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'
import { buildWorld, fork } from '../laws/harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

function fixture(stroke, duringDrain, targetSource = 'fw 5\nwait 0.2', otherStroke = ' fw 7') {
    const scheduler = buildWorld({ capacity: 512, strokeMax: 0, breathEvery: 1000, clock: () => 0 })
    const target = scheduler.hotSwapChild('R', fork('R', targetSource))
    const owner = scheduler.hotSwapChild('H', fork('H', `as C R do\n${stroke}\nend`))
    const other = scheduler.hotSwapChild('Q', fork('Q', `as D R do\n${otherStroke}\nend`))
    for (let i = 0; i < 16; i++) scheduler.tick(0)
    const source = owner.children.get('C'), survivor = other.children.get('D')
    assert.equal(source.targetFrame, 'R')
    assert.equal(source.done, true)
    assert.equal(survivor.done, true)
    assert.deepEqual(scheduler.errors, [])
    const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
    ink._cached = true
    const shapes = new Map()
    let retiredDuringDrain = false
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: { getInk: () => ink, get: () => ink, clear: () => ink.dispose() },
        requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText: () => { throw Error('no labels in this fixture') },
        createShapist(parent) { const shape = new Shape(parent); shapes.set(parent, shape); return shape },
        onBeat() {
            if (!duringDrain || retiredDuringDrain) return
            retiredDuringDrain = true
            scheduler.removeChild('H')
        },
    })
    const layer = () => scene.children.find(g => g.children.some(c => c._sourceId === survivor.id))
    const tags = () => layer()?.children.map(c => c._sourceId) ?? []
    const fills = () => shapes.get(layer())?.getMeshes().length ?? 0
    const close = () => {
        for (const key of ['H', 'Q', 'R']) scheduler.removeChild(key)
        compositor.dispose()
    }
    return { scheduler, compositor, target, source, survivor, tags, fills, shape: () => shapes.get(layer()), close,
        retiredDuringDrain: () => retiredDuringDrain }
}

for (const [kind, stroke] of [
    ['open stroke', ' fw 30'],
    ['closed run and filled path', ' fw 10\n jmp 40\n fw 5\n rt 90\n fw 5\n fill'],
]) {
    for (const timing of ['before first drain', 'after first drain', 'during drain']) {
        test(`${kind}: retire ${timing}, preserve the target and other depositor`, () => {
            const r = fixture(stroke, timing === 'during drain')
            try {
                assert.equal(r.compositor.probeLayerFor(r.source.id), null)
                if (timing === 'after first drain') {
                    r.compositor.advance(0)
                    assert.ok(r.compositor.probeLayerFor(r.source.id))
                    assert.ok(r.tags().includes(r.source.id), 'the control materialized the source ink')
                    assert.equal(r.fills(), kind === 'open stroke' ? 0 : 1)
                    if (kind !== 'open stroke') {
                        const targetLayer = r.compositor.probeLayerFor(r.target.id)
                        assert.ok(targetLayer.children.length > targetLayer.trails.length)
                        assert.equal(targetLayer.trails.some(t => t.key === String(r.source.id)), false)
                    }
                }
                if (timing !== 'during drain') r.scheduler.removeChild('H')
                r.compositor.advance(timing === 'after first drain' ? 16 : 0)
                r.compositor.advance(32)
                if (timing === 'during drain') assert.equal(r.retiredDuringDrain(), true)
                assert.equal(r.scheduler.registry.has(r.source.id), false)
                assert.equal(r.scheduler.registry.has(r.target.id), true)
                assert.equal(r.scheduler.registry.has(r.survivor.id), true)
                assert.ok(r.tags().includes('self'), 'the target keeps its own ink')
                assert.ok(r.tags().includes(r.survivor.id), 'body completion is not source retirement')
                assert.equal(r.tags().includes(r.source.id), false, 'no dead source tag survives in the target')
                assert.equal(r.fills(), 0, 'retirement also removes the filled face and its retained reference')
                assert.deepEqual(r.scheduler.errors, [])
            } finally { r.close() }
        })
    }
}

test('erase clears filled geometry and the shape owner’s retained mesh references', () => {
    const r = fixture(' fw 30', false, 'fw 10\nrt 90\nfw 10\nfill\nwait 0.1\nerase\nwait 0.1')
    try {
        r.compositor.advance(0)
        const shape = r.shape()
        assert.equal(shape.getMeshes().length, 1)
        const acceptedBefore = [...frameWorldTransform(r.target).position]
        r.compositor.advance(100)
        assert.equal(shape.getMeshes().length, 0)
        assert.equal(shape.scene.children.length, 0)
        assert.deepEqual(frameWorldTransform(r.target).position, acceptedBefore)
        assert.equal(r.scheduler.atCut, true)
        assert.deepEqual(r.scheduler.errors, [])
    } finally { r.close() }
})

test('reclaim preserves a live filled depositor and disposes dead fill resources exactly once', () => {
    const triangle = ' fw 10\n rt 90\n fw 10\n fill'
    const r = fixture(triangle, false, 'fw 5\nwait 0.1\nerase\nwait 0.1', triangle)
    try {
        r.compositor.advance(0)
        const shape = r.shape()
        assert.equal(shape.getMeshes().length, 2)
        const dead = shape.getMeshes().find(m => m._sourceId === r.source.id)
        const live = shape.getMeshes().find(m => m._sourceId === r.survivor.id)
        assert.ok(dead && live)
        let geometries = 0, materials = 0
        const disposeGeometry = dead.geometry.dispose.bind(dead.geometry)
        const disposeMaterial = dead.material.dispose.bind(dead.material)
        dead.geometry.dispose = () => { geometries++; disposeGeometry() }
        dead.material.dispose = () => { materials++; disposeMaterial() }
        r.scheduler.removeChild('H')
        for (const t of [16, 32, 48]) r.compositor.advance(t)
        assert.deepEqual(shape.getMeshes(), [live])
        assert.equal(geometries, 1)
        assert.equal(materials, 1)
        r.compositor.advance(100)
        assert.equal(shape.getMeshes().length, 0)
        assert.equal(geometries, 1)
        assert.equal(materials, 1)
    } finally { r.close() }
})

test('same-size source replacement before a drain reclaims the old fill, not its successor', () => {
    const triangle = ' fw 10\n rt 90\n fw 10\n fill'
    const r = fixture(triangle, false)
    try {
        const size = r.scheduler.registry.size
        r.scheduler.removeChild('H')
        const replacement = r.scheduler.hotSwapChild('H', fork('H', `as C R do\n${triangle}\nend`))
        for (let i = 0; i < 16; i++) r.scheduler.tick(0)
        const next = replacement.children.get('C')
        assert.equal(r.scheduler.registry.size, size)
        assert.notEqual(next.id, r.source.id)
        const revision = r.scheduler.motionRevision
        const oldRequest = r.scheduler.requestMotion(r.source,
            { ...r.source.transform.deref(), position: [999, 0, 0] }, revision)
        assert.equal(oldRequest.kind, 'stale')
        assert.equal(r.scheduler.motionRevision, revision)
        r.compositor.advance(0)
        assert.equal(r.tags().includes(r.source.id), false)
        assert.ok(r.tags().includes(next.id))
        assert.equal(r.fills(), 1)
        assert.ok(r.tags().includes(r.survivor.id))
        assert.deepEqual(r.scheduler.errors, [])
    } finally { r.close() }
})
