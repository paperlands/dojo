// Reactive randomness is driven by resolved inputs, never by publication cadence.
// One initial sample; changed input values sample once; preflight only captures.
// (id:laws-reactive-randomness)

// Run: node --test test/js/laws/reactive_randomness_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScheduler, metaRoot, frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { deps, fork, drive } from './harness.mjs'
import { createReadouts } from '../../../assets/js/turtling/laws/readout.js'
import { reactiveReading } from '../../../assets/js/turtling/laws/reactive.js'

const pos = frame => frameWorldTransform(frame).position
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

function scene({ expr = 'B.x+random', feature = 'x', prefix = '', extra = '', noise = n => n / 1000,
    allowError = false, program = null, run = true } = {}) {
    let samples = 0
    const scheduler = createScheduler(metaRoot(), {
        createDeps: () => {
            const d = deps()
            d.mathEvaluator.constants.random = () => noise(++samples)
            return d
        },
        motionAdmission: ({ requested }) => ({ accepted: true, transform: requested }),
        execOpts: { breathEvery: 1, strokeMax: 1 },
    })
    const source = program ?? `${prefix}\nlet B\nlet C\nlet A\nlet A.${feature}=${expr}\nlet A.y=2\n${extra}`
    const host = scheduler.hotSwapChild('host', fork('host', source))
    if (run) drive(scheduler)
    if (!allowError) assert.equal(host.error, null)
    const A = host.children.get('A'), B = host.children.get('B'), C = host.children.get('C')
    const tick = (now = 0) => scheduler.tick(now)
    const idle = () => { for (let i = 0; i < 20; i++) { scheduler.readouts.recompute(); tick() } }
    const move = (frame, position) => {
        const result = scheduler.requestMotion(frame, { rotation: frame.transform.deref().rotation, position }, scheduler.motionRevision)
        assert.equal(result.kind, 'accept')
    }
    return { scheduler, host, A, B, C, tick, idle, move, samples: () => samples }
}

test('the real authored law samples exactly once at installation and settles', () => {
    const s = scene()
    assert.equal(s.samples(), 1)
    near(pos(s.A)[0], .001)
    assert.equal(s.scheduler.root._derivedMoves.length, 0)
    assert.equal(s.scheduler.readouts.hasPending(), false)
    assert.equal(s.scheduler.done, true)
    s.idle()
    assert.equal(s.samples(), 1)
    near(pos(s.A)[0], .001)
})

test('B.x changes once: one fresh sample, normal law publication, no self-resampling', () => {
    const s = scene()
    s.move(s.B, [7, 0, 0])
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], .001, 'the proposal waits for the normal scheduler boundary')
    s.tick()
    near(pos(s.A)[0], 7.002)
    assert.equal(pos(s.A)[1], 2)
    const law = s.scheduler.laws.active().find(l => l.feature === 'coordinate' && l.axis === 'x')
    near(law.predicate, pos(s.A)[0])
    assert.equal(law.expression.source, 'B.x+random')
    s.idle()
    assert.equal(s.samples(), 2)
})

test('B.y and unrelated C movement do not change the B.x input question', () => {
    const s = scene()
    s.move(s.B, [0, 9, 0]); s.tick()
    s.move(s.C, [4, 0, 0]); s.tick()
    assert.equal(s.samples(), 1)
    near(pos(s.A)[0], .001)
})

test('equal B.x does not sample; returning to an earlier value does sample again', () => {
    const s = scene()
    s.move(s.B, [7, 0, 0]); s.tick()
    s.move(s.B, [7, 4, 0]); s.tick()
    assert.equal(s.samples(), 2)
    s.move(s.B, [0, 4, 0]); s.tick()
    assert.equal(s.samples(), 3)
    near(pos(s.A)[0], .003)
})

test('every accepted input change samples, but superseded queued answers cannot publish', () => {
    const s = scene()
    s.move(s.B, [7, 0, 0])
    s.move(s.B, [8, 0, 0])
    assert.equal(s.samples(), 3)
    assert.equal(s.scheduler.root._derivedMoves.length, 2)
    const revision = s.scheduler.motionRevision
    s.tick()
    assert.equal(s.scheduler.motionRevision, revision + 1, 'only the newest answer publishes')
    near(pos(s.A)[0], 8.003)
})

test('both external inputs are observed by value', () => {
    const s = scene({ expr: 'B.x+C.y+random' })
    s.move(s.C, [0, 5, 0]); s.tick()
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 5.002)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 3)
    near(pos(s.A)[0], 12.003)
    s.idle()
    assert.equal(s.samples(), 3)
})

test('two intrinsic uses draw twice per changed question, not per capture', () => {
    const s = scene({ expr: 'B.x+random+random' })
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], .003)
    s.idle()
    assert.equal(s.samples(), 2)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 4)
    near(pos(s.A)[0], 7.007)
})

test('random inside a user function is observed without treating its parameter as an input', () => {
    const s = scene({ prefix: 'fn jitter(v) (v+random)', expr: 'jitter[B.x]' })
    assert.equal(s.samples(), 1)
    s.idle()
    assert.equal(s.samples(), 1)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 7.002)
})

test('a function argument derived from random is not an external input', () => {
    const s = scene({ prefix: 'fn double(v) (2*v)', expr: 'B.x+double[random]' })
    s.idle()
    assert.equal(s.samples(), 1)
    near(pos(s.A)[0], .002)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 7.004)
})

test('the same mechanism drives a stochastic point without resampling itself', () => {
    const s = scene({ feature: 'position', expr: '(B.x+random,2)' })
    assert.equal(s.samples(), 1)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 7.002)
    s.idle()
    assert.equal(s.samples(), 2)
})

test('a whole-position input preserves its point kind and snapshot', () => {
    const s = scene({ feature: 'position', expr: 'B.position+[random,2,0]' })
    assert.equal(s.samples(), 1)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 7.002)
    s.idle()
    assert.equal(s.samples(), 2)
})

test('a sampled point declaration remains sampled while an explicit driven law reacts', () => {
    const s = scene({ extra: 'let P=(B.x+random,2)' })
    const P = s.host.children.get('P')
    assert.equal(s.samples(), 2)
    near(pos(P)[0], .002)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 3)
    near(pos(P)[0], .002)
    near(pos(s.A)[0], 7.003)
})

test('repeated preflight through the installed driver observes edges without drawing', () => {
    const s = scene()
    const [node] = s.scheduler.readouts.list()
    for (let i = 0; i < 5; i++) {
        assert.equal(s.scheduler.readouts.dependsOnFrame(() => s.scheduler.readouts.value(node.id), s.B), true)
        assert.equal(s.scheduler.readouts.dependsOnFrame(() => s.scheduler.readouts.value(node.id), s.A), false)
    }
    assert.equal(s.samples(), 1)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 2)
})

test('a refused cyclic replacement consumes only its reach sample and keeps the accepted law', () => {
    const s = scene({ extra: 'let A.x=A.x+random', allowError: true })
    assert.equal(s.samples(), 2)
    assert.equal(s.host.error.kind, 'relation')
    near(pos(s.A)[0], .001)
    s.idle()
    assert.equal(s.samples(), 2)
    assert.equal(s.scheduler.readouts.size, 1)
})

test('removing the owner cancels queued work and releases the stochastic driver', () => {
    const s = scene()
    s.move(s.B, [7, 0, 0])
    assert.equal(s.samples(), 2)
    s.scheduler.removeChild('host')
    s.tick()
    assert.equal(s.scheduler.readouts.size, 0)
    assert.equal(s.scheduler.laws.count(), 0)
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], .001)
})

test('transient source unreadiness cancels queued work without consuming a new sample', () => {
    const s = scene()
    s.move(s.B, [7, 0, 0])
    s.B.midInstant = true
    s.scheduler.readouts.recompute()
    s.tick()
    near(pos(s.A)[0], .001)
    assert.equal(s.samples(), 2)
    s.B.midInstant = false
    s.scheduler.readouts.recompute()
    s.tick()
    near(pos(s.A)[0], 7.002)
    assert.equal(s.samples(), 2, 'the equal input recovers its prior sample')
})

test('an unlucky domain refusal does not keep drawing; a changed input gets a fresh attempt', () => {
    const s = scene({ expr: 'B.x/(random-0.5)', noise: n => [.1, .5, .8][n - 1] })
    s.move(s.B, [1, 0, 0]); s.tick()
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 0)
    s.idle()
    assert.equal(s.samples(), 2)
    s.move(s.B, [2, 0, 0]); s.tick()
    assert.equal(s.samples(), 3)
    near(pos(s.A)[0], 2 / .3)
    s.idle()
    assert.equal(s.samples(), 3)
})

test('a geometric refusal retains the old law and does not hunt for another random sample', () => {
    const s = scene({ extra: 'let A.distance=sqrt[4+0.000001]' })
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], .001)
    s.idle()
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], .001)
    const law = s.scheduler.laws.active().find(l => l.feature === 'coordinate' && l.axis === 'x')
    near(law.predicate, .001)
})

test('a cold captured scalar is preflighted without computing or changing its question', () => {
    const r = createReadouts(), frame = { id: 'B' }
    let samples = 0
    const evaluate = sample => {
        r.readsink(frame)
        const value = sample ? sample('random') : ++samples / 1000
        return { value, reads: { inputs: [['external', 'B.x', null, 0]], samples: [['random', value]] } }
    }
    const initial = evaluate(), definition = reactiveReading(initial, evaluate)
    const id = r.register('host', 'x', definition)
    const before = r.list()
    for (let i = 0; i < 5; i++) assert.equal(r.dependsOnFrame(() => r.value(id), frame), true)
    assert.equal(samples, 1)
    assert.deepEqual(r.list(), before)
    r.recompute()
    assert.equal(samples, 1)
    near(r.value(id), .001)
})

test('fresh stochastic choices own their edges, allowing a captured cycle to break', () => {
    const r = createReadouts()
    const frames = { B: { id: 'B', x: 10 }, C: { id: 'C', x: 20 }, A: { id: 'A', x: 30 } }
    let samples = 0, trigger = 0
    const evaluate = sample => {
        const choice = sample ? sample('choice') : ['B', 'C', 'A', 'B'][samples++]
        const frame = frames[choice]
        r.readsink(frame)
        return { value: frame.x + trigger, reads: {
            inputs: [['external', 'trigger', null, trigger], ['external', `${choice}.x`, null, frame.x]],
            samples: [['choice', choice]],
        } }
    }
    const id = r.register('host', 'x', reactiveReading(evaluate(), evaluate))
    r.produces(id, frames.A)
    r.recompute()
    trigger = 1; r.recompute()
    assert.equal(r.value(id), 21)
    assert.equal(r.dependsOnFrame(() => r.value(id), frames.B), false)
    assert.equal(r.dependsOnFrame(() => r.value(id), frames.C), true)
    trigger = 2; r.recompute()
    assert.equal(r.value(id), undefined)
    trigger = 3; r.recompute()
    assert.equal(r.value(id), 13, 'the discarded capture edge to A must not keep this cyclic')
    assert.equal(samples, 4)
    r.recompute()
    assert.equal(samples, 4)
})

test('a running source moves x, then only y, then x again without sampling on readiness cuts', () => {
    const program = 'as B do\nwait 2\njmpto 80 0\nwait 2\njmpto 80 80\nwait 2\njmpto 160 80\nend\nlet A\nlet A.x=B.x+random\nlet A.y=2'
    const s = scene({ program, run: false })
    const settleThrough = now => {
        for (let i = 0; i < 16 && !s.scheduler.isSettledThrough(now); i++) s.tick(now)
        assert.equal(s.scheduler.isSettledThrough(now), true)
    }
    settleThrough(0)
    assert.equal(s.samples(), 1)
    settleThrough(2000)
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 80.002)
    settleThrough(4000)
    assert.equal(pos(s.B)[1], 80)
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 80.002)
    settleThrough(6000)
    assert.equal(s.samples(), 3)
    near(pos(s.A)[0], 160.003)
    assert.equal(s.scheduler.done, true)
})

test('reaching the same law twice installs two samples; only the last installation follows', () => {
    const program = 'let B\nlet A\nloop 2 do\nlet A.x=B.x+count+random\nend\nlet A.y=2'
    const s = scene({ program })
    assert.equal(s.samples(), 2)
    near(pos(s.A)[0], 1.002)
    s.idle()
    assert.equal(s.samples(), 2)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 3)
    near(pos(s.A)[0], 8.003)
})

test('a law with no live input samples once and owns no driver', () => {
    const s = scene({ expr: 'random' })
    assert.equal(s.scheduler.readouts.size, 0)
    s.move(s.B, [7, 0, 0]); s.tick()
    s.idle()
    assert.equal(s.samples(), 1)
    near(pos(s.A)[0], .001)
})

test('capture hooks cannot leak into an ordinary evaluator use', () => {
    const s = scene()
    s.idle()
    const evaluator = s.host.deps.mathEvaluator
    assert.equal(evaluator.reads.sample, null)
    assert.equal(evaluator.reads.bind, null)
    near(evaluator.run(s.host.deps.mathParser.parse('random'), {}), .002)
    assert.equal(s.samples(), 2)
    s.move(s.B, [7, 0, 0]); s.tick()
    assert.equal(s.samples(), 3)
    near(pos(s.A)[0], 7.003)
})
