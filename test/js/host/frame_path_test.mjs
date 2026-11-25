import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameAt } from '../../../assets/js/turtling/frame.js'
import { frameAddress } from '../../../assets/js/turtling/scheduler.js'
import { SE3, AXIS_Z } from '../../../assets/js/turtling/se3.js'
import { buildWorld, fork, drive } from '../laws/harness.mjs'
import { headlessWorld } from './harness.mjs'

const value = value => ({ kind: 'value', value })
const source = `as "A/B" do
  rt 30
end
as A do
  as B do
    rt 60
  end
end
as "" do
  fw 1
end
as "a~1b" do
  fw 2
end`

test('key paths distinguish legal frames whose serialized execution addresses collide', () => {
    const scheduler = buildWorld({ strokeMax: 0, breathEvery: 1000 })
    const host = scheduler.hotSwapChild('host', fork('label', source))
    const other = scheduler.hotSwapChild('origin', fork('another label', 'fw 3'))
    const slashSeat = scheduler.hotSwapChild('seat/key', fork('label', 'fw 4'))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    const literal = host.children.get('A/B')
    const nested = host.children.get('A').children.get('B')
    assert.equal(frameAddress(scheduler.root, literal), frameAddress(scheduler.root, nested))
    assert.notEqual(literal, nested)
    assert.equal(frameAt(scheduler.root, ['host', 'A/B']), literal)
    assert.equal(frameAt(scheduler.root, ['host', 'A', 'B']), nested)
    assert.equal(frameAt(scheduler.root, ['host', '']), host.children.get(''))
    assert.equal(frameAt(scheduler.root, ['host', 'a~1b']), host.children.get('a~1b'))
    assert.equal(frameAt(scheduler.root, ['host']), host, 'registration key, not display label')
    assert.equal(frameAt(scheduler.root, ['origin']), other)
    assert.equal(frameAt(scheduler.root, []), scheduler.root)
    assert.equal(frameAt(scheduler.root, ['seat/key']), slashSeat)
    assert.equal(frameAt(scheduler.root, ['label']), null, 'no display-name fallback')
    for (const bad of [null, undefined, 'host', {}, [42], Array(1), ['host', 'missing']])
        assert.equal(frameAt(scheduler.root, bad), null)
    assert.equal(frameAt(null, []), null)
})

test('root, datum, shadowing names and nested turtles use the ordinary property reader', async () => {
    const { world } = headlessWorld()
    await (await world.play(`rt 90
as host do
  rt 30
end
as world do
  rt 45
end
as origin do
  rt 60
end
${source}`)).finished
    assert.deepEqual(world.interaction.read(['host'], 'heading'), value(180))
    assert.ok(Math.abs(world.interaction.read(['host', 'host'], 'heading').value - 210) < 1e-9)
    assert.equal(world.interaction.read(['host', 'world'], 'heading').value, 225)
    assert.ok(Math.abs(world.interaction.read(['host', 'origin'], 'heading').value - 240) < 1e-9)
    assert.deepEqual(world.interaction.read([], 'position'), value([0, 0, 0]))
    assert.ok(Math.abs(world.interaction.read(['host', 'A/B'], 'heading').value - 210) < 1e-9)
    assert.ok(Math.abs(world.interaction.read(['host', 'A', 'B'], 'heading').value - 240) < 1e-9)
    assert.equal(world.interaction.read(['world'], 'heading').kind, 'missing')
    const stored = world.interaction.read(['host', ''], 'position')
    assert.ok(Object.isFrozen(stored.value))
    world.dispose()
    assert.ok(Object.isFrozen(stored.value), 'retained answers outlive their world')
})

test('the target path does not change world-valued position or origin-relative orientation', () => {
    const scheduler = buildWorld({ strokeMax: 0, breathEvery: 1000 })
    const origin = { ...SE3.rotateLocal(SE3.identity(), AXIS_Z, -30), position: [100, 200, 3] }
    scheduler.hotSwapChild('host', fork('host', 'rt 90\nfw 10', origin))
    drive(scheduler)
    assert.ok(Math.abs(scheduler.readPlace(['host'], 'heading').value - 180) < 1e-9)
    const point = scheduler.readPlace(['host'], 'position').value
    assert.ok(Math.abs(point[0] - 95) < 1e-9)
    assert.ok(Math.abs(point[1] - (200 - 5 * Math.sqrt(3))) < 1e-9)
    assert.equal(point[2], 3)
    assert.equal(scheduler.readPlace([], 'position', 'no seat').kind, 'missing')
})

test('root heading subscriptions reuse accepted-state notifications and deduplicate waits', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('fw 10\nwait 1\nrt 90\nwait 1\nrt 90')
    const headings = [], positions = []
    world.interaction.subscribe(['host'], 'heading', answer => headings.push(answer))
    world.interaction.subscribe(['host'], 'position', answer => positions.push(answer))
    const revision = turtle.scheduler.motionRevision
    for (const time of [0, 500, 1000, 1500, 2000]) turtle.advance(time)
    const finished = await run.finished
    assert.deepEqual(headings, [value(90), value(180), value(270)])
    assert.deepEqual(positions, [value([10, 0, 0])])
    assert.equal(finished.commandCount, 5, 'no wrapper command or count remap')
    assert.equal(turtle.scheduler.motionRevision, revision, 'observation needs no invented revision')
    world.dispose()
})

test('vertical and hidden turtles retain their native reading domains', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('hd\npitch 90\nwait 1\npitch -90')
    const samples = []
    world.interaction.subscribe(['host'], 'heading', answer => samples.push(answer))
    assert.deepEqual(world.interaction.read(['host'], 'elevation'), value(-90))
    turtle.advance(1000)
    await run.finished
    assert.deepEqual(samples, [value(null), value(90)])
    world.dispose()
})

test('subscriptions capture a path once and cannot be retargeted by caller mutation', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('as A do\nrt 30\nend\nwait 1\nrt 90')
    let reads = 0
    const path = ['host']
    Object.defineProperty(path, '0', { configurable: true, get() { reads++; return 'host' } })
    const samples = []
    const off = world.interaction.subscribe(path, 'heading', answer => samples.push(answer))
    Object.defineProperty(path, '0', { value: 'missing', writable: true })
    path.push('A')
    turtle.advance(1000)
    await run.finished
    assert.equal(reads, 1)
    assert.deepEqual(samples, [value(90), value(180)])
    assert.equal(Object.isFrozen(path), false, 'the caller keeps ownership of its input')
    off(); off()
    world.dispose()
})

test('paths are live bindings, but every play attempt retires old subscriptions', async () => {
    const { world, turtle } = headlessWorld()
    const first = await world.play('wait 1\nrt 90')
    const rejected = assert.rejects(first.finished, error => error.reason === 'superseded')
    const samples = []
    const off = world.interaction.subscribe(['host'], 'heading', answer => samples.push(answer))
    const replacement = await world.play('rt 45\nwait 1\nrt 45')
    await rejected
    const current = []
    world.interaction.subscribe(['host'], 'heading', answer => current.push(answer))
    turtle.advance(1000)
    await replacement.finished
    assert.deepEqual(samples, [value(90)])
    assert.deepEqual(current, [value(135), value(180)])
    await assert.rejects(world.play('jmp 1 2 3 4'), error => error.wound.span.line === 1)
    assert.deepEqual(current, [value(135), value(180)])
    assert.throws(() => world.interaction.subscribe(['host'], 'heading', () => {}), /before subscribing/)
    off(); off()
    world.dispose(); world.dispose()
    assert.deepEqual(world.interaction.read(['host'], 'heading'), { kind: 'retired' })
    assert.equal(world.interaction.propose(['host'], [0, 0, 0]).kind, 'retired')
    assert.equal(turtle.disposeCount, 1)
})

test('one path namespace serves proposals without granting authority over headed frames', async () => {
    const { world } = headlessWorld()
    await (await world.play('as P do\nlet A\nend')).finished
    assert.equal(world.interaction.propose(['host', 'P', 'A'], [7, 0, 0]).kind, 'accept')
    assert.deepEqual(world.interaction.read(['host', 'P', 'A'], 'position'), value([7, 0, 0]))
    assert.equal(world.interaction.read(['host', 'P', 'A'], 'heading').kind, 'unsupported')
    for (const path of [[], ['host'], ['host', 'P']])
        assert.equal(world.interaction.propose(path, [1, 0, 0]).kind, 'unsupported')
    assert.equal(world.interaction.propose(['missing'], [1, 0, 0]).kind, 'missing')
    world.dispose()
})

test('frame paths cannot escape the observer seat or grant cross-seat steering', async () => {
    const { world, turtle } = headlessWorld()
    await (await world.play('let P')).finished
    const other = turtle.scheduler.hotSwapChild('other', fork('other display name', 'let P'))
    turtle.advance(0)
    assert.deepEqual(world.interaction.read(['other', 'P'], 'position'), { kind: 'missing' })
    assert.equal(world.interaction.propose(['other', 'P'], [7, 0, 0]).kind, 'missing')
    assert.equal(frameAt(turtle.scheduler.root, ['other']), other, 'generic tree resolution is separate from door scope')
    assert.deepEqual(turtle.scheduler.readPlace(['other', 'P'], 'position', 'other'), value([0, 0, 0]))
    assert.equal(turtle.scheduler.proposePlace(['other', 'P'], [7, 0, 0], turtle.scheduler.motionRevision, 'other').kind, 'accept')
    assert.deepEqual(turtle.scheduler.readPlace(['other', 'P'], 'position', 'other'), value([7, 0, 0]))
    assert.equal(turtle.scheduler.readPlace(['host', 'P'], 'position', 'other').kind, 'missing')
    assert.equal(turtle.scheduler.proposePlace(['host', 'P'], [7, 0, 0], turtle.scheduler.motionRevision, 'other').kind, 'missing')
    world.dispose()
})

test('path normalization cannot install rights after a reentrant disposal', async () => {
    for (const operation of ['read', 'subscribe', 'propose']) {
        const { world, turtle } = headlessWorld()
        await (await world.play('let A')).finished
        const path = ['host', 'A']
        Object.defineProperty(path, '0', { get() { world.dispose(); return 'host' } })
        let calls = 0
        if (operation === 'subscribe') {
            const off = world.interaction.subscribe(path, 'position', () => { calls++ })
            off(); off()
        } else {
            const answer = operation === 'read'
                ? world.interaction.read(path, 'position')
                : world.interaction.propose(path, [7, 0, 0])
            assert.equal(answer.kind, 'retired')
        }
        assert.equal(calls, 0)
        assert.equal(turtle.scheduler.root._acceptedWatchers?.size ?? 0, 0)
    }
})

test('path normalization rechecks acceptance after a reentrant source replacement', async () => {
    const { world, turtle } = headlessWorld()
    await (await world.play('rt 45')).finished
    let replacement
    const path = ['host']
    Object.defineProperty(path, '0', { get() { replacement = world.play('wait 1\nrt 90'); return 'host' } })
    assert.throws(() => world.interaction.subscribe(path, 'heading', () => {}), error => error.reason === 'superseded')
    assert.equal(turtle.scheduler.root._acceptedWatchers?.size ?? 0, 0)
    const run = await replacement
    turtle.advance(1000)
    await run.finished
    assert.deepEqual(world.interaction.read(['host'], 'heading'), value(180))
    world.dispose()
})

test('a path getter cannot retarget a proposal into a replacement source', async () => {
    const { world, turtle } = headlessWorld()
    await (await world.play('let A')).finished
    let replacement
    const path = ['host', 'Q']
    Object.defineProperty(path, '1', { get() { replacement = world.play('let Q'); return 'Q' } })
    assert.equal(world.interaction.propose(path, [7, 0, 0]).kind, 'stale')
    await (await replacement).finished
    assert.deepEqual(world.interaction.read(['host', 'Q'], 'position'), value([0, 0, 0]))
    assert.equal(turtle.scheduler.root._acceptedWatchers?.size ?? 0, 0)
    world.dispose()
})

test('readiness is checked before caller path getters run', async () => {
    const { world } = headlessWorld()
    let reads = 0
    const path = ['host']
    Object.defineProperty(path, '0', { get() { reads++; return 'host' } })
    assert.throws(() => world.interaction.subscribe(path, 'heading', () => {}), /before subscribing/)
    await assert.rejects(world.play('nope'))
    assert.throws(() => world.interaction.subscribe(path, 'heading', () => {}), /before subscribing/)
    assert.throws(() => world.interaction.subscribe('host', 'heading', () => {}), /before subscribing/)
    assert.equal(reads, 0)
    world.dispose()
})

test('a subscription follows a binding through a new run within the same play', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('as S do\nfw 1\nend\nwait 1\nas S do\nfw 2\nend')
    const first = frameAt(turtle.scheduler.root, ['host', 'S'])
    const incarnation = first.runIncarnation
    const samples = []
    world.interaction.subscribe(['host', 'S'], 'position', answer => samples.push(answer))
    turtle.advance(1000)
    await run.finished
    assert.equal(frameAt(turtle.scheduler.root, ['host', 'S']), first, 'the native binding is reused')
    assert.notEqual(first.runIncarnation, incarnation, 'its execution has changed')
    assert.deepEqual(samples, [value([1, 0, 0]), value([2, 0, 0])])
    world.dispose()
})

test('frame paths and named scalar values have explicit, non-coercing call shapes', async () => {
    const { world, turtle } = headlessWorld()
    assert.deepEqual(world.interaction.read(['host'], 'heading'), { kind: 'missing' })
    await (await world.play('let s = 7')).finished
    assert.deepEqual(world.interaction.read('s'), value(7))
    for (const bad of ['host', null, undefined, 42, { address: 'host' }, ['host', 1], Array(1)]) {
        assert.throws(() => world.interaction.read(bad, 'heading'), TypeError)
        assert.throws(() => world.interaction.subscribe(bad, 'heading', () => {}), TypeError)
        assert.throws(() => world.interaction.propose(bad, [0, 0, 0]), TypeError)
    }
    assert.throws(() => world.interaction.read(['host']), TypeError)
    assert.throws(() => world.interaction.subscribe(['host'], () => {}), TypeError)
    assert.throws(() => world.interaction.read(['host'], 1), TypeError)
    assert.equal(turtle.scheduler.root._acceptedWatchers?.size ?? 0, 0)
    world.dispose()
    assert.deepEqual(world.interaction.read('host', 'heading'), { kind: 'retired' })
    assert.doesNotThrow(() => world.interaction.subscribe('host', 'heading', () => {}))
})

test('a late wound keeps its authored location without source instrumentation', async () => {
    const { world, turtle } = headlessWorld()
    const run = await world.play('fw 1\nwait 1\njmp 1 2 3 4')
    const ended = assert.rejects(run.finished, error => error.wound.span.line === 3)
    turtle.advance(1000)
    await ended
    assert.deepEqual(world.interaction.read(['host'], 'position'), value([1, 0, 0]))
    world.dispose()
})
