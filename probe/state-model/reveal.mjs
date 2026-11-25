// probe-status: concluded
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Group, PerspectiveCamera } from '../../assets/js/utils/three-entry.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { createPacer } from '../../assets/js/turtling/pacer.js'
import { parseProgram } from '../../assets/js/turtling/parse.js'
import { Parser } from '../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../assets/js/turtling/mafs/evaluate.js'

const home = fileURLToPath(new URL('../../assets/js/', import.meta.url))
const dir = join(home, 'turtling')
const scheduler = await readFile(join(dir, 'scheduler.js'), 'utf8')
const compositor = await readFile(join(dir, 'compositor.js'), 'utf8')
const scratch = await mkdtemp(join(tmpdir(), 'dojo-reveal-cross-'))
const emit = (caseName, value) => console.log(JSON.stringify({ case: caseName, ...value }))
function change(s, before, after) {
    assert.equal(s.split(before).length, 2, `exactly one anchor: ${before}`)
    return s.replace(before, () => after)
}
// Keep the inception control reproducible if the parallel cadence fix is present.
const cadenceReset = `            // A new play takes no cadence sample from the inter-play gap: the loop
            // did not run a frame for it. (id:render-construction-cadence)
            frameStart = null
`
const hasCadenceReset = compositor.includes(cadenceReset)
const reference = hasCadenceReset ? change(compositor, cadenceReset, '') : compositor
function eraScheduler(s) {
    s = change(s, '        held: false, // authorization for this play, not a change to execution.permits',
        '        held: false, contextEra: 0, // scratch')
    return change(s, '        set held(next) { pump.held = next },', `        set held(next) {
            if (next !== pump.held) { pump.held = next; pump.contextEra++ }
        },
        get contextEra() { return pump.contextEra },
        beginRevealEra() { pump.held = false; pump.contextEra++ },`)
}
function rawCompositor(s, mode) {
    const era = mode.startsWith('era'), paired = mode === 'era-paired'
    s = change(s, 'import { rebaseEpoch, idleFloorMs }', 'import { idleFloorMs }')
    const start = s.indexOf('    let epoch = null'), end = s.indexOf('    const held = () =>')
    assert.ok(start >= 0 && end > start)
    s = change(s, s.slice(start, end), `    let previous = null
    let H = 0
${era ? '' : '    let context = {}\n'}`)
    // Pacing parity belongs to the control. Its wall gap is independent of grant validity.
    s = change(s, '    let frameStart = null', '    let frameStart = null\n    let paceWall = null')
    s = change(s, '            lastNow = frameStart = null\n            sample = {}', era
        ? '            frameStart = null'
        : '            previous = frameStart = null\n            context = {}')
    s = change(s, `            scheduler.held = false
            epoch = null
            lastWallT = null
            H = 0            // a new play resets the horizon and its elapsed baseline together
            lastNow = null
            sample = {}`, `            ${era ? 'scheduler.beginRevealEra()' : 'scheduler.held = false\n            context = {}'}
            paceWall = null
            H = 0
            previous = null`)
    const before = s.indexOf('            // Idle-out: rebase'), after = s.indexOf('            // Drain at the current H FIRST:')
    assert.ok(before >= 0 && after > before)
    s = change(s, s.slice(before, after), `            const idledOut = paceWall !== null && t - paceWall > IDLE_GAP_MS
            paceWall = t
            const contextAt = ${era ? 'scheduler.contextEra' : 'context'}
            const gap = previous && previous.contextAt === contextAt ? Math.max(0, t - previous.t) : 0
            const allowance = gap > IDLE_GAP_MS ? FRAME_MS : gap
            const cell = previous = { t, contextAt }
`)
    s = change(s, 'claim === sample', era ? 'contextAt === scheduler.contextEra' : mode === 'cell' ? 'cell === previous' : 'contextAt === context')
    if (!paired) return s
    return change(s, `            if (frameStart !== null) {
                if (held() || idledOut) pacer.skip()
                else pacer.observe(t - frameStart)
            }
            frameStart = t`, `            if (!hasGap || contextAt !== scheduler.contextEra || held() || idledOut) pacer.skip()
            else pacer.observe(gap)`)
        .replace('    let frameStart = null\n    let paceWall = null\n', '')
        .replace('            frameStart = null\n', '')
        .replace('            paceWall = null\n', '')
        .replace('            const idledOut = paceWall !== null && t - paceWall > IDLE_GAP_MS\n            paceWall = t\n', '')
        .replace('            const gap = previous && previous.contextAt === contextAt ? Math.max(0, t - previous.t) : 0',
            `            const hasGap = previous !== null && previous.contextAt === contextAt
            const gap = hasGap ? Math.max(0, t - previous.t) : 0
            const idledOut = gap > IDLE_GAP_MS`)
}
async function load(mode) {
    const base = join(scratch, mode), turtle = join(base, 'turtling')
    await mkdir(turtle, { recursive: true })
    for (const item of await readdir(home)) if (item !== 'turtling') await symlink(join(home, item), join(base, item))
    for (const item of await readdir(dir)) if (!['scheduler.js', 'compositor.js'].includes(item)) await symlink(join(dir, item), join(turtle, item))
    await writeFile(join(turtle, 'scheduler.js'), mode.startsWith('era') ? eraScheduler(scheduler) : scheduler)
    await writeFile(join(turtle, 'compositor.js'), mode === 'current' ? compositor : mode === 'landed' ? reference : rawCompositor(reference, mode))
    const mod = name => import(pathToFileURL(join(turtle, `${name}.js`)).href)
    return { ...await mod('scheduler'), ...await mod('compositor') }
}
function setup(m, source = 'loop 1000 do\n  rt 1\n  wait 0.1\nend', adaptive = false) {
    const s = m.createScheduler(m.metaRoot(), { createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }), execOpts: { color: '#c02' }, clock: () => 0 })
    const replace = () => s.hotSwapChild('host', { name: 'host', code: { ast: parseProgram(source) }, style: { color: '#c02' } }, { fresh: true })
    replace()
    const pacing = [], actualPacer = createPacer()
    const c = m.createCompositor(s, { scene: new Group(), camera: new PerspectiveCamera(),
        materials: { getInk() { return {} }, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { frameMs: 16, createText() { throw new Error('no authored labels') },
        pacer: { get budgetMs() { return adaptive ? actualPacer.budgetMs : 1 },
            observe(gap) { pacing.push(gap); actualPacer.observe(gap) },
            skip() { pacing.push('skip'); actualPacer.skip() } },
        focus: { kindled: null, isFocused: () => false, inFocusedSubtree: () => false } })
    const read = () => ({ H: s.lastTickTime, elapsed: s.root.children.get('host').elapsedTime, F: s.root._frontier })
    const dispose = () => { assert.deepEqual(s.errors, []); c.dispose() }
    return { s, c, replace, read, dispose, pacing, budget: () => actualPacer.budgetMs }
}

function inside(m, kind, at) {
    const w = setup(m, 'wait 100')
    w.c.advance(0); w.c.advance(40)
    assert.equal(w.read().H, 40)
    const drain = w.s.readouts.drain
    if (kind === 'outside-raw') { w.s.held = true; w.s.held = false }
    else w.s.readouts.drain = (...args) => {
        w.s.readouts.drain = drain
        if (kind === 'public') { w.c.setHeld(true); w.c.setHeld(false) }
        if (kind === 'raw') { w.s.held = true; w.s.held = false }
        if (kind === 'noop') w.s.held = false
        if (kind === 'nested') w.c.advance(at)
        if (kind === 'play') { w.c.beginPlay(); w.replace() }
        if (kind === 'play-only') w.c.beginPlay()
        if (kind === 'fresh-only') w.replace()
        return drain(...args)
    }
    w.c.advance(60)
    const at60 = w.read().H
    w.c.advance(100)
    const at100 = w.read().H
    w.dispose()
    return [at60, at100]
}

const steps = [10.2, 26.5, 110.2, 110.3, 240.15, 'flush', 2250.15, 2700.7, 'hold',
    2716.7, 5300.7, 'resume', 5400.9, 5500.9, 'unsettled', 6000.23, 'settled', 6030.75,
    'play', 39000.75, 39016.75, 39100.75, 'hold', 'resume', 39250.75, 39500.15, 41560.27]
function series(m, schedule = steps) {
    const w = setup(m)
    const gate = w.s.isSettledThrough
    const trace = []
    for (const step of schedule) {
        if (step === 'play') { w.c.beginPlay(); w.replace() }
        else if (step === 'hold' || step === 'resume') w.c.setHeld(step === 'hold')
        else if (step === 'flush') w.c.flush()
        else if (step === 'unsettled') w.s.isSettledThrough = () => false
        else if (step === 'settled') w.s.isSettledThrough = gate
        else w.c.advance(step)
        trace.push(w.read())
    }
    w.dispose()
    return { trace, pacing: w.pacing }
}

try {
    const hash = s => createHash('sha256').update(s).digest('hex')
    emit('sources', { node: process.version, scheduler: hash(scheduler), compositor: hash(compositor) })
    const modes = {}
    for (const name of ['current', 'landed', 'raw', 'era', 'cell', 'era-paired']) modes[name] = await load(name)
    const rows = Object.fromEntries(Object.entries(modes).map(([name, m]) => [name,
        Object.fromEntries([['public'], ['raw'], ['outside-raw'], ['noop'], ['play'], ['play-only'], ['fresh-only'], ['nested-equal',60], ['nested-later',80]]
            .map(([label, t]) => [label, inside(m, t ? 'nested' : label, t)]))]))
    emit('interleavings', rows)
    assert.deepEqual(rows.landed, rows.raw, 'raw-gap only does not alter authority')
    assert.deepEqual(rows.landed.public, [40, 40]); assert.deepEqual(rows.landed.raw, [60, 100]);
    assert.deepEqual(rows.era.raw, [40, 40]); assert.deepEqual(rows.era['outside-raw'], [40, 80]);
    assert.deepEqual(rows.era.noop, rows.landed.noop); assert.deepEqual(rows.era.play, [0, 0])
    assert.deepEqual(rows.era['nested-equal'], [60, 100]); assert.deepEqual(rows.era['nested-later'], [80, 100]);
    assert.deepEqual(rows.cell['nested-equal'], [40, 80]); assert.deepEqual(rows.cell['nested-later'], [60, 80]);
    const control = series(modes.landed)
    for (const name of ['raw', 'era']) {
        const other = series(modes[name])
        const diffs = control.trace.map((x, i) => Math.abs(x.H - other.trace[i].H))
        const flips = control.trace.flatMap((x, i) => Array.from({ length: 100 }, (_, n) => (n + 1) * 100)
            .filter(wait => (wait <= x.H) !== (wait <= other.trace[i].H)).map(wait => [steps[i], wait]))
        const authored = control.trace.flatMap((x, i) => x.elapsed !== other.trace[i].elapsed || x.F !== other.trace[i].F
            ? [{ step: steps[i], control: x, arm: other.trace[i] }] : [])
        emit('cadence', { name, points: diffs.length, maxDelta: Math.max(...diffs), flips, authored,
            pacingEqual: JSON.stringify(control.pacing) === JSON.stringify(other.pacing), pacing: other.pacing })
        assert.ok(Math.max(...diffs) < 0.000001)
        assert.deepEqual(other.pacing, control.pacing)
    }
    const threshold = [0.1, 'unsettled', 1000.1, 'settled', 1100.1]
    const exact = series(modes.landed, threshold).trace.at(-1)
    const justBelow = series(modes.raw, threshold).trace.at(-1)
    emit('exact-wait-boundary', { threshold, landed: exact, raw: justBelow })
    assert.equal(exact.H, 100)
    assert.ok(justBelow.H < 100)
    assert.ok(exact.elapsed > justBelow.elapsed, 'the discrepancy changes a real authored turn')
    const paced = Object.fromEntries(['current', 'landed', 'era-paired'].map(name => {
        const w = setup(modes[name], 'wait 100', true)
        w.c.advance(0); w.c.advance(16)
        const before = w.budget()
        w.c.beginPlay(); w.replace(); w.c.advance(516)
        const r = { before, after: w.budget(), observed: w.pacing.at(-1), H: w.read().H }
        w.dispose()
        return [name, r]
    }))
    emit('first-frame-of-a-new-play', paced)
    assert.deepEqual(paced.landed, { before: 4, after: 2, observed: 500, H: 0 })
    assert.deepEqual(paced.current, hasCadenceReset ? { before: 4, after: 4, observed: 16, H: 0 } : paced.landed)
    assert.deepEqual(paced['era-paired'], { before: 4, after: 4, observed: 'skip', H: 0 })
    const pausedWait = Object.fromEntries(['landed', 'era-paired'].map(name => {
        const w = setup(modes[name], 'wait 0.1\nrt 1')
        w.c.advance(0); w.c.advance(60)
        w.c.setHeld(true); w.c.advance(700); w.c.setHeld(false)
        w.c.advance(710)
        const hasRemainder = !w.s.done, resumed = w.read().H
        w.c.advance(750)
        const r = { hasRemainder, resumed, final: w.read().H, done: w.s.done,
            observed: w.pacing.filter(p => p !== 'skip').slice(1) }
        w.dispose()
        return [name, r]
    }))
    emit('partly-elapsed-wait', pausedWait)
    for (const r of Object.values(pausedWait)) {
        assert.deepEqual(r, { hasRemainder: true, resumed: 60, final: 100, done: true, observed: [40] })
    }
} finally {
    await rm(scratch, { recursive: true, force: true })
}
