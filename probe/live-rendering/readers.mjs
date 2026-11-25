// probe-status: active
// Equivalent readers: candidates must return the SAME classification as an explicit oracle
// across six readiness states, then be compared on correctness, visits and host cost across
// tree sizes. A cheaper reader giving a different answer is not an alternative. Runtime unchanged.
// Run: node probe/live-rendering/readers.mjs > probe/live-rendering/records/readers-run.jsonl
// Snap: node probe/live-rendering/readers.mjs --snapshot > probe/live-rendering/records/readers-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/readers.mjs'
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
emit({ kind: 'manifest', experiment: 'equivalent-readers', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'headless model bench; oracle vs candidates; runtime unchanged',
    limitations: ['model sink, no browser', 'oracle labels are hand-set per state', 'single host, single process'] })

emit({ kind: 'prediction', phase: 'equivalent-readers',
    hypothesis: 'an O(frames) reader reproduces the oracle classification on all six states; an O(1) flags reader is cheaper but cannot distinguish the closed-due body, breath, or the pending/ready admission',
    manipulationCheck: 'each state must actually differ in its readiness cause',
    falsifier: 'a cheaper reader returns the same classification everywhere' })

const seat = (source, config = {}) => {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    return scheduler
}
const tick = (scheduler, horizon, budget = null) => scheduler.withSlice(budget, () => scheduler.tick(horizon))
const drain = scheduler => { for (const frame of scheduler.registry.values()) frame.channel.drain() }
const tag = (gate, cause, visits) => ({ key: cause ? `${gate}:${cause}` : gate, gate, cause, visits })

// full: reads every frame — suspension kind and verdict, mid-instant, due, derived move.
function full(scheduler, H) {
    if (scheduler.root._derivedMoves.length > 0) return tag('hold', 'derived', 0)
    let visits = 0
    for (const frame of scheduler.registry.values()) {
        visits++
        if (frame === scheduler.root || frame.done) continue
        const suspension = frame.suspension
        if (suspension) {
            if (suspension.kind === 'admission' && suspension.verdict != null) return tag('hold', 'admission-ready', visits)
            return tag('hold', suspension.kind, visits)
        }
        if (frame.midInstant) return tag('hold', 'mid-instant', visits)
        if (frame.resumeAt <= H) return tag('hold', 'due', visits)
    }
    return tag('advance', null, visits)
}
// flagsOnly: reads only O(1) scheduler flags.
function flagsOnly(scheduler) {
    if (scheduler.root._derivedMoves.length > 0) return tag('hold', 'derived', 0)
    if (scheduler.building) return tag('hold', 'flags', 1)
    return tag('advance', null, 1)
}

async function admissionState(resolve) {
    const responder = delayedResponder({ defer: Infinity })
    const scheduler = seat('fw 1', { admitAsync: responder.admit })
    tick(scheduler, 0)
    await settle()
    const call = responder.calls[0]
    if (resolve) { call.resolve({ accepted: true, transform: call.request.requested }); await settle() }
    return scheduler
}
async function buildStates() {
    const states = []
    const healthy = seat('fw 1\nwait 0.1\nfw 2'); tick(healthy, 0); drain(healthy)
    states.push({ name: 'healthy-future-wait', scheduler: healthy, H: 0, oracle: 'advance' })

    const breath = seat('loop 8 do\n fw 1\nend\nwait 0.1', { breathEvery: 4 }); tick(breath, 0, -1); drain(breath)
    states.push({ name: 'breath-parked-construction', scheduler: breath, H: 0, oracle: 'hold:breath' })

    const closedDue = seat('fw 1\nwait 0.1\nfw 2'); tick(closedDue, 0); drain(closedDue)
    states.push({ name: 'closed-but-due-body', scheduler: closedDue, H: 100, oracle: 'hold:due' })

    const derived = seat('let B\nlet A = (B.x, 0)', { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    for (let pass = 0; pass < 50 && !derived.done; pass++) { tick(derived, 0); drain(derived) }
    const B = derived.root.children.get('host').children.get('B')
    derived.requestMotion(B, { rotation: SE3.identity().rotation, position: [7, 0, 0] }, derived.motionRevision)
    states.push({ name: 'queued-derived-move', scheduler: derived, H: 0, oracle: 'hold:derived' })

    states.push({ name: 'admission-pending', scheduler: await admissionState(false), H: 0, oracle: 'hold:admission' })
    states.push({ name: 'admission-ready', scheduler: await admissionState(true), H: 0, oracle: 'hold:admission-ready' })
    return states
}

const states = await buildStates()
for (const state of states) {
    const f = full(state.scheduler, state.H), g = flagsOnly(state.scheduler)
    emit({ kind: 'state', name: state.name, oracle: state.oracle, full: f.key, flagsOnly: g.key,
        fullCorrect: f.key === state.oracle, flagsOnlyCorrect: g.key === state.oracle, registry: state.scheduler.registry.size })
    requireEvidence(`${state.name}: the full reader reproduces the oracle classification`, f.key === state.oracle)
}
const gateOf = key => key.split(':')[0]
const diagnosticWrong = states.filter(s => flagsOnly(s.scheduler).key !== s.oracle).map(s => s.name)
const decisionWrong = states.filter(s => gateOf(flagsOnly(s.scheduler).key) !== gateOf(s.oracle)).map(s => s.name)
emit({ kind: 'state-summary', fullCorrect: states.length, flagsDecisionWrong: decisionWrong, flagsDiagnosticWrong: diagnosticWrong })
requireEvidence('the O(frames) reader matches the oracle on every state', states.every(s => full(s.scheduler, s.H).key === s.oracle))
requireEvidence('the flags reader is DECISION-wrong on the closed-due body only', decisionWrong.join(',') === 'closed-but-due-body')
requireEvidence('the flags reader is DIAGNOSTIC-wrong on the four cause states', diagnosticWrong.length === 4)

// Cost across tree sizes, on the plain healthy-wait state plus N fan waits.
{
    const rows = []
    for (const N of [64, 256, 1024]) {
        const fan = Array.from({ length: N }, (_, i) => `as a${i} do\n wait 10\nend`).join('\n')
        const scheduler = seat(fan + '\nfw 1\nwait 0.1\nfw 2'); tick(scheduler, 0); drain(scheduler)
        const fVisits = full(scheduler, 0).visits, gVisits = flagsOnly(scheduler).visits
        let sink = 0
        const time = (fn) => { const t0 = performance.now(); for (let i = 0; i < 20000; i++) sink += fn(); return (performance.now() - t0) / 20000 * 1000 }
        const fullUs = time(() => full(scheduler, 0).visits), flagsUs = time(() => flagsOnly(scheduler).visits)
        rows.push({ n: N, registry: scheduler.registry.size, fullVisits: fVisits, flagsVisits: gVisits })
        emit({ kind: 'cost', n: N, registry: scheduler.registry.size, fullVisits: fVisits, flagsVisits: gVisits })
        requireEvidence(`cost n=${N}: the full reader visits the whole registry, the flags reader does not`, fVisits === scheduler.registry.size && gVisits <= 1)
        note(`readers n=${N}: registry=${scheduler.registry.size} full=${fullUs.toFixed(3)}us flags=${flagsUs.toFixed(3)}us sink=${sink}`)
    }
    emit({ kind: 'cost-summary', rows })
}

emit({ kind: 'reading', subject: 'equivalent readers',
    note: 'the O(1) flags reader is cheaper but differs on the closed-due body and on pending vs ready admission, so it is not an alternative. The only correct reader here is O(frames). Visits and host cost are retained; scan versus pump-summary remains open until a correct cheaper reader is shown.' })
emit({ kind: 'verdict', experiment: 'equivalent-readers',
    decisionEquivalence: { full: 'matches', flags: 'differs only on the closed-but-due body (says advance, must hold) — decisively rejects flags for horizon control' },
    diagnosticEquivalence: { full: 'matches', flags: 'differs on four causes: breath, closed-due, pending and ready admission' },
    holdIsNotRetry: 'pending and ready admission both hold, but permit different useful actions; a hold gate is not a pump instruction',
    earned: ['the O(frames) reader is decision- and diagnostic-equivalent', 'the flags reader is decision-wrong on the closed-due body and causally indistinct'],
    notEarned: ['that no correct cheaper reader exists', 'that any notification is necessary'],
    promotion: 'rejected', runtimeChanged: false })
