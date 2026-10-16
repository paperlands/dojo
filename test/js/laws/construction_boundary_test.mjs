// A private construction cannot import free world authority; explicit participant inputs
// admit scoped requests without replacing the participants or their original laws.
// (id:being-facets-participant-membrane)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const position = (frame) => frameWorldTransform(frame).position
const messages = (scheduler) => scheduler.errors.map((error) => error.message ?? String(error))

test('a private construction cannot acquire authority over an unpassed outside being', () => {
    const scheduler = buildWorld()
    // The outside being is SOURCED: it owns a body, a subtree and an own-scope law, so
    // preservation is a POSITIVE claim, not an empty-subtree absence. (id:being-facets-p4-rungs)
    const A = scheduler.hotSwapChild('A', fork('A', `let C
let C.x = 1`))
    for (let i = 0; i < 3; i++) scheduler.tick(i * 1000)
    const before = {
        run: A.run,
        incarnation: A.runIncarnation,
        declared: [...A.declared],
        children: [...A.children.keys()],
        laws: scheduler.laws.active().filter((law) => law.scope === A.id).length,
        pose: position(A),
    }
    assert.ok(before.declared.length > 0 && before.children.length > 0 && before.laws > 0,
        'the outside being has a body, subtree and law to preserve')
    const spec = fork('src', `def move target do
  as target do
    fw 1
  end
end
def wrap do
  let out = move A
end
let private = wrap`)
    const src = scheduler.hotSwapChild('src', spec)
    drive(scheduler)
    const out = src.children.get('private')?.children.get('out')
    assert.ok(out, 'the nested private answer exists')
    // The private construction is closed, derived, and owns nothing outside it.
    assert.equal(out.closed, true, 'the answer is a private construction')
    assert.equal(out.profile, 'derived')
    // Forbidden attachment leaves NO partial mutation and PRESERVES the receiver.
    assert.deepEqual(position(A), before.pose, 'the outside being is not moved')
    assert.notEqual(A.closed, true, 'the outside being is not reclassified')
    assert.equal(A.run, before.run, 'the outside being keeps its run')
    assert.equal(A.runIncarnation, before.incarnation, 'the outside being keeps its run episode')
    assert.deepEqual([...A.declared], before.declared, 'the outside being keeps its source declarations')
    assert.deepEqual([...A.children.keys()], before.children, 'the outside being keeps its subtree')
    assert.equal(scheduler.laws.active().filter((law) => law.scope === A.id).length, before.laws,
        'the outside being keeps its own-scope law')
    assert.ok(messages(scheduler).some((message) => /closed region has no outside receiver/.test(message)),
        'the forbidden attachment is refused')
})

test('internal attachment inside a closed construction is permitted', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `def wrap target do
  let inner
  as inner do
    fw 1
  end
end
let A
wrap A`))
    drive(scheduler)
    const A = host.children.get('A'), inner = host.children.get('inner')
    assert.ok(A && inner, 'the outside being and the internal receiver exist')
    assert.deepEqual(position(A), [0, 0, 0], 'the outside being is untouched by an internal attachment')
    assert.deepEqual(position(inner), [1, 0, 0], 'the internal receiver actually moved')
    assert.deepEqual(messages(scheduler), [], 'no refusal: attachment inside the region is permitted')
})
