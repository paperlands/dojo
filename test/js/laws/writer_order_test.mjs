// Logical time orders writers; equal instants use source hierarchy/order. Admission
// may delay an instant, never let another writer overtake it. (id:being-facets-writer-order)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, nz, settle, delayedResponder } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const position = (frame) => nz(frameWorldTransform(frame).position)
const drain = (scheduler) => {
    for (const frame of scheduler.registry.values()) frame.channel.drain()
}
const pump = (scheduler, now) => {
    for (let n = 0; n < 200; n++) {
        const progress = scheduler.tick(now)
        drain(scheduler)
        if (!progress) return
    }
    assert.fail('the bounded frontier did not settle')
}

function scene(src, options = {}) {
    const attempts = [], acknowledgments = []
    const scheduler = buildWorld({
        ...options,
        admit: options.admit ?? ((request) => {
            attempts.push({ command: request.command, from: [...request.from.position],
                requested: [...request.requested.position] })
            return { accepted: true, transform: request.requested }
        }),
        onShout: (_frame, _name, payload) => acknowledgments.push(payload),
    })
    const host = scheduler.hotSwapChild('host', fork('host', options.hostSource ?? 'let A'))
    drive(scheduler)
    const A = host.children.get('A')
    const source = scheduler.hotSwapChild('src', fork('src', src))
    pump(scheduler, 0)
    assert.deepEqual(position(A), [0, 0, 0], 'neither writer has moved before its wait')
    assert.deepEqual(scheduler.errors, [])
    return { scheduler, A, source, attempts, acknowledgments }
}

const pair = ({ order = ['absolute', 'relative'], waits = [1, 1] } = {}) => `def absolute receiver do
  as receiver do
    wait ${waits[0]}
    goto 10 0
    shout "ack" 1
  end
end
def relative receiver do
  as receiver do
    wait ${waits[1]}
    fw 5
    shout "ack" 2
  end
end
${order.map((name) => `${name} A`).join('\n')}`

for (const [order, commands, expected] of [
    [['absolute', 'relative'], ['goto', 'fw'], 15],
    [['relative', 'absolute'], ['fw', 'goto'], 10],
]) {
    test(`same-instant writers follow reached source order: ${order.join(' then ')}`, () => {
        const { scheduler, A, source, attempts, acknowledgments } = scene(pair({ order }))
        const records = scheduler.installationsOf(source)
        assert.equal(records.length, 2, 'distinct statement sites, not replacement of one slot')
        assert.ok(records.every(({ frame }) => !frame.done && frame.resumeAt === 1000))
        pump(scheduler, 1000)
        assert.deepEqual(attempts.map(({ command }) => command), commands)
        assert.deepEqual(position(A), [expected, 0, 0])
        assert.deepEqual(acknowledgments, order.map((name) => name === 'absolute' ? 1 : 2))
        assert.equal(scheduler.done, true)
        assert.deepEqual(scheduler.errors, [])
    })
}

test('logical time outranks source order even under a wall-clock jump', () => {
    const { scheduler, A, attempts, acknowledgments } = scene(pair({ waits: [2, 1] }))
    pump(scheduler, 9999)
    assert.deepEqual(attempts.map(({ command }) => command), ['fw', 'goto'])
    assert.deepEqual(acknowledgments, [2, 1])
    assert.deepEqual(position(A), [10, 0, 0])
    assert.equal(scheduler.done, true)
    assert.deepEqual(scheduler.errors, [])
})

test('equal-time nested installations run child before parent', () => {
    const { scheduler, A, source, attempts, acknowledgments } = scene(`def attach receiver do
  as receiver do
    as receiver do
      wait 1
      goto 10 0
      shout "ack" 1
    end
    wait 1
    fw 5
    shout "ack" 2
  end
end
attach A`)
    const [outer] = scheduler.installationsOf(source)
    const [inner] = scheduler.installationsOf(outer.frame)
    assert.equal(inner.frame.parent, outer.frame, 'execution hierarchy, not receiver parentage')
    assert.equal(inner.receiver, A)
    assert.equal(outer.receiver, A)
    assert.equal(inner.frame.resumeAt, outer.frame.resumeAt)
    pump(scheduler, 1000)
    assert.deepEqual(attempts.map(({ command }) => command), ['goto', 'fw'])
    assert.deepEqual(acknowledgments, [1, 2])
    assert.deepEqual(position(A), [15, 0, 0])
    assert.deepEqual(scheduler.errors, [])
})

test('pending admission holds writer order rather than letting the next writer prepare', async () => {
    const { calls, admit } = delayedResponder()
    const { scheduler, A, source, acknowledgments } = scene(pair(), { admitAsync: admit })
    pump(scheduler, 1000)
    assert.equal(calls.length, 1, 'only the first ordered writer may prepare')
    assert.equal(calls[0].request.command, 'goto')
    assert.deepEqual(position(A), [0, 0, 0], 'a pending candidate is not published')
    assert.deepEqual(acknowledgments, [])
    pump(scheduler, 9999)
    assert.equal(calls.length, 1, 'a wall-clock jump cannot release the unfinished instant')
    calls[0].resolve({ accepted: true, transform: calls[0].request.requested })
    await settle()
    pump(scheduler, 9999)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].request.from.position, [10, 0, 0], 'the second resumes from accepted reality')
    assert.deepEqual(calls[1].request.requested.position, [15, 0, 0])
    calls[1].resolve({ accepted: true, transform: calls[1].request.requested })
    await settle()
    pump(scheduler, 9999)
    assert.deepEqual(position(A), [15, 0, 0])
    assert.deepEqual(acknowledgments, [1, 2])
    assert.ok(scheduler.installationsOf(source).every(({ frame }) => frame.done))
    assert.deepEqual(scheduler.errors, [])
})

test('an unfinished nested instant outranks an earlier sibling that already yielded', async () => {
    const { calls, admit } = delayedResponder()
    const { scheduler, A, source, acknowledgments } = scene(`def relative receiver do
  as receiver do
    wait 1
    yield
    fw 5
    shout "ack" 2
  end
end
def absolute receiver do
  as receiver do
    wait 1
    goto 10 0
    shout "ack" 1
  end
end
as early do
  relative A
end
as later do
  absolute A
end`, { admitAsync: admit })
    const [early] = scheduler.installationsOf(source.children.get('early'))
    const [later] = scheduler.installationsOf(source.children.get('later'))
    assert.equal(early.frame.resumeAt, later.frame.resumeAt)
    scheduler.tick(1000)
    drain(scheduler)
    assert.equal(calls.length, 1, 'yield permits the later subtree to open its instant')
    assert.equal(calls[0].request.command, 'goto')
    assert.equal(later.frame.midInstant, true, 'the nested writer now owns the unfinished instant')
    pump(scheduler, 9999)
    assert.equal(calls.length, 1, 'the earlier subtree cannot overtake that owner on the next tick')
    calls[0].resolve({ accepted: true, transform: calls[0].request.requested })
    await settle()
    pump(scheduler, 9999)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].request.from.position, [0, 0, 0], 'yield is not a wait-joint refresh')
    calls[1].resolve({ accepted: true, transform: calls[1].request.requested })
    await settle()
    pump(scheduler, 9999)
    assert.deepEqual(acknowledgments, [1, 2], 'the current instant finishes before the yielded sibling resumes')
    assert.deepEqual(position(A), [5, 0, 0], 'the new gated proposal uses its retained cursor after yield')
    assert.deepEqual(scheduler.errors, [])
})

test('mixed execution edges retain reached source order, not storage-kind order', () => {
    const { scheduler, A, source, attempts, acknowledgments } = scene(`def absolute receiver do
  as receiver do
    wait 1
    goto 10 0
    shout "ack" 1
  end
end
def relative receiver do
  as receiver do
    wait 1
    fw 5
    shout "ack" 2
  end
end
absolute A
as later do
  relative A
end`)
    const [first] = scheduler.installationsOf(source)
    const [second] = scheduler.installationsOf(source.children.get('later'))
    assert.equal(first.receiver, second.receiver)
    assert.equal(first.frame.resumeAt, second.frame.resumeAt)
    pump(scheduler, 1000)
    assert.deepEqual(attempts.map(({ command }) => command), ['goto', 'fw'])
    assert.deepEqual(acknowledgments, [1, 2])
    assert.deepEqual(position(A), [15, 0, 0])
    assert.deepEqual(scheduler.errors, [])
})

test('registry insertion order is not writer authority', () => {
    const { scheduler, A, attempts } = scene(pair())
    const entries = [...scheduler.registry.entries()].reverse()
    scheduler.registry.clear()
    for (const [id, frame] of entries) scheduler.registry.set(id, frame)
    pump(scheduler, 9999)
    assert.deepEqual(attempts.map(({ command }) => command), ['goto', 'fw'])
    assert.deepEqual(position(A), [15, 0, 0])
    assert.deepEqual(scheduler.errors, [])
})

test('same-slot replacement keeps its place among mixed execution siblings', () => {
    const { scheduler, A, source, attempts, acknowledgments } = scene(`def absolute receiver duration do
  as receiver do
    wait duration
    goto 10 0
    shout "ack" 1
  end
end
def relative receiver do
  as receiver do
    wait 2
    fw 5
    shout "ack" 2
  end
end
absolute A 2
as later do
  relative A
end
wait 1
absolute A 1`)
    const [old] = scheduler.installationsOf(source)
    const [sibling] = scheduler.installationsOf(source.children.get('later'))
    pump(scheduler, 1000)
    const [current] = scheduler.installationsOf(source)
    assert.notEqual(current, old)
    assert.equal(scheduler.registry.has(old.frame.id), false, 'the replaced continuation is gone')
    assert.equal(current.frame.resumeAt, sibling.frame.resumeAt, 'replacement and sibling are tied at 2000')
    pump(scheduler, 2000)
    assert.deepEqual(attempts.map(({ command }) => command), ['goto', 'fw'])
    assert.deepEqual(acknowledgments, [1, 2], 'only the new occupant and its sibling complete')
    assert.deepEqual(position(A), [15, 0, 0])
    assert.deepEqual(scheduler.errors, [])
})

test('retiring the pending writer releases its sibling without accepting old work', async () => {
    const { calls, admit } = delayedResponder()
    const { scheduler, A, source, acknowledgments } = scene(pair(), { admitAsync: admit })
    pump(scheduler, 1000)
    assert.equal(calls.length, 1)
    const [first, second] = scheduler.installationsOf(source)
    assert.equal(scheduler.retireOccupant(first), true)
    calls[0].resolve({ accepted: true, transform: calls[0].request.requested })
    await settle()
    assert.deepEqual(position(A), [0, 0, 0], 'retired work has no publication rights')
    pump(scheduler, 1000)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].request.requested.position, [5, 0, 0])
    calls[1].resolve({ accepted: true, transform: calls[1].request.requested })
    await settle()
    pump(scheduler, 1000)
    assert.deepEqual(acknowledgments, [2])
    assert.equal(second.frame.done, true, 'independent ownership survives selective retirement')
    assert.deepEqual(position(A), [5, 0, 0])
    assert.deepEqual(scheduler.errors, [])
})

test('writer order does not override original laws or turn refusal into blanket non-admission', () => {
    const { scheduler, A, attempts, acknowledgments } = scene(pair().replace('goto 10 0', 'goto 10 1'),
        { hostSource: 'let A\nlet A.y = 0' })
    const laws = [...scheduler.laws.active()]
    assert.ok(laws.some((law) => law.endpoints.includes(A.id)), 'the original receiver law is present')
    pump(scheduler, 1000)
    assert.deepEqual(attempts.map(({ command }) => command), ['goto', 'fw'])
    assert.deepEqual(attempts[0].requested, [10, 1, 0], 'the first really proposes a forbidden movement')
    assert.deepEqual(attempts[1].from, [0, 0, 0], 'the refused candidate never becomes accepted reality')
    assert.deepEqual(position(A), [5, 0, 0], 'the permitted sibling still moves')
    assert.deepEqual(acknowledgments, [1, 2])
    assert.deepEqual(scheduler.laws.active(), laws, 'order grants no authority to retract a law')
    assert.deepEqual(scheduler.errors, [])
})
