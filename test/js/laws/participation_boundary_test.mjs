// A shared scope policy must not reorder the consumers' different refusals.
// (id:participation-language)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'

function waiting(body) {
    const scheduler = buildWorld({ breathEvery: 0 })
    const points = scheduler.hotSwapChild('points', fork('points', 'let A'))
    drive(scheduler)
    const A = points.children.get('A')
    const spec = fork('source', `def later subject do
  wait 2
  ${body}
end
let answer = later A`)
    spec.env.scope.A = A
    const source = scheduler.hotSwapChild('source', spec)
    drive(scheduler, { maxTicks: 1 })
    const answer = source.children.get('answer')
    assert.equal(answer.done, false)
    assert.equal(answer.seed.question[0], A)
    return { scheduler, A, answer }
}

for (const [consumer, body, expected] of [
    ['facet', 'label subject.x 10', 'closed region has no world read: A.x'],
    ['receiver', 'as subject do\n    fw 1\n  end', 'retired receiver: A'],
    ['law', 'let subject.x = 1', 'a bound subject is retired'],
]) test(`${consumer}: simultaneous retirement and scope refusal keep their existing precedence`, () => {
    const { scheduler, A, answer } = waiting(body)
    // Remove both permissions deliberately: this characterizes diagnostic order.
    answer.seed.question = []
    scheduler.removeChild('points')
    drive(scheduler, { maxTicks: 8 })
    assert.equal(scheduler.registry.has(A.id), false)
    assert.deepEqual(scheduler.errors.map(e => e.message), [expected])
    assert.equal(scheduler.laws.count(), 0)
})

test('a closed missing-name read remains a scope refusal, not a dataflow suspension', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const source = scheduler.hotSwapChild('source', fork('source', `def read do
  label ghost.x 10
end
let answer = read`))
    drive(scheduler)
    const answer = source.children.get('answer')
    assert.deepEqual(scheduler.errors.map(e => e.message), ['closed region has no world read: ghost.x'])
    assert.equal(answer.suspension, null)
    assert.equal(answer.done, true)
})
