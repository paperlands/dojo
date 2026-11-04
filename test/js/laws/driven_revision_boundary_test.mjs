// Queued revisions retain installation rights and compare freshness before projection.
// (id:laws-payload-boundary)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, nz } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const accept = ({ requested }) => ({ accepted: true, transform: requested })
const position = frame => nz(frameWorldTransform(frame).position)
const move = (scheduler, frame, point) => {
    const out = scheduler.requestMotion(frame, {
        rotation: frame.transform.deref().rotation, position: point,
    }, scheduler.motionRevision)
    assert.equal(out.kind, 'accept')
}
const scene = source => {
    const scheduler = buildWorld({ admit: accept })
    const host = scheduler.hotSwapChild('host', fork('host', source))
    drive(scheduler)
    assert.equal(host.error, null)
    return { scheduler, host, A: host.children.get('A'), B: host.children.get('B') }
}

test('retracting an accepted law while its revision is queued cannot resurrect it', () => {
    const { scheduler, host, A, B } = scene('let B\nlet A = (B.x, 100)')
    move(scheduler, B, [7, 0, 0])
    assert.equal(scheduler.root._derivedMoves.length, 1)
    const address = scheduler.root._derivedMoves[0].spec.address
    assert.ok(scheduler.laws.lawAt(address))
    scheduler.laws.retractIdentity(A.id)
    const revision = scheduler.motionRevision
    scheduler.tick(0)
    assert.equal(scheduler.laws.lawAt(address), null)
    assert.deepEqual(position(A), [0, 100, 0])
    assert.equal(scheduler.motionRevision, revision)
    assert.equal(host.error, null)
})

test('target removal cancels an already queued revision and its producer', () => {
    const scheduler = buildWorld({ admit: accept })
    const A = scheduler.hotSwapChild('A', fork('A', ''))
    const host = scheduler.hotSwapChild('host', fork('host', 'let B\nlet A.position = (B.x, 100)'))
    drive(scheduler)
    assert.equal(host.error, null)
    move(scheduler, host.children.get('B'), [7, 0, 0])
    assert.equal(scheduler.root._derivedMoves.length, 1)
    scheduler.removeChild('A')
    scheduler.tick(0)
    assert.equal(scheduler.registry.get(A.id), undefined)
    assert.equal(scheduler.readouts.size, 0)
    assert.equal(scheduler.laws.count(), 0)
})

test('different raw answers with equal projections discard superseded queued work', () => {
    const { scheduler, A, B } = scene('let B\nlet A = (1, 2, 3, B.x)')
    assert.deepEqual(position(A), [1, 2, 3])
    move(scheduler, B, [7, 0, 0])
    move(scheduler, B, [8, 0, 0])
    const queued = scheduler.root._derivedMoves
    assert.equal(queued.length, 2)
    assert.deepEqual([...queued[0].raw], [1, 2, 3, 7])
    assert.deepEqual([...queued[1].raw], [1, 2, 3, 8])
    const revision = scheduler.motionRevision
    scheduler.tick(0)
    assert.equal(scheduler.motionRevision, revision + 1, 'only the current raw answer publishes')
    assert.deepEqual(position(A), [1, 2, 3])
    assert.deepEqual([...scheduler.laws.active()[0].expression.value], [1, 2, 3])
    for (let i = 0; i < 10; i++) scheduler.tick(i)
    assert.equal(scheduler.root._derivedMoves.length, 0)
    assert.equal(scheduler.motionRevision, revision + 1, 'an equal projection does not create an idle loop')
})
