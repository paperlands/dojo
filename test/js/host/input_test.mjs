// Invalid input policy must fail before a Turtle or WebGL context exists.
// Accepted policy is detached from the caller; real controls own wheel admission.
// (id:host-input-wheel)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { Turtle, headlessWorld } from './harness.mjs'

describe('the option is refused, not absorbed', () => {
    test('a misspelt wheel policy never constructs a turtle', () => {
        const before = Turtle.instances.length
        assert.throws(() => headlessWorld({ input: { wheel: 'modifer' } }),
            /input\.wheel must be one of always, modifier, none/)
        assert.throws(() => headlessWorld({ input: { wheel: 1 } }), TypeError)
        assert.equal(Turtle.instances.length, before,
            'a refused policy must fail before the stage exists — no turtle, no canvas, no context')
    })

    test('an unsupported input key is refused rather than read as an offer', () => {
        const before = Turtle.instances.length
        assert.throws(() => headlessWorld({ input: { orbit: false } }), /input\.orbit is not supported/)
        assert.throws(() => headlessWorld({ input: { wheel: 'modifier', pan: true } }),
            /input\.pan is not supported/)
        assert.throws(() => headlessWorld({ input: 'modifier' }), /input must be an options object/)
        assert.equal(Turtle.instances.length, before)
    })
})

describe('the policy that is accepted', () => {
    test('the default is the frozen today-policy, and it reaches the turtle', () => {
        const { world, turtle } = headlessWorld()
        assert.deepEqual(turtle.options.input, { wheel: 'always' })
        assert.ok(Object.isFrozen(turtle.options.input))
        world.dispose()
    })

    test('an accepted mode arrives as one frozen primitive, not the caller object', () => {
        const caller = { wheel: 'modifier' }
        const { world, turtle } = headlessWorld({ input: caller })
        assert.notEqual(turtle.options.input, caller, 'the caller keeps no handle on live policy')
        assert.deepEqual(turtle.options.input, { wheel: 'modifier' })
        assert.ok(Object.isFrozen(turtle.options.input))
        caller.wheel = 'none'
        assert.equal(turtle.options.input.wheel, 'modifier')
        world.dispose()
    })

    test('the policy is inert: a play is unaffected by it', async () => {
        const { world } = headlessWorld({ input: { wheel: 'none' } })
        const run = await world.play('let s = 1')
        await run.finished
        assert.deepEqual(world.interaction.read('s'), { kind: 'value', value: 1 })
        world.dispose()
    })
})
