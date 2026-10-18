// A numeric function holds only bindings its operand substitutions can consume.
// Supplied beings stay at the recipe boundary, not in an unused value copy. (id:tower-capture-operands)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Parser } from '../../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'
import { buildWorld, fork, drive } from '../laws/harness.mjs'

function algebra() {
    const parser = new Parser(), evaluator = new Evaluator()
    evaluator.userFunctions = parser.userspace
    return { parser, evaluator }
}
const cycle = () => { const value = {}; value.self = value; return value }

test('an unused cyclic context value does not prevent numeric definition', () => {
    const { parser, evaluator } = algebra()
    parser.defineFunction('square(v)', 'v*v', { unused: cycle() })
    assert.equal(evaluator.applyFunction('square', [3]), 9)
})

test('unused context getters are not acquired', () => {
    const { parser, evaluator } = algebra()
    let reads = 0
    const context = { get unused() { reads++; throw new Error('unused binding acquired') } }
    parser.defineFunction('identity(v)', 'v', context)
    assert.equal(evaluator.applyFunction('identity', [7]), 7)
    assert.equal(reads, 0)
})

test('referenced bindings are sampled once in context order, not once per operand', () => {
    const { parser, evaluator } = algebra()
    const reads = []
    const context = {
        get alpha() { reads.push('alpha'); return 5 },
        get beta() { reads.push('beta'); return 7 },
    }
    parser.defineFunction('sum(v)', 'v+beta+alpha+alpha', context)
    assert.deepEqual(reads, ['alpha', 'beta'])
    assert.equal(evaluator.applyFunction('sum', [1]), 18)
    assert.equal(evaluator.applyFunction('sum', [2]), 19)
    assert.deepEqual(reads, ['alpha', 'beta'])
})

test('formal operands shadow context values without acquiring them', () => {
    const { parser, evaluator } = algebra()
    parser.defineFunction('plus(v)', 'v+1', { get v() { throw new Error('shadowed binding acquired') } })
    assert.equal(evaluator.applyFunction('plus', [4]), 5)
})

test('referenced scalar and vector values remain definition-time copies', () => {
    const { parser, evaluator } = algebra()
    const context = { amount: 5, offset: [3, 4, 0], unused: cycle() }
    parser.defineFunction('plus(v)', 'v+amount', context)
    parser.defineFunction('shift(v)', 'v+offset', context)
    context.amount = 99
    context.offset[0] = 99
    assert.equal(evaluator.applyFunction('plus', [2]), 7)
    assert.deepEqual(evaluator.applyFunction('shift', [[1, 0, 0]]), [4, 4, 0])
})

test('function names and quoted contents are not operand captures', () => {
    const { parser, evaluator } = algebra()
    parser.defineFunction('sine(v)', 'sin(v)', { sin: cycle() })
    parser.defineFunction('word(v)', '"unused"', { unused: cycle() })
    parser.defineFunction('call(v)', 'subject.bias(v)', { 'subject.bias': cycle() })
    assert.equal(evaluator.applyFunction('sine', [0]), 0)
    assert.equal(evaluator.applyFunction('word', [0]), 'unused')
    const [body] = parser.userspace.get('call:1')
    assert.equal(body.type, 'function')
    assert.equal(body.value, 'subject.bias')
})

test('a literal payload that resembles an operand is still data', () => {
    const { parser, evaluator } = algebra()
    const payload = { type: 'operand', value: 'unused', children: [{ type: 'operand', value: 'unused' }] }
    parser.defineFunction('data', 'value', { value: payload })
    parser.defineFunction('copy(v)', 'data', { unused: cycle() })
    assert.deepEqual(evaluator.applyFunction('copy', [0]), payload)
})

test('capture follows operands after zero-arity expansion, not the expanded spelling', () => {
    const { parser, evaluator } = algebra()
    parser.defineFunction('reading', 'outside.x')
    parser.defineFunction('plus(v)', 'v+reading', { 'outside.x': 7, reading: cycle() })
    assert.equal(evaluator.applyFunction('plus', [3]), 10)
})

test('an exact dotted key is held, while an unbound n-ary dotted reading stays live', () => {
    const { parser, evaluator } = algebra()
    parser.defineFunction('held(v)', 'v+outside.x', { 'outside.x': 7, outside: cycle() })
    parser.defineFunction('live(v)', 'v+outside.x')
    let x = 10
    evaluator.resolveExternal = name => name === 'outside.x' ? x : undefined
    assert.equal(evaluator.applyFunction('held', [3]), 10)
    assert.equal(evaluator.applyFunction('live', [3]), 13)
    x = 20
    assert.equal(evaluator.applyFunction('held', [3]), 10)
    assert.equal(evaluator.applyFunction('live', [3]), 23)
})

test('a referenced unsupported cyclic value is not silently dropped or partly installed', () => {
    const { parser, evaluator } = algebra()
    parser.defineFunction('kept(v)', 'v+1')
    const epoch = parser.epoch, accepted = parser.userspace.get('kept:1')
    assert.throws(() => parser.defineFunction('kept(v)', 'v+used', { used: cycle() }))
    assert.equal(parser.userspace.get('kept:1'), accepted)
    assert.equal(parser.epoch, epoch)
    assert.equal(evaluator.applyFunction('kept', [3]), 4)
})

test('a source recipe can define numeric functions beside an unused supplied being', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A
let B
def compute subject amount do
  fn plus(v) (v+amount)
end
let result = compute A 5`))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    const A = host.children.get('A'), B = host.children.get('B'), result = host.children.get('result')
    assert.equal(result.seed.question[0], A)
    assert.equal(scheduler.registry.get(A.id), A)
    assert.equal(scheduler.registry.get(B.id), B)
    assert.equal(result.deps.mathEvaluator.applyFunction('plus', [3]), 8)
    assert.deepEqual(A.transform.deref().position, [0, 0, 0])
    assert.deepEqual(B.transform.deref().position, [0, 0, 0])
})

test('free qualified local subjects refuse instead of escaping to ambient lookup', () => {
    for (const body of ['v+subject.x', 'subject.bias(v)']) {
        const { parser } = algebra()
        parser.defineFunction('kept(v)', 'v+1')
        const accepted = parser.userspace.get('kept:1'), epoch = parser.epoch
        assert.throws(() => parser.defineFunction('kept(v)', body, { subject: cycle() }), /qualified binding.*subject/)
        assert.equal(parser.userspace.get('kept:1'), accepted)
        assert.equal(parser.epoch, epoch)
    }
})

test('quoted subjects remain explicit spellings rather than captured context bindings', () => {
    const { parser } = algebra()
    parser.defineFunction('read(v)', '"subject".x+v', { subject: cycle() })
    parser.defineFunction('call(v)', '"subject".bias(v)', { subject: cycle() })
    assert.ok(parser.userspace.has('read:1'))
    assert.ok(parser.userspace.has('call:1'))
})

test('a free supplied alias cannot silently read a different also-permitted namesake', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A=(10,0,0)
let being=(99,0,0)
def make being alternate amount do
  fn sum(v) (v+amount+being.x)
end
let helper=make A being 5`))
    drive(scheduler)
    const helper = host.children.get('helper')
    assert.equal(helper.seed.question[0], host.children.get('A'))
    assert.equal(helper.seed.question[1], host.children.get('being'))
    assert.ok(scheduler.errors.some(e => /qualified binding.*being/.test(e.message)))
    assert.equal(helper.deps.mathParser.userspace.has('sum:1'), false)
})

test('an explicit numeric-function subject parameter keeps the supplied original identity', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A=(10,0,0)
let being=(99,0,0)
def make being alternate amount do
  fn sum(being,v) (v+amount+being.x)
  fw sum[being,3]
end
let helper=make A being 5`))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    const helper = host.children.get('helper'), A = host.children.get('A')
    assert.equal(helper.seed.question[0], A)
    assert.equal(helper.deps.mathEvaluator.applyFunction('sum', [A, 3]), 18)
    assert.deepEqual(helper.transform.deref().position, [18, 0, 0])
})
