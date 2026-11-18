// Explicit participants cross the declaration membrane by retained identity; free world
// access does not. Facets and receiver requests keep their existing admission boundaries.
// (id:being-facets-participant-membrane)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, delayedResponder, settle } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const at = frame => frameWorldTransform(frame).position.map(n => +n.toFixed(6))
const messages = scheduler => scheduler.errors.map(e => e.message)
const labels = trace => [...trace.values()].flat().filter(e => e.type === 'label').map(e => e.text)

function run(source, ticks = 60) {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', source))
    const trace = drive(scheduler, { maxTicks: ticks })
    return { scheduler, host, trace }
}

const HUNT = `def hunt prey predator do
  as predator do
    loop 100 do
      faceto prey
      fw 2
      wait 1
    end
  end
end`

test('the original pursuit declaration encounters the original participants', () => {
    const { scheduler, host, trace } = run(`def hunt prey predator do
  as predator do
    loop 360 do
      faceto prey
      fw 2
      wait 1/24
    end
  end
end
as rabbit do
  loop 360 do
    fw 5
    rt 1
    label rabbit 0.1
    wait 1/24
  end
end
let fox
let hunting = hunt rabbit fox`, 2000)
    const rabbit = host.children.get('rabbit')
    const fox = host.children.get('fox')
    const hunting = host.children.get('hunting')
    const [record] = scheduler.installationsOf(hunting)
    assert.equal(scheduler.done, true)
    assert.deepEqual(messages(scheduler), [])
    assert.equal(hunting.closed, true)
    assert.equal(hunting.profile, 'derived')
    assert.equal(record.receiver, fox)
    assert.notEqual(record.frame, fox)
    assert.deepEqual(at(hunting), [0, 0, 0])
    assert.notDeepEqual(at(fox), [0, 0, 0])
    assert.equal(scheduler.registry.get(rabbit.id), rabbit)
    assert.equal(labels(trace).length, 360)
})

test('one question answers a supplied participant from its boundary across wait joints', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    scheduler.hotSwapChild('host', fork('host', `as rabbit do
  fw 5
  wait 1
  fw 5
  wait 1
end
def read subject do
  label subject
  wait 1
  label subject.position
end
let answer = read rabbit`))
    const labels = []
    for (let i = 0; i < 12 && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) {
            for (const e of frame.channel.drain()) {
                if (e.type === 'label') labels.push({ run: frame.runIncarnation, text: e.text })
            }
        }
    }
    assert.deepEqual(messages(scheduler), [])
    const first = labels.filter((l) => l.run === 1).map((l) => l.text)
    const later = labels.filter((l) => l.run > 1).map((l) => l.text)
    // One question never mixes captures: every read it makes answers the boundary value.
    assert.ok(first.length > 0 && first.every((t) => t === '[5, 0, 0]'), JSON.stringify(labels))
    // The participant's later motion explicitly supersedes into a fresh run.
    assert.ok(later.length > 0 && later.every((t) => t === '[10, 0, 0]'), JSON.stringify(labels))
})

test('a passed receiver keeps its original law gate and source', () => {
    const { scheduler, host } = run(`let rabbit
let rabbit.y = 5
let fox
let fox.x = 0
def move prey target do
  as target do
    faceto prey
    fw 2
  end
end
let venture = move rabbit fox`)
    const fox = host.children.get('fox')
    const venture = host.children.get('venture')
    assert.deepEqual(messages(scheduler), [])
    assert.deepEqual(at(fox), [0, 2, 0])
    assert.ok(scheduler.laws.active().some(law => law.endpoints?.includes(fox.id)))
    assert.equal(scheduler.installationsOf(venture)[0].receiver, fox)
    assert.equal(fox.closed, undefined)
})

test('a free outside read and receiver are not imported by world lookup', () => {
    const { scheduler, host } = run(`let rabbit
let rabbit.y = 5
let fox
def read do
  faceto rabbit
end
def move do
  as fox do
    fw 2
  end
end
let reading = read
let moving = move`)
    assert.ok(messages(scheduler).some(m => /closed region has no world read/.test(m)))
    assert.deepEqual(at(host.children.get('moving').children.get('fox')), [2, 0, 0])
    assert.deepEqual(at(host.children.get('fox')), [0, 0, 0])
    assert.equal(scheduler.installationsOf(host.children.get('moving')).length, 0)
})

test('a nested declaration cannot launder a free outside participant', () => {
    const { scheduler, host } = run(`let fox
def move target do
  as target do
    fw 2
  end
end
def wrap do
  let nested = move fox
end
let out = wrap`)
    assert.ok(messages(scheduler).some(m => /closed region has no outside receiver/.test(m)))
    assert.deepEqual(at(host.children.get('fox')), [0, 0, 0])
})

test('a nearer namesake does not redirect a passed participant or its requests', () => {
    const { scheduler, host } = run(`let fox
def move target do
  let fox
  let fox.y = 99
  as target do
    fw 2
  end
end
let venture = move fox`)
    const fox = host.children.get('fox')
    const venture = host.children.get('venture')
    assert.deepEqual(messages(scheduler), [])
    assert.deepEqual(at(fox), [2, 0, 0])
    assert.deepEqual(at(venture.children.get('fox')), [0, 99, 0])
    assert.equal(scheduler.installationsOf(venture)[0].receiver, fox)
})

test('a passed retired identity is not replaced by its namesake', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const rabbit = scheduler.hotSwapChild('rabbit', fork('rabbit', 'fw 5\nwait 100'))
    scheduler.hotSwapChild('source', fork('source', `def read subject do
  label subject
  wait 1
  label subject
end
let answer = read rabbit`))
    drive(scheduler, { maxTicks: 1 })
    scheduler.removeChild('rabbit')
    const namesake = scheduler.hotSwapChild('rabbit', fork('rabbit', 'fw 99\nwait 100'))
    assert.notEqual(namesake, rabbit)
    const trace = drive(scheduler, { maxTicks: 5 })
    assert.ok(messages(scheduler).some(m => /retired subject: rabbit/.test(m)))
    assert.equal(labels(trace).includes('[99, 0, 0]'), false)
})

test('withdrawing a declared interaction stops its active requests, not its participants', () => {
    const { scheduler, host } = run(`let rabbit
let rabbit.y = 5
let fox
${HUNT}
let hunting = hunt rabbit fox`, 8)
    const hunting = host.children.get('hunting')
    const fox = host.children.get('fox')
    const rabbit = host.children.get('rabbit')
    const [record] = scheduler.installationsOf(hunting)
    assert.ok(record)
    assert.equal(record.frame.done, false)
    assert.notDeepEqual(at(fox), [0, 0, 0])
    const frozen = at(fox)
    assert.equal(scheduler.retireInstallation(hunting, record.site), true)
    drive(scheduler, { maxTicks: 40 })
    assert.deepEqual(at(fox), frozen)
    assert.equal(scheduler.registry.get(fox.id), fox)
    assert.equal(scheduler.registry.get(rabbit.id), rabbit)
    assert.deepEqual(messages(scheduler), [])
})

test('source withdrawal revokes a pending cross-membrane publication', async () => {
    const responder = delayedResponder()
    const scheduler = buildWorld({ breathEvery: 0, admitAsync: responder.admit })
    const fox = scheduler.hotSwapChild('fox', fork('fox', ''))
    const source = fork('source', `def move target do
  as target do
    fw 2
  end
end
let venture = move fox`)
    source.env.scope.fox = fox
    scheduler.hotSwapChild('source', source)
    drive(scheduler, { maxTicks: 3 })
    assert.equal(responder.calls.length, 1)
    scheduler.removeChild('source')
    responder.calls[0].resolve({ accepted: true, transform: responder.calls[0].request.requested })
    await settle()
    drive(scheduler, { maxTicks: 5 })
    assert.deepEqual(at(fox), [0, 0, 0])
    assert.equal(scheduler.registry.get(fox.id), fox)
})

test('a passed receiver request cannot bypass its original coordinate law', () => {
    const { scheduler, host } = run(`let fox
let fox.x = 0
def move target do
  as target do
    fw 2
  end
end
let venture = move fox`)
    const fox = host.children.get('fox')
    assert.equal(scheduler.installationsOf(host.children.get('venture'))[0].receiver, fox)
    assert.deepEqual(at(fox), [0, 0, 0])
    assert.ok(scheduler.laws.active().some(law => law.endpoints?.includes(fox.id)))
})

test('a changed scalar input replaces the run while retaining the participant address', () => {
    const scheduler = buildWorld({ breathEvery: 0, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const fox = scheduler.hotSwapChild('fox', fork('fox', ''))
    const driver = scheduler.hotSwapChild('driver', fork('driver', 'fw 1'))
    drive(scheduler, { maxTicks: 3 })
    const source = fork('source', `def move target amount do
  as target do
    loop 100 do
      fw amount
      wait 1
    end
  end
end
let venture = move fox driver.x`)
    source.env.scope.fox = fox
    const host = scheduler.hotSwapChild('source', source)
    drive(scheduler, { maxTicks: 1 })
    const venture = host.children.get('venture')
    const [old] = scheduler.installationsOf(venture)
    assert.equal(old.frame.done, false)
    const before = at(fox)
    const verdict = scheduler.requestMotion(driver,
        { rotation: driver.transform.deref().rotation, position: [2, 0, 0] }, scheduler.motionRevision)
    assert.equal(verdict.kind, 'accept')
    scheduler.readouts.recompute()
    scheduler.readouts.drain()
    drive(scheduler, { maxTicks: 1 })
    const [current] = scheduler.installationsOf(venture)
    assert.notEqual(current, old)
    assert.equal(current.receiver, fox)
    assert.equal(scheduler.registry.has(old.frame.id), false)
    assert.deepEqual(at(fox), [before[0] + 2, 0, 0])
    assert.deepEqual(messages(scheduler), [])
})

test('implicit and explicit positional requests share the moving-participant observation', () => {
    const positions = []
    for (const input of ['prey', 'prey.position', 'prey.x prey.y prey.z']) {
        const { scheduler, host } = run(`as rabbit do
  loop 6 do
    fw 5
    rt 17
    wait 1/24
  end
end
let fox
def hunt prey predator do
  as predator do
    loop 6 do
      faceto ${input}
      fw 2
      wait 1/24
    end
  end
end
let hunting = hunt rabbit fox`)
        assert.deepEqual(messages(scheduler), [], input)
        positions.push(at(host.children.get('fox')))
    }
    assert.deepEqual(positions[0], positions[1])
    assert.deepEqual(positions[0], positions[2])
})
