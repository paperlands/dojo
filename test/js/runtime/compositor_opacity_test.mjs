import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from '../laws/harness.mjs'
import { createCompositor } from '../../../assets/js/turtling/compositor.js'
import { createMaterialCache } from '../../../assets/js/turtling/render/line/material-cache.js'
import { Group, Vector3, Mesh, MeshBasicMaterial } from '../../../assets/js/utils/three-entry.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'

const vector = (name = 'v', color = '#fff') => ({
    type: 'vector', name, from: [0, 0, 0], to: [1, 0, 0], color, thickness: 2,
})
function rig(source = 'wait 100') {
    const scheduler = buildWorld({ capacity: 4096 })
    const frame = scheduler.hotSwapChild('host', fork('host', source))
    const materials = createMaterialCache()
    const stage = {
        scene: new Group(), camera: { position: new Vector3(0, 0, 250) }, materials,
        requestRender() {}, viewOffset: () => SE3.identity(),
    }
    const compositor = createCompositor(scheduler, stage, {
        focus: { kindled: null, isFocused: () => false }, createText: () => new Group(),
    })
    const put = (event, owner = frame) => {
        assert.equal(owner.channel.put(event), true)
        compositor.advance(0)
    }
    return { scheduler, frame, materials, stage, compositor, put }
}
const lines = group => group.children.filter(child => child.isLine2)

test('a style set before materialization reaches new geometry, vectors and later updates', () => {
    const r = rig()
    r.compositor.setOpacityByAddress(r.frame.address, .4)
    r.put(vector())
    const group = r.stage.scene.children[0]
    const line = lines(group)[0]
    assert.equal(line.material.opacity, .4)
    assert.equal(r.materials.get('#fff', 2).opacity, 1)
    const firstVariant = line.material
    let released = 0
    firstVariant.addEventListener('dispose', () => released++)
    for (let i = 0; i < 20; i++) r.put({ ...vector(), to: [i + 2, 0, 0] })
    assert.equal(line.material, firstVariant, 'same-style motion keeps the existing material binding')
    assert.equal(released, 0)
    r.put({ ...vector('v', '#f00'), to: [2, 0, 0] })
    assert.equal(lines(group)[0], line, 'vector identity and mesh seat survive')
    assert.equal(released, 1)
    assert.equal(line.material.opacity, .4)
    r.compositor.setOpacityByAddress(r.frame.address, .2)
    assert.equal(line.material.opacity, .2)
    assert.equal(r.materials.get('#fff', 2).opacity, 1)
    assert.equal(r.materials.get('#f00', 2).opacity, 1)
    r.put(vector('second', '#f00'))
    assert.equal(lines(group)[1].material, line.material, 'same style shares a leased variant')
    r.materials.updateResolution(320, 240)
    assert.deepEqual(line.material.resolution.toArray(), [320, 240])
    r.compositor.dispose()
    assert.equal(r.materials.variantCount, 0)
})

test('a global style reaches future layers and clear releases their variants', () => {
    const r = rig()
    r.compositor.setOpacity(.3)
    r.put(vector())
    assert.equal(lines(r.stage.scene.children[0])[0].material.opacity, .3)
    r.put({ type: 'clear' })
    assert.equal(r.materials.variantCount, 0)
    r.put(vector())
    assert.equal(lines(r.stage.scene.children[0])[0].material.opacity, .3)
    r.compositor.dispose()
})

test('new descendants inherit their addressed parent style', () => {
    const r = rig('wait 0.1\nas child do\n wait 100\nend')
    r.compositor.setOpacityByAddress(r.frame.address, .4)
    r.compositor.advance(0)
    r.compositor.advance(100)
    const child = r.frame.children.get('child')
    assert.ok(child)
    assert.equal(child.channel.put(vector()), true)
    r.compositor.advance(100)
    const line = r.stage.scene.children.flatMap(lines)[0]
    assert.equal(line.material.opacity, .4)
    r.compositor.dispose()
})

test('exclusive materials are not cloned; full brightness restores their own depth policy', () => {
    const r = rig()
    r.put(vector())
    const group = r.stage.scene.children[0]
    const material = new MeshBasicMaterial({ depthWrite: false })
    material.clone = () => { throw new Error('an exclusive material must not be cloned') }
    const mesh = new Mesh(undefined, material)
    group.add(mesh)
    r.compositor.setOpacity(.4)
    assert.equal(mesh.material, material)
    assert.equal(material.opacity, .4)
    assert.equal(material.transparent, true)
    r.compositor.setOpacity(1)
    assert.equal(material.transparent, false)
    assert.equal(material.depthWrite, false)
    assert.equal(lines(group)[0].material, r.materials.get('#fff', 2))
    r.compositor.dispose()
})

test('orphan cleanup releases leased ink without disposing the shared base', () => {
    const r = rig()
    r.compositor.setOpacity(.4)
    r.put(vector())
    const base = r.materials.get('#fff', 2)
    let baseDisposed = 0
    base.addEventListener('dispose', () => baseDisposed++)
    assert.equal(r.materials.variantCount, 1)
    r.scheduler.removeChild('host')
    r.compositor.advance(0)
    assert.equal(r.materials.variantCount, 0)
    assert.equal(r.stage.scene.children.length, 0)
    assert.equal(baseDisposed, 0)
    r.compositor.dispose()
    assert.equal(baseDisposed, 1)
})

test('text arrays retain SDF transparency and owned depth settings', () => {
    const r = rig()
    r.put(vector())
    const text = new Group()
    text.text = 'caption'
    text.material = [new MeshBasicMaterial({ depthWrite: false }), new MeshBasicMaterial({ depthWrite: false })]
    r.stage.scene.children[0].add(text)
    r.compositor.setOpacity(.4)
    r.compositor.setOpacity(1)
    for (const mat of text.material) {
        assert.equal(mat.opacity, 1)
        assert.equal(mat.transparent, true)
        assert.equal(mat.depthWrite, false)
    }
    r.compositor.dispose()
})
