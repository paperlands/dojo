// Probe law facts are owned plain data: canonical fields only, detached and frozen.
// The law store, truth, gates and publication are never changed by observation.
// Run: node --test test/js/laws/law_observation_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { attachProbe } from '../../../assets/js/turtling/probe.js'
import { frameWorldTransform, lawWorld } from '../../../assets/js/turtling/scheduler.js'
import { lawViolation } from '../../../assets/js/turtling/laws/verdict.js'

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const lawKeys = ['address', 'feature', 'relation', 'endpoints', 'scope', 'frame', 'predicate',
    'owner', 'expression', 'kind', 'guards', 'bounds', 'sourceIds']

function seat() {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', 'let A\nlet B\nas B do\n  let A.distance = 5\nend'))
    drive(scheduler, { maxTicks: 10 })
    const previous = globalThis.window
    globalThis.window = {}
    attachProbe({ scheduler, _stateOf: () => null }, { orderOf: () => null })
    const read = () => globalThis.window.__probe.read()
    const restore = () => {
        if (previous === undefined) delete globalThis.window
        else globalThis.window = previous
    }
    return { scheduler, host, read, restore }
}
const gate = (scheduler) => lawViolation(scheduler.laws.active(), new Map(), scheduler.registry, lawWorld)

test('law metadata is detached and frozen; observer edits never reach the store', () => {
    const ctx = seat()
    try {
        const observed = ctx.read().laws[0]
        const original = ctx.scheduler.laws.active()[0]
        assert.notEqual(observed, original)
        for (const key of ['owner', 'guards', 'bounds', 'sourceIds', 'expression', 'endpoints'])
            assert.notEqual(observed[key], original[key], `${key} is detached`)
        for (const key of ['owner', 'guards', 'bounds', 'sourceIds', 'expression', 'endpoints'])
            assert.ok(Object.isFrozen(observed[key]), `${key} is frozen`)
        const before = { gate: gate(ctx.scheduler), rev: ctx.scheduler.motionRevision,
            config: ctx.scheduler.root._configurationRevision,
            owner: { ...original.owner }, sourceIds: [...original.sourceIds] }
        assert.throws(() => { observed.owner.line = 999 })
        assert.throws(() => { observed.guards.finite = false })
        assert.throws(() => { observed.bounds.min = 99 })
        assert.throws(() => { observed.sourceIds.push(999) })
        assert.equal(Reflect.set(observed, 'predicate', 99), false)
        const after = ctx.scheduler.laws.active()[0]
        assert.deepEqual({ ...after.owner }, before.owner)
        assert.deepEqual([...after.sourceIds], before.sourceIds)
        assert.deepEqual(gate(ctx.scheduler), before.gate)
        assert.equal(ctx.scheduler.motionRevision, before.rev)
        assert.equal(ctx.scheduler.root._configurationRevision, before.config)
        assert.deepEqual(ctx.read().laws[0], observed, 'a later read does not drift')
    } finally { ctx.restore() }
})

test('the canonical term shape and numeric JSON survive unchanged', () => {
    const ctx = seat()
    try {
        const observed = ctx.read().laws[0]
        const original = ctx.scheduler.laws.active()[0]
        assert.deepEqual(Object.keys(observed).sort(), lawKeys.slice().sort(),
            'no field added or removed')
        assert.deepEqual(observed.expression, original.expression)
        assert.deepEqual(observed.endpoints, [...original.endpoints])
        assert.equal(observed.address, original.address)
        assert.equal(observed.expression.radius, 5)
        assert.deepEqual(observed.expression.references, [...original.expression.references])
        assert.equal(Object.getPrototypeOf(observed.expression), Object.prototype)
        assert.deepEqual(JSON.parse(JSON.stringify(observed)), JSON.parse(JSON.stringify(original)))
    } finally { ctx.restore() }
})

test('unknown private top-level payload is not read or crossed', () => {
    const ctx = seat()
    try {
        const law = ctx.scheduler.laws.active()[0]
        const decorated = {}
        for (const key of lawKeys) decorated[key] = law[key]
        Object.defineProperty(decorated, 'cache', { get() { throw new Error('private cache read') } })
        decorated.handle = { self: null }
        decorated.handle.self = decorated.handle
        const previous = ctx.scheduler.laws.active
        ctx.scheduler.laws.active = () => [decorated]
        try {
            const observed = ctx.read().laws[0]
            assert.equal('cache' in observed, false)
            assert.equal('handle' in observed, false)
            assert.deepEqual(observed.expression, law.expression)
        } finally { ctx.scheduler.laws.active = previous }
    } finally { ctx.restore() }
})

test('a later conflict keeps the original law line after attempted observer edits', () => {
    const SRC = `let A
let B
let D
as B do
  let A.distance = 5
  wait 1
  let A.position = origin
end
`
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', SRC))
    let now = 0
    const tick = (n) => {
        for (let i = 0; i < n; i++) {
            now += 1000
            scheduler.tick(now)
            scheduler.readouts?.drain?.()
        }
    }
    const previous = globalThis.window
    try {
        tick(1)
        globalThis.window = {}
        attachProbe({ scheduler, _stateOf: () => null }, { orderOf: () => null })
        const observed = globalThis.window.__probe.read().laws[0]
        assert.equal(Reflect.set(observed.owner, 'line', 999), false)
        assert.equal(Reflect.set(observed.sourceIds, 0, 999), false)
        assert.throws(() => { observed.sourceIds.push(999) })
        tick(10)
        const last = scheduler.root._lastAttempt
        assert.match(last.message, /at line 5$/, 'the original law line survives')
        assert.deepEqual(last.span, { line: 7, endLine: 7 }, 'the pin span survives')
        const D = host.children.get('D')
        assert.equal(D.heldAttempts, undefined, 'sourceIds metadata does not hold D')
        const req = scheduler.requestMotion(D, { rotation: D.transform.deref().rotation, position: [1, 0, 0] },
            scheduler.motionRevision)
        assert.equal(req.kind, 'accept', 'D stays playable')
    } finally {
        if (previous === undefined) delete globalThis.window
        else globalThis.window = previous
    }
})
