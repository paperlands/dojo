import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Group, Vector3 } from '../../../assets/js/utils/three-entry.js'
import { createCompositor } from '../../../assets/js/turtling/compositor.js'
import { createFocus } from '../../../assets/js/turtling/focus.js'
import { createMaterialCache } from '../../../assets/js/turtling/render/line/material-cache.js'
import { buildWorld, fork, IDENT, at } from '../laws/harness.mjs'

function fixture(t, onBeat) {
    const scheduler = buildWorld({ capacity: 512, strokeMax: 0, breathEvery: 1000, clock: () => 0,
        admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const scene = new Group()
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) }, materials: createMaterialCache(),
        requestRender() {}, viewOffset: () => IDENT,
    }, { focus: createFocus(scheduler), createText: () => { throw Error('no labels in this fixture') }, onBeat })
    t.after(() => compositor.dispose())
    return { scheduler, scene, compositor }
}

const linesIn = scene => scene.children.flatMap(g => g.children).filter(c => c.isLine2)

for (const shift of [0, 400]) test(`targeted deposits use their own carrier endpoints (shift ${shift})`, t => {
    const { scheduler, scene, compositor } = fixture(t)
    const target = scheduler.hotSwapChild('R', fork('R', ''))
    const child = scheduler.hotSwapChild('H', fork('H', 'as C R do\nfw 10\nwait 0.1\nfw 10\nend')).children.get('C')
    compositor.advance(0)
    if (shift) assert.equal(scheduler.requestMotion(target, at(shift), scheduler.motionRevision, 'world').kind, 'accept')
    compositor.advance(100)
    assert.deepEqual(scheduler.errors, [])
    const [mesh, ...others] = linesIn(scene)
    assert.equal(others.length, 0, 'both appends still batch into one mesh')
    assert.equal(mesh._sourceId, child.id)
    assert.equal(mesh.geometry.instanceCount, 2)
    const start = mesh.geometry.getAttribute('instanceStart'), end = mesh.geometry.getAttribute('instanceEnd')
    assert.deepEqual([start.getX(0), end.getX(0)], [0, 10])
    assert.deepEqual([start.getX(1), end.getX(1)], [10 - shift, 20 - shift])
})

test('a nested flush cannot overtake an older deposit on the same living carrier', t => {
    const times = []
    let reentered = false
    const { scheduler, scene, compositor } = fixture(t, beat => {
        times.push(beat.time)
        if (reentered || beat.time < 0.1) return
        reentered = true
        scheduler.tick(6000)
        compositor.flush()
    })
    const target = scheduler.hotSwapChild('R', fork('R', 'fw 1\nwait 0.1\nfw 2\nwait 0.1\nfw 3\nwait 5\nerase'))
    compositor.advance(0)
    compositor.advance(1000)
    assert.equal(reentered, true)
    assert.equal(scheduler.registry.get(target.id), target)
    assert.equal(scheduler.done, true)
    assert.deepEqual(linesIn(scene), [], 'erase removed every earlier deposit; no old suffix resumed')
    assert.deepEqual(times, [0, 0.1, 0.2, 5.2], 'the inner beat did not overtake outer ones')
})

for (const ending of ['replace', 'dispose']) test(`a beat can ${ending} after the pass without later writes to the old mesh`, t => {
    const counts = []
    let oldMesh, endedAt
    const { scheduler, scene, compositor } = fixture(t, beat => {
        counts.push(beat.time)
        if (oldMesh || beat.time < 0.1) return
        oldMesh = linesIn(scene)[0]
        endedAt = oldMesh.geometry.instanceCount
        if (ending === 'replace') {
            scheduler.hotSwapChild('H', fork('H', 'fw 9'))
            compositor.flush()
        } else compositor.dispose()
    })
    scheduler.hotSwapChild('H', fork('H', 'fw 1\nwait 0.1\nfw 2\nwait 0.1\nfw 3'))
    compositor.advance(0)
    compositor.advance(1000)
    assert.ok(oldMesh)
    assert.equal(oldMesh.geometry.instanceCount, endedAt, 'no writes after retirement')
    assert.equal(endedAt, 3, 'after the pass, the callback saw a fully applied batch')
    assert.deepEqual(counts, ending === 'replace' ? [0, 0.1, 0] : [0, 0.1], 'retirement revokes older pending delivery')
    assert.equal(linesIn(scene).includes(oldMesh), false)
    assert.equal(linesIn(scene).length, ending === 'replace' ? 1 : 0)
})

test('all carriers materialize before the first beat; removed emitters do not deliver', t => {
    let linesAtFirst
    const delivered = []
    const { scheduler, scene, compositor } = fixture(t, beat => {
        delivered.push(beat.lines)
        if (linesAtFirst !== undefined) return
        linesAtFirst = linesIn(scene).length
        scheduler.removeChild('B')
    })
    scheduler.hotSwapChild('A', fork('A', 'fw 1'))
    scheduler.hotSwapChild('B', fork('B', '\nfw 8'))
    compositor.flush()
    assert.equal(linesAtFirst, 2)
    assert.deepEqual(delivered, [[1]])
})

test('throwing from one beat does not stop delivery or fail an already-completed pass', t => {
    const log = t.mock.method(console, 'error', () => {})
    const failure = Error('observer fault')
    const delivered = []
    const { scheduler, scene, compositor } = fixture(t, beat => {
        delivered.push(beat.line)
        if (delivered.length === 1) throw failure
    })
    scheduler.hotSwapChild('A', fork('A', 'fw 1'))
    scheduler.hotSwapChild('B', fork('B', '\nfw 8'))
    assert.equal(compositor.flush(), true)
    assert.deepEqual(scheduler.errors, [])
    assert.deepEqual(delivered, [1, 2])
    assert.equal(linesIn(scene).length, 2)
    assert.equal(log.mock.calls.length, 1)
    assert.equal(log.mock.calls[0].arguments[1], failure)
})
