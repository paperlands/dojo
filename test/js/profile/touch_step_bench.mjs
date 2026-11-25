// Headless M1 benchmark; pass the worktree at 795b304, not the active Dojo tree.
// N=8000 REPS=7 node test/js/profile/touch_step_bench.mjs /path/to/touch-mendel
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const tree = process.argv[2]
if (!tree) throw new Error('Pass the isolated experiment/touch-mendel worktree at 795b304.')
const load = (file) => import(pathToFileURL(join(resolve(tree), file)).href)
const { createScheduler, metaRoot } = await load('assets/js/turtling/scheduler.js')
const { segmentContact } = await load('assets/js/turtling/laws/path.js')
const { deps, fork, worldOf } = await load('test/js/laws/harness.mjs')

const N = Number(process.env.N ?? 8000)
const REPS = Number(process.env.REPS ?? 7)
const pass = ({ requested }) => ({ accepted: true, transform: requested })
const variants = {
    direct: {},
    'identity admission': { motionAdmission: pass },
    'guarded miss': { contactFixture: { owner: 'w', id: 'S', from: [-10, -2, 0], to: [-10, 2, 0] } },
}

function walk(opts, n) {
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps, execOpts: { color: '#000000', strokeMax: 32, breathEvery: 64 },
        channelCapacity: 64, clock: () => 0, onShout() {}, ...opts,
    })
    const w = scheduler.hotSwapChild('w', fork('w', `loop ${n} do\nfw 1\nend`), { deferStart: true })
    let ticks = 0, paths = 0, lastInk
    const start = performance.now()
    while (!scheduler.done && ++ticks < n * 2 + 64) {
        scheduler.tick(ticks)
        for (const event of w.channel.drain()) {
            if (event.type === 'path') { paths++; lastInk = event.points.at(-1) }
        }
    }
    const ms = performance.now() - start
    assert.ok(scheduler.done, 'workload must complete')
    assert.deepEqual(scheduler.errors, [])
    assert.deepEqual(worldOf(w), [n, 0, 0])
    assert.deepEqual(lastInk, [n, 0, 0])
    assert.equal(w.commandCount, n)
    return { us: ms * 1000 / n, ticks, paths }
}

const labels = process.env.CASE ? [process.env.CASE] : Object.keys(variants)
for (const k of labels) assert.ok(Object.hasOwn(variants, k), `unknown CASE: ${k}`)
for (let i = 0; i < 3; i++) for (const k of labels) walk(variants[k], Math.min(N, 3000))
const samples = Object.fromEntries(labels.map((k) => [k, []]))
for (let i = 0; i < REPS; i++) {
    for (let j = 0; j < labels.length; j++) {
        const k = labels[(i + j) % labels.length]
        samples[k].push(walk(variants[k], N))
    }
}
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)]
const median = (xs) => quantile(xs, 0.5)
for (const k of labels) {
    const row = samples[k]
    console.log(`${k}: μs/fw ${row.map(x => x.us.toFixed(2)).join(' ')} | median ${median(row.map(x => x.us)).toFixed(2)} | ticks ${median(row.map(x => x.ticks))} | paths ${median(row.map(x => x.paths))}`)
}
for (const k of labels.slice(1)) {
    const ratios = samples[k].map((x, i) => x.us / samples.direct[i].us)
    console.log(`${k}/direct: paired median ${median(ratios).toFixed(2)}×`)
}


const geometry = Array.from({ length: 64 }, (_, i) => {
    const x = 2 + (i % 32) / 4
    return { from: [0, i, 0], to: [10, i, 0], screen: { from: [x, i - 2, 0], to: [x, i + (i % 2 ? 2 : -1), 0] } }
})
function kernel(n) {
    let hits = 0
    const start = performance.now()
    for (let i = 0; i < n; i++) hits += Number(segmentContact(geometry[i % geometry.length]).kind === 'point')
    const us = (performance.now() - start) * 1000 / n
    assert.equal(hits, n / 2)
    return us
}
if (!process.env.CASE) {
    for (let i = 0; i < 3; i++) kernel(10000)
    const kernels = Array.from({ length: REPS }, () => kernel(300000))
    console.log(`segment kernel 50/50 hit/miss: μs/query ${kernels.map(x => x.toFixed(3)).join(' ')} | median ${median(kernels).toFixed(3)}`)
}
