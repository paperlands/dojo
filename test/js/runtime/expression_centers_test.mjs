import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Parser } from '../../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'
import { asKind } from '../../../assets/js/turtling/mafs/tower.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'
import { isLocal } from '../../../assets/js/turtling/bindings.js'
import { parseProgram } from '../../../assets/js/turtling/parse.js'
import { evaluateExpr, readExpr, retryBlocked } from '../../../assets/js/turtling/expressions.js'
import { readPointArgs } from '../../../assets/js/turtling/arguments.js'
import { declareValue, declareLaw } from '../../../assets/js/turtling/declarations.js'

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const state = () => ({ deps: deps(), transform: SE3.identity(), style: {}, functions: {} })

test('an ordinary value cell neither enters nor overwrites its caller observation', () => {
    const d = deps(), evaluator = d.mathEvaluator
    evaluator.constants.probe = () => 7
    const parent = evaluator.beginReads()
    parent.bind = () => assert.fail('a parent replay entered a nested value cell')
    assert.equal(evaluateExpr('probe + 1', {}, d), 8)
    assert.equal(evaluator.reads, parent)
    assert.deepEqual(parent.inputs, [])
})

test('a failed reading carries its own evidence and restores its caller', () => {
    const d = deps(), evaluator = d.mathEvaluator
    evaluator.constants.probe = () => 7
    const parent = evaluator.beginReads()
    const reading = readExpr('probe + missing', {}, d)
    assert.match(reading.error.message, /Undefined variable/)
    assert.equal(reading.value, undefined)
    assert.deepEqual(reading.reads.inputs, [['constant', 'probe', 7]])
    assert.equal(evaluator.reads, parent)
    assert.deepEqual(parent.inputs, [])
})

test('retrying waits only for blocked errors and returns the complete answer unchanged', () => {
    const target = {}, answer = {}, failure = new Error('not a wait')
    let attempts = 0
    const stream = retryBlocked(() => {
        if (++attempts === 1) throw Object.assign(new Error('waiting'), { blocked: true, blockedFrame: target })
        return answer
    })
    assert.deepEqual(stream.next(), { value: { type: 'blocked', target }, done: false })
    assert.deepEqual(stream.next(), { value: answer, done: true })
    assert.equal(attempts, 2)
    const refused = retryBlocked(() => { throw failure })
    assert.throws(() => refused.next(), error => error === failure)
})

test('command argument retry closes the observation and rereads every argument', () => {
    const s = state(), evaluator = s.deps.mathEvaluator
    let revision = 0, closes = 0, samples = 0, attempts = 0
    evaluator.beginObservation = () => ++revision
    evaluator.endObservation = () => closes++
    evaluator.constants.probe = () => ++samples
    evaluator.resolveExternal = () => {
        if (++attempts === 1) throw Object.assign(new Error('waiting'), { blocked: true })
        return 9
    }
    const stream = readPointArgs([{ value: 'probe' }, { value: 'B.x' }], {}, s, 'jmpto')
    assert.deepEqual(stream.next().value, { type: 'blocked', target: null })
    assert.equal(closes, 1)
    assert.deepEqual(stream.next(), { value: { args: [2, 9], baseRevision: 2 }, done: true })
    assert.equal(closes, 2)
})

test('point bindings and explicit position declarations form the same law effect', () => {
    const s = state(), owner = { line: 1 }
    const point = parseProgram('let A = (5, 2, 3)')[0]
    const position = parseProgram('let A.position = (5, 2, 3)')[0]
    point.span = position.span = owner
    const [fromPoint] = [...declareValue(point, {}, s)]
    const [fromPosition] = [...declareLaw(position, {}, s)]
    assert.deepEqual(fromPoint, fromPosition)
    assert.deepEqual(fromPoint.value, [5, 2, 3])
    assert.equal(fromPoint.read, null)
})

for (const expr of ['7', '[1, 2, 3]', 'random']) {
    test(`local value binding follows effect delivery: ${expr}`, () => {
        const s = state(), scope = {}
        const stream = declareValue(parseProgram(`let a = ${expr}`)[0], scope, s)
        assert.ok(['scalar', 'parameter'].includes(stream.next().value.type))
        assert.equal(isLocal(scope, 'a'), false)
        assert.equal(stream.next().done, true)
        assert.equal(isLocal(scope, 'a'), true)
    })
}

test('a refused vector effect does not introduce a local value binding', () => {
    const s = state(), scope = {}
    s.deps.mathEvaluator.constants.probe = () => asKind([NaN], 'vector')
    const [effect] = [...declareValue(parseProgram('let a = probe')[0], scope, s)]
    assert.equal(effect.type, 'notice')
    assert.equal(isLocal(scope, 'a'), false)
})

test('an unhandled value kind uses the value binding, not an object prototype entry', () => {
    const s = state(), value = asKind([1, 2, 3], 'constructor')
    s.deps.mathEvaluator.constants.probe = () => value
    const [effect] = [...declareValue(parseProgram('let a = probe')[0], {}, s)]
    assert.equal(effect.type, 'scalar')
    assert.equal(effect.read(), value)
})
