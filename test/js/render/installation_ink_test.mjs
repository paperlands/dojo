// Retained receivers keep accepted ink, but distinct writers never join it by accident.
// (id:ft-d7-deposit-runid)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Group } from '../../../assets/js/utils/three-entry.js'
import { accumulateTrail, flushTrail } from '../../../assets/js/turtling/materializer.js'
import { buildWorld, fork } from '../laws/harness.mjs'

function chase({ movingPrey = false, named = true } = {}) {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', `def hunt prey predator do
${movingPrey ? `  as prey do
    loop 500 do
      fw 5
      rt 1
      wait 1/24
    end
  end` : ''}
  as predator do
    loop 500 do
      faceto prey
      fw 3
      wait 1/24
    end
  end
end
let fox
${movingPrey ? '' : 'let rabbit'}
${named ? 'let hunting = ' : ''}hunt ${movingPrey ? '"rabbit"' : 'rabbit'} fox`))
    const fox = host.children.get('fox')
    const layer = { group: new Group(), trails: new Map() }
    const materials = { getInk: () => ({}) }
    const paths = []
    const drain = () => {
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) {
                if (frame !== fox || event.type !== 'path') continue
                paths.push(event)
                accumulateTrail(event, layer, materials)
            }
        }
    }
    const tick = now => {
        scheduler.tick(now)
        drain()
        scheduler.readouts.drain()
        drain()
    }
    drain()
    tick(0)
    return { scheduler, host, fox, layer, paths, drain, tick }
}

function assertSegmentsFollowEvents({ layer, paths }) {
    flushTrail(layer)
    const actual = layer.group.children.flatMap(mesh => {
        const geometry = mesh.geometry
        const start = geometry.getAttribute('instanceStart')
        const end = geometry.getAttribute('instanceEnd')
        return Array.from({ length: geometry.instanceCount }, (_, i) => [
            start.getX(i), start.getY(i), start.getZ(i),
            end.getX(i), end.getY(i), end.getZ(i),
        ])
    })
    const expected = paths.flatMap(path => path.points.slice(1).map((to, i) =>
        [...path.points[i], ...to].map(Math.fround)))
    assert.deepEqual(actual, expected, 'render exactly authored segments, never a bridge across a hand move')
}

for (const movingPrey of [false, true]) {
    test(`dragging fox is pen-up across a declared hunt revision (moving prey: ${movingPrey})`, () => {
        const w = chase({ movingPrey })
        const { scheduler, host, fox, paths, drain, tick } = w
        assert.ok(paths.length > 0)
        const oldRun = host.children.get('hunting').runIncarnation
        for (let i = 1; i <= 3; i++) {
            const before = paths.length
            const position = [100 * i, 50 * i, 0]
            assert.equal(scheduler.requestMotion(fox,
                { ...fox.transform.deref(), position }, scheduler.motionRevision).kind, 'accept')
            drain()
            assert.equal(paths.length, before, 'the hand emits no ink')
            scheduler.readouts.recompute()
            scheduler.readouts.drain()
            drain()
            tick(i * 100)
            assert.ok(paths.length > before, 'the new hunt still draws')
            assert.deepEqual(paths[before].points[0], position, 'new ink starts at the dragged pose')
        }
        assert.ok(host.children.get('hunting').runIncarnation > oldRun)
        assertSegmentsFollowEvents(w)
        assert.deepEqual(scheduler.errors, [])
    })
}

test('one installation still consolidates its continuous wait-separated strokes', () => {
    const w = chase({ named: false })
    for (let i = 1; i <= 20; i++) w.tick(i * 100)
    assert.ok(w.paths.length >= 3)
    assert.equal(new Set(w.paths.map(path => path.runId)).size, 1)
    assert.equal(w.layer.group.children.length, 1)
    assertSegmentsFollowEvents(w)
    assert.deepEqual(w.scheduler.errors, [])
})
