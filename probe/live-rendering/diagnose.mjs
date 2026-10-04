// probe-status: concluded
// P0 observes current policy; synthetic admission cost is not device latency.
// Run: node probe/live-rendering/diagnose.mjs > /tmp/live-rendering.jsonl
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
import { worldProgress } from '../../assets/js/turtling/vitals.js'
import { buildWorld, delayedResponder, fork, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const digest = value => createHash('sha256').update(value).digest('hex')
const emit = row => console.log(JSON.stringify(row))
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

function sourceManifest(directory) {
    const files = []
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) files.push(...sourceManifest(path))
        else if (/\.m?js$/.test(entry.name)) files.push([relative(root, path), digest(readFileSync(path))])
    }
    return files
}

const manifest = [
    ...sourceManifest(join(root, 'assets/js')),
    ['test/js/laws/harness.mjs', digest(readFileSync(join(root, 'test/js/laws/harness.mjs')))],
    ['probe/live-rendering/diagnose.mjs', digest(readFileSync(fileURLToPath(import.meta.url)))],
].sort(([a], [b]) => a.localeCompare(b))
emit({
    kind: 'manifest', experiment: 'P0', treatment: 'current-runtime-only',
    node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: digest(JSON.stringify(manifest)), sourceFiles: manifest.length,
    sourceManifest: manifest,
    primarySources: manifest.filter(([path]) => /\/(compositor|scheduler|timeline|vitals|pacer|diagnose)\.[mj]+s$/.test(path)),
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    workUnits: 'one synthetic clock unit per identity-admitted motion, not measured milliseconds',
    limitations: ['no GPU', 'no browser input', 'no candidate horizon policy', 'state getters are not exact stop reasons'],
})

function snapshot(scheduler) {
    return {
        horizon: scheduler.lastTickTime, logicalFrontier: scheduler.root._frontier,
        done: scheduler.done, building: scheduler.building, atCut: scheduler.atCut,
        feedbackPhase: worldProgress(scheduler).phase,
        errors: scheduler.errors,
        frames: [...scheduler.registry.values()].map(frame => ({
            id: frame.id, address: frame.address ?? frame.name,
            incarnation: frame.runIncarnation ?? null, done: frame.done,
            resumeAt: frame.resumeAt, elapsedTime: frame.elapsedTime ?? null,
            logicalBirth: frame.logicalBirth ?? null, midInstant: frame.midInstant,
            suspension: frame.suspension?.kind ?? null,
            queuedEvents: frame.channel.length, ownedChildren: frame.children.size,
        })),
    }
}

function step(scheduler, horizon) {
    let tickReturn
    scheduler.withSlice(null, () => { tickReturn = scheduler.tick(horizon) })
    return { tickReturn, ...snapshot(scheduler) }
}

function drain(scheduler) {
    const events = []
    for (const frame of scheduler.registry.values()) {
        for (const event of frame.channel.drain()) events.push({ source: frame.address ?? frame.name, type: event.type })
    }
    return events
}

function diagnostic(name, source, config = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    emit({ kind: 'fixture', name, source, sourceSha256: digest(source), config: { capacity: config.capacity ?? 512, breathEvery: 1, clock: 'frozen', deferredSeat: true } })
    return scheduler
}

const waiting = diagnostic('healthy-wait', 'draw r n do\n fw n\n wait 0.1\n fw n\nend\nlet F = r 2')
for (const horizon of [0, 50, 100]) {
    emit({ kind: 'state', fixture: 'healthy-wait', ...step(waiting, horizon), drained: drain(waiting) })
}

const child = diagnostic('ended-owner-live-child', 'draw r n do\n as kid do\n  fw n\n  wait 0.1\n  fw n\n end\nend\nlet F = r 2')
for (const horizon of [0, 50, 100]) {
    emit({ kind: 'state', fixture: 'ended-owner-live-child', ...step(child, horizon), drained: drain(child) })
}

const credit = diagnostic('credit-pressure', 'fw 1\nfw 1\nfw 1', { capacity: 1 })
emit({ kind: 'state', fixture: 'credit-pressure', phase: 'before-drain', ...step(credit, 0) })
for (let pass = 0; pass < 8 && !credit.done; pass++) {
    const drained = drain(credit)
    emit({ kind: 'state', fixture: 'credit-pressure', phase: 'after-credit-return', pass, drained, ...step(credit, 0) })
}
emit({ kind: 'termination', fixture: 'credit-pressure', censored: !credit.done, finalDrained: drain(credit) })

const delayed = delayedResponder({ defer: 1 })
const admission = diagnostic('delayed-admission', 'draw r n do\n fw n\nend\nlet F = r 2', { admitAsync: delayed.admit })
emit({ kind: 'state', fixture: 'delayed-admission', phase: 'pending', ...step(admission, 0), pendingReplies: delayed.calls.length })
await settle()
emit({ kind: 'state', fixture: 'delayed-admission', phase: 'no-reply-yet', ...step(admission, 0), pendingReplies: delayed.calls.length })
if (delayed.calls.length !== 1) throw Error('admission fixture did not produce exactly one controlled pending reply')
const reply = delayed.calls[0]
reply.resolve({ accepted: true, transform: reply.request.requested })
await settle()
emit({ kind: 'state', fixture: 'delayed-admission', phase: 'reply-delivered', ...step(admission, 0), drained: drain(admission) })

function compositorDiagnostic(count, afterWaitChild = false) {
    const name = (afterWaitChild ? 'ended-owner-after-wait-n' : 'current-compositor-n') + count
    const source = afterWaitChild
        ? 'draw r n do\n as kid do\n  fw 1\n  wait 0.1\n  loop n do\n   fw 1\n  end\n end\nend\nlet F = r ' + count
        : 'draw r n do\n loop n do\n  fw 1\n end\n wait 0.1\n fw 2\nend\nlet F = r ' + count
    let workClock = 0, admitted = 0, ticks = 0
    const scheduler = buildWorld({
        capacity: 512, breathEvery: 4, clock: () => workClock,
        admit: request => { workClock++; admitted++; return { accepted: true, transform: request.requested } },
    })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    const originalTick = scheduler.tick.bind(scheduler)
    scheduler.tick = horizon => { ticks++; return originalTick(horizon) }
    const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
    ink._cached = true
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, {
        focus: createFocus(scheduler), pacer: { budgetMs: 4, observe() {}, skip() {} },
        createText: () => { throw Error('fixture has no labels') },
    })
    const opportunities = [0, 16, 32, 48, 80, 96, 112, 128]
    emit({ kind: 'fixture', name, source, sourceSha256: digest(source), config: { capacity: 512, breathEvery: 4, sliceWorkUnits: 4, workPerAdmission: 1, materializer: 'real-headless', opportunities } })
    for (const timestamp of opportunities) {
        const beforeWork = workClock, beforeTicks = ticks
        compositor.advance(timestamp)
        let segments = 0
        scene.traverse(object => { segments += object.geometry?.instanceCount || 0 })
        emit({ kind: 'presentation', fixture: name, timestamp, syntheticWork: workClock - beforeWork, ticks: ticks - beforeTicks, admitted, segments, ...snapshot(scheduler) })
    }
    emit({ kind: 'termination', fixture: name, censored: !scheduler.done })
    compositor.dispose()
    ink.dispose()
}

for (const count of [600, 12000]) compositorDiagnostic(count)
compositorDiagnostic(12000, true)
