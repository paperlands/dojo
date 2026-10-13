import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialCache } from '../../../assets/js/turtling/render/line/material-cache.js'

function rig() {
    const cache = createMaterialCache()
    const base = cache.get('#fff', 2)
    let clones = 0
    const clone = base.clone.bind(base)
    base.clone = () => { clones++; return clone() }
    return { cache, base, clones: () => clones }
}

test('full brightness keeps the base; repeated dim bindings share one variant', () => {
    const { cache, base, clones } = rig()
    const a = { material: base }, b = { material: base }
    cache.bindOpacity(a, 1)
    assert.equal(a.material, base)
    assert.equal(clones(), 0)
    cache.bindOpacity(a, .4)
    cache.bindOpacity(b, .4)
    for (let i = 0; i < 100; i++) cache.bindOpacity(a, .4)
    assert.equal(a.material, b.material)
    assert.equal(clones(), 1)
    assert.equal(cache.variantCount, 1)
    assert.equal(base.opacity, 1)
    assert.equal(a.material.transparent, true)
    assert.equal(a.material.depthWrite, false)
    cache.release(a)
    assert.equal(cache.variantCount, 1, 'the second binding still owns the variant')
    cache.release(b)
    assert.equal(cache.variantCount, 0)
    cache.dispose()
})

test('every live variant receives resize, including one acquired after resizing', () => {
    const { cache, base } = rig()
    const mesh = { material: base }
    cache.updateResolution(800, 600)
    cache.bindOpacity(mesh, .4)
    assert.deepEqual(mesh.material.resolution.toArray(), [800, 600])
    cache.updateResolution(320, 240)
    assert.deepEqual(mesh.material.resolution.toArray(), [320, 240])
    assert.deepEqual(base.resolution.toArray(), [320, 240])
    cache.dispose()
})

test('replacing a material releases the previous binding and never changes shared ink', () => {
    const { cache, base } = rig()
    const mesh = { material: base }
    cache.bindOpacity(mesh, .4)
    let disposed = 0
    mesh.material.addEventListener('dispose', () => disposed++)
    const replacement = cache.get('#f00', 4)
    mesh.material = replacement
    cache.bindOpacity(mesh, .2)
    assert.equal(disposed, 1)
    assert.equal(base.opacity, 1)
    assert.equal(replacement.opacity, 1)
    assert.equal(mesh.material.opacity, .2)
    assert.equal(cache.variantCount, 1)
    cache.bindOpacity(mesh, 1)
    assert.equal(mesh.material, replacement)
    assert.equal(cache.variantCount, 0)
    cache.dispose()
})

test('array bindings, duplicate slots and repeated releases dispose each variant once', () => {
    const { cache, base, clones } = rig()
    const mesh = { material: [base, null, base] }
    cache.bindOpacity(mesh, .4)
    let disposed = 0
    mesh.material[0].addEventListener('dispose', () => disposed++)
    cache.bindOpacity(mesh, .4)
    assert.equal(clones(), 1)
    assert.equal(disposed, 0)
    assert.equal(mesh.material[0], mesh.material[2])
    cache.release(mesh)
    cache.release(mesh)
    assert.equal(disposed, 1)
    assert.equal(cache.variantCount, 0)
    cache.dispose()
})

test('clear reclaims leases, resets ownership and permits new materials', () => {
    const { cache, base } = rig()
    const mesh = { material: base }
    cache.bindOpacity(mesh, .4)
    let disposed = 0
    mesh.material.addEventListener('dispose', () => disposed++)
    cache.clear()
    cache.release(mesh)
    assert.equal(disposed, 1)
    assert.equal(cache.variantCount, 0)
    mesh.material = cache.get('#fff', 2)
    cache.bindOpacity(mesh, .4)
    assert.equal(cache.variantCount, 1)
    cache.dispose()
    assert.throws(() => cache.bindOpacity(mesh, .2), /used after dispose/)
})

test('changing opacity continuously retains only currently leased variants', () => {
    const { cache, base } = rig()
    const mesh = { material: base }
    for (let i = 1; i <= 100; i++) {
        cache.bindOpacity(mesh, i / 101)
        assert.equal(cache.variantCount, 1)
    }
    cache.release(mesh)
    assert.equal(cache.variantCount, 0)
    cache.dispose()
})
