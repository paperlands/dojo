// probe-status: active
// Separate clocks inside the real driver, now with the READER as the gate and irregular wall
// opportunities. The WALL timestamp keeps feeding idle-gap detection and pacer observation;
// the REVEAL horizon advances by the normalized elapsed allowance (idle time removed) only when
// Runtime unchanged; the split is a probe-local driver seam.
// Run: node probe/live-rendering/clocks.mjs > probe/live-rendering/records/clocks-run.jsonl
// Snap: node probe/live-rendering/clocks.mjs --snapshot > probe/live-rendering/records/clocks-instrument.jsonl
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
import { rebaseEpoch, idleFloorMs } from '../../assets/js/turtling/timeline.js'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/clocks.mjs'
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
emit({ kind: 'manifest', experiment: 'split-clocks', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'real headless compositor; reader-gated reveal, wall delta, irregular opportunities; no runtime edit',
    limitations: ['model sink, no browser', 'the split clock is a driver seam, not a runtime policy', 'single process run'] })

emit({ kind: 'prediction', phase: 'split-clocks',
    hypothesis: 'a reader-gated reveal clock tracks normalized wall time when unconstrained, holds during construction (including an idle gap) and queued/closed work, replays no withheld time as debt, and preserves authored tempo under irregular opportunities',
    manipulationCheck: 'the gate must hold reveal for closed-but-due and queued-derived work, and a wall gap must be seen while reveal is held',
    falsifier: 'wait depends on callback count, withheld time reappears as debt, or wall/idle observations are suppressed by the hold' })

const STEP = 16
const round = n => Math.round(n * 1e6) / 1e6
const MAX_OVERRUN = 64
const FRAME_MS = 1000 / 60
const IDLE_GAP_MS = idleFloorMs(FRAME_MS)

function makeRig(source, { budgetMs = 4, admitAsync, admit } = {}) {
    const clock = { work: 0 }
    const responder = admitAsync ? delayedResponder() : null
    const scheduler = buildWorld({ capacity: 512, breathEvery: 4, clock: () => clock.work,
        ...(admitAsync ? { admitAsync: (request) => { clock.work++; return responder.admit(request) } } : { admit: admit ?? (({ requested }) => { clock.work++; return { accepted: true, transform: requested } }) }) })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
    ink._cached = true
    const pacer = { budgetMs, events: [], observe(dt) { this.events.push(dt) }, skip() { this.events.push('skip') } }
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), pacer, createText: () => { throw Error('fixture has no labels') } })
    const state = { split: true, reveal: 0, ticks: 0 }
    const original = scheduler.tick.bind(scheduler)
    scheduler.tick = (now) => { state.ticks++; return original(state.split ? state.reveal : now) }
    return { scheduler, compositor, scene, clock, responder, pacer, state }
}
const canonical = rig => { let n = 0; rig.scene.traverse(o => { n += o.geometry?.instanceCount || 0 }); return JSON.stringify({ done: rig.scheduler.done, segs: n, errors: rig.scheduler.errors.length, frames: [...rig.scheduler.registry.values()].map(f => [f.address ?? f.name, f.transform.deref().position.map(round), f.done]) }) }
// The full reader, used provisionally AS THE GATE.
function fullReader(scheduler, H) {
    if (scheduler.root._derivedMoves.length > 0) return 'hold:derived'
    for (const frame of scheduler.registry.values()) {
        if (frame === scheduler.root || frame.done) continue
        const suspension = frame.suspension
        if (suspension) return suspension.kind === 'admission' && suspension.verdict != null ? 'hold:admission-ready' : `hold:${suspension.kind}`
        if (frame.midInstant) return 'hold:mid-instant'
        if (frame.resumeAt <= H) return 'hold:due'
    }
    return 'advance'
}
// The reveal advances by the NORMALIZED elapsed allowance (idle removed) only when the reader
// says advance. The allowance is derived with the existing timeline.js normalization.
function driveReaderGated(rig, wallPlan) {
    const trace = []
    let epoch = null, lastWallT = null, prevNow = null
    for (const wall of wallPlan) {
        const gate = fullReader(rig.scheduler, rig.state.reveal)
        const rebased = rebaseEpoch(epoch, lastWallT, wall, FRAME_MS, IDLE_GAP_MS)
        const idledOut = rebased !== epoch
        epoch = rebased
        lastWallT = wall
        if (epoch === null) epoch = wall
        const now = round(wall - epoch)
        const allowance = prevNow === null ? 0 : Math.max(0, now - prevNow)
        const advanceBy = rig.state.split && gate === 'advance' ? allowance : 0
        rig.state.reveal += advanceBy
        const t0 = rig.state.ticks, p0 = rig.pacer.events.length
        rig.compositor.advance(wall)
        trace.push({ wall, wallClock: round(wall - wallPlan[0]), now, idledOut, allowance, gate, advanceBy, reveal: round(rig.state.reveal),
            atCut: rig.scheduler.atCut, done: rig.scheduler.done, ticks: rig.state.ticks - t0,
            pacer: rig.pacer.events.slice(p0), readerAfter: fullReader(rig.scheduler, rig.state.reveal) })
        prevNow = now
        if (rig.scheduler.done) break
    }
    return trace
}
function driveCoupled(rig, wallPlan) { rig.state.split = false; for (const wall of wallPlan) { rig.compositor.advance(wall); if (rig.scheduler.done) break } }
const noDebt = trace => trace.every((t, i) => i === 0 || t.reveal - trace[i - 1].reveal <= t.allowance + 1e-6)   // vs normalized, not raw
const wallObserved = trace => trace.slice(1).every(t => t.pacer.length > 0)

// --- Gate: the reader decides advancement; closed-but-due and derived must hold it. ---
{
    const s = buildWorld({ capacity: 512, clock: () => 0 })
    s.hotSwapChild('host', fork('host', 'fw 1\nwait 0.1\nfw 2'), { fresh: true, deferStart: true })
    s.withSlice(null, () => s.tick(0))
    for (const frame of s.registry.values()) frame.channel.drain()
    const gate = fullReader(s, 100)
    emit({ kind: 'gate', name: 'closed-but-due', reader: gate })
    requireEvidence('gate: a closed-but-due body holds the reveal clock', gate === 'hold:due')
}
{
    const s = buildWorld({ capacity: 512, clock: () => 0, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    s.hotSwapChild('host', fork('host', 'let B\nlet A = (B.x, 0)'), { fresh: true, deferStart: true })
    for (let i = 0; i < 50 && !s.done; i++) { s.withSlice(null, () => s.tick(0)); for (const frame of s.registry.values()) frame.channel.drain() }
    const B = s.root.children.get('host').children.get('B')
    s.requestMotion(B, { rotation: SE3.identity().rotation, position: [7, 0, 0] }, s.motionRevision)
    const gate = fullReader(s, 0)
    emit({ kind: 'gate', name: 'queued-derived', reader: gate })
    requireEvidence('gate: a queued derived move holds the reveal clock', gate === 'hold:derived')
}

// --- Heavy construction: reader-gated reveal tracks wall, holds while building, no debt. ---
{
    const plan = Array.from({ length: 40 }, (_, i) => i * STEP)
    const split = makeRig('draw r n do\n loop n do\n  fw 1\n end\n wait 0.1\n fw 2\nend\nlet F = r 12000')
    const coupled = makeRig('draw r n do\n loop n do\n  fw 1\n end\n wait 0.1\n fw 2\nend\nlet F = r 12000')
    const trace = driveReaderGated(split, plan)
    driveCoupled(coupled, plan)
    const held = trace.filter(t => t.advanceBy === 0 && t.gate !== 'advance').length
    emit({ kind: 'fixture', name: 'heavy-construction', heldSteps: held, first: trace.slice(0, 5), canonicalEqual: canonical(split) === canonical(coupled) })
    requireEvidence('heavy: the reader holds the reveal while building', held > 0)
    requireEvidence('heavy: wall observations continue while reveal is held', wallObserved(trace))
    requireEvidence('heavy: held intervals create no debt', noDebt(trace))
    requireEvidence('heavy: canonical results match the coupled control', canonical(split) === canonical(coupled))
}

// --- Idle gap INSIDE a hold: wall-side idle detection and a held reveal, together. ---
{
    const plan = [0, ...Array.from({ length: 40 }, (_, i) => 5032 + i * STEP)]   // wall gap right after the first opportunity
    const rig = makeRig('draw r n do\n loop n do\n  fw 1\n end\n wait 0.1\n fw 2\nend\nlet F = r 12000')
    const trace = driveReaderGated(rig, plan)
    const gap = trace.find(t => t.idledOut)
    const skips = trace.reduce((n, t) => n + t.pacer.filter(e => e === 'skip').length, 0)
    emit({ kind: 'fixture', name: 'idle-gap-in-construction', gap, skips, canonicalDone: rig.scheduler.done })
    requireEvidence('idle gap in construction: the wall-side idle-out is observed', skips === 1 && gap && gap.pacer.includes('skip'))
    requireEvidence('idle gap in construction: reveal is held across the gap', gap !== undefined && gap.advanceBy === 0 && gap.gate !== 'advance')
    requireEvidence('idle gap in construction: no withheld time reappears as debt', noDebt(trace))
}

// --- Idle gap during a HEALTHY FUTURE WAIT: the reader permits advance, so idle time must NOT
// advance reveal. This is the counterexample: wall [0, 5000] must not resume the wait. ---
{
    const plan = [0, 5000, 5016, 5032, 5048, 5064, 5080, 5096, 5112, 5128, 5146, 5162]
    const split = makeRig('fw 1\nwait 0.1\nfw 2')
    const coupled = makeRig('fw 1\nwait 0.1\nfw 2')
    const trace = driveReaderGated(split, plan)
    driveCoupled(coupled, plan)
    const gap = trace.find(t => t.idledOut)
    let segments = 0; split.scene.traverse(o => { segments += o.geometry?.instanceCount || 0 })
    emit({ kind: 'fixture', name: 'idle-gap-in-healthy-wait', gap, segmentsAfterGap: segments, canonicalEqual: canonical(split) === canonical(coupled) })
    requireEvidence('idle gap in a wait: the wall-side idle-out is observed', gap !== undefined && gap.pacer.includes('skip'))
    requireEvidence('idle gap in a wait: reveal advances only by the normalized frame, not the gap', gap.allowance <= FRAME_MS + 1 && gap.reveal <= FRAME_MS + 1)
    requireEvidence('idle gap in a wait: the wait does not resume early', gap.done === false)
    requireEvidence('idle gap in a wait: canonical matches the coupled control', canonical(split) === canonical(coupled))
}

// --- Irregular opportunities: reveal follows the normalized wall delta; authored tempo. ---
{
    const plan = [0, 7, 23, 61, 100, 137, 180, 220]
    const split = makeRig('fw 1\nwait 0.1\nfw 2')
    const coupled = makeRig('fw 1\nwait 0.1\nfw 2')
    const trace = driveReaderGated(split, plan)
    driveCoupled(coupled, plan)
    const reached = trace.find(t => t.reveal >= 100)
    emit({ kind: 'fixture', name: 'irregular-tempo', trace, canonicalEqual: canonical(split) === canonical(coupled) })
    requireEvidence('tempo: reveal follows the normalized allowance when unconstrained', trace.every(t => t.advanceBy === 0 || t.advanceBy === t.allowance))
    requireEvidence('tempo: no withheld time reappears as debt', noDebt(trace))
    requireEvidence('tempo: the 100ms wait resumes at reveal ~100, not by callback count', reached !== undefined && reached.reveal === 100 && reached.wallClock === 100)
    requireEvidence('tempo: canonical results match the coupled control', canonical(split) === canonical(coupled))
}

// --- Pending / ready admission: pump stopping independent; reader names the states. ---
{
    const rig = makeRig('fw 1', { budgetMs: -1, admitAsync: true })
    driveReaderGated(rig, [0])
    const gate = fullReader(rig.scheduler, rig.state.reveal)
    const t0 = rig.state.ticks, p0 = rig.pacer.events.length
    rig.compositor.advance(1000)
    const ticks = rig.state.ticks - t0
    emit({ kind: 'fixture', name: 'pending-admission', gate, ticksOnParkedOpportunity: ticks, pacer: rig.pacer.events.slice(p0) })
    requireEvidence('pending admission: the reader holds the reveal clock', gate === 'hold:admission')
    requireEvidence('pending admission: pump stopping is bounded (< 64) and the wall is observed', ticks < MAX_OVERRUN && rig.pacer.events.length - p0 === 1)
}
{
    const rig = makeRig('fw 1', { admitAsync: true })
    driveReaderGated(rig, [0])
    const call = rig.responder.calls[0]
    call.resolve({ accepted: true, transform: call.request.requested })
    await settle()
    const ready = fullReader(rig.scheduler, rig.state.reveal)
    driveReaderGated(rig, [16, 32, 48, 64])
    emit({ kind: 'fixture', name: 'admission-ready', ready, done: rig.scheduler.done })
    requireEvidence('ready admission: the reader names the ready state', ready === 'hold:admission-ready')
    requireEvidence('ready admission: the reply resumes and finishes', rig.scheduler.done === true)
}

note('split clocks: wall time drove idle detection and pacer observation; the reader-gated reveal followed the normalized wall delta and held without debt; pump stopping stayed bounded and independent.')
emit({ kind: 'reading', subject: 'split clocks',
    note: 'a reader-gated reveal clock advances by the normalized elapsed allowance (idle time removed via timeline.js), holds during construction (including an idle gap inside the hold) and for closed-due and queued-derived work, replays no withheld time as debt, and preserves authored tempo under irregular opportunities. An idle gap in a healthy wait does NOT advance reveal (counterexample fixed). The full reader is provisional. Scan versus pump-summary remains open; no runtime seam chosen.' })
emit({ kind: 'verdict', experiment: 'split-clocks',
    earned: ['the reader gates reveal; closed-due and derived hold it', 'an idle gap is seen on the wall side while reveal is held', 'reveal follows the normalized wall delta with no debt and preserves authored tempo'],
    notEarned: ['a browser pump cadence', 'a chosen runtime seam for the split', 'scan versus pump-summary'],
    promotion: 'rejected', runtimeChanged: false })
