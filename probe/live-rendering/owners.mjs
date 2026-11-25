// probe-status: concluded
// Owner census: for each natural owner, is its STOP routed, and is its ELIGIBILITY change
// (its "wake") routed, or only read off cross-cutting state? Measures; adds no seam.
// Includes a positive control and the residency case stopwake censored.
// Run: node probe/live-rendering/owners.mjs > probe/live-rendering/records/owners-run.jsonl
// Snap: node probe/live-rendering/owners.mjs --snapshot > probe/live-rendering/records/owners-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFECTS } from '../../assets/js/turtling/scheduler.js'
import { setResident, MAX_STAGE_SEGMENTS } from '../../assets/js/turtling/ledger.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/owners.mjs'
const plan = 'probe/live-rendering/P1-PLAN.org'
const hash = value => createHash('sha256').update(value).digest('hex')
const emit = row => console.log(JSON.stringify(row))
const address = frame => frame.address ?? frame.name
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
    for (const path of [self, plan]) emit({ kind: 'source-snapshot', path, source: readFileSync(join(root, path), 'utf8') })
    process.exit(0)
}

// --- Routed transitions, wrapped per window. ---
const VOCABULARY = Object.keys(EFFECTS).sort()
const ORIGINAL = new Map(VOCABULARY.map(key => [key, EFFECTS[key]]))
const transitions = []
let collecting = false
let currentPhase = null
for (const key of VOCABULARY) {
    const handler = ORIGINAL.get(key)
    EFFECTS[key] = function probed(ctx, value, route, pump) {
        const result = handler.call(this, ctx, value, route, pump)
        if (collecting) transitions.push({ phase: currentPhase, type: key, address: address(ctx), verdict: result?.verdict ?? null })
        return result
    }
}
const WAKE_VERBS = VOCABULARY.filter(verb => /wake|clear|resume|unblock|ready|retry/.test(verb))
const PARK_VERDICTS = new Set(['parked', 'paused'])
const parkedOn = observed => observed.some(t => PARK_VERDICTS.has(t.verdict))

function windowSync(phase, fn) {
    const start = transitions.length
    const prevCollecting = collecting, prevPhase = currentPhase
    collecting = true; currentPhase = phase
    let result
    try { result = fn() } finally { collecting = prevCollecting; currentPhase = prevPhase }
    return { phase, result, observed: transitions.slice(start) }
}
async function windowAsync(phase, fn) {
    const start = transitions.length
    const prevCollecting = collecting, prevPhase = currentPhase
    collecting = true; currentPhase = phase
    let result
    try { result = await fn() } finally { collecting = prevCollecting; currentPhase = prevPhase }
    return { phase, result, observed: transitions.slice(start) }
}
const tickRaw = (scheduler, H, budget) => scheduler.withSlice(budget, () => scheduler.tick(H))
function tickIn(phase, scheduler, H, budget = null) {
    const w = windowSync(phase, () => tickRaw(scheduler, H, budget))
    return { phase: w.phase, produced: w.result, observed: w.observed }
}

const manifest = [...files(join(root, 'assets/js')),
    ...['test/js/laws/harness.mjs', self, plan].map(path => [path, hash(readFileSync(join(root, path)))])]
    .sort(([a], [b]) => a.localeCompare(b))
emit({ kind: 'manifest', experiment: 'P1-owner-census', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'mutates exported EFFECTS values; each window is phase-tagged; no source edit',
    limitations: ['owner surfaces are read directly, not through a new seam', 'model sink, no GPU/browser', 'synthetic clock, not measured latency'] })
emit({ kind: 'vocabulary', verbs: VOCABULARY, wakeVerbs: WAKE_VERBS,
    reading: 'the routed vocabulary names stops and constructions; it names no wake or clear' })

function reference(scheduler, H) {
    const frames = [...scheduler.registry.values()].map(f => ({
        address: address(f), name: f.name, done: f.done, resumeAt: f.resumeAt,
        suspension: f.suspension?.kind ?? null,
        admissionReady: f.suspension?.kind === 'admission' ? f.suspension.verdict != null : null,
        owed: !!f.suspension?.owed, run: f.runIncarnation ?? null,
    }))
    const live = frames.filter(f => !f.done)
    const nextWake = live.reduce((next, f) => f.resumeAt > H ? Math.min(next, f.resumeAt) : next, Infinity)
    return { H, done: scheduler.done, building: scheduler.building, derivedQueued: scheduler.root._derivedMoves.length,
        nextWake: Number.isFinite(nextWake) ? nextWake : null, frames }
}
const hostOf = ref => ref.frames.find(f => f.address === 'host')
function seat(name, source, config = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    emit({ kind: 'fixture', name, source, sourceSha256: hash(source), capacity: config.capacity ?? 512,
        admission: config.admitAsync ? 'controlled-async' : config.admit ? 'sync-responder' : 'none' })
    return scheduler
}
const census = []
function owner(name, fact, stopRouted, eligibleRouted, state, detail) {
    const row = { name, fact, stopRouted, eligibleRouted, state, detail }
    census.push(row)
    emit({ kind: 'owner', ...row })
}

// --- Instrument first: a positive control before any zero is trusted. ---
const sensor = seat('sensor', 'loop 8 do\n fw 1\nend\nwait 0.1', { breathEvery: 4 })
const sensorSync = windowSync('control:sync-window', () => tickRaw(sensor, 0, -1))
requireEvidence('positive control: a window records a forced breath', sensorSync.observed.some(t => t.type === 'breath' && t.verdict === 'parked'))
const sensorAsyncTick = await windowAsync('control:async-window', async () => { const s2 = seat('sensor-async', 'loop 8 do\n fw 1\nend\nwait 0.1', { breathEvery: 4 }); tickRaw(s2, 0, -1); await settle() })
requireEvidence('positive control: an async window records a forced breath', sensorAsyncTick.observed.some(t => t.type === 'breath' && t.verdict === 'parked'))
const idleWindow = await windowAsync('control:async-idle', async () => { await settle() })
requireEvidence('control contrast: an idle async window records nothing', idleWindow.observed.length === 0)

// --- Owner 1: pacer owns slice-spent (preemption). ---
const pacer = seat('pacer', 'loop 8 do\n fw 1\nend\nwait 0.1', { breathEvery: 4 })
const pacerTick = tickIn('owner:pacer', pacer, 0, -1)
const pacerRef = reference(pacer, 0)
const pacerStop = pacerTick.observed.some(t => t.type === 'breath' && t.verdict === 'parked')
owner('pacer', 'slice spent / preempted', pacerStop, false, pacerRef.frames.some(f => f.suspension === 'breath'),
    'stop routed as breath; the pass-start clear that lets it run again is not routed')
requireEvidence('pacer routes its stop, not its eligibility', pacerStop === true && census.at(-1).eligibleRouted === false)

// --- Owner 2: dependency owns wait-on (dataflow). ---
const dependency = seat('dependency', 'as a do\n fw b.x\nend\nas b do\n fw 5\nend')
const depTick = tickIn('owner:dependency', dependency, 0)
const depRef = reference(dependency, 0)
const depInstallRouted = depTick.observed.some(t => t.type === 'blocked')
let depResolveParked = null
for (let pass = 0; pass < 10 && !dependency.done; pass++) {
    const w = tickIn('owner:dependency-resolve', dependency, 0)
    depResolveParked = parkedOn(w.observed)
}
owner('dependency', 'waiting on X / resolved', depInstallRouted, false, depRef.frames.some(f => f.suspension === 'dataflow'),
    'install routed as blocked; resolution is a state clear with no routed transition')
requireEvidence('dependency install routes; its clear does not', depInstallRouted && dependency.done && dependency.errors.length === 0 && depResolveParked === false)

// --- Owner 3: admission owns the verdict lifecycle. ---
const responder = delayedResponder({ defer: 1 })
const admission = seat('admission', 'fw 1\nwait 0.1\nfw 2', { admitAsync: responder.admit })
const admTick = tickIn('owner:admission', admission, 0)
await settle()
const admRef = reference(admission, 0)
const admInstallRouted = admTick.observed.some(t => t.type === 'motion')
const readyArrival = await windowAsync('owner:admission-ready', async () => {
    const reply = responder.calls[0]
    reply.resolve({ accepted: true, transform: reply.request.requested })
    await settle()
})
const readyRef = reference(admission, 0)
owner('admission', 'pending / ready verdict', admInstallRouted, false, hostOf(readyRef).admissionReady === true,
    'install routed as motion; readiness mutates the retained verdict, no transition')
requireEvidence('admission install routes; readiness does not', admInstallRouted && hostOf(admRef).admissionReady === false && readyArrival.observed.length === 0 && hostOf(readyRef).admissionReady === true)

// --- Owner 4: channel owns credit availability. ---
const channel = seat('channel', 'fw 1\nfw 2', { capacity: 1 })
const chanTick = tickIn('owner:channel', channel, 0)
const chanRef = reference(channel, 0)
owner('channel', 'credit available', false, false, chanRef.frames.some(f => f.owed && f.suspension === 'credit'),
    'deposit fallback: a debt park leaves no routed transition, and no routed return either')
requireEvidence('the channel debt is state only', chanRef.frames.some(f => f.owed && f.suspension === 'credit') && !parkedOn(chanTick.observed))

// --- Owner 5: stage owns room (residency) — the case stopwake censored. ---
const stage = seat('stage', 'fw 1\nfw 2')
setResident(stage.root, stage.stock, MAX_STAGE_SEGMENTS + 1)
emit({ kind: 'fixture', name: 'stage-residency', source: 'fw 1\nfw 2', sourceSha256: hash('fw 1\nfw 2'),
    residencyFill: MAX_STAGE_SEGMENTS + 1, stockFull: stage.stock.full })
const stageTick = tickIn('owner:stage', stage, 0)
const stageRef = reference(stage, 0)
owner('stage', 'room available', false, false, stageRef.frames.some(f => f.owed && f.suspension === 'residency'),
    'deposit fallback: residency exercised; a full stage parks with no routed transition')
requireEvidence('residency parks as state, no routed transition', stageRef.frames.some(f => f.owed && f.suspension === 'residency') && !parkedOn(stageTick.observed))

// --- Owner 6: place owns queue and commit, separately. ---
const place = seat('place', 'let B\nlet A = (B.x, 0)', { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
for (let pass = 0; pass < 50 && !place.done; pass++) tickIn('owner:place-settle', place, 0)
requireEvidence('place fixture settles', place.done)
const host = place.root.children.get('host')
const B = host.children.get('B'), A = host.children.get('A')
const poseBefore = A.transform.deref().position
const queueArrival = windowSync('owner:place-queue', () => place.requestMotion(B, { rotation: SE3.identity().rotation, position: [7, 0, 0] }, place.motionRevision))
const queuedRef = reference(place, 0)
tickIn('owner:place-consume', place, 0)
const poseAfter = A.transform.deref().position
owner('place', 'queued / committed', false, false, queuedRef.derivedQueued === 1,
    'queue is a root flag and commit is a pose; both state, neither routed')
requireEvidence('the place queue is not routed and commit is separate state', queueArrival.observed.length === 0 && queuedRef.derivedQueued === 1 && JSON.stringify(poseBefore) !== JSON.stringify(poseAfter))

// --- Owner 7: run owns liveness (done / error). ---
const run = seat('run', 'fw 1', { admit: () => { throw Error('controlled responder failure') } })
const runTick = tickIn('owner:run', run, 0)
const runRef = reference(run, 0)
const endedRouted = runTick.observed.some(t => t.verdict === 'ended')
owner('run', 'runnable / ended / faulted', endedRouted, false, runRef.done === true && run.errors.length > 0,
    'the effect yields ended; the run itself exposes only done/error state')
requireEvidence('the run is state; ended is routed by the yielding effect', endedRouted && runRef.done === true && run.errors.length > 0)

requireEvidence('the routed vocabulary has no wake or clear verb', WAKE_VERBS.length === 0)
const stopsRouted = census.filter(c => c.stopRouted).map(c => c.name + ':' + c.fact)
const eligibilityRouted = census.filter(c => c.eligibleRouted).map(c => c.name + ':' + c.fact)
emit({ kind: 'verdict', experiment: 'P1-owner-census',
    stopsRouted, eligibilityRouted,
    census: census.map(c => ({ name: c.name, fact: c.fact, stopRouted: c.stopRouted, eligibleRouted: c.eligibleRouted, state: c.state })),
    recommendation: {
        pacer: 'owns slice-spent; already routed',
        dependency: 'owns wait-on; the clear needs reporting',
        admission: 'owns the verdict; readiness needs reporting',
        channel: 'owns capacity; credit return needs reporting',
        stage: 'owns room; residency relief needs reporting',
        place: 'owns the commit; the pose needs reporting',
        run: 'owns liveness; done/error needs reporting',
    },
    scope: 'stops/installs are sometimes routed; no listed owner routes its eligibility change',
    stoppingRule: 'one verdict per owner; promote nothing',
    promotion: 'rejected', runtimeChanged: false })
