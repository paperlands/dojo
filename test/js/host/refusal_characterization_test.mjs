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
})
