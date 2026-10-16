import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMemo } from '../../../assets/js/turtling/mafs/parse_memo.js'
import { Parser as RealParser } from '../../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'
import { buildWorld, fork } from '../laws/harness.mjs'

function parser() {
    return {
        epoch: 0,
        calls: 0,
        parse(expr) { this.calls++; return { expr, epoch: this.epoch } },
    }
}

test('authored terms survive fallback overflow without enlarging the dynamic cache', () => {
    const p = parser()
    const terms = Array.from({ length: 1000 }, (_, i) => ({ expr: `X.x + ${i}` }))
    const trees = terms.map(term => parseMemo(p, term.expr, term))
    assert.equal(p.calls, terms.length)
    for (let i = 0; i < 2000; i++) parseMemo(p, `dynamic ${i}`)
    const before = p.calls
    terms.forEach((term, i) => assert.equal(parseMemo(p, term.expr, term), trees[i]))
    assert.equal(p.calls, before)
})

test('equal authored spellings share an expansion without sharing term ownership', () => {
    const p = parser()
    const a = {}, b = {}
    assert.equal(parseMemo(p, 'X.x + 1', a), parseMemo(p, 'X.x + 1', b))
    assert.equal(p.calls, 1)
})

test('authored expansions invalidate at the vocabulary epoch and stay parser-local', () => {
    const a = parser(), b = parser(), term = {}
    const first = parseMemo(a, 'f 1', term)
    assert.notEqual(parseMemo(b, 'f 1', term), first)
    a.epoch++
    const next = parseMemo(a, 'f 1', term)
    assert.notEqual(next, first)
    assert.equal(next.epoch, 1)
    assert.equal(parseMemo(a, 'f 1', term), next)
    assert.equal(a.calls, 2)
})

test('one authored argument region may own several expressions', () => {
    const p = parser(), args = []
    const x = parseMemo(p, 'X.x', args), y = parseMemo(p, 'Y.y', args)
    for (let i = 0; i < 600; i++) parseMemo(p, `unowned ${i}`)
    assert.equal(parseMemo(p, 'X.x', args), x)
    assert.equal(parseMemo(p, 'Y.y', args), y)
})

test('a live store larger than the fallback does not reparse its authored scalar terms', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', `let X\n${
        Array.from({ length: 600 }, (_, i) => `let s${i} = X.x + ${i}`).join('\n')
    }`))
    scheduler.tick(0)
    scheduler.readouts.recompute()
    const p = host.deps.mathParser
    const original = p.parse
    let calls = 0
    p.parse = function (...args) { calls++; return original.apply(this, args) }
    try {
        const X = host.children.get('X')
        assert.equal(scheduler.requestMotion(X, {
            rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [3, 0, 0],
        }, scheduler.motionRevision).kind, 'accept')
        scheduler.readouts.recompute()
        assert.equal(calls, 0)
        assert.equal(scheduler.readouts.value(host.scalars.get('s599')), 602)
    } finally {
        p.parse = original
    }
})

test('a REAL userspace write discards a CHANGED expanded meaning, not only an identity', () => {
    const p = new RealParser(), term = { authored: true }
    const ev = new Evaluator()
    p.defineFunction('c', '1 + 1')                 // 0-arity: parse expands the body
    const first = parseMemo(p, 'c', term)
    assert.equal(ev.run(first, {}), 2)
    p.defineFunction('c', '2 + 2')                 // userspace write -> epoch++
    const second = parseMemo(p, 'c', term)
    assert.equal(ev.run(second, {}), 4, 'a redefined body must re-expand under the new epoch')
    assert.notEqual(second, first)
    assert.equal(parseMemo(p, 'c', term), second, 'and then re-cache under the new epoch')
    p.reset()                                      // reset -> epoch++
    const third = parseMemo(p, 'c', term)
    assert.notEqual(third, second, 'reset invalidates too')
})

test('a weak authored owner does not retain its term once dropped, while the parser lives',
    { skip: typeof global.gc !== 'function' && 'run with NODE_OPTIONS=--expose-gc' },
    async () => {
        const p = new RealParser()
        let term = { authored: true }
        const ref = new WeakRef(term)
        parseMemo(p, '1 + 1', term)
        term = null
        // A WeakRef keeps its target alive to the end of the CURRENT job, so yield between
        // collections; otherwise this measures the job, not the cache.
        for (let i = 0; i < 10; i++) { await new Promise(r => setImmediate(r)); global.gc(); global.gc() }
        assert.equal(ref.deref(), undefined, 'the term cache key is weak; the parser must not root the holder')
        assert.equal(p.epoch, 0, 'the parser stayed alive across the collections')   // observable liveness
        assert.deepEqual(parseMemo(p, '9 + 9', { alive: true }), parseMemo(p, '9 + 9', { alive: true }))
    })

test('a released authored owner does not retain its AST while the parser is explicitly alive',
    { skip: typeof global.gc !== 'function' && 'run with NODE_OPTIONS=--expose-gc' },
    async () => {
        const p = new RealParser()
        let term = { authored: true }
        let tree = parseMemo(p, 'term-unique-31337 + 4', term)
        const ref = new WeakRef(tree)
        // Overflow the bounded fallback so it cannot legitimately retain this tree.
        for (let i = 0; i < 600; i++) parseMemo(p, `dyn ${i}`)
        tree = null
        term = null
        for (let i = 0; i < 10; i++) { await new Promise(r => setImmediate(r)); global.gc(); global.gc() }
        assert.equal(ref.deref(), undefined, 'the AST must follow the weak owner, not the parser')
        assert.equal(p.epoch, 0)   // parser observably alive
    })
