// Input revision scopes govern continuations, rebuilds and delayed delivery together.
// (id:execution-input-revisions)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, delayedResponder, settle } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const position = frame => frameWorldTransform(frame).position
const accept = ({ requested }) => ({ accepted: true, transform: requested })
const source = `def move target do
  as target do
    fw 3
    wait 1
  end
end
let fox
let moving = move fox`

function fixture({ async = false, code = source, validate } = {}) {
    const responder = delayedResponder()
    const scheduler = buildWorld({ breathEvery: 0, admit: accept, validate,
        ...(async ? { admitAsync: responder.admit } : {}) })
    const host = scheduler.hotSwapChild('host', fork('host', code))
    let now = 0
    const drain = () => {
        for (const frame of scheduler.registry.values()) frame.channel.drain()
        scheduler.readouts.drain()
    }
    const pump = (count = 10) => {
        for (let i = 0; i < count; i++) { now += 100; scheduler.tick(now); drain() }
    }
    pump(2)
    const fox = host.children.get('fox'), owner = host.children.get('moving')
    const move = xyz => assert.equal(scheduler.requestMotion(fox,
        { ...fox.transform.deref(), position: xyz }, scheduler.motionRevision).kind, 'accept')
    return { scheduler, host, fox, owner, responder, drain, pump, move }
}

test('a deferred async reply cannot publish; unchanged input resumes the same run on close', async () => {
    const w = fixture({ async: true }), run = w.owner.runIncarnation
    assert.equal(w.responder.calls.length, 1)
    const close = w.scheduler.defer(w.fox)
    w.responder.calls[0].resolve(accept(w.responder.calls[0].request))
    await settle()
    assert.deepEqual(position(w.fox), [0, 0, 0], 'a reply is not a publication permission')
    w.pump()
    assert.deepEqual(position(w.fox), [0, 0, 0])
    close()
    w.pump()
    assert.equal(w.owner.runIncarnation, run, 'equal demand preserves the continuation')
    assert.deepEqual(position(w.fox), [3, 0, 0])
    assert.deepEqual(w.scheduler.errors, [])
})

test('closing changed input replaces before delivering an old ready reply', async () => {
    const w = fixture({ async: true }), run = w.owner.runIncarnation
    const close = w.scheduler.defer(w.fox)
    w.move([100, 50, 0])
    w.responder.calls[0].resolve(accept(w.responder.calls[0].request))
    await settle()
    assert.deepEqual(position(w.fox), [100, 50, 0])
    close()
    assert.equal(w.owner.runIncarnation, run + 1)
    w.pump()
    assert.deepEqual(position(w.fox), [100, 50, 0], 'retired delivery cannot overwrite the input')
    assert.equal(w.responder.calls.length, 2)
    const fresh = w.responder.calls[1]
    assert.deepEqual(fresh.request.from.position, [100, 50, 0])
    fresh.resolve(accept(fresh.request))
    await settle()
    w.pump()
    assert.deepEqual(position(w.fox), [103, 50, 0])
    assert.deepEqual(w.scheduler.errors, [])
})

test('overlapping revision scopes keep the latest rebuild pending until the last close', () => {
    const w = fixture(), run = w.owner.runIncarnation
    assert.equal(w.scheduler.defer(undefined)(), false, 'an absent input has no execution lifetime')
    assert.equal(w.scheduler.defer(null)(), false)
    const first = w.scheduler.defer(w.fox), second = w.scheduler.defer(w.fox)
    w.move([100, 50, 0])
    first()
    w.pump()
    assert.equal(w.owner.runIncarnation, run)
    assert.deepEqual(position(w.fox), [100, 50, 0])
    second()
    assert.equal(w.owner.runIncarnation, run + 1)
    w.pump()
    assert.deepEqual(position(w.fox), [103, 50, 0])
    assert.equal(first(), false)
    assert.deepEqual(w.scheduler.errors, [])
})

test('retirement while deferred cannot revive a successor or deliver an old reply', async () => {
    const w = fixture({ async: true }), close = w.scheduler.defer(w.fox)
    w.move([100, 50, 0])
    const next = w.scheduler.hotSwapChild('host', fork('host', 'let fox\nas fox do\n  fw 7\nend'))
    w.responder.calls[0].resolve(accept(w.responder.calls[0].request))
    await settle()
    close()
    w.pump()
    const fox = next.children.get('fox'), fresh = w.responder.calls.at(-1)
    assert.notEqual(fox, w.fox)
    assert.deepEqual(position(fox), [0, 0, 0])
    fresh.resolve(accept(fresh.request))
    await settle()
    w.pump()
    assert.deepEqual(position(fox), [7, 0, 0])
    assert.deepEqual(position(w.fox), [100, 50, 0])
    assert.deepEqual(w.scheduler.errors, [])
})

test('nested receiver input belongs to the owning realization, not an unobserved frame map', () => {
    const w = fixture({ code: `def move anchor target do
  as anchor do
    as target do
      fw 3
      wait 1
    end
  end
end
let anchor
let fox
let moving = move anchor fox` })
    const run = w.owner.runIncarnation, close = w.scheduler.defer(w.fox)
    w.move([100, 50, 0])
    w.pump()
    assert.equal(w.owner.runIncarnation, run)
    close()
    assert.equal(w.owner.runIncarnation, run + 1, 'the governing question owns nested receiver demand')
    w.pump()
    assert.deepEqual(position(w.fox), [103, 50, 0])
    assert.deepEqual(w.scheduler.errors, [])
})

test('observations still follow intermediate accepted input without executing its realization', () => {
    const w = fixture({ code: source + '\nlet observed = fox.x' })
    const run = w.owner.runIncarnation, close = w.scheduler.defer(w.fox)
    w.move([100, 50, 0])
    w.pump()
    assert.equal(w.owner.runIncarnation, run)
    assert.deepEqual(w.scheduler.readScalar('observed'), { kind: 'value', value: 100 })
    close()
    w.pump()
    assert.deepEqual(w.scheduler.readScalar('observed'), { kind: 'value', value: 103 })
    assert.deepEqual(w.scheduler.errors, [])
})

test('an independently named nested realization retains its own question authority', () => {
    const w = fixture({ code: `def step target do
  as target do
    fw 3
    wait 1
  end
end
def move target do
  let inner = step target
end
let fox
let moving = move fox` })
    const outerRun = w.owner.runIncarnation, inner = w.owner.children.get('inner')
    const run = inner.runIncarnation, close = w.scheduler.defer(w.fox)
    w.move([100, 50, 0])
    w.pump()
    assert.equal(inner.runIncarnation, run)
    close()
    assert.equal(inner.runIncarnation, run + 1)
    assert.equal(w.owner.runIncarnation, outerRun, 'inner demand is not an outer expression read')
    w.pump()
    assert.deepEqual(position(w.fox), [103, 50, 0])
    assert.deepEqual(w.scheduler.errors, [])
})

test('a revision opened during validation is rechecked at admission delivery', async () => {
    let w, close
    w = fixture({ async: true, validate: () => {
        close ??= w.scheduler.defer(w.fox)
        return true
    } })
    w.responder.calls[0].resolve(accept(w.responder.calls[0].request))
    await settle()
    assert.equal(typeof close, 'function')
    assert.deepEqual(position(w.fox), [0, 0, 0], 'validation cannot grant a stale permission')
    close()
    w.pump()
    assert.deepEqual(position(w.fox), [3, 0, 0])
    assert.deepEqual(w.scheduler.errors, [])
})

test('source replacement retires old work while a live input scope also governs the successor', async () => {
    const responder = delayedResponder()
    const scheduler = buildWorld({ breathEvery: 0, admit: accept, admitAsync: responder.admit })
    const participants = scheduler.hotSwapChild('participants', fork('participants', 'let fox'))
    const fox = participants.children.get('fox')
    const venture = distance => {
        const spec = fork('source', `as target do\n  fw ${distance}\n  wait 1\nend`)
        spec.env.scope.target = fox
        return spec
    }
    scheduler.hotSwapChild('source', venture(3))
    const close = scheduler.defer(fox)
    const next = scheduler.hotSwapChild('source', venture(8))
    responder.calls[0].resolve(accept(responder.calls[0].request))
    await settle()
    let now = 0
    const pump = () => {
        for (let i = 0; i < 10; i++) {
            scheduler.tick(now += 100)
            for (const frame of scheduler.registry.values()) frame.channel.drain()
            scheduler.readouts.drain()
        }
    }
    pump()
    assert.deepEqual(position(fox), [0, 0, 0])
    assert.equal(responder.calls.length, 1, 'successor execution waits on the same input scope')
    close()
    pump()
    assert.equal(responder.calls.length, 2)
    assert.equal(scheduler.installationsOf(next).length, 1)
    responder.calls[1].resolve(accept(responder.calls[1].request))
    await settle()
    pump()
    assert.deepEqual(position(fox), [8, 0, 0], 'only the current source can publish')
    assert.deepEqual(scheduler.errors, [])
})
