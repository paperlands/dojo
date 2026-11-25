import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headlessWorld } from './harness.mjs'
import { labInputs } from '../../../assets/js/turtling/lab.js'

const value = value => ({ kind: 'value', value })

test('subscribe after play observes delayed availability, before finished', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('wait 1\nlet s = 7\nwait 1')
    const samples = []
    world.interaction.subscribe('s', answer => {
        assert.deepEqual(answer, world.interaction.read('s'))
        samples.push(answer)
    })
    assert.deepEqual(samples, [{ kind: 'missing' }])
    let ended = false
    run.finished.then(() => { ended = true })
    turtle.advance(1000)
    await Promise.resolve()
    assert.equal(ended, false)
    assert.deepEqual(samples, [{ kind: 'missing' }, value(7)])
    turtle.advance(2000)
    await run.finished
    assert.equal(samples.length, 2)
    world.dispose()
})

test('ordinary actor motion and dependent readings are observed without law publication', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('as A do\nwait 1\njmp 10\nwait 1\nend\nlet p = A.position')
    const positions = [], derived = []
    world.interaction.subscribe(['host', 'A'], 'position', answer => {
        assert.deepEqual(answer, world.interaction.read(['host', 'A'], 'position'))
        assert.deepEqual(answer, world.interaction.read('p'))
        positions.push(answer)
    })
    world.interaction.subscribe('p', answer => derived.push(answer))
    const revision = turtle.scheduler.motionRevision
    turtle.advance(1000)
    assert.deepEqual(positions, [value([0, 0, 0]), value([10, 0, 0])])
    assert.deepEqual(derived, positions)
    assert.equal(turtle.scheduler.motionRevision, revision)
    turtle.advance(2000)
    await run.finished
    world.dispose()
})

test('cancellation is immediate, idempotent, and does not cancel the run', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('wait 1\nlet s = 7')
    const samples = []
    const off = world.interaction.subscribe('s', answer => samples.push(answer))
    off(); off()
    turtle.advance(1000)
    await run.finished
    assert.deepEqual(samples, [{ kind: 'missing' }])
    assert.deepEqual(world.interaction.read('s'), value(7))
    world.dispose()
})

test('replacement retires old subscriptions and completion; the new run has new ownership', async () => {
    const { world, turtle } = headlessWorld()
    const old = await world.play('wait 1\nlet s = 7')
    const rejected = assert.rejects(old.finished, error => error.reason === 'superseded')
    const oldSamples = [], newSamples = []
    world.interaction.subscribe('s', answer => oldSamples.push(answer))
    const run = await world.play('let s = 2\nwait 1\nlet s = 3')
    await rejected
    world.interaction.subscribe('s', answer => newSamples.push(answer))
    turtle.advance(1000)
    await run.finished
    assert.deepEqual(oldSamples, [{ kind: 'missing' }])
    assert.deepEqual(newSamples, [value(2), value(3)])
    world.dispose()
})

test('failed replacement also retires delivery; disposal is terminal and idempotent', async () => {
    const { world, turtle } = headlessWorld()
    await (await world.play('let s = 1')).finished
    const samples = []
    world.interaction.subscribe('s', answer => samples.push(answer))
    await assert.rejects(world.play('nope'), error => error.reason === 'fatal' && error.wound.span.line === 1)
    assert.throws(() => world.interaction.subscribe('s', () => {}), /before subscribing/)
    world.dispose(); world.dispose()
    assert.equal(turtle.disposeCount, 1)
    assert.deepEqual(samples, [value(1)])
    assert.deepEqual(world.interaction.read('s'), { kind: 'retired' })
    assert.equal(world.interaction.propose(['host', 'A'], [0, 0, 0]).kind, 'retired')
})

test('native acceptance installs geometry and dependent values before observers; callbacks cannot propose', async () => {
    const { world } = headlessWorld()
    await (await world.play('let A\nlet A.y = 0\nlet p = A.position')).finished
    const samples = [], proposals = []
    world.interaction.subscribe('p', answer => {
        assert.deepEqual(answer, world.interaction.read(['host', 'A'], 'position'))
        proposals.push(world.interaction.propose(['host', 'A'], [8, 0, 0]).kind)
        samples.push(answer)
        throw Error('observer is not an authority')
    })
    assert.equal(world.interaction.propose(['host', 'A'], [7, 20, 0]).kind, 'accept')
    assert.deepEqual(samples, [value([0, 0, 0]), value([7, 0, 0])])
    assert.deepEqual(proposals, ['busy', 'busy'])
    world.dispose()
})

test('mid-fan cancellation and mid-fan subscription respect delivery rights', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('let s = 1\nwait 1\nlet s = 2\nwait 1\nlet s = 3')
    const cancelled = [], sibling = [], added = []
    let off = () => {}
    world.interaction.subscribe('s', answer => {
        if (answer.value === 2) {
            off()
            world.interaction.subscribe('s', answer => added.push(answer.value))
        }
    })
    off = world.interaction.subscribe('s', answer => cancelled.push(answer.value))
    world.interaction.subscribe('s', answer => sibling.push(answer.value))
    turtle.advance(1000)
    turtle.advance(2000)
    await run.finished
    assert.deepEqual(cancelled, [1])
    assert.deepEqual(sibling, [1, 2, 3])
    assert.deepEqual(added, [2, 3])
    world.dispose()
})

test('a late wound rejects finished rather than reporting successful completion', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('fw 1\nwait 1\nnope')
    const ended = assert.rejects(run.finished, error => error.reason === 'fatal' && error.wound.span.line === 3)
    turtle.advance(1000)
    await ended
    world.dispose()
})

test('a deferred callback proposal uses a later admission, not a hidden retry queue', async () => {
    const { world } = headlessWorld()
    await (await world.play('let A\nlet s = A.x')).finished
    const samples = []
    let verdict
    world.interaction.subscribe('s', answer => {
        samples.push(answer.value)
        if (answer.value === 0) queueMicrotask(() => { verdict = world.interaction.propose(['host', 'A'], [7, 0, 0]) })
    })
    assert.deepEqual(samples, [0])
    await Promise.resolve()
    assert.equal(verdict.kind, 'accept')
    assert.deepEqual(samples, [0, 7])
    world.dispose()
})

test('disposal during a delayed run revokes delivery and rejects only its completion', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('wait 1\nlet s = 7')
    const samples = []
    world.interaction.subscribe('s', answer => samples.push(answer))
    const rejected = assert.rejects(run.finished, error => error.reason === 'disposed')
    world.dispose()
    turtle.advance(1000)
    await rejected
    assert.deepEqual(samples, [{ kind: 'missing' }])
    assert.deepEqual(world.interaction.read('s'), { kind: 'retired' })
})

test('play reads a walk of places, and the reading is not the walk', async () => {
    const { world } = headlessWorld()
    await (await world.play('let s = 1')).finished
    assert.deepEqual(world.interaction.read(['host'], 'path'), { kind: 'value', value: [] })
    await (await world.play('let rail = path((0, 0, 0), (3, 0, 0))')).finished
    assert.deepEqual(world.interaction.read('rail'), { kind: 'value', value: [[[0, 0, 0], [3, 0, 0]]] })
    await (await world.play('fw 50\njmp 20\nfw 10')).finished
    const walk = world.interaction.read(['host'], 'path')
    const again = world.interaction.read(['host'], 'path')
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    assert.equal(walk.kind, 'value')
    assert.equal(walk.value.length, 2)
    assert.ok(Math.abs(dist(walk.value[0][0], walk.value[0][1]) - 50) < 1e-9)
    assert.ok(Math.abs(dist(walk.value[1][0], walk.value[1][1]) - 10) < 1e-9)
    assert.ok(Object.isFrozen(walk.value) && walk.value.every(run => Object.isFrozen(run) && run.every(Object.isFrozen)))
    assert.throws(() => { walk.value[0][1][0] = 9 })
    assert.notEqual(again.value, walk.value)
    assert.deepEqual(again.value, walk.value)
    world.dispose()
    assert.deepEqual(world.interaction.read(['host'], 'path'), { kind: 'retired' })
})

test('laboratory inputs are an allow-list, not a scheduler configuration funnel', () => {
    const admit = () => ({ accepted: true })
    assert.equal(labInputs({ motionAdmission: admit }).motionAdmission, admit)
    for (const key of ['almostRight', 'execOpts', 'createDeps', 'channelCapacity', 'rootHears', 'onShout', 'lossless'])
        assert.throws(() => labInputs({ [key]: 1 }), /unknown laboratory input/)
    assert.deepEqual(labInputs(null), {})
})
