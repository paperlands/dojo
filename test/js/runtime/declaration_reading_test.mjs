import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Parser } from '../../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'
import { asKind } from '../../../assets/js/turtling/mafs/tower.js'
import { parseProgram } from '../../../assets/js/turtling/parse.js'
import { execute, drainEvents } from '../../../assets/js/turtling/executor.js'

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const declaration = events => events.find(event => ['law', 'scalar', 'parameter'].includes(event.type))

for (const kind of ['point', 'vector']) {
    test(`${kind} classification and installation share one initial reading`, () => {
        const d = deps()
        let calls = 0
        d.mathEvaluator.constants.probe = () => asKind([++calls, 2, 3], kind)
        const event = declaration(drainEvents(parseProgram('let A = probe'), d))
        assert.equal(calls, 1)
        assert.deepEqual(kind === 'point' ? event.value : event.initial, [1, 2, 3])
        if (kind === 'vector') {
            assert.deepEqual(event.read(), [2, 2, 3])
            assert.equal(calls, 2, 'a later live reading remains a separate operation')
        }
    })
}

for (const [expr, type, expected] of [
    ['(random, 2, 3)', 'law', [.25, 2, 3]],
    ['[random, 2, 3]', 'scalar', [.25, 2, 3]],
    ['random', 'parameter', .25],
]) {
    test(`sampling policy is independent of kind: ${expr}`, () => {
        const d = deps()
        let samples = 0
        d.mathEvaluator.constants.random = () => ++samples / 4
        const event = declaration(drainEvents(parseProgram(`let A = ${expr}`), d))
        assert.equal(event.type, type)
        assert.deepEqual(type === 'scalar' ? event.initial : event.value, expected)
        if (type === 'scalar') {
            assert.deepEqual(event.read(), expected)
            assert.deepEqual(event.read(), expected)
        }
        if (type === 'law') assert.equal(event.read, null)
        assert.equal(samples, 1)
    })
}

test('a point carries its own observations without leaving them on the evaluator', () => {
    const d = deps(), evaluator = d.mathEvaluator
    let x = 4, calls = 0
    evaluator.resolveExternal = name => {
        assert.equal(name, 'B.position')
        calls++
        if (evaluator.reads) evaluator.reads.live = true
        return asKind([x, 0, 0], 'point')
    }
    const event = declaration(drainEvents(parseProgram('let A = B.position'), d))
    assert.equal(calls, 1)
    assert.equal(evaluator.reads, null)
    assert.deepEqual(event.read.initial.value, [4, 0, 0])
    drainEvents(parseProgram('let unrelated = 7'), d)
    x = 9
    assert.deepEqual(event.read.compute().value, [9, 0, 0])
    assert.equal(evaluator.reads, null)
})

test('a blocked law retries with a fresh observation and restores the caller record', () => {
    const d = deps(), evaluator = d.mathEvaluator
    const parent = evaluator.beginReads()
    let attempts = 0
    evaluator.resolveExternal = () => {
        evaluator.reads.inputs.push(['attempt', ++attempts])
        if (attempts === 1) throw Object.assign(new Error('not ready'), { blocked: true })
        evaluator.reads.live = true
        return asKind([8, 0, 0], 'point')
    }
    const stream = execute(parseProgram('let A.position = B.position'), d, { breathEvery: 0 })
    assert.equal(stream.next().value.type, 'blocked')
    assert.equal(evaluator.reads, parent)
    const event = stream.next().value
    assert.equal(event.type, 'law')
    assert.deepEqual(event.value, [8, 0, 0])
    assert.deepEqual(event.read.initial.question, [
        ['attempt', 2], ['external', 'B.position', null, asKind([8, 0, 0], 'point')],
    ])
    assert.equal(evaluator.reads, parent)
    assert.deepEqual(parent.inputs, [])
})

test('an unavailable declaration remains a deferred scalar rather than blocking birth', () => {
    const d = deps(), evaluator = d.mathEvaluator
    let ready = false
    evaluator.constants.probe = () => {
        if (!ready) throw Object.assign(new Error('not ready'), { blocked: true })
        return 12
    }
    const events = drainEvents(parseProgram('let A = probe'), d)
    assert.equal(events.some(event => event.type === 'blocked'), false)
    const event = declaration(events)
    assert.equal(event.type, 'scalar')
    ready = true
    assert.equal(event.read(), 12)
})
