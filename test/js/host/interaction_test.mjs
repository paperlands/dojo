import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildWorld, fork, drive } from '../laws/harness.mjs'

// Run the real host adapter with only its DOM/WebGL owner replaced in memory.
const fakeURL = 'data:text/javascript,' + encodeURIComponent(`
export class Turtle {
    static instances = []
    constructor() { Turtle.instances.push(this); this.scheduler = null; this.watchers = new Set(); this.answer = { kind: 'value', value: 0 } }
    upsertAmbient() { this.scheduler = { done: true, commandCount: 1, errors: [] }; return { success: true, commandCount: 1 } }
    readScalar() { return this.answer }
    readPlace() { return this.answer }
    proposePlace() { return { kind: 'accept' } }
    onAcceptedChange(fn) { this.watchers.add(fn); return () => this.watchers.delete(fn) }
    publish(answer) { this.answer = answer; for (const fn of [...this.watchers]) if (this.watchers.has(fn)) fn() }
    dispose() { this.disposeCount = (this.disposeCount ?? 0) + 1 }
}`)
const { Turtle } = await import(fakeURL)
const source = readFileSync(new URL('../../../assets/js/host.js', import.meta.url), 'utf8')
const { createHatch } = await import('data:text/javascript,' + encodeURIComponent(
    source.replace('"./turtling/turtle.js"', JSON.stringify(fakeURL))
        .replace('"./turtling/run.js"', JSON.stringify(new URL('../../../assets/js/turtling/run.js', import.meta.url).href))))

async function ready() {
    const hatch = createHatch({})
    const turtle = Turtle.instances.at(-1)
    await (await hatch.play('let A')).finished
    return { hatch, turtle }
}

function seat(source) {
    const scheduler = buildWorld({ strokeMax: 0, breathEvery: 1000 })
    scheduler.hotSwapChild('host', fork('host', source))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    return scheduler
}

test('accepted scalar redeclarations notify without inventing a motion revision', () => {
    const scheduler = buildWorld({ strokeMax: 0, breathEvery: 1000 })
    scheduler.hotSwapChild('host', fork('host', 'let s = 1\nlet t = s\nwait 1\nlet s = 2'))
    const samples = [scheduler.readScalar('s').value]
    const derived = []
    const revision = scheduler.motionRevision
    scheduler.onAcceptedChange(() => {
        const value = scheduler.readScalar('s').value
        if (Object.is(value, samples.at(-1))) return
        samples.push(value)
        derived.push(scheduler.readScalar('t').value)
    })
    drive(scheduler)
    assert.deepEqual(samples, [1, 2])
    assert.deepEqual(derived, [2])
    assert.equal(scheduler.motionRevision, revision)
})

test('late births notify after installation and keep the reentrant motion gate closed', () => {
    const scheduler = buildWorld({ strokeMax: 0, breathEvery: 1000 })
    scheduler.hotSwapChild('host', fork('host', 'wait 1\nlet A'))
    const samples = [scheduler.readPlace('A', 'x').kind]
    const proposals = []
    scheduler.onAcceptedChange(() => {
        const answer = scheduler.readPlace('A', 'x')
        if (answer.kind === 'missing') return
        samples.push(answer.value)
        proposals.push(scheduler.proposePlace('A', [7, 0, 0], scheduler.motionRevision).kind)
    })
    drive(scheduler)
    assert.deepEqual(samples, ['missing', 0])
    assert.deepEqual(proposals, ['busy'])
    assert.equal(scheduler.root.notifyingCommit, false)
})

test('a named vector and a place property share the same value door', () => {
    const scheduler = seat('let A\nlet p = A.position\nlet v = [A.x, A.y, A.z]')
    assert.deepEqual(scheduler.readScalar('p'), scheduler.readPlace('A', 'position'))
    assert.deepEqual(scheduler.readScalar('v').value, [0, 0, 0])
    assert.equal(scheduler.proposePlace('A', [7, 0, 0], scheduler.motionRevision).kind, 'accept')
    assert.deepEqual(scheduler.readScalar('p').value, [7, 0, 0])
    assert.deepEqual(scheduler.readScalar('v').value, [7, 0, 0])
})

test('the value door preserves vector dimension instead of projecting it to the canvas', () => {
    const scheduler = seat('let v = [1, 2, 3, 4]')
    assert.deepEqual(scheduler.readScalar('v'), { kind: 'value', value: [1, 2, 3, 4] })
})

test('sparse positions are unsupported before they reach admission', () => {
    const scheduler = seat('let A')
    assert.equal(scheduler.proposePlace('A', Array(3), scheduler.motionRevision).kind, 'unsupported')
    assert.deepEqual(scheduler.readPlace('A', 'position').value, [0, 0, 0])
})

test('subscriptions require a played program and a callable observer', async () => {
    const hatch = createHatch({})
    assert.throws(() => hatch.interaction.subscribe('s', () => {}), /play.*before subscribing/)
    await (await hatch.play('let A')).finished
    assert.throws(() => hatch.interaction.subscribe('A', 'x', null), TypeError)
    hatch.dispose()
})

test('public vectors are immutable snapshots; equal values do not re-deliver', async () => {
    const { hatch, turtle } = await ready()
    const vector = [1, 2, 3, 4]
    turtle.answer = { kind: 'value', value: vector }
    const samples = []
    const off = hatch.interaction.subscribe('v', answer => samples.push(answer))
    const first = samples[0]
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.value))
    assert.notEqual(first.value, vector)
    vector[0] = 5
    assert.equal(first.value[0], 1)
    turtle.publish({ kind: 'value', value: [1, 2, 3, 4] })
    assert.equal(samples.length, 1)
    turtle.publish({ kind: 'value', value: [5, 2, 3, 4] })
    assert.equal(samples.length, 2)
    off(); off()
    assert.equal(turtle.watchers.size, 0)
    hatch.dispose()
})

test('the public boundary refuses non-finite, sparse and non-plain values', async () => {
    const { hatch, turtle } = await ready()
    for (const value of [Infinity, NaN, [0, Infinity], Array(3), { x: 1 }, undefined]) {
        turtle.answer = { kind: 'value', value }
        assert.equal(hatch.interaction.read('s').kind, 'unsupported')
    }
    turtle.answer = { kind: 'value', value: null }
    assert.deepEqual(hatch.interaction.read('s'), { kind: 'value', value: null })
    hatch.dispose()
})

test('observer failure and mid-fan cancellation cannot silence a live sibling', async () => {
    const { hatch, turtle } = await ready()
    let stopCancelled = () => {}
    const cancelled = [], sibling = []
    hatch.interaction.subscribe('s', answer => { if (answer.value === 7) stopCancelled() })
    hatch.interaction.subscribe('s', () => { throw new Error('observer') })
    stopCancelled = hatch.interaction.subscribe('s', answer => cancelled.push(answer.value))
    hatch.interaction.subscribe('s', answer => sibling.push(answer.value))
    turtle.publish({ kind: 'value', value: 7 })
    assert.deepEqual(cancelled, [0])
    assert.deepEqual(sibling, [0, 7])
    hatch.dispose()
})

test('replacement and disposal retire subscriptions and dispose exactly once', async () => {
    const { hatch, turtle } = await ready()
    const samples = []
    hatch.interaction.subscribe('s', answer => samples.push(answer.value))
    await (await hatch.play('let B')).finished
    turtle.publish({ kind: 'value', value: 7 })
    assert.deepEqual(samples, [0])
    assert.equal(turtle.watchers.size, 0)
    hatch.interaction.subscribe('s', () => {})
    hatch.dispose(); hatch.dispose()
    assert.equal(turtle.disposeCount, 1)
    assert.equal(turtle.watchers.size, 0)
    assert.equal(hatch.interaction.read('s').kind, 'retired')
    assert.equal(hatch.interaction.propose('A', [0, 0, 0]).kind, 'retired')
})

test('overlapping play acceptance says superseded, not disposed', async () => {
    const { hatch, turtle } = await ready()
    let finishAcceptance
    turtle.upsertAmbient = () => new Promise(resolve => { finishAcceptance = resolve })
    const earlier = hatch.play('first')
    const firstAcceptance = finishAcceptance
    const later = hatch.play('second')
    firstAcceptance({ success: true, commandCount: 1 })
    await assert.rejects(earlier, /superseded/)
    finishAcceptance({ success: true, commandCount: 1 })
    await (await later).finished
    hatch.dispose()
})
