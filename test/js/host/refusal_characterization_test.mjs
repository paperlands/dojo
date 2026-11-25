// Legacy characterization: a refused play can replace the seat and retire rights.
// Forgiving prefix admission is current scheduler behavior, not a D030 promise.
// New prepared-presentation semantics must change these deliberately. (id:host-runtime-play)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { headlessWorld } from './harness.mjs'

const value = v => ({ kind: 'value', value: v })

describe('legacy: a refused play has already replaced the seat', () => {
    test('the accepted prefix of the refused source is live; earlier bindings are gone', async () => {
        const { world } = headlessWorld()
        await (await world.play('let s = 3\nlet A')).finished
        assert.deepEqual(world.interaction.read('s'), value(3))
        assert.deepEqual(world.interaction.read(['host', 'A'], 'x'), value(0))

        // Line 2 does not parse. The first line still takes effect.
        await assert.rejects(world.play('let s = 4\nlet Broken = ('), error => {
            assert.equal(error.reason, 'fatal')
            assert.ok(error.wound, 'a refusal carries the wound that caused it')
            return true
        })

        assert.deepEqual(world.interaction.read('s'), value(4),
            'the refused program was not rolled back')
        assert.deepEqual(world.interaction.read(['host', 'A'], 'x'), { kind: 'missing' },
            'a binding the refused source never reached is not restored from the previous run')
        world.dispose()
    })

    test('a live run is superseded, and its subscription retired, before refusal is known', async () => {
        const { world } = headlessWorld()
        // `wait` keeps the first run walking, so "superseded" is observable at all.
        const first = await world.play('let s = 3\nwait 1')
        const deliveries = []
        world.interaction.subscribe('s', answer => deliveries.push(answer))
        const ended = first.finished.then(() => 'settled', error => error.reason)

        await assert.rejects(world.play('let s = 4\nlet Broken = ('), /did not parse|expected/)

        assert.equal(await ended, 'superseded',
            'delivery rights are retired by attempting a play, not by accepting one')
        assert.deepEqual(deliveries, [value(3)],
            'the previous subscription heard its last value and nothing from the refused source')
        world.dispose()
    })

    test('refusal is reported, not swallowed: the caller sees a refusal, not a run', async () => {
        const { world } = headlessWorld()
        await (await world.play('let s = 1')).finished
        let threw = null
        try { await world.play('let s = 2\nlet Broken = (') } catch (error) { threw = error }
        assert.ok(threw, 'a refused play must throw')
        assert.equal(threw.reason, 'fatal')
        assert.equal(typeof threw.wound?.message, 'string')
        world.dispose()
    })

    test('a syntax-only refusal still replaces the seat and keeps no prefix', async () => {
        const { world } = headlessWorld()
        const first = await world.play('let s = 3\nwait 30')
        const ended = first.finished.then(() => 'settled', error => error.reason)
        await assert.rejects(world.play('let Broken = ('), error => {
            assert.equal(error.reason, 'fatal')
            assert.equal(error.wound.kind, 'parse')
            return true
        })
        assert.equal(await ended, 'superseded')
        assert.deepEqual(world.interaction.read('s'), { kind: 'missing' })
        world.dispose()
    })

    test('a parsed call wound keeps the prefix and still refuses before a run exists', async () => {
        const { world } = headlessWorld()
        const first = await world.play('let s = 3\nwait 30')
        const ended = first.finished.then(() => 'settled', error => error.reason)
        // `nope` is a Call. parseProgram does not refuse it.
        await assert.rejects(world.play('let s = 4\nnope'), error => {
            assert.equal(error.reason, 'fatal')
            assert.equal(error.wound.kind, 'walk')
            return true
        })
        assert.equal(await ended, 'superseded')
        assert.deepEqual(world.interaction.read('s'), value(4))
        world.dispose()
    })

    test('a wound behind a wait is accepted, then fatal on the new run', async () => {
        const { world, turtle } = headlessWorld()
        const first = await world.play('let s = 3\nwait 30')
        const ended = first.finished.then(() => 'settled', error => error.reason)
        const run = await world.play('wait 0.01\nnope')
        assert.equal(await ended, 'superseded', 'the old run dies at the attempt, before the later wound')
        turtle.advance(1000)
        await assert.rejects(run.finished, error => {
            assert.equal(error.reason, 'fatal')
            assert.equal(error.wound.kind, 'walk')
            return true
        })
        world.dispose()
    })
})
