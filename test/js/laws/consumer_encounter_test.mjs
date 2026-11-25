// Consumer-owned encounters. An ordinary recipe receives supplied values unchanged,
// encounters participants through existing doors, and the CONSUMER decides whether it
// needs a position, an identity or another facet. Neither argument passing nor message
// delivery grants mutation authority. (id:being-facets-p4-sequence)
//
// Receiver-law admission and retired participants are already fenced in
// installation_life_test.mjs and subject_binding_test.mjs. This file earns the two
// boundaries that had no standing fence — positional-value construction and
// identity-preserving message delivery — plus withdrawal while the installation is still
// executing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const at = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(6))
const pass = ({ requested }) => ({ accepted: true, transform: requested })
const installationsOf = (scheduler, frame) => scheduler.installationsOf(frame)

function run(source, { ticks = 60, opts = {} } = {}) {
    const scheduler = buildWorld({ admit: pass, breathEvery: 0, ...opts })
    const host = scheduler.hotSwapChild('host', fork('host', source))
    const trace = drive(scheduler, { maxTicks: ticks })
    return { scheduler, host, trace }
}

test('a private construction takes supplied positional values and moves no participant', () => {
    const { scheduler, host } = run(`let rabbit
let rabbit.y = 5
let rabbit.z = 0
let fox
let fox.x = 3
let fox.z = 0
def aim start destination do
  goto start
  faceto destination
  fw 2
end
let out = aim fox.position rabbit.position`)
    const out = host.children.get('out')
    const fox = host.children.get('fox')
    const rabbit = host.children.get('rabbit')
    // The answer is fox's SUPPLIED position, aimed at rabbit's SUPPLIED position, stepped
    // two — a positional interpretation, not merely movement away from the origin.
    const dx = 0 - 3, dy = 5 - 0
    const len = Math.hypot(dx, dy)
    const expected = [3 + 2 * dx / len, 0 + 2 * dy / len, 0].map((n) => +n.toFixed(6))
    assert.deepEqual(at(out), expected, 'the answer is fox aimed at rabbit, stepped two')
    assert.deepEqual(at(fox), [3, 0, 0], 'the supplied participant was not moved')
    assert.deepEqual(at(rabbit), [0, 5, 0], 'the destination participant was not moved')
    assert.deepEqual(scheduler.errors.map((e) => e.message), [])
})

test('a message carries the participant by identity past a nearer namesake', () => {
    const { scheduler, host, trace } = run(`let rabbit
let rabbit.y = 5
let rabbit.z = 0
as listener do
  let rabbit
  let rabbit.y = 99
  let rabbit.z = 0
  loop 2 do
    when 'participant' subject do
      label subject 10
      fw 1
    end
    wait 1
  end
end
as sender do
  shout 'participant' rabbit
  wait 1
end`)
    const labels = [...trace.values()].flat().filter((e) => e.type === 'label').map((e) => e.text)
    assert.deepEqual(labels, ['[0, 5, 0]'],
        'the listener read the CARRIED participant, not the nearer namesake at [0, 99, 0]')
    assert.deepEqual(at(host.children.get('listener')), [1, 0, 0], 'the listener acted')
    assert.deepEqual(at(host.children.get('rabbit')), [0, 5, 0], 'the carried participant did not move')
    assert.deepEqual(at(host.children.get('listener').children.get('rabbit')), [0, 99, 0],
        'the nearer namesake was never the answer')
    assert.deepEqual(scheduler.errors.map((e) => e.message), [])
})

test('withdrawal during active execution stops the effect and keeps the participants', () => {
    const { scheduler, host } = run(`let rabbit
let rabbit.y = 5
let rabbit.z = 0
let fox
let fox.x = 0
def hunt prey predator do
  as predator do
    loop 100 do
      faceto prey
      fw 2
      wait 1
    end
  end
end
as hunting do
  hunt rabbit fox
end`, { ticks: 8 })
    const rabbit = host.children.get('rabbit')
    const fox = host.children.get('fox')
    const hunting = host.children.get('hunting')
    const [record] = installationsOf(scheduler, hunting)
    assert.ok(record, 'the installation is seated')
    assert.equal(record.frame.done, false, 'the continuation is still executing')
    assert.notDeepEqual(at(fox), [0, 0, 0], 'the effect has begun')
    const frozen = at(fox)
    assert.equal(scheduler.retireInstallation(hunting, record.site), true, 'the owner withdrew it mid-execution')
    drive(scheduler, { maxTicks: 40 })
    assert.deepEqual(at(fox), frozen, 'no future effect reached the receiver')
    assert.equal(scheduler.registry.get(fox.id), fox, 'the receiver survives')
    assert.equal(scheduler.registry.get(rabbit.id), rabbit, 'the observed participant survives')
})


// Both contexts expose the same encounter door. Only passed participants may cross the
// private membrane; unrelated world reads remain refused.
// (id:being-facets-participant-membrane)

test('a participant inside the construction reaches the facet door and answers', () => {
    const { scheduler, host, trace } = run(`def build seed do
  let inner
  fw seed
  label inner 10
end
let out = build 3`)
    const out = host.children.get('out')
    assert.ok(out.children.get('inner'), 'the construction declares its own participant')
    const labels = [...trace.values()].flat().filter((e) => e.type === 'label').map((e) => e.text)
    assert.equal(labels.length, 1, 'the inside participant answered')
    assert.notEqual(labels[0], 'inner', 'the read reached the facet door, not the spelling')
    assert.match(labels[0], /^\[/, 'the answer is a position')
    assert.deepEqual(scheduler.errors.map((e) => e.message), [])
})

test('an unpassed participant outside the construction meets the containment refusal', () => {
    const { scheduler } = run(`let rabbit
let rabbit.y = 5
let rabbit.z = 0
def peek do
  faceto rabbit
end
let out = peek`)
    assert.ok(scheduler.errors.some((e) => /closed region has no world read/.test(e.message ?? '')),
        'the outside participant is refused by the existing containment policy')
    assert.equal(scheduler.errors.some((e) => /Cannot read properties/.test(e.message ?? '')), false,
        'the refusal is not an undefined-array crash')
})
