// probe-status: concluded
// Read-only S2/S9/S11 discriminators; see also refusal_characterization_test.mjs.
import assert from 'node:assert/strict'
import { createCompositor } from '../../assets/js/turtling/compositor.js'
import { createFocus } from '../../assets/js/turtling/focus.js'
import { createPacer } from '../../assets/js/turtling/pacer.js'
import { createMaterialCache } from '../../assets/js/turtling/render/line/material-cache.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { Group, Vector3 } from '../../assets/js/utils/three-entry.js'
import { buildWorld, fork, world } from '../../test/js/laws/harness.mjs'

function runCandidate(admit) {
    const shouts = [], paths = []
    const scheduler = buildWorld({ admit, onShout: (...args) => shouts.push(args),
        capacity: 64, strokeMax: 0, breathEvery: 64, clock: () => 0 })
    scheduler.hotSwapChild('host', fork('host', 'let D = 10\nfw D\nshout "preview" 1'),
        { fresh: true, deferStart: true })
    for (let i = 0; i < 16 && !scheduler.done; i++) {
        scheduler.tick(0)
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) {
                if (event.type === 'path') paths.push(event.points)
            }
        }
    }
    assert.equal(scheduler.done, true)
    assert.deepEqual(scheduler.errors, [])
    return { x: world('host', scheduler)[0], inkEnd: paths.at(-1)?.at(-1)[0] ?? null, shouts: shouts.length }
}

const candidates = {
    standalone: runCandidate(),
    constrained: runCandidate(({ requested }) => ({ accepted: true,
        transform: { ...requested, position: requested.position.map(n => n / 2) } })),
    refused: runCandidate(() => ({ accepted: false, message: 'not here' })),
}
assert.deepEqual(candidates, {
    standalone: { x: 10, inkEnd: 10, shouts: 1 },
    constrained: { x: 5, inkEnd: 5, shouts: 1 },
    refused: { x: 0, inkEnd: null, shouts: 1 },
})
console.log('S2 same code, different motion context:', candidates)

function workFixture({ initiallySpent = false, breathEvery = 4, countMotion = true } = {}) {
    let work = 0, spent = initiallySpent
    const cadence = []
    const scheduler = buildWorld({ capacity: 64, strokeMax: 0, breathEvery,
        clock: () => spent ? work += 4 : work,
        admit: ({ requested }) => { if (countMotion) work++; return { accepted: true, transform: requested } } })
    const materials = createMaterialCache()
    const compositor = createCompositor(scheduler, {
        scene: new Group(), camera: { position: new Vector3(0, 0, 1000) }, materials,
        requestRender() {}, viewOffset: () => SE3.identity(),
    }, {
        focus: createFocus(scheduler), createText() { throw Error('fixture only walks') },
        pacer: { budgetMs: 2, observe: dt => cadence.push(dt), skip() {} },
    })
    const read = () => ({ H: scheduler.lastTickTime, x: world('host', scheduler)[0], work })
    return { scheduler, compositor, cadence, read, openSlice() { spent = false } }
}

function repeatTimestamp(source) {
    const { scheduler, compositor, cadence, read } = workFixture()
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    try {
        compositor.advance(1000)
        const first = read()
        compositor.advance(1000)
        const second = read()
        compositor.flush()
        const flushed = read()
        assert.deepEqual(cadence, [0])
        assert.deepEqual([first.H, second.H, flushed.H], [0, 0, 0])
        return { first, second, flushed }
    } finally { compositor.dispose() }
}

const waiting = repeatTimestamp('fw 1\nwait 0.1\nfw 2')
assert.equal(waiting.first.x, 1)
assert.deepEqual(waiting.second, waiting.first)
assert.deepEqual(waiting.flushed, waiting.first)
const busy = repeatTimestamp('loop 100 do\n fw 1\nend')
assert.ok(busy.second.work > busy.first.work, 'another frame services due work at the held H')
assert.ok(busy.flushed.work > busy.second.work, 'a synchronous flush also services due work at the held H')
const pacer = createPacer()
const budget = pacer.budgetMs
assert.ok(pacer.observe(0) > budget, 'a frozen frame timestamp registers as calm, not paused')
console.log('S9 same frame timestamp, different obligations:', { waiting, busy, budget, calmBudget: pacer.budgetMs })

function budgetWound(initiallySpent) {
    const { scheduler, compositor, openSlice } = workFixture({ initiallySpent, breathEvery: 1, countMotion: false })
    const source = 'loop 500 do\n fw 1\nend\nnope'
    const wounds = () => scheduler.errors.map(({ kind, span }) => [kind, span.line])
    try {
        compositor.beginPlay()
        scheduler.withSlice(2, () => scheduler.hotSwapChild('host', fork('host', source), { fresh: true }))
        compositor.flush()
        const initial = wounds()
        openSlice()
        compositor.advance(1000)
        return { initial, later: wounds() }
    } finally { compositor.dispose() }
}

const open = budgetWound(false), spent = budgetWound(true)
assert.deepEqual(open, { initial: [['walk', 4]], later: [['walk', 4]] })
assert.deepEqual(spent, { initial: [], later: [['walk', 4]] })
console.log('S11 same source, different first-flush diagnosis:', JSON.stringify({ open, spent }))
