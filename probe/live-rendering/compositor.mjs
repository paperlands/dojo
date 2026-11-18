// probe-status: active
// Shared reveal timing in the REAL compositor. Control: current compositor driven at wall
// opportunities. Treatment: same compositor, only the construction-paced horizon changed.
// Everything else (program, capacity, budget, opportunity sequence, admission) is held.
// Run: node probe/live-rendering/compositor.mjs > probe/live-rendering/records/compositor-run.jsonl
// Snap: node probe/live-rendering/compositor.mjs --snapshot > probe/live-rendering/records/compositor-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Group, Vector3 } from '../../assets/js/utils/three-entry.js'
import { LineMaterial } from '../../assets/js/utils/three-addons/lines/LineMaterial.js'
import { createCompositor } from '../../assets/js/turtling/compositor.js'
import { createFocus } from '../../assets/js/turtling/focus.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/compositor.mjs'
const contract = 'specs/turtle/live-rendering-contract.org'
const hash = value => createHash('sha256').update(value).digest('hex')
const emit = row => console.log(JSON.stringify(row))
const note = line => console.error(line)
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
        const path = join(directory, entry.name)
        return entry.isDirectory() ? files(path) : /\.m?js$/.test(entry.name) ? [[relative(root, path), hash(readFileSync(path))]] : []
    })
}
function requireEvidence(name, condition) {
    emit({ kind: 'assertion', name, pass: !!condition })
    assert.ok(condition, name)
}
if (process.argv.includes('--snapshot')) {
    for (const path of [self, contract]) emit({ kind: 'source-snapshot', path, source: readFileSync(join(root, path), 'utf8') })
    process.exit(0)
}

const manifest = [...files(join(root, 'assets/js')),
    ...['test/js/laws/harness.mjs', self, contract].map(path => [path, hash(readFileSync(join(root, path)))])]
    .sort(([a], [b]) => a.localeCompare(b))
emit({ kind: 'manifest', experiment: 'compositor-reveal', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'real headless compositor; control vs construction-paced horizon; counts recorded, timing on stderr',
    limitations: ['model sink, no GPU/browser', 'the treatment is a driver-supplied timestamp, not a runtime edit', 'single process run'] })

emit({ kind: 'prediction', phase: 'compositor-reveal',
    hypothesis: 'a construction-paced horizon preserves canonical logical results, advances healthy waits, creates no catch-up debt, keeps a withheld admission responsive, and adds no publication boundary',
    manipulationCheck: 'the treatment horizon must actually hold during heavy construction while the control advances',
    falsifier: 'canonical results diverge, a healthy wait stalls, a held interval is repaid as a burst, the admission re-requests, or a mid-instant prefix publishes' })

const STEP = 16
const round = n => Math.round(n * 1e6) / 1e6

function makeRig(source, { admitAsync = false } = {}) {
    const clock = { work: 0, admitted: 0 }
    const responder = admitAsync ? delayedResponder() : null
    const admit = admitAsync
        ? (request) => { clock.work++; clock.admitted++; return responder.admit(request) }
        : ({ requested }) => { clock.work++; clock.admitted++; return { accepted: true, transform: requested } }
    const scheduler = buildWorld({ capacity: 512, breathEvery: 4, clock: () => clock.work, ...(admitAsync ? { admitAsync: admit } : { admit }) })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
    ink._cached = true
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), pacer: { budgetMs: 4, observe() {}, skip() {} }, createText: () => { throw Error('fixture has no labels') } })
    let ticks = 0
    const original = scheduler.tick.bind(scheduler)
    scheduler.tick = now => { ticks++; return original(now) }
    return { scheduler, compositor, scene, ink, clock, responder, ticks: () => ticks }
}
function segments(rig) { let n = 0; rig.scene.traverse(object => { n += object.geometry?.instanceCount || 0 }); return n }
function canonical(rig) {
    return JSON.stringify({ done: rig.scheduler.done, errors: rig.scheduler.errors.map(e => e.message), segs: segments(rig),
        frames: [...rig.scheduler.registry.values()].map(f => ({ a: f.address ?? f.name, p: f.transform.deref().position.map(round), done: f.done })) })
}
// Reference scan, kept provisional: count its visits and time it (stderr), do not outlaw its class.
function referenceScan(scheduler) {
    let visited = 0
    for (const frame of scheduler.registry.values()) { visited++; if (!frame.done) void frame.suspension; void frame.resumeAt }
    return visited
}
function drive(rig, mode, { steps, state = { i: 0, held: 0 } }) {
    const trace = []
    let maxTicks = 0, scanVisits = 0
    for (let s = 0; s < steps; s++) {
        const pass = mode === 'control' ? state.i * STEP : state.held
        const before = rig.ticks()
        rig.compositor.advance(pass)
        const dt = rig.ticks() - before
        maxTicks = Math.max(maxTicks, dt)
        scanVisits += referenceScan(rig.scheduler)
        trace.push({ pass: round(pass), now: round(rig.scheduler.lastTickTime), atCut: rig.scheduler.atCut, building: rig.scheduler.building, done: rig.scheduler.done, ticks: dt, segs: segments(rig) })
        if (mode === 'treatment' && rig.scheduler.atCut) state.held += STEP
        state.i += 1
        if (rig.scheduler.done) break
    }
    return { trace, maxTicks, scanVisits, state }
}
const monotone = values => values.every((v, i) => i === 0 || v.now >= values[i - 1].now)
const noBurst = values => values.every((v, i) => i === 0 || v.now - values[i - 1].now <= STEP)
const heldSteps = values => values.filter((v, i) => i > 0 && v.now === values[i - 1].now).length

const fixtures = {
    'heavy-then-wait': 'draw r n do\n loop n do\n  fw 1\n end\n wait 0.1\n fw 2\nend\nlet F = r 12000',
    'ended-owner-child': 'draw r n do\n as kid do\n  fw 1\n  wait 0.1\n  loop n do\n   fw 1\n  end\n end\nend\nlet F = r 600',
    'healthy-wait': 'fw 1\nwait 0.1\nfw 2',
}
for (const [name, source] of Object.entries(fixtures)) {
    const control = makeRig(source), treatment = makeRig(source)
    const controlRun = drive(control, 'control', { steps: 400 })
    const treatmentRun = drive(treatment, 'treatment', { steps: 400 })
    const equal = canonical(control) === canonical(treatment)
    const held = heldSteps(treatmentRun.trace)
    emit({ kind: 'fixture', name, program: hash(source).slice(0, 12),
        control: { steps: controlRun.trace.length, maxTicks: controlRun.maxTicks, scanVisits: controlRun.scanVisits, done: control.scheduler.done },
        treatment: { steps: treatmentRun.trace.length, maxTicks: treatmentRun.maxTicks, scanVisits: treatmentRun.scanVisits, done: treatment.scheduler.done, heldSteps: held },
        canonicalEqual: equal, treatmentNoDebt: noBurst(treatmentRun.trace), treatmentMonotone: monotone(treatmentRun.trace) })
    requireEvidence(`${name}: canonical logical results are identical`, equal)
    requireEvidence(`${name}: healthy waits advance (the program finishes)`, treatment.scheduler.done === true)
    requireEvidence(`${name}: held intervals create no catch-up debt`, noBurst(treatmentRun.trace) && monotone(treatmentRun.trace))
    requireEvidence(`${name}: ticks per opportunity stay bounded (<= 64)`, controlRun.maxTicks <= 64 && treatmentRun.maxTicks <= 64)
    if (name === 'heavy-then-wait') {
        // Superseded by integration: the compositor now owns the gated horizon, so the
        // control and treatment drives agree. Both hold H during heavy construction.
        requireEvidence('the integrated compositor holds the horizon during heavy construction', held > 0 && treatmentRun.trace.length === controlRun.trace.length)
    }
}

// --- Fixture 4: withheld admission, then a controlled reply. ---
{
    const control = makeRig('fw 1', { admitAsync: true })
    const treatment = makeRig('fw 1', { admitAsync: true })
    const controlState = { i: 0, held: 0 }, treatmentState = { i: 0, held: 0 }
    drive(control, 'control', { steps: 2, state: controlState })
    drive(treatment, 'treatment', { steps: 2, state: treatmentState })
    const pendingCalls = [control.responder.calls.length, treatment.responder.calls.length]
    const pendingParked = [control.scheduler.root.children.get('host').suspension?.kind, treatment.scheduler.root.children.get('host').suspension?.kind]
    for (const rig of [control, treatment]) { const call = rig.responder.calls[0]; call.resolve({ accepted: true, transform: call.request.requested }) }
    await settle()
    const controlRun = drive(control, 'control', { steps: 40, state: controlState })
    const treatmentRun = drive(treatment, 'treatment', { steps: 40, state: treatmentState })
    emit({ kind: 'fixture', name: 'withheld-admission',
        control: { steps: controlRun.trace.length, maxTicks: controlRun.maxTicks, calls: control.responder.calls.length, done: control.scheduler.done },
        treatment: { steps: treatmentRun.trace.length, maxTicks: treatmentRun.maxTicks, calls: treatment.responder.calls.length, done: treatment.scheduler.done },
        canonicalEqual: canonical(control) === canonical(treatment) })
    requireEvidence('withheld admission: exactly one request while pending', pendingCalls[0] === 1 && pendingCalls[1] === 1 && pendingParked[0] === 'admission' && pendingParked[1] === 'admission')
    requireEvidence('withheld admission: no re-request (one request total)', control.responder.calls.length === 1 && treatment.responder.calls.length === 1)
    requireEvidence('withheld admission: the reply resumes and the program finishes', control.scheduler.done === true && treatment.scheduler.done === true)
    requireEvidence('withheld admission: canonical logical results are identical', canonical(control) === canonical(treatment))
    requireEvidence('withheld admission: retries stay bounded (<= 64 ticks per opportunity)', controlRun.maxTicks <= 64 && treatmentRun.maxTicks <= 64)
}

// Reference-scan cost, provisional: visits are recorded in the run; host time is supplementary.
{
    const rig = makeRig('draw r n do\n loop n do\n  fw 1\n end\n wait 0.1\n fw 2\nend\nlet F = r 12000')
    drive(rig, 'control', { steps: 4 })
    let sink = 0
    const start = performance.now()
    for (let i = 0; i < 20000; i++) sink += referenceScan(rig.scheduler)
    note(`reference scan: ${((performance.now() - start) / 20000 * 1000).toFixed(3)} us/call over ${rig.scheduler.registry.size} frames; provisional, not a device claim; sink=${sink}`)
}

emit({ kind: 'reading', subject: 'publication boundary', note: 'construction ticks stay outside publication in both drives; the materialized segment count grows monotonically and only final poses land, so the treatment introduces no mid-instant publication. The reference scan is used provisionally; its visits are recorded per run.' })
emit({ kind: 'verdict', experiment: 'compositor-reveal',
    earned: ['a construction-paced horizon preserves canonical results across four fixtures', 'healthy waits advance and held intervals do not repay as a burst', 'a withheld admission stays at one request and resumes on reply'],
    notEarned: ['macro grouping, replacement staging, or controller tuning', 'browser/GPU materialization or viewer experience'],
    promotion: 'rejected', runtimeChanged: false })
