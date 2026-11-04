// M3 memo window, corrected: BASE-parameterized (production vs exact pre-Wave3 ablation),
// independent monotonic sampleSeq (identical poses across arms), asserted sample count and
// readout size. Windowed GC only.
//
//   M3BASE=<turtling dir> [EXPR=x-one|x-unique] [R=] [REPS=] node --expose-gc memo_cell2.mjs
// No repo edits.

import { performance, PerformanceObserver } from 'node:perf_hooks'
import assert from 'node:assert/strict'

const BASE = process.env.M3BASE ?? '/home/putra/dojo/assets/js/turtling/'
const R = Number(process.env.R ?? 1000)
const S = Number(process.env.S ?? 8)
const TICKS = Number(process.env.TICKS ?? 300)
const WARM = Number(process.env.WARM ?? 60)
const CAP = Number(process.env.CAP ?? 64)
const EXPR = process.env.EXPR ?? 'x-unique'
const REPS = Number(process.env.REPS ?? 1)

const { createScheduler, metaRoot, frameWorldTransform } = await import(BASE + 'scheduler.js')
const { parseProgram } = await import(BASE + 'parse.js')
const { Parser } = await import(BASE + 'mafs/parse.js')
const { Evaluator } = await import(BASE + 'mafs/evaluate.js')

const _orig = Parser.prototype.parse
let parseCalls = 0

const exprFor = i => EXPR === 'x-one' ? 'X.x + 1' : `X.x + ${i}`
const SRC = `let X\n` + Array.from({ length: R }, (_, i) => `let s${i} = ${exprFor(i)}`).join('\n')

async function once() {
    const s = createScheduler(metaRoot(), { createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }), execOpts: { color: '#e77808' }, onShout: () => {} })
    s.hotSwapChild('buf', { name: 'main', code: { ast: parseProgram(SRC), functions: null }, style: { color: '#e77808' }, env: null })
    const host = s.root.children.get('buf')
    let now = 0, sampleSeq = 0, accepted = 0
    const drain = () => { s.readouts.drain(); for (const f of s.registry.values()) f.channel.drain(); s.readouts.drain() }
    const tick = () => { now += 1000 / 24; s.tick(now); drain() }
    const gcNow = () => { if (global.gc) { global.gc(); global.gc() } }
    const gc = []
    const obs = new PerformanceObserver(l => { for (const e of l.getEntries()) gc.push({ start: e.startTime, dur: e.duration }) })
    obs.observe({ entryTypes: ['gc'] })

    const flood = n => { for (let i = 0; i < n; i++) { const x = (sampleSeq++) * 0.001; const v = s.requestMotion(X, { rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [x, 0, 0] }, s.motionRevision, 'world'); if (v.kind === 'accept') accepted++ } }
    const X = host.children.get('X')

    for (let t = 0; t < WARM; t++) { flood(S); tick() }
    gcNow()
    const parse0 = parseCalls, accepted0 = accepted, seq0 = sampleSeq
    const t0 = performance.now()
    const walls = []
    for (let t = 0; t < TICKS; t++) { const a = performance.now(); flood(S); walls.push(performance.now() - a); tick() }
    const wall = performance.now() - t0
    const t1 = performance.now()
    gcNow()
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))
    obs.disconnect()
    const stats = s.readouts.stats()
    const samples = sampleSeq - seq0
    assert.equal(accepted - accepted0, samples, 'every sampled pose was accepted')
    assert.equal(stats.size, R, 'readout size is R')
    assert.equal(s.errors.length, 0)
    const gcMs = gc.filter(e => e.start >= t0 && e.start <= t1).reduce((a, e) => a + e.dur, 0)
    walls.sort((a, b) => a - b)
    return { parsePerSample: (parseCalls - parse0) / samples, msPerSample: wall / samples, gcMs: +gcMs.toFixed(1), wall: +wall.toFixed(1), samples }
}

const runs = []
Parser.prototype.parse = function (...a) { parseCalls++; return _orig.apply(this, a) }
try {
    for (let r = 0; r < REPS; r++) runs.push(await once())
} finally { Parser.prototype.parse = _orig }

const ms = runs.map(r => r.msPerSample)
console.log(JSON.stringify({
    base: BASE, expr: EXPR, R, reps: REPS,
    parsePerSample: runs.map(r => +r.parsePerSample.toFixed(3)),
    msPerSample: ms.map(m => +m.toFixed(4)),
    msPerSampleMed: +[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(4),
    gcMs: runs.map(r => r.gcMs), samples: runs[0].samples,
}))
