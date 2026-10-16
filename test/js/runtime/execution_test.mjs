// Generic input revisions: no frames, turtles, pointers or drawing policy.
// (id:execution-input-revisions)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createExecution } from '../../../assets/js/turtling/execution.js'
import { createReadouts } from '../../../assets/js/turtling/laws/readout.js'

function fixture() {
    const input = {}, other = {}, owner = {}, unrelated = {}
    const live = new Set([input, other, owner, unrelated])
    let releases = 0
    const execution = createExecution({
        current: item => live.has(item),
        depends: (reader, value) => reader === value || reader === owner && (value === input || value === other),
        onRelease: () => releases++,
    })
    return { input, other, owner, unrelated, live, execution, releases: () => releases }
}

test('an input revision defers dependent work, leaving independent work executable', () => {
    const w = fixture(), close = w.execution.defer(w.input)
    let ran = 0
    assert.equal(w.execution.run(w.owner, () => ran++), false)
    assert.equal(w.execution.run(w.unrelated, () => ran++), true)
    assert.equal(ran, 1)
    assert.equal(close(), true)
    assert.equal(w.execution.run(w.owner, () => ran++), true)
    assert.equal(close(), false, 'scope release is idempotent')
    assert.equal(w.releases(), 1)
})

test('overlapping scopes on one input do not release each other', () => {
    const w = fixture()
    const first = w.execution.defer(w.input), second = w.execution.defer(w.input)
    first()
    assert.equal(w.execution.permits(w.owner), false)
    second()
    assert.equal(w.execution.permits(w.owner), true)
})

test('independent input revisions compose without a global pause', () => {
    const w = fixture()
    const first = w.execution.defer(w.input), second = w.execution.defer(w.other)
    first()
    assert.equal(w.execution.permits(w.owner), false)
    assert.equal(w.execution.permits(w.input), true)
    assert.equal(w.execution.permits(w.unrelated), true)
    second()
    assert.equal(w.execution.permits(w.owner), true)
})

test('retirement revokes work, and an old scope cannot wake a successor', () => {
    const w = fixture(), close = w.execution.defer(w.input)
    w.live.delete(w.owner)
    close()
    assert.equal(w.execution.run(w.owner, () => assert.fail('retired owner ran')), false)
    const oldClose = w.execution.defer(w.input)
    w.live.delete(w.input)
    assert.equal(oldClose(), true)
    assert.equal(w.releases(), 1, 'retired input release services no new lifetime')
    assert.equal(w.execution.defer(w.input)(), false)
})

test('deferred keyed demand stays pending and coalesces without pretending to build', () => {
    const w = fixture(), readouts = createReadouts({ permits: w.execution.permits })
    let question = 0
    const built = []
    const id = readouts.register('source', 'answer', {
        scope: w.owner, seed: 0, capture: () => question,
        build: value => { built.push(value); return value },
    })
    const close = w.execution.defer(w.input)
    for (question = 1; question <= 3; question++) {
        readouts.recompute()
        readouts.drain()
        assert.equal(readouts.hasPending(), true)
        assert.equal(readouts.hasWork(), false)
        assert.deepEqual(built, [])
    }
    close()
    assert.equal(readouts.hasWork(), true)
    readouts.drain()
    assert.deepEqual(built, [3], 'service the last demanded question, not a queued history')
    assert.equal(readouts.value(id), 3)
    assert.equal(readouts.hasPending(), false)
})

test('a drain rechecks execution permission at each build, not just when collecting work', () => {
    const w = fixture(), readouts = createReadouts({ permits: w.execution.permits })
    const built = []
    let close
    readouts.register('source', 'first', {
        scope: w.unrelated, capture: () => 1,
        build() { built.push('first'); close = w.execution.defer(w.input); return 1 },
    })
    readouts.register('source', 'second', {
        scope: w.owner, capture: () => 1,
        build() { built.push('second'); return 1 },
    })
    readouts.recompute()
    readouts.drain()
    assert.deepEqual(built, ['first'])
    assert.equal(readouts.hasPending(), true)
    close()
    readouts.drain()
    assert.deepEqual(built, ['first', 'second'])
})
