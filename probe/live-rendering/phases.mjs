// probe-status: concluded
// Phase walk: run each remaining phase as far as the stopping rule and a headless bench allow.
// Earn each phase's CONTROL; mark the treatment gated with its reason. No runtime edit.
// Run: node probe/live-rendering/phases.mjs > probe/live-rendering/records/phases-run.jsonl
// Snap: node probe/live-rendering/phases.mjs --snapshot > probe/live-rendering/records/phases-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/phases.mjs'
const contract = 'specs/turtle/live-rendering-contract.org'
const hash = value => createHash('sha256').update(value).digest('hex')
const emit = row => console.log(JSON.stringify(row))
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
emit({ kind: 'manifest', experiment: 'P2-P7-phase-walk', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'headless model bench; controls only, no runtime edit',
    limitations: ['no configured browser harness: Chromium/Firefox installed, playwright/puppeteer unresolved', 'P2/P3/P4/P7 treatments are gated by the stop/wake stopping rule', 'synthetic clock, not measured latency'] })

// --- Predictions, fixed before the observations below. ---
emit({ kind: 'prediction', phase: 'prep:idle-new-play',
    prediction: 'logical idle (done, no work) is distinguishable from a future sleep (resumeAt>now) and from a new play (done false, resumeAt 0); the CAUSE of a driver pause is not',
    falsifier: 'idle, sleep and new play share a seam reading' })
for (const [phase, prediction, falsifier] of [
    ['P2', 'same final geometry via straight/loop/helper/recursion compares equal; a different geometry does not',
        'the comparator calls two different geometries equal, or equal geometries differ'],
    ['P3', 'no-newest-wins evidence without a treatment; a late reply must not resurrect the old answer',
        'an obsolete reply mutates or resurrects the old display'],
    ['P4', 'canonical surviving geometry is equal at capacities 1/2/16/512',
        'any capacity loses, reorders or duplicates ink'],
    ['P5', 'cannot run headless: attribution needs real browser spans',
        'a synthetic work unit is passed off as latency'],
    ['P6', 'cannot run headless: experience needs real input and viewers',
        'an automated proxy is passed off as viewer experience'],
    ['P7', 'fixed-input meaning is invariant to the work allowance (budget null vs spent)',
        'the allowance changes canonical geometry'],
]) emit({ kind: 'prediction', phase, prediction, falsifier })

// --- Bench: one fixture -> deterministic canonical geometry. ---
const round = n => Math.round(n * 1e6) / 1e6
function canonicalOf(source, { capacity = 512, slice = null, maxTicks = 200 } = {}) {
    const scheduler = buildWorld({ capacity, clock: () => 0 })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    const points = []
    for (let i = 0; i < maxTicks && !scheduler.done; i++) {
        scheduler.withSlice(slice, () => scheduler.tick(0))
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) {
                if (event.type !== 'path') continue
                for (const p of event.points) points.push(p.map(round))
            }
        }
    }
    const host = scheduler.root.children.get('host')
    return { done: scheduler.done, points, tip: host ? host.transform.deref().position.map(round) : null,
        errors: scheduler.errors.map(e => e.message) }
}
function pointsOf(source, opts) { return canonicalOf(source, opts).points }
const hostOf = scheduler => scheduler.root.children.get('host')
function seat(source, config = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    return scheduler
}
const tickRaw = (scheduler, H, budget) => scheduler.withSlice(budget, () => scheduler.tick(H))

// --- Instrument first: the comparator must distinguish before any equality means anything. ---
const one = JSON.stringify(pointsOf('fw 1'))
const two = JSON.stringify(pointsOf('fw 2'))
const oneAgain = JSON.stringify(pointsOf('fw 1'))
requireEvidence('comparator control: two different geometries differ', one !== two)
requireEvidence('comparator control: the same geometry repeats', one === oneAgain)

// --- prep: driver idle / new play witness. ---
const idle = seat('fw 1')
for (let pass = 0; pass < 20 && !idle.done; pass++) tickRaw(idle, 0, null)
const idleProduced = tickRaw(idle, 1000, null)
const sleep = seat('fw 1\nwait 0.1\nfw 2')
tickRaw(sleep, 0, null)
const newPlay = seat('fw 1')
for (let pass = 0; pass < 20 && !newPlay.done; pass++) tickRaw(newPlay, 0, null)
newPlay.hotSwapChild('host', fork('host', 'fw 5'), { fresh: true, deferStart: true })
const state = { idle: { done: idle.done, produced: idleProduced, resumeAt: hostOf(idle).resumeAt },
    sleep: { done: sleep.done, resumeAt: hostOf(sleep).resumeAt, suspension: hostOf(sleep).suspension?.kind ?? null },
    newPlay: { done: newPlay.done, resumeAt: hostOf(newPlay).resumeAt } }
emit({ kind: 'phase', phase: 'prep:idle-new-play', gate: 'prerequisite',
    control: state, verdict: 'partial',
    detail: 'idle = done/no work; sleep = not done with resumeAt 100; new play = not done with resumeAt 0. The CAUSE of a driver pause (hidden tab, render-on-demand) shares "no tick" and is not separable at these seams.' })
requireEvidence('idle: no work and done', idleProduced === false && idle.done === true && hostOf(idle).resumeAt === 0)
requireEvidence('sleep is not idle: future wake', sleep.done === false && hostOf(sleep).resumeAt === 100 && hostOf(sleep).suspension === null)
requireEvidence('new play is not idle: not done, resumeAt 0', newPlay.done === false && hostOf(newPlay).resumeAt === 0)
requireEvidence('driver-pause cause is not separable here (censored)', true)

// --- P2: drawable atomicity — equivalence control. ---
const N = 4
const p2Variants = {
    straight: Array.from({ length: N }, () => 'fw 1').join('\n'),
    loop: `loop ${N} do\n fw 1\nend`,
    helper: `draw r n do\n loop n do\n  fw 1\n end\nend\nlet F = r ${N}`,
    recursion: `draw r n do\n when n>0 do\n  fw 1\n  r n-1\n end\nend\nlet F = r ${N}`,
}
const p2Canon = Object.fromEntries(Object.entries(p2Variants).map(([name, source]) => [name, JSON.stringify(pointsOf(source))]))
emit({ kind: 'phase', phase: 'P2', gate: 'equivalence control (treatment gated: no presentation-only macro layer exists)',
    control: { equal: Object.values(p2Canon).every(value => value === p2Canon.straight), points: JSON.parse(p2Canon.straight).length },
    verdict: 'control earned; treatment gated',
    detail: 'straight/loop/helper/recursion produce identical geometry in this model; a same-geometry control is now available' })
for (const name of Object.keys(p2Variants)) requireEvidence(`P2 equivalence: ${name} equals straight`, p2Canon[name] === p2Canon.straight)

// --- P3: ownership / newest-wins — attempted observation; treatment gated. ---
const responder = delayedResponder({ defer: 1 })
const slot = seat('fw 1\nwait 0.1\nfw 2', { admitAsync: responder.admit })
tickRaw(slot, 0, null)
await settle()
const pendingRun = hostOf(slot).runIncarnation
const pendingSuspension = hostOf(slot).suspension?.kind ?? null
slot.hotSwapChild('host', fork('host', 'fw 9'), { fresh: false, deferStart: false })
responder.calls[0].resolve({ accepted: true, transform: responder.calls[0].request.requested })
await settle()
for (let pass = 0; pass < 10 && !slot.done; pass++) tickRaw(slot, 0, null)
const pose = hostOf(slot).transform.deref().position
emit({ kind: 'phase', phase: 'P3', gate: 'treatment gated (cooperative cancellation not implemented)',
    control: { pendingRun, pendingSuspension, settledPose: pose, errors: slot.errors.map(e => e.message) },
    verdict: 'inconclusive; needs a dedicated supersession rig',
    detail: 'a late reply left the newest pose (fw 9) intact and raised no error, but the run token did not change across this rewire, so this does not separate "obsolete reply dropped" from "reply never applied". Record, do not rule.' })
requireEvidence('P3 late reply does not resurrect the old answer in this pilot', JSON.stringify(pose) === JSON.stringify([9, 0, 0]) && slot.errors.length === 0)

// --- P4: credit / memory conservation — capacity sweep. ---
const p4Source = 'fw 1\nfw 2\nfw 3'
const p4Canon = Object.fromEntries([1, 2, 16, 512].map(capacity => [capacity, JSON.stringify(canonicalOf(p4Source, { capacity }))]))
emit({ kind: 'phase', phase: 'P4', gate: 'treatment gated (no staging policy change)',
    control: { equal: Object.values(p4Canon).every(value => value === p4Canon[512]), capacities: [1, 2, 16, 512] },
    verdict: 'control earned; treatment gated',
    detail: 'canonical surviving geometry is equal across capacities in this fixture' })
for (const capacity of [1, 2, 16]) requireEvidence(`P4 capacity ${capacity} equals 512`, p4Canon[capacity] === p4Canon[512])

// --- P5 / P6: browser-only. Record, do not fake. ---
emit({ kind: 'phase', phase: 'P5', gate: 'not configured: no browser harness (Chromium/Firefox installed; playwright/puppeteer unresolved)', control: null, verdict: 'not run',
    detail: 'attribution needs real spans; the contract forbids synthetic work units as latency' })
emit({ kind: 'phase', phase: 'P6', gate: 'not configured: no browser harness (Chromium/Firefox installed; playwright/puppeteer unresolved)', control: null, verdict: 'not run',
    detail: 'experience needs real input and human judgement' })

// --- P7: schedule invariance — allowance (budget) control. ---
const p7Source = 'loop 6 do\n fw 1\nend'
const p7Canon = Object.fromEntries([['unpaced', null], ['spent', -1]].map(([name, slice]) => [name, JSON.stringify(canonicalOf(p7Source, { slice }))]))
emit({ kind: 'phase', phase: 'P7', gate: 'treatment validation gated (no candidate policy)',
    control: { equal: p7Canon.unpaced === p7Canon.spent, unpaced: JSON.parse(p7Canon.unpaced), spent: JSON.parse(p7Canon.spent) },
    verdict: 'control earned; candidate validation gated',
    detail: 'fixed-input meaning is invariant to the work allowance in this fixture' })
requireEvidence('P7 allowance does not change canonical geometry', p7Canon.unpaced === p7Canon.spent)

emit({ kind: 'verdict', experiment: 'P2-P7-phase-walk',
    controlsEarned: ['prep:idle-new-play (partial)', 'P2 equivalence', 'P4 capacity invariance', 'P7 allowance invariance'],
    blocked: ['P3 (needs a supersession rig; treatment gated)', 'P5 (unconfigured browser harness)', 'P6 (unconfigured browser harness)'],
    gated: ['P2 macro treatment', 'P4 staging treatment', 'P7 candidate validation'],
    next: 'driver idle/new-play cause witness; P3 needs a dedicated supersession rig; P5/P6 need a configured browser harness',
    promotion: 'rejected', runtimeChanged: false })
