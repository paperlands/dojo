// world.view.fit() is a request-only framing door: a boolean, never a pose.
// Run with: node --test test/js/host/view_fit_test.mjs
// (id:host-embedding-slice-1-view)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { headlessWorld } from './harness.mjs'

describe('world.view.fit', () => {
    test('delegates to the native centre once and answers true when it applied', async () => {
        const { world, turtle } = headlessWorld({})
        await (await world.play('fw 1')).finished
        let calls = 0
        turtle.fit = () => { calls++; return { position: [0, 0, 500], target: [0, 0, 0] } }
        assert.equal(world.view.fit(), true)
        assert.equal(calls, 1)
        assert.deepEqual(Object.keys(world.view).sort(), ['fit', 'project', 'snapshot', 'unproject'])
    })

    test('answers false when the native centre finds no framed target', async () => {
        const { world, turtle } = headlessWorld({})
        await (await world.play('fw 1')).finished
        turtle.fit = () => null
        assert.equal(world.view.fit(), false)
    })

    test('answers false before a scene and never calls the centre after disposal', async () => {
        const { world, turtle } = headlessWorld({})
        let calls = 0, framed = null
        turtle.fit = () => { calls++; return framed }
        assert.equal(world.view.fit(), false, 'the centre finds no targets before a scene')
        assert.equal(calls, 1, 'the centre is the one that says no')
        framed = { position: [0, 0, 500], target: [0, 0, 0] }
        assert.equal(world.view.fit(), true)
        world.dispose()
        assert.equal(world.view.fit(), false)
        assert.equal(calls, 2, 'after disposal nothing is asked')
    })
})
