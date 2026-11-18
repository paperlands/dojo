// Authored-term memo boundary — independent witnesses (1209b3a1).
//
// `mafs/parse_memo.js` clears its whole map at MAX_MEMO=512, so a store with more than 512
// unique authored expressions re-parses every term on every recompute sweep. The source-owned
// term cache must keep static authored terms without a global clear sweep, while a single
// shared shape stays a single entry.
//
// STATUS: RED BASELINE for the >512 unique case (memo fix not landed). The shared-shape
// control is green. No production/spec file is touched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScheduler, metaRoot, frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { parseProgram } from '../../../assets/js/turtling/parse.js'
import { Parser } from '../../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'

function world(src) {
    const s = createScheduler(metaRoot(), {
        createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }),
        execOpts: { color: '#e77808' },
        onShout: () => {},
    })
    s.hotSwapChild('buf', { name: 'main', code: { ast: parseProgram(src), functions: null }, style: { color: '#e77808' }, env: null })
    const host = s.root.children.get('buf')
    let now = 0
    const drain = () => { s.readouts.drain(); for (const f of s.registry.values()) f.channel.drain(); s.readouts.drain() }
    const tick = () => { now += 1000 / 24; s.tick(now) }
    const warm = n => { for (let i = 0; i < n; i++) { tick(); drain() } }
    const g = n => host.children.get(n)
    const hand = (frame, xyz) => s.requestMotion(frame, { rotation: frame.transform.deref().rotation, position: xyz }, s.motionRevision, 'world')
    return { s, g, hand, tick, drain, warm }
}

// Count parser invocations without touching a source file.
async function parsesPerSample(makeSrc, { R, TICKS = 50, S = 4 }) {
    const orig = Parser.prototype.parse
    let calls = 0
    Parser.prototype.parse = function (...a) { calls++; return orig.apply(this, a) }
    try {
        const c = world(makeSrc(R))
        c.warm(60)                     // fill the memo / settle the store
        const before = calls
        let samples = 0
        for (let t = 0; t < TICKS; t++) {
            for (let i = 0; i < S; i++) { samples++; c.hand(c.g('X'), [(t * S + i) * 0.001, 0, 0]) }
            c.tick(); c.drain()
        }
        assert.equal(c.s.errors.length, 0)
        return (calls - before) / samples
    } finally {
        Parser.prototype.parse = orig
    }
}

const uniqueScalars = R => `let X\n` + Array.from({ length: R }, (_, i) => `let s${i} = X.x + ${i}`).join('\n')
const sharedScalars = R => `let X\n` + Array.from({ length: R }, (_, i) => `let s${i} = X.x + 1`).join('\n')

test('memo: >512 unique STATIC scalar terms must not be re-parsed on every recompute', async () => {
    const per = await parsesPerSample(uniqueScalars, { R: 600 })
    assert.ok(per < 6, `re-parsed ${per} expression(s) per sample; the bounded-512 clear sweep is thrashing`)
})

test('memo control: one shared STATIC term shape is a single bounded entry', async () => {
    const per = await parsesPerSample(sharedScalars, { R: 600 })
    assert.ok(per < 1, `shared shape re-parsed ${per}/sample`)
})
