// Binding, not syntax, interprets a coordinate target. Acquisition preserves what
// arrived; the consumer's binder turns the whole argument list into one point; the
// command proposes geometry only. Same being, same consumer, same result through every
// syntactic path. (id:world-coordinate-phase-3)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, settle, at as atPose } from '../laws/harness.mjs'
import { SE3 } from '../../../assets/js/turtling/se3.js'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const run = (source) => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host', source))
    const trace = drive(scheduler, { maxTicks: 30 })
    return { scheduler, host, trace }
}
const at = (frame) => [...frameWorldTransform(frame).position]
const labels = (trace) => (trace.get('host') ?? []).filter((e) => e.type === 'label').map((e) => e.text)

test('a target is one being, also when forwarded through a parameter', () => {
    assert.deepEqual(at(run('let bob = (7, 8, 9)\ngoto bob').host), [7, 8, 9])
    assert.deepEqual(at(run('let bob = (7, 8, 9)\ndef visit t do\n goto t\nend\nvisit bob').host), [7, 8, 9])
})

test('a target spelling projects a position, directly or forwarded', () => {
    for (const command of ['goto', 'jmpto', 'faceto']) {
        const expected = run(`${command} 7 8 9`).host.transform.deref()
        for (const call of [`${command} "bob"`, `def visit t do\n ${command} t\nend\nvisit "bob"`]) {
            const { scheduler, host } = run(`let bob = (7, 8, 9)\n${call}`)
            assert.deepEqual(scheduler.errors, [], `${command}: ${call}`)
            assert.deepEqual(host.transform.deref(), expected)
        }
    }
    assert.deepEqual(labels(run('let bob = (7, 8, 9)\nlabel "bob"').trace), ['bob'], 'a display spelling is still text')
    assert.ok(run('let bob = (7, 8, 9)\nfw "bob"').scheduler.errors.length, 'a measure does not become a subject lookup')
})

test('a target spelling chooses the receiving namesake; a bound being keeps identity', () => {
    for (const [argument, expected] of [['"bob"', [10, 20, 30]], ['bob', [7, 8, 9]]]) {
        const { scheduler, host } = run(`let bob = (7, 8, 9)
def visit t do
 as inner do
  let bob = (10, 20, 30)
  goto t
 end
end
visit ${argument}`)
        assert.deepEqual(scheduler.errors, [])
        assert.deepEqual(at(host.children.get('inner')), expected)
    }
})

test('a four-dancer ring agrees with explicit coordinate following', () => {
    const source = (aim) => `def follow leader follower do
 as follower do
  loop 30 do
   ${aim}
   fw 2
   wait 1/24
  end
 end
end
loop 4 do
 let "dancer[count]"
 fw 100
 rt 90
 follow "dancer[mod(count+1,4)]" "dancer[count]"
end`
    const runRing = (aim) => {
        const scheduler = buildWorld({})
        const host = scheduler.hotSwapChild('host', fork('host', source(aim)))
        const trace = drive(scheduler, { maxTicks: 400 })
        assert.deepEqual(scheduler.errors, [])
        return { host, trace }
    }
    const compact = runRing('faceto leader')
    const explicit = runRing('faceto leader.x leader.y leader.z')
    for (let i = 0; i < 4; i++) {
        const name = `dancer${i}`
        assert.ok(compact.host.children.has(name))
        assert.deepEqual(at(compact.host.children.get(name)), at(explicit.host.children.get(name)), name)
        // One beat per wait joint; 30 beats means the follow loop ran to completion.
        // (id:host-beat)
        assert.equal((compact.trace.get(name) ?? []).filter(e => e.type === 'beat').length, 30, `${name} completed its follow loop`)
    }
})

test('a target is one coordinate value or its scalar components', () => {
    assert.deepEqual(at(run('goto [1, 2, 3]').host), [1, 2, 3])
    assert.deepEqual(at(run('goto [1,] [2,] [3,]').host), [1, 2, 3])
    assert.deepEqual(at(run('goto 1 2 3').host), [1, 2, 3])
    assert.deepEqual(at(run('let v = [4, 5, 6]\ngoto v').host), [4, 5, 6])
})

test('omitted components complete once: x/y zero, z the world height', () => {
    assert.deepEqual(at(run('goto 3').host), [3, 0, 0])
    assert.deepEqual(at(run('jmpto 5 6 7\njmpto 10 20').host), [10, 20, 7])
})

test('a point mixed with separate components is refused', () => {
    const { scheduler } = run('goto [1, 2, 3] 99 88')
    assert.match(scheduler.errors.map((e) => e.message).join(' '), /one point or its components/)
})

test('a display slot shows a location, however it was delivered', () => {
    assert.deepEqual(labels(run('let bob = (7, 8, 9)\nlabel bob').trace), ['[7, 8, 9]'])
    assert.deepEqual(labels(run('let bob = (7, 8, 9)\ndef visit t do\n label t\nend\nvisit bob').trace), ['[7, 8, 9]'])
    assert.deepEqual(labels(run('label origin').trace), ['[0, 0, 0]'])
})

test('a word hole is not a position: only the display consumer projects a being', () => {
    // The display consumer reads a bound being as its location (positive control).
    assert.deepEqual(labels(run('let bob = (7, 8, 9)\nlabel bob').trace), ['[7, 8, 9]'])
    // A colour input keeps the value; a "word" hole is not permission to project.
    const colour = run('let bob = (7, 8, 9)\nbeColour bob').host.actorState.style.color
    assert.equal(Array.isArray(colour), false, 'a colour is not a coordinate tuple')
    assert.equal(run('let bob = (7, 8, 9)\nbeColour "bob"').host.actorState.style.color, 'bob', 'a quoted colour stays a word')
    // A message input keeps the value; a "word" hole is not permission to project.
    const shouts = []
    const scheduler = buildWorld({ onShout: (from, name) => shouts.push(name) })
    scheduler.hotSwapChild('host', fork('host', 'let bob = (7, 8, 9)\nshout bob 5'))
    drive(scheduler, { maxTicks: 30 })
    assert.equal(shouts.length, 1)
    assert.equal(Array.isArray(shouts[0]), false, 'a message name is not a coordinate tuple')
})

test('only the display consumer reads the position facet', () => {
    // The `wait` lets the ambient door install before we spy on the frame's evaluator.
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host',
        'let bob = (7, 8, 9)\nwait 1\nlabel bob\nbeColour bob\nshout bob 5'))
    scheduler.tick(0)
    let reads = 0
    const evaluator = host.deps.mathEvaluator
    const facet = evaluator.resolveSubjectFacet
    evaluator.resolveSubjectFacet = (being, property, args) => {
        if (property === 'position') reads++
        return facet(being, property, args)
    }
    for (let i = 1; i < 12; i++) scheduler.tick(i * 1000)
    assert.equal(reads, 1, 'label reads the position facet; a colour and a shout do not')
})

test('a pending being suspends a label, and never a colour or a shout', async () => {
    const pending = async (source) => {
        let release
        const scheduler = buildWorld({ admitAsync: ({ frame, requested }) => frame.name === 'bob'
            ? new Promise((res) => { release = res }) : { accepted: true, transform: requested } })
        scheduler.hotSwapChild('bob', fork('bob', 'goto 5 5 5'))
        for (let i = 0; i < 5; i++) scheduler.tick(i * 1000)
        const reader = scheduler.hotSwapChild('reader', fork('reader', source))
        for (let i = 5; i < 12; i++) scheduler.tick(i * 1000)
        const suspension = reader.suspension?.kind ?? null
        if (release) { release({ accepted: true, transform: atPose(5, 5) }); await settle(); await settle() }
        for (let i = 12; i < 24; i++) scheduler.tick(i * 1000)
        return { suspension, events: reader.channel.drain() }
    }
    const label = await pending('label bob')
    assert.equal(label.suspension, 'dataflow', 'the label waits on the being')
    assert.deepEqual(label.events.filter((e) => e.type === 'label').map((e) => e.text),
        ['[5, 5, 0]'], 'the label projects once the being lands')
    assert.equal((await pending('beColour bob')).suspension, null, 'a colour never waits on a position')
    assert.equal((await pending('shout bob 5')).suspension, null, 'a shout never waits on a position')
})

test('a command proposes geometry only (the patch shape is the contract)', () => {
    const goto = run('goto 1 2 3')
    const local = goto.host.transform.deref()
    assert.deepEqual([...local.position], [1, 2, 3])
    // An aim never proposes a displacement; a place never proposes a rotation.
    const aim = run('faceto 1 2 3')
    assert.deepEqual(aim.scheduler.errors, [])
})

test('projection SUSPENDS while the being is unresolved, then resumes', async () => {
    let release
    const scheduler = buildWorld({ admitAsync: ({ frame, requested }) => frame.name === 'bob'
        ? new Promise((res) => { release = res }) : { accepted: true, transform: requested } })
    scheduler.hotSwapChild('bob', fork('bob', 'goto 5 5 5'))
    for (let i = 0; i < 5; i++) scheduler.tick(i * 1000)
    const reader = scheduler.hotSwapChild('reader', fork('reader', 'goto bob'))
    for (let i = 5; i < 12; i++) scheduler.tick(i * 1000)
    assert.equal(reader.suspension?.kind, 'dataflow', 'a pending being is awaited, not wounded')
    assert.equal(reader.error ?? null, null)
    release({ accepted: true, transform: atPose(5, 5) })
    await settle(); await settle()
    for (let i = 12; i < 24; i++) scheduler.tick(i * 1000)
    assert.deepEqual([...frameWorldTransform(reader).position], [5, 5, 0])
    assert.equal(reader.error ?? null, null)
})

test('a forwarded being suspends the same way', async () => {
    let release
    const scheduler = buildWorld({ admitAsync: ({ frame, requested }) => frame.name === 'bob'
        ? new Promise((res) => { release = res }) : { accepted: true, transform: requested } })
    scheduler.hotSwapChild('bob', fork('bob', 'goto 5 5 5'))
    for (let i = 0; i < 5; i++) scheduler.tick(i * 1000)
    const reader = scheduler.hotSwapChild('reader', fork('reader', 'def visit t do\n goto t\nend\nvisit bob'))
    for (let i = 5; i < 12; i++) scheduler.tick(i * 1000)
    assert.equal(reader.suspension?.kind, 'dataflow')
    assert.equal(reader.error ?? null, null)
    release({ accepted: true, transform: atPose(5, 5) })
    await settle(); await settle()
    for (let i = 12; i < 24; i++) scheduler.tick(i * 1000)
    assert.deepEqual([...frameWorldTransform(reader).position], [5, 5, 0])
})

test('malformed structure refuses before any default', () => {
    for (const bad of [[], Array(1), [null], [undefined], [1, null, 3], [1, undefined, 3]]) {
        const scheduler = buildWorld({})
        const src = fork('host', 'goto held')
        src.env.scope = { held: bad }
        scheduler.hotSwapChild('host', src)
        drive(scheduler, { maxTicks: 12 })
        assert.match(scheduler.errors.map((e) => e.message).join(' '), /No measure/, JSON.stringify(bad))
    }
    // Genuine omissions (a shorter value, an omitted argument) still complete.
    assert.deepEqual(at(run('goto [1,2]').host), [1, 2, 0])
    assert.deepEqual(at(run('goto [1,]').host), [1, 0, 0])
    assert.deepEqual(at(run('goto 3').host), [3, 0, 0])
})

test('completion and conversion share ONE sampled basis', () => {
    const scheduler = buildWorld({})
    const frame = scheduler.hotSwapChild('host', fork('host', 'goto 10 20'), { deferStart: true })
    let samples = 0
    const heights = [30, 40]
    frame.deps.space = { sample: () => {
        const basis = { ...SE3.identity(), position: [0, 0, heights[samples++] ?? heights[1]] }
        return {
            toWorld: (local) => SE3.compose(basis, local),
            toLocalPoint: (point) => SE3.unapply(basis, point),
            toLocalRotation: (rotation) => SE3.invert(basis).rotation.multiply(rotation),
            toLocal: (world) => SE3.compose(SE3.invert(basis), world),
        }
    } }
    for (let i = 0; i < 12; i++) scheduler.tick(i * 1000)
    assert.equal(samples, 1, 'one sample for the whole command')
    // Completion used height 30, so conversion by that same height leaves local z = 0.
    // A second sample (height 40) would strip the extra 10 and leave z = 10.
    assert.deepEqual([...frame.transform.deref().position], [10, 20, 0], 'completion and conversion shared the sampled cursor')
})
