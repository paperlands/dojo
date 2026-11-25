import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headlessWorld } from './harness.mjs'

const source = 'wait 1\nlet cue = 1\nwait 10'
const reason = name => error => error.reason === name
const value = value => ({ kind: 'value', value })

test('a reading callback requests replacement without seating inside the old turn', async () => {
    const { world, turtle } = headlessWorld()
    const old = await world.play(source)
    const oldEnd = assert.rejects(old.finished, reason('superseded'))
    let requested
    const sibling = []
    world.interaction.subscribe('cue', answer => {
        if (answer.value === 1) requested = world.play('let cue = 2')
    })
    world.interaction.subscribe('cue', answer => sibling.push(answer))
    turtle.advance(1000)
    assert.ok(requested)
    assert.deepEqual(world.interaction.read('cue'), value(1))
    assert.deepEqual(sibling, [{ kind: 'missing' }, value(1)])
    await (await requested).finished
    await oldEnd
    assert.deepEqual(world.interaction.read('cue'), value(2))
    assert.deepEqual(sibling, [{ kind: 'missing' }, value(1)])
    world.dispose()
})

test('only the newest play request in the reading fan can seat', async () => {
    const { world, turtle } = headlessWorld()
    const old = await world.play(source)
    const oldEnd = assert.rejects(old.finished, reason('superseded'))
    let loser, winner
    world.interaction.subscribe('cue', answer => {
        if (answer.value === 1) loser = assert.rejects(world.play('nope'), reason('superseded'))
    })
    world.interaction.subscribe('cue', answer => {
        if (answer.value === 1) winner = world.play('let cue = 3')
    })
    turtle.advance(1000)
    assert.ok(winner, 'the second listener still sees the old value')
    await (await winner).finished
    await Promise.all([loser, oldEnd])
    assert.deepEqual(world.interaction.read('cue'), value(3))
    world.dispose()
})

test('a later immediate play outranks a deferred reading request', async () => {
    const { world, turtle } = headlessWorld()
    const old = await world.play(source)
    const oldEnd = assert.rejects(old.finished, reason('superseded'))
    let loser
    world.interaction.subscribe('cue', answer => {
        if (answer.value === 1) loser = assert.rejects(world.play('nope'), reason('superseded'))
    })
    turtle.advance(1000)
    assert.ok(loser)
    const winner = world.play('let cue = 4')
    assert.deepEqual(world.interaction.read('cue'), value(4), 'ordinary entry stays synchronous')
    await (await winner).finished
    await Promise.all([loser, oldEnd])
    world.dispose()
})

test('disposal revokes a deferred play before any seating', async () => {
    const { world, turtle } = headlessWorld()
    const old = await world.play(source)
    const oldEnd = assert.rejects(old.finished, reason('disposed'))
    let dropped
    world.interaction.subscribe('cue', answer => {
        if (answer.value === 1) dropped = assert.rejects(world.play('let cue = 5'), reason('disposed'))
    })
    turtle.advance(1000)
    assert.ok(dropped)
    world.dispose()
    await Promise.all([dropped, oldEnd])
    assert.equal(turtle.scheduler.root.children.has('host'), false)
})

test('a deferred replacement still reports its own wound', async () => {
    const { world, turtle } = headlessWorld()
    const old = await world.play(source)
    const oldEnd = assert.rejects(old.finished, reason('superseded'))
    let refused
    world.interaction.subscribe('cue', answer => {
        if (answer.value === 1) refused = assert.rejects(world.play('nope'), error =>
            error.reason === 'fatal' && error.wound.span.line === 1)
    })
    turtle.advance(1000)
    assert.ok(refused)
    await Promise.all([refused, oldEnd])
    world.dispose()
})
