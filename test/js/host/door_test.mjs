import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headlessHatch } from './harness.mjs'
import { labInputs } from '../../../assets/js/turtling/lab.js'

const value = value => ({ kind: 'value', value })

test('subscribe after play observes delayed availability, before finished', async () => {
    const { hatch, turtle } = headlessHatch()
    const run = await hatch.play('wait 1\nlet s = 7\nwait 1')
    const samples = []
    hatch.interaction.subscribe('s', answer => {
        assert.deepEqual(answer, hatch.interaction.read('s'))
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
    hatch.dispose()
})

test('ordinary actor motion and dependent readings are observed without law publication', async () => {
    const { hatch, turtle } = headlessHatch()
    const run = await hatch.play('as A do\nwait 1\njmp 10\nwait 1\nend\nlet p = A.position')
    const positions = [], derived = []
    hatch.interaction.subscribe('A', 'position', answer => {
        assert.deepEqual(answer, hatch.interaction.read('A', 'position'))
        assert.deepEqual(answer, hatch.interaction.read('p'))
        positions.push(answer)
    })
    hatch.interaction.subscribe('p', answer => derived.push(answer))
    const revision = turtle.scheduler.motionRevision
    turtle.advance(1000)
    assert.deepEqual(positions, [value([0, 0, 0]), value([10, 0, 0])])
    assert.deepEqual(derived, positions)
    assert.equal(turtle.scheduler.motionRevision, revision)
    turtle.advance(2000)
    await run.finished
    hatch.dispose()
})

test('cancellation is immediate, idempotent, and does not cancel the run', async () => {
    const { hatch, turtle } = headlessHatch()
    const run = await hatch.play('wait 1\nlet s = 7')
    const samples = []
    const off = hatch.interaction.subscribe('s', answer => samples.push(answer))
    off(); off()
    turtle.advance(1000)
    await run.finished
    assert.deepEqual(samples, [{ kind: 'missing' }])
    assert.deepEqual(hatch.interaction.read('s'), value(7))
    hatch.dispose()
})

test('replacement retires old subscriptions and completion; the new run has new ownership', async () => {
    const { hatch, turtle } = headlessHatch()
    const old = await hatch.play('wait 1\nlet s = 7')
    const rejected = assert.rejects(old.finished, error => error.reason === 'superseded')
    const oldSamples = [], newSamples = []
    hatch.interaction.subscribe('s', answer => oldSamples.push(answer))
    const run = await hatch.play('let s = 2\nwait 1\nlet s = 3')
    await rejected
    hatch.interaction.subscribe('s', answer => newSamples.push(answer))
    turtle.advance(1000)
    await run.finished
    assert.deepEqual(oldSamples, [{ kind: 'missing' }])
    assert.deepEqual(newSamples, [value(2), value(3)])
    hatch.dispose()
})

test('failed replacement also retires delivery; disposal is terminal and idempotent', async () => {
    const { hatch, turtle } = headlessHatch()
    await (await hatch.play('let s = 1')).finished
    const samples = []
    hatch.interaction.subscribe('s', answer => samples.push(answer))
    await assert.rejects(hatch.play('nope'), error => error.reason === 'fatal' && error.wound.span.line === 1)
    assert.throws(() => hatch.interaction.subscribe('s', () => {}), /before subscribing/)
    hatch.dispose(); hatch.dispose()
    assert.equal(turtle.disposeCount, 1)
    assert.deepEqual(samples, [value(1)])
    assert.deepEqual(hatch.interaction.read('s'), { kind: 'retired' })
    assert.equal(hatch.interaction.propose('A', [0, 0, 0]).kind, 'retired')
})

test('native acceptance installs geometry and dependent values before observers; callbacks cannot propose', async () => {
    const { hatch } = headlessHatch()
    await (await hatch.play('let A\nlet A.y = 0\nlet p = A.position')).finished
    const samples = [], proposals = []
    hatch.interaction.subscribe('p', answer => {
        assert.deepEqual(answer, hatch.interaction.read('A', 'position'))
        proposals.push(hatch.interaction.propose('A', [8, 0, 0]).kind)
        samples.push(answer)
        throw Error('observer is not an authority')
    })
    assert.equal(hatch.interaction.propose('A', [7, 20, 0]).kind, 'accept')
    assert.deepEqual(samples, [value([0, 0, 0]), value([7, 0, 0])])
    assert.deepEqual(proposals, ['busy', 'busy'])
    hatch.dispose()
})

test('mid-fan cancellation and mid-fan subscription respect delivery rights', async () => {
    const { hatch, turtle } = headlessHatch()
    const run = await hatch.play('let s = 1\nwait 1\nlet s = 2\nwait 1\nlet s = 3')
    const cancelled = [], sibling = [], added = []
    let off = () => {}
    hatch.interaction.subscribe('s', answer => {
        if (answer.value === 2) {
            off()
            hatch.interaction.subscribe('s', answer => added.push(answer.value))
        }
    })
    off = hatch.interaction.subscribe('s', answer => cancelled.push(answer.value))
    hatch.interaction.subscribe('s', answer => sibling.push(answer.value))
    turtle.advance(1000)
    turtle.advance(2000)
    await run.finished
    assert.deepEqual(cancelled, [1])
    assert.deepEqual(sibling, [1, 2, 3])
    assert.deepEqual(added, [2, 3])
    hatch.dispose()
})

test('a late wound rejects finished rather than reporting successful completion', async () => {
    const { hatch, turtle } = headlessHatch()
    const run = await hatch.play('fw 1\nwait 1\nnope')
    const ended = assert.rejects(run.finished, error => error.reason === 'fatal' && error.wound.span.line === 3)
    turtle.advance(1000)
    await ended
    hatch.dispose()
})

test('a deferred callback proposal uses a later admission, not a hidden retry queue', async () => {
    const { hatch } = headlessHatch()
    await (await hatch.play('let A\nlet s = A.x')).finished
    const samples = []
    let verdict
    hatch.interaction.subscribe('s', answer => {
        samples.push(answer.value)
        if (answer.value === 0) queueMicrotask(() => { verdict = hatch.interaction.propose('A', [7, 0, 0]) })
    })
    assert.deepEqual(samples, [0])
    await Promise.resolve()
    assert.equal(verdict.kind, 'accept')
    assert.deepEqual(samples, [0, 7])
    hatch.dispose()
})

test('disposal during a delayed run revokes delivery and rejects only its completion', async () => {
    const { hatch, turtle } = headlessHatch()
    const run = await hatch.play('wait 1\nlet s = 7')
    const samples = []
    hatch.interaction.subscribe('s', answer => samples.push(answer))
    const rejected = assert.rejects(run.finished, error => error.reason === 'disposed')
    hatch.dispose()
    turtle.advance(1000)
    await rejected
    assert.deepEqual(samples, [{ kind: 'missing' }])
    assert.deepEqual(hatch.interaction.read('s'), { kind: 'retired' })
})

test('laboratory inputs are an allow-list, not a scheduler configuration funnel', () => {
    const admit = () => ({ accepted: true })
    assert.equal(labInputs({ motionAdmission: admit }).motionAdmission, admit)
    for (const key of ['almostRight', 'execOpts', 'createDeps', 'channelCapacity', 'rootHears', 'onShout', 'lossless'])
        assert.throws(() => labInputs({ [key]: 1 }), /unknown laboratory input/)
    assert.deepEqual(labInputs(null), {})
})
