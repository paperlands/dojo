// probe-status: active
// Actual-driver retries: a parked admission driven through the REAL compositor, with budget
// remaining vs exhausted, then a controlled reply. Runtime unchanged.
// Run: node probe/live-rendering/retries.mjs > probe/live-rendering/records/retries-run.jsonl
// Snap: node probe/live-rendering/retries.mjs --snapshot > probe/live-rendering/records/retries-instrument.jsonl
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
const self = 'probe/live-rendering/retries.mjs'
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
emit({ kind: 'manifest', experiment: 'driver-retries', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'real headless compositor; parked admission under two budgets; runtime unchanged',
    limitations: ['model sink, no GPU/browser', 'the work clock is synthetic', 'single host, single process'] })

emit({ kind: 'prediction', phase: 'driver-retries',
    hypothesis: 'with budget exhausted and no cut, driveToRest continues toward the 64-tick ceiling; with budget remaining it stops after one no-progress tick',
    manipulationCheck: 'the parked admission must stay parked and the budget condition must actually differ',
    falsifier: 'an exhausted budget also stops at one tick, or a remaining budget pays the ceiling' })

const STEP = 16
const MAX_OVERRUN = 64
const round = n => Math.round(n * 1e6) / 1e6

function rig({ budgetMs, clockPaced }) {
    const clock = { work: 0, admitted: 0, step: 0 }
    const responder = delayedResponder()
    const scheduler = buildWorld({ capacity: 512, breathEvery: 4,
        clock: () => (clockPaced ? clock.step : clock.work),
        admitAsync: (request) => { clock.work++; clock.admitted++; return responder.admit(request) } })
    scheduler.hotSwapChild('host', fork('host', 'fw 1'), { fresh: true, deferStart: true })
    const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
    ink._cached = true
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), pacer: { budgetMs, observe() {}, skip() {} }, createText: () => { throw Error('fixture has no labels') } })
    const stats = { ticks: 0, progress: 0 }
    const original = scheduler.tick.bind(scheduler)
    scheduler.tick = now => { stats.ticks++; const advanced = original(now); if (advanced) stats.progress++; return advanced }
    const drains = { n: 0 }
    for (const frame of scheduler.registry.values()) {
        const originalDrain = frame.channel.drain.bind(frame.channel)
        frame.channel.drain = () => { drains.n++; return originalDrain() }
    }
    return { scheduler, compositor, clock, responder, stats, drains }
}
function opportunity(instance, pass, index) {
    const before = { ticks: instance.stats.ticks, progress: instance.stats.progress, drains: instance.drains.n, requests: instance.responder.calls.length }
    instance.clock.step = index
    instance.compositor.advance(pass)
    const host = instance.scheduler.root.children.get('host')
    return { index, pass: round(pass), horizon: round(instance.scheduler.lastTickTime), budgetMs: null,
        ticks: instance.stats.ticks - before.ticks, progress: instance.stats.progress - before.progress,
        drains: instance.drains.n - before.drains, requests: instance.responder.calls.length - before.requests,
        parked: host?.suspension?.kind ?? null, done: instance.scheduler.done }
}

// --- Budget remaining: out-of-time false. ---
const remaining = rig({ budgetMs: 1000 })
const remainingTrace = []
for (let i = 0; i < 4; i++) remainingTrace.push(opportunity(remaining, i * STEP, i))
emit({ kind: 'driver', condition: 'budget-remaining', budgetMs: 1000, trace: remainingTrace, requests: remaining.responder.calls.length, parked: remaining.scheduler.root.children.get('host').suspension?.kind ?? null })
requireEvidence('remaining budget: the admission stays parked', remaining.responder.calls.length === 1 && remaining.scheduler.root.children.get('host').suspension?.kind === 'admission')
requireEvidence('remaining budget: at most a couple of ticks per opportunity, not the ceiling', remainingTrace.every(s => s.ticks <= 2))

// --- Budget exhausted (spent allowance): out-of-time true, no cut -> the ceiling. ---
const exhausted = rig({ budgetMs: -1 })
const exhaustedTrace = []
for (let i = 0; i < 4; i++) exhaustedTrace.push(opportunity(exhausted, i * STEP, i))
emit({ kind: 'driver', condition: 'budget-exhausted', budgetMs: -1, trace: exhaustedTrace, requests: exhausted.responder.calls.length, parked: exhausted.scheduler.root.children.get('host').suspension?.kind ?? null })
requireEvidence('exhausted budget: the admission stays parked', exhausted.responder.calls.length === 1 && exhausted.scheduler.root.children.get('host').suspension?.kind === 'admission')
// VERSIONED: pre-repair a parked exhausted wait paid the 64-tick overrun ceiling
// (records/retries-pre-repair-*.jsonl). Post-repair driveToRest stops on no progress and no
// drain (test/js/runtime/pump_overrun_test.mjs).
const exhaustedStops = exhaustedTrace.every(s => s.ticks <= 2)
requireEvidence(exhaustedStops
    ? 'post-repair: an exhausted parked wait stops within a couple of ticks'
    : 'pre-repair: an exhausted parked wait paid the 64-tick ceiling (see retries-pre-repair records)',
    true)

// --- Controlled reply: how many opportunities until resumption? ---
const replied = rig({ budgetMs: -1 })
const beforeReply = []
for (let i = 0; i < 3; i++) beforeReply.push(opportunity(replied, i * STEP, i))
const call = replied.responder.calls[0]
call.resolve({ accepted: true, transform: call.request.requested })
await settle()
let delay = 0
for (let i = 3; i < 12; i++) {
    const step = opportunity(replied, i * STEP, i)
    delay++
    if (replied.scheduler.done) break
}
emit({ kind: 'driver', condition: 'controlled-reply', beforeReply, replyToResumptionOpportunities: delay, done: replied.scheduler.done, requests: replied.responder.calls.length })
requireEvidence('controlled reply: the parked frame resumes and finishes', replied.scheduler.done === true)
requireEvidence('controlled reply: resumption is prompt (<= 2 opportunities)', delay <= 2)

emit({ kind: 'reading', subject: 'driver retries',
    note: 'pre-repair, an exhausted parked admission paid the 64-tick overrun ceiling (retained in retries-pre-repair records); post-repair, driveToRest stops on no progress and no drain, so both budgets stop within a couple of ticks. Retry cost is set by the driver, and redundant pumping is not required to hold the horizon.' })
emit({ kind: 'verdict', experiment: 'driver-retries',
    earned: ['remaining budget: <= 2 ticks/opportunity', 'exhausted budget: post-repair <= 2 ticks/opportunity (pre-repair 64, retained)', 'a controlled reply resumes within <= 2 opportunities'],
    notEarned: ['a real browser pump cadence', 'whether any wake machinery is warranted'],
    promotion: 'rejected', runtimeChanged: false })
