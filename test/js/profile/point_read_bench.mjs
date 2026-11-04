// Model-only point passes, including preparation; no DOM, projection or GPU.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { buildWorld, fork, drive } from '../laws/harness.mjs'
import { pointStateOf, preparePointRead } from '../../../assets/js/turtling/laws/point_state.js'

const samples = Number(process.env.SAMPLES ?? 24)
const counts = (process.env.POINTS ?? '10,100,500').split(',').map(Number)
const percentile = (times, p) => [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * p))]

for (const count of counts) {
    const scheduler = buildWorld({ capacity: 4096, breathEvery: 1024 })
    const host = scheduler.hotSwapChild('host', fork('host',
        Array.from({ length: count }, (_, i) => `let P${i}=(${i},0,0)`).join('\n')))
    drive(scheduler, { maxTicks: 10000 })
    assert.equal(host.error, null)
    assert.equal(host.unresolved, null)
    assert.equal(scheduler.done, true)
    const points = [...host.children.values()]
    const reading = preparePointRead(scheduler)
    for (const point of points) assert.deepEqual(reading(point), pointStateOf(point, scheduler))

    const passes = {
        scanning() { for (const point of points) pointStateOf(point, scheduler) },
        shared() {
            const laws = scheduler.laws.active()
            for (const point of points) pointStateOf(point, scheduler, laws)
        },
        prepared() {
            const read = preparePointRead(scheduler)
            for (const point of points) read(point)
        },
    }
    const original = scheduler.laws.active.bind(scheduler.laws)
    let snapshots = 0, records = 0
    scheduler.laws.active = () => {
        const laws = original()
        snapshots++
        records += laws.length
        return laws
    }
    const countsByPass = {}
    for (const [name, pass] of Object.entries(passes)) {
        snapshots = records = 0
        pass()
        countsByPass[name] = { snapshots, records }
    }
    scheduler.laws.active = original

    const names = Object.keys(passes)
    const times = Object.fromEntries(names.map(name => [name, []]))
    for (let i = 0; i < 10 + samples; i++) {
        for (let offset = 0; offset < names.length; offset++) {
            const name = names[(i + offset) % names.length]
            const start = performance.now()
            passes[name]()
            const elapsed = performance.now() - start
            if (i >= 10) times[name].push(elapsed)
        }
    }
    console.log(JSON.stringify({ points: points.length, laws: scheduler.laws.count(), samples,
        passes: Object.fromEntries(names.map(name => [name, {
            ...countsByPass[name], p50ms: percentile(times[name], .5), p95ms: percentile(times[name], .95),
        }])),
    }))
}
