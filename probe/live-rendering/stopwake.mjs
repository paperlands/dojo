// probe-status: concluded
// Stop/wake isolation at EXISTING scheduler seams; the runtime is not edited.
// Pilot correction: each collection window spans one controlled wake, phase-tagged,
// not only the tick; a zero count inside the window is the falsifier, outside it is nothing.
// Run: node probe/live-rendering/stopwake.mjs > probe/live-rendering/records/stopwake-run.jsonl
// Snap: node probe/live-rendering/stopwake.mjs --snapshot > probe/live-rendering/records/stopwake-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFECTS } from '../../assets/js/turtling/scheduler.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/stopwake.mjs'
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

// --- The two seams, wrapped only while a named window is open. ---
const VOCABULARY = Object.keys(EFFECTS).sort()
const ORIGINAL = new Map(VOCABULARY.map(key => [key, EFFECTS[key]]))
const transitions = []
let collecting = false
let currentPhase = null
for (const key of VOCABULARY) {
    const handler = ORIGINAL.get(key)
    EFFECTS[key] = function probed(ctx, value, route, pump) {
        const result = handler.call(this, ctx, value, route, pump)
        if (collecting) transitions.push({
            phase: currentPhase, type: key, address: address(ctx), verdict: result?.verdict ?? null,
            resumeAt: ctx.resumeAt ?? null, suspension: ctx.suspension?.kind ?? null,
            owed: ctx.suspension?.owed != null,
            admissionReady: ctx.suspension?.kind === 'admission' ? ctx.suspension.verdict != null : null,
        })
        return result
    }
}
const WAKE_VERBS = VOCABULARY.filter(verb => /wake|clear|resume|unblock|ready|retry/.test(verb))
const PARK_VERDICTS = new Set(['parked', 'paused'])
const parkKinds = observed => [...new Set(observed.filter(t => PARK_VERDICTS.has(t.verdict)).map(t => t.type))]

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
const windowFacts = w => ({ phase: w.phase, transitions: w.observed.length, observed: w.observed })

const manifest = [...files(join(root, 'assets/js')),
    ...['test/js/laws/harness.mjs', self, plan].map(path => [path, hash(readFileSync(join(root, path)))])]
    .sort(([a], [b]) => a.localeCompare(b))
emit({ kind: 'manifest', experiment: 'P1-stopwake', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'mutates exported EFFECTS values; each window is phase-tagged; no source edit',
    limitations: ['states read on the reference side to check the seam reader', 'model sink, no GPU/browser', 'synthetic clock, not measured latency', 'residency and failed redraw not exercised'] })
emit({ kind: 'vocabulary', verbs: VOCABULARY, wakeVerbs: WAKE_VERBS,
    reading: 'the routed vocabulary names stops and constructions; it names no wake or clear' })

// --- Instrument validity: a positive control before any zero is trusted. ---
const sensorSource = 'loop 8 do\n fw 1\nend\nwait 0.1'
const sensorSync = seat('sensor-sync', sensorSource, { breathEvery: 4 })
const syncControl = windowSync('control:sync-window', () => tickRaw(sensorSync, 0, -1))
requireEvidence('positive control: a sync window records a known effect', syncControl.observed.some(t => t.type === 'breath' && t.verdict === 'parked'))
const sensorAsync = seat('sensor-async', sensorSource, { breathEvery: 4 })
const asyncControl = await windowAsync('control:async-window', async () => { tickRaw(sensorAsync, 0, -1); await settle() })
requireEvidence('positive control: an async window records a known effect', asyncControl.observed.some(t => t.type === 'breath' && t.verdict === 'parked'))
const idleControl = await windowAsync('control:async-idle', async () => { await settle() })
requireEvidence('control contrast: an idle async window records nothing while the same harness records the effect', idleControl.observed.length === 0)
emit({ kind: 'reading', subject: 'effect reachability', source: 'assets/js/turtling/scheduler.js',
    note: 'EFFECTS handlers run only from stepFrame via stepOnce, reached from tick/drainUntilPause; no pump runs outside a tick, so a wake window with no tick is structurally empty. The controls certify the collector was live.' })

function reference(scheduler, H) {
    const frames = [...scheduler.registry.values()].map(f => ({
        address: address(f), name: f.name, done: f.done, resumeAt: f.resumeAt, midInstant: f.midInstant,
        suspension: f.suspension?.kind ?? null,
        admissionReady: f.suspension?.kind === 'admission' ? f.suspension.verdict != null : null,
        owed: !!f.suspension?.owed, queued: f.channel.length, run: f.runIncarnation ?? null,
    }))
    const live = frames.filter(f => !f.done)
    const nextWake = live.reduce((next, f) => f.resumeAt > H ? Math.min(next, f.resumeAt) : next, Infinity)
    return { H, frontier: scheduler.root._frontier, done: scheduler.done, building: scheduler.building,
        atCut: scheduler.atCut, derivedQueued: scheduler.root._derivedMoves.length,
        nextWake: Number.isFinite(nextWake) ? nextWake : null, frames }
}
const hostOf = ref => ref.frames.find(f => f.address === 'host')
const named = (ref, name) => ref.frames.find(f => f.name === name)
function seat(name, source, config = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    emit({ kind: 'fixture', name, source, sourceSha256: hash(source), capacity: config.capacity ?? 512,
        admission: config.admitAsync ? 'controlled-async' : config.admit ? 'sync-responder' : 'none' })
    return scheduler
}
function stopRecord(name, phase, H, tick, ref) {
    emit({ kind: 'stop', name, phase, H, tickReturn: tick.produced, observed: tick.observed,
        parkKinds: parkKinds(tick.observed), reference: ref })
}

// --- F0: terminal idle is the one stop the tick boundary reports authoritatively. ---
const idle = seat('terminal-idle', 'fw 1')
for (let pass = 0; pass < 10 && !idle.done; pass++) tickIn('tick:settle', idle, 0)
const idleTick = tickIn('tick:terminal', idle, 0)
const idleRef = reference(idle, 0)
stopRecord('terminal-idle', idleTick.phase, 0, idleTick, idleRef)
requireEvidence('terminal stop: tick returns no work', idleTick.produced === false)
requireEvidence('terminal stop: done and not building agree', idleRef.done === true && idleRef.building === false)

// --- F1: breath preemption has an effect transition. ---
const cpu = seat('breath-park', 'loop 8 do\n fw 1\nend\nwait 0.1', { breathEvery: 4 })
const cpuTick = tickIn('tick:spent-slice', cpu, 0, -1)
const cpuRef = reference(cpu, 0)
stopRecord('breath-park', cpuTick.phase, 0, cpuTick, cpuRef)
requireEvidence('breath stop is a routed transition', cpuTick.observed.some(t => t.type === 'breath' && t.verdict === 'parked'))
requireEvidence('reference agrees a frame is parked on breath', cpuRef.frames.some(f => f.suspension === 'breath'))
requireEvidence('tick boundary alone cannot name the park kind', cpuRef.building === true && !WAKE_VERBS.length)

// --- F2: a logical wait carries its next wake on the transition. ---
const slept = seat('wait-sleep', 'fw 1\nwait 0.1\nfw 2')
const sleepTick = tickIn('tick:at-wait', slept, 0)
const sleepRef = reference(slept, 0)
stopRecord('wait-sleep', sleepTick.phase, 0, sleepTick, sleepRef)
requireEvidence('wait stop carries its next wake at the transition', sleepTick.observed.some(t => t.type === 'wait' && t.resumeAt === 100))
requireEvidence('reference next wake matches the transition', sleepRef.nextWake === 100)

// --- F3: a cross-ambient read parks as a named dataflow stop. ---
const forward = seat('forward-block', 'as a do\n fw b.x\nend\nas b do\n fw 5\nend')
const forwardTick = tickIn('tick:first', forward, 0)
const forwardRef = reference(forward, 0)
stopRecord('forward-block', forwardTick.phase, 0, forwardTick, forwardRef)
requireEvidence('dataflow stop is a routed transition', forwardTick.observed.some(t => t.type === 'blocked' && t.suspension === 'dataflow'))
requireEvidence('reference agrees on the dataflow stop', forwardRef.frames.some(f => f.suspension === 'dataflow'))
for (let pass = 0; pass < 10 && !forward.done; pass++) tickIn('tick:settle', forward, 0)
requireEvidence('forward dependency resolves at unchanged H', forward.done && forward.errors.length === 0)

// --- F4a: admission readiness arrives WITH the suspension retained. ---
const responder = delayedResponder({ defer: 1 })
const admission = seat('admission-ready', 'fw 1\nwait 0.1\nfw 2', { admitAsync: responder.admit })
const pendingTick = tickIn('tick:admission-pending', admission, 0)
const pendingRef = reference(admission, 0)
stopRecord('admission-ready', pendingTick.phase, 0, pendingTick, pendingRef)
requireEvidence('admission install is a routed transition', pendingTick.observed.some(t => t.type === 'motion' && t.suspension === 'admission' && t.admissionReady === false))
await settle()
assert.equal(responder.calls.length, 1)
const readyArrival = await windowAsync('wake:admission-ready-arrival', async () => {
    const reply = responder.calls[0]
    reply.resolve({ accepted: true, transform: reply.request.requested })
    await settle()
})
const readyRef = reference(admission, 0)
emit({ kind: 'wake', name: 'admission-ready', arrival: windowFacts(readyArrival),
    facts: { suspensionAfter: hostOf(readyRef).suspension, eligibleAfter: hostOf(readyRef).admissionReady,
        runBefore: hostOf(pendingRef).run, runAfter: hostOf(readyRef).run } })
requireEvidence('admission reply lands with no scheduler transition', readyArrival.observed.length === 0)
requireEvidence('readiness retains the admission suspension rather than clearing it', hostOf(readyRef).suspension === 'admission' && hostOf(readyRef).admissionReady === true)

// --- F4b: a suspension clear can belong to a terminated run, not a wake. ---
const faultResponder = delayedResponder({ defer: 1 })
const faulted = seat('admission-fault', 'fw 1\nwait 0.1\nfw 2', { admitAsync: faultResponder.admit })
tickIn('tick:admission-pending', faulted, 0)
await settle()
const faultBefore = reference(faulted, 0)
const faultArrival = await windowAsync('wake:admission-fault-arrival', async () => {
    faultResponder.calls[0].resolve({ accepted: true, transform: { rotation: SE3.identity().rotation, position: 'nope' } })
    await settle()
})
const faultRef = reference(faulted, 0)
emit({ kind: 'wake', name: 'admission-fault', arrival: windowFacts(faultArrival),
    facts: { suspensionBefore: hostOf(faultBefore).suspension, suspensionAfter: hostOf(faultRef).suspension,
        doneAfter: hostOf(faultRef).done, error: faulted.errors[0]?.message ?? null } })
requireEvidence('admission fault lands with no scheduler transition', faultArrival.observed.length === 0)
requireEvidence('the clear coincides with termination, not wake', hostOf(faultBefore).suspension === 'admission' && hostOf(faultRef).suspension === null && hostOf(faultRef).done === true)

// --- F5: the deposit fallback parks on credit; availability retains the debt. ---
const credit = seat('credit-debt', 'fw 1\nfw 2', { capacity: 1 })
const debtTick = tickIn('tick:debt', credit, 0)
const debtRef = reference(credit, 0)
stopRecord('credit-debt', debtTick.phase, 0, debtTick, debtRef)
requireEvidence('reference holds a credit debt', debtRef.frames.some(f => f.owed && f.suspension === 'credit'))
requireEvidence('no routed transition reports the debt park', parkKinds(debtTick.observed).length === 0)
const creditArrival = windowSync('wake:credit-arrival', () => { for (const frame of credit.registry.values()) frame.channel.drain() })
const availableRef = reference(credit, 0)
requireEvidence('credit availability lands with no scheduler transition', creditArrival.observed.length === 0)
requireEvidence('availability retains the owed debt; the replay/clear is later and internal', hostOf(availableRef).owed === true && hostOf(availableRef).suspension === 'credit')
const creditConsume = tickIn('wake:credit-consume', credit, 0)
const consumedRef = reference(credit, 0)
emit({ kind: 'wake', name: 'credit-return', arrival: windowFacts(creditArrival), consume: windowFacts(creditConsume),
    facts: { owedAfterArrival: hostOf(availableRef).owed, owedAfterConsume: hostOf(consumedRef).owed,
        suspensionAfterConsume: hostOf(consumedRef).suspension } })
requireEvidence('the replayed deposit makes progress with no routed wake', creditConsume.produced === true && parkKinds(creditConsume.observed).length === 0)

// --- F6: terminal failure is a routed ended transition. ---
const failure = seat('responder-failure', 'fw 1', { admit: () => { throw Error('controlled responder failure') } })
const failTick = tickIn('tick:wounded', failure, 0)
const failRef = reference(failure, 0)
stopRecord('responder-failure', failTick.phase, 0, failTick, failRef)
requireEvidence('terminal failure is a routed ended transition', failTick.observed.some(t => t.type === 'motion' && t.verdict === 'ended'))
requireEvidence('reference reports the failure', failRef.done === true && failure.errors.length > 0)

// --- F7: a derived move queues with no suspension; drained is checked against the pose. ---
const derived = seat('derived-move-after-done', 'let B\nlet A = (B.x, 0)', { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
for (let pass = 0; pass < 50 && !derived.done; pass++) tickIn('tick:settle', derived, 0)
requireEvidence('derived fixture settles first', derived.done)
const host = derived.root.children.get('host')
const B = host.children.get('B'), A = host.children.get('A')
const poseBefore = A.transform.deref().position
const derivedArrival = windowSync('wake:derived-arrival', () => derived.requestMotion(B, { rotation: SE3.identity().rotation, position: [7, 0, 0] }, derived.motionRevision))
const queuedRef = reference(derived, 0)
requireEvidence('derived queue forms with no routed transition', derivedArrival.observed.length === 0)
requireEvidence('a derived wake queues without any suspension', queuedRef.derivedQueued === 1 && named(queuedRef, 'A').suspension === null)
const derivedConsume = tickIn('wake:derived-consume', derived, 0)
const poseAfter = A.transform.deref().position
const drainedRef = reference(derived, 0)
const poseCommitted = JSON.stringify(poseBefore) !== JSON.stringify(poseAfter)
emit({ kind: 'wake', name: 'derived-move', arrival: windowFacts(derivedArrival), consume: windowFacts(derivedConsume),
    facts: { queuedAfterArrival: queuedRef.derivedQueued, drainedAfterConsume: drainedRef.derivedQueued,
        suspensionWhileQueued: named(queuedRef, 'A').suspension, poseBefore, poseAfter, poseCommitted } })
requireEvidence('queue drained and pose commit are separate facts', drainedRef.derivedQueued === 0 && poseCommitted === true)
emit({ kind: 'reading', subject: 'redrawDerivedPlace guards', source: 'assets/js/turtling/scheduler.js:2227-2232',
    guards: ['target missing/error/not done: drop', 'observer not live: drop', 'law owner changed: drop', 'applyLaw outcome not commit: keep last pose'],
    note: 'on any guard the queued entry is consumed and the last pose is kept, so drained does not imply committed; a failed redraw is not exercised here' })

requireEvidence('the routed vocabulary has no wake or clear verb', WAKE_VERBS.length === 0)
emit({ kind: 'verdict', experiment: 'P1-stopwake',
    isolatedStops: ['terminal done', 'wait next-wake', 'breath preemption', 'dataflow block', 'admission install', 'terminal failure'],
    unisolatedStops: ['credit/residency debt (deposit fallback; residency not exercised)'],
    wakeArrivalTransitions: { admissionReply: readyArrival.observed.length, admissionFault: faultArrival.observed.length,
        creditReturn: creditArrival.observed.length, derivedQueue: derivedArrival.observed.length },
    wakeSemantics: {
        admission: 'ready while the admission suspension is retained (verdict set, not cleared)',
        credit: 'capacity returned while the owed debt is retained; the replay and clear are later and internal',
        derived: 'queued with no suspension at all',
        fault: 'suspension cleared as the run terminates; a clear is not a wake',
    },
    queueVersusCommit: 'drained queue and committed pose reported as separate facts',
    scope: 'the two observed seams expose no complete stop/eligibility account; this does not rule out an O(transitions) account',
    ownership: 'each owner should report the fact it owns (admission verdict, channel capacity/credit, place commit, run liveness); no universal wake class',
    positiveControls: 'a sync and an async window each record a forced breath; an idle async window records nothing, so every wake zero is certified by a live collector',
    promotion: 'rejected', runtimeChanged: false })
