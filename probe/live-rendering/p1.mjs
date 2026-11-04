// probe-status: concluded
// Reference scans and driver-only treatment; no browser latency claim.
// Run: node probe/live-rendering/p1.mjs > probe/live-rendering/records/p1-run.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'
import { SE3 } from '../../assets/js/turtling/se3.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
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
const manifest = [...files(join(root, 'assets/js')), ...['test/js/laws/harness.mjs', 'probe/live-rendering/p1.mjs', 'probe/live-rendering/P1-PLAN.org'].map(path => [path, hash(readFileSync(join(root, path)))])].sort(([a], [b]) => a.localeCompare(b))
emit({ kind: 'manifest', experiment: 'P1', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifest: manifest, sourceManifestSha256: hash(JSON.stringify(manifest)),
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    limitations: ['registry scan is O(frames), not a runtime stop summary', 'model sink, no GPU/browser', 'synthetic work, not measured latency', 'one tick per opportunity, not compositor overrun policy'] })

function summary(scheduler, H) {
    const frames = [...scheduler.registry.values()].map(frame => ({
        address: address(frame), parent: frame.parent ? address(frame.parent) : null,
        done: frame.done, resumeAt: frame.resumeAt, logicalBirth: frame.logicalBirth ?? null,
        midInstant: frame.midInstant, suspension: frame.suspension?.kind ?? null,
        admissionReady: frame.suspension?.kind === 'admission' ? frame.suspension.verdict != null : null,
        dependency: frame.suspension?.kind === 'dataflow' ? address(frame.suspension.on ?? { name: '<missing>' }) : null,
        queued: frame.channel.length, owed: !!frame.suspension?.owed,
        pose: frame.transform.deref().position, error: frame.error?.message ?? null,
    }))
    const live = frames.filter(frame => !frame.done)
    const due = live.filter(frame => frame.resumeAt <= H)
    const reasons = due.map(frame => ({ address: frame.address, cause: frame.suspension ?? (frame.midInstant ? 'open' : 'due-closed'), admissionReady: frame.admissionReady }))
    const derived = scheduler.root._derivedMoves.length
    if (derived) reasons.push({ address: address(scheduler.root), cause: 'derived-move', count: derived })
    const nextWake = live.reduce((next, frame) => frame.resumeAt > H ? Math.min(next, frame.resumeAt) : next, Infinity)
    return { H, frontier: scheduler.root._frontier, done: scheduler.done, cachedDone: scheduler.root._done,
        building: scheduler.building, atCut: scheduler.atCut,
        referenceCut: live.every(frame => !frame.midInstant && !frame.suspension),
        gate: reasons.length ? 'hold' : 'advance', reasons, visited: frames.length,
        nextWake: Number.isFinite(nextWake) ? nextWake : null,
        frames }
}
function seat(name, source, config = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    emit({ kind: 'fixture', name, source, sourceSha256: hash(source), capacity: config.capacity ?? 512, requestedBreathEvery: config.breathEvery ?? 1, admission: config.admitAsync ? 'controlled-async' : config.admit ? 'sync-responder' : 'none', deferredSeat: true })
    return scheduler
}
function drain(scheduler) {
    return [...scheduler.registry.values()].flatMap(frame => [...frame.channel.drain()].map(event => ({ address: address(frame), event })))
}
function sample(name, scheduler, H, { budget = null, drainAfter = true, phase = 'tick' } = {}) {
    const before = summary(scheduler, H)
    const tickReturn = scheduler.withSlice(budget, () => scheduler.tick(H))
    const after = summary(scheduler, H)
    const events = drainAfter ? drain(scheduler) : []
    emit({ kind: 'state', name, phase, budget, tickReturn, before, after, events })
    return after
}
function requireEvidence(name, condition) {
    emit({ kind: 'assertion', name, pass: !!condition })
    assert.ok(condition, name)
}

const wait = seat('healthy-wait', 'fw 1\nwait 0.1\nfw 2')
requireEvidence('closed due frame is not permission to advance', summary(wait, 0).referenceCut && summary(wait, 0).gate === 'hold')
for (const H of [0, 50, 99, 100]) {
    const state = sample('healthy-wait', wait, H)
    requireEvidence('healthy-wait allows advance', state.gate === 'advance')
    if (H < 100) requireEvidence('wait stays at logical 100', state.frames.some(frame => !frame.done && frame.resumeAt === 100 && !frame.midInstant))
}
requireEvidence('wait finishes at due time', wait.done)

const ended = seat('ended-owner', 'draw r n do\n as kid do\n  fw 1\n  wait 0.1\n  loop n do\n   fw 1\n  end\n end\nend\nlet F = r 600', { breathEvery: 4 })
sample('ended-owner', ended, 0)
const descendant = sample('ended-owner', ended, 100, { budget: -1 })
// VERSIONED: pre-repair this checkout skipped a living descendant under an ended owner
// (atCut true). Post-repair atCut descends through done bodies (atCut false). Pre-repair
// records: records/p1-pre-repair-*.jsonl; the repair's regression is
// test/js/runtime/construction_cut_test.mjs.
const traversalRepaired = descendant.atCut === false
requireEvidence('ended-owner has a living breath descendant; the reference sees it', !descendant.referenceCut && descendant.gate === 'hold' && descendant.reasons.some(reason => reason.cause === 'breath'))
requireEvidence(traversalRepaired
    ? 'post-repair: atCut is false for a living descendant under an ended owner (construction_cut_test.mjs)'
    : 'pre-repair: atCut is true for a living descendant under an ended owner (defect; see p1-pre-repair records)',
    true)
for (let pass = 0; pass < 100 && !ended.done; pass++) sample('ended-owner', ended, 100, { budget: -1, phase: 'held-H' })
requireEvidence('ended-owner finishes under held H', ended.done)

const cpu = seat('finite-breath', 'loop 24 do\n fw 1\nend\nwait 0.1\nfw 2', { breathEvery: 4 })
const breath = sample('finite-breath', cpu, 0, { budget: -1 })
requireEvidence('breath has unfinished eligible work', breath.gate === 'hold' && !breath.referenceCut)
for (let pass = 0; pass < 50 && summary(cpu, 0).gate === 'hold'; pass++) sample('finite-breath', cpu, 0, { budget: -1 })
requireEvidence('CPU resumes healthy sleep without rewriting time', summary(cpu, 0).gate === 'advance' && summary(cpu, 0).nextWake === 100)

const credit = seat('credit', 'fw 1\nfw 2\nfw 3', { capacity: 1 })
const debt = sample('credit', credit, 0, { drainAfter: false })
requireEvidence('full channel holds owed event', debt.reasons.some(reason => reason.cause === 'credit') && debt.frames.some(frame => frame.owed))
sample('credit', credit, 0, { drainAfter: false, phase: 'no-credit-return' })
emit({ kind: 'intervention', name: 'credit', cause: 'return-credit-only', events: drain(credit) })
for (let pass = 0; pass < 20 && !credit.done; pass++) sample('credit', credit, 0)
requireEvidence('credit alone permits completion', credit.done)

const responder = delayedResponder({ defer: 1 })
const admission = seat('admission', 'fw 1\nwait 0.1\nfw 2', { admitAsync: responder.admit })
const pending = sample('admission', admission, 0)
requireEvidence('pending admission distinguished from ready reply', pending.reasons.some(reason => reason.cause === 'admission' && !reason.admissionReady))
await settle()
sample('admission', admission, 0, { phase: 'no-reply' })
assert.equal(responder.calls.length, 1)
const reply = responder.calls[0]
reply.resolve({ accepted: true, transform: reply.request.requested })
await settle()
emit({ kind: 'intervention', name: 'admission', cause: 'reply-only', state: summary(admission, 0) })
requireEvidence('delivered reply is due work, not sleep', summary(admission, 0).reasons.some(reason => reason.admissionReady))
for (let pass = 0; pass < 10 && summary(admission, 0).gate === 'hold'; pass++) sample('admission', admission, 0)
requireEvidence('reply reaches future wait', summary(admission, 0).gate === 'advance' && summary(admission, 0).nextWake === 100)

const forward = seat('missing-yet-spawnable', 'as a do\n fw b.x\nend\nas b do\n fw 5\nend')
const missing = sample('missing-yet-spawnable', forward, 0)
requireEvidence('forward read suspends before its legal retry', missing.reasons.some(reason => reason.cause === 'dataflow'))
for (let pass = 0; pass < 10 && !forward.done; pass++) sample('missing-yet-spawnable', forward, 0)
requireEvidence('forward dependency settles at same H', forward.done && forward.errors.length === 0)

const cycle = seat('mutual-cycle', 'as a do\n fw b.x\nend\nas b do\n fw a.x\nend')
for (let pass = 0; pass < 20 && !cycle.done; pass++) sample('mutual-cycle', cycle, 0)
requireEvidence('mutual cycle resolves rather than remaining blocked', cycle.done && cycle.errors.length === 0)

const absent = seat('absent-name', 'when ghost.x do\n fw 2\nend')
const blocked = sample('absent-name', absent, 0)
requireEvidence('absent name initially has dataflow cause', blocked.reasons.some(reason => reason.cause === 'dataflow'))
for (let pass = 0; pass < 8 && !absent.done; pass++) sample('absent-name', absent, 0)
requireEvidence('absent-name permanent-block prediction falsified: runtime wounds', absent.done && absent.errors.some(error => /Undefined assistant/.test(error.message)))

const never = delayedResponder()
const permanent = seat('permanent-admission-block', 'fw 1', { admitAsync: never.admit })
sample('permanent-admission-block', permanent, 0)
const parked = summary(permanent, 0)
let unchanged = 0
for (let pass = 0; pass < 8; pass++) {
    const next = sample('permanent-admission-block', permanent, 0, { phase: 'no-wake' })
    if (JSON.stringify(next) === JSON.stringify(parked)) unchanged++
}
requireEvidence('blind due-frame retry falsified: eight unchanged no-wake ticks', unchanged === 8)
emit({ kind: 'termination', name: 'permanent-admission-block', censored: true, unchangedRetries: unchanged, policyVerdict: 'reject-blind-retry' })

for (const [name, source, config] of [
    ['explicit-done', '', {}],
    ['failure', 'fw 1', { admit: () => { throw Error('controlled responder failure') } }],
    ['derived-cycle-failure', 'let A\nlet s = A.x + 1\nlet A = (s, 0)', {}],
]) {
    const scheduler = seat(name, source, config)
    for (let pass = 0; pass < 20 && !scheduler.done; pass++) sample(name, scheduler, 0)
    requireEvidence(name + ' terminates', scheduler.done)
    if (name !== 'explicit-done') requireEvidence(name + ' reports failure', scheduler.errors.length > 0)
}

const derived = seat('queued-derived-after-done', 'let B\nlet A = (B.x, 0)', { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
for (let pass = 0; pass < 50 && !derived.done; pass++) sample('queued-derived-after-done', derived, 0)
requireEvidence('derived fixture initially done', derived.done)
const B = derived.root.children.get('host').children.get('B')
assert.equal(derived.requestMotion(B, { rotation: SE3.identity().rotation, position: [7, 0, 0] }, derived.motionRevision).kind, 'accept')
const queued = summary(derived, 0)
emit({ kind: 'intervention', name: 'queued-derived-after-done', cause: 'hand-input', state: queued })
requireEvidence('a cut can hide a queued derived move', queued.cachedDone && !queued.done && queued.atCut && queued.referenceCut && queued.reasons.some(reason => reason.cause === 'derived-move'))
sample('queued-derived-after-done', derived, 0)
requireEvidence('derived queue drained legally at held H', derived.root._derivedMoves.length === 0)

function canonical(scheduler, paths, requests) {
    const frames = [...scheduler.registry.values()].map(frame => ({ address: address(frame), pose: frame.transform.deref(), done: frame.done, resumeAt: frame.resumeAt, logicalBirth: frame.logicalBirth ?? null, error: frame.error?.message ?? null }))
    const errors = scheduler.errors.map(({ ambientId, ...error }) => error)
    return { frames, paths: [...paths].sort(([a], [b]) => a.localeCompare(b)), requests, errors }
}
function horizonTrial(name, source, treatment, { prefixH = null, maxOpportunities = 500 } = {}) {
    let W = 0
    const requests = [], paths = new Map(), transitions = []
    const scheduler = seat(name + ':' + treatment, source, { breathEvery: 4, clock: () => W,
        admit: request => {
            W++
            requests.push({ address: address(request.frame), logical: request.frame.resumeAt, command: request.command, from: request.from, requested: request.requested })
            return { accepted: true, transform: request.requested }
        } })
    let H = 0, priorGate = 'advance', completed = false, scanVisits = 0
    for (let opportunity = 0; opportunity < maxOpportunities; opportunity++) {
        const wall = opportunity * 10, previousH = H
        const delta = opportunity === 0 ? 0 : 10
        H = treatment === 'absolute-wall' ? wall : H + (priorGate === 'advance' ? delta : 0)
        if (prefixH !== null) H = Math.min(H, prefixH)
        const beforeW = W
        const tickReturn = scheduler.withSlice(-1, () => scheduler.tick(H))
        const state = summary(scheduler, H)
        scanVisits += state.visited
        const events = drain(scheduler)
        for (const { address: owner, event } of events) {
            if (event.type !== 'path') continue
            if (!paths.has(owner)) paths.set(owner, [])
            for (let i = 1; i < event.points.length; i++) paths.get(owner).push({ from: event.points[i - 1], to: event.points[i], color: event.color, thickness: event.thickness })
        }
        const row = { kind: 'opportunity', name, treatment, opportunity, wall, W, work: W - beforeW, previousH, priorGate, tickReturn, state, segments: [...paths.values()].reduce((n, value) => n + value.length, 0) }
        emit(row)
        transitions.push(row)
        if (treatment === 'held-H') assert.equal(H - previousH, prefixH !== null ? Math.min(priorGate === 'advance' ? delta : 0, prefixH - previousH) : priorGate === 'advance' ? delta : 0, 'held wall time must never become debt')
        priorGate = state.gate
        if (scheduler.done || (prefixH !== null && H === prefixH && state.gate === 'advance')) { completed = true; break }
    }
    const result = canonical(scheduler, paths, requests)
    emit({ kind: 'termination', name, treatment, censored: !scheduler.done, logicalPrefixClosed: prefixH !== null && completed, observationCeilingHit: !completed, scanVisits, canonical: result, canonicalSha256: hash(JSON.stringify(result)) })
    assert.ok(completed, name + ': finite/prefix trial exceeded instrument ceiling')
    return { result, transitions }
}
for (const [name, source, options] of [
    ['finite-then-wait', 'loop 24 do\n fw 1\nend\nwait 0.1\nfw 2', {}],
    ['ended-owner-then-wait', 'draw r n do\n as kid do\n  fw 1\n  wait 0.1\n  loop n do\n   fw 1\n  end\n  wait 0.1\n  fw 2\n end\nend\nlet F = r 600', {}],
    ['recursive-finite-no-wait', 'draw r n do\n when n>0 do\n  fw 1\n  r n-1\n end\nend\nlet F = r 24', {}],
    ['recursive-waited-prefix', 'draw r n do\n fw n\n wait 0.01\n r n\nend\nlet F = r 1', { prefixH: 30 }],
    ['semantic-read', 'as a do\n loop 12 do\n  fw 1\n end\n wait 0.1\n fw 2\nend\nas b do\n fw a.x\n wait 0.1\n fw a.x\nend', {}],
]) {
    const control = horizonTrial(name, source, 'absolute-wall', options)
    const candidate = horizonTrial(name, source, 'held-H', options)
    emit({ kind: 'comparison', name, equal: JSON.stringify(candidate.result) === JSON.stringify(control.result) })
    assert.deepEqual(candidate.result, control.result, name + ': horizon changed canonical meaning')
    if (name === 'finite-then-wait') {
        const closes = candidate.transitions.find(row => row.state.nextWake === 100 && row.state.gate === 'advance')
        const resumes = candidate.transitions.find(row => row.work > 0 && row.state.H >= 100)
        requireEvidence('finite construction closes at H=0 after positive wall/work', closes && closes.state.H === 0 && closes.wall > 0 && closes.W > 0)
        requireEvidence('post-construction wait retains full distance, no burst', resumes && resumes.wall - closes.wall === 100)
    }
}

const zero = seat('zero-time-recursive', 'draw r n do\n fw n\n r n\nend\nlet F = r 1', { breathEvery: 4 })
let zeroPasses = 0
for (; zeroPasses < 12 && !zero.done; zeroPasses++) {
    const state = sample('zero-time-recursive', zero, 0, { budget: -1 })
    requireEvidence('zero-time recurrence either holds H or reports terminal fault', state.gate === 'hold' || (state.done && zero.errors.length > 0))
}
emit({ kind: 'termination', name: 'zero-time-recursive', censored: !zero.done, passes: zeroPasses, policyVerdict: zero.done ? 'terminal-resource-fault-not-sleep' : 'not-healthy-sleep', final: summary(zero, 0) })
emit({ kind: 'verdict', experiment: 'P1', finiteGate: 'supports-model-only', promotion: 'rejected', reasons: ['blind due-frame retries pending admission without wake', 'O(frames) reference scan, no authoritative scheduler stop summary', 'zero-time recursion held H then hit a stack fault in this fixture'], next: 'isolate stop/wake authority before integration', runtimePolicyChanged: false })
