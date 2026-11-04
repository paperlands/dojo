// probe-status: active
// Machinery cost: before minting reporting obligations, measure the alternatives. Is the
// reference scan inexpensive, and is a blind retry a spin or one check per opportunity?
// Counts go to stdout (deterministic, recorded); wall time goes to stderr (host measurement).
// Run: node probe/live-rendering/machinery.mjs > probe/live-rendering/records/machinery-run.jsonl
// Snap: node probe/live-rendering/machinery.mjs --snapshot > probe/live-rendering/records/machinery-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/machinery.mjs'
const contract = 'specs/turtle/live-rendering-contract.org'
const hash = value => createHash('sha256').update(value).digest('hex')
const emit = row => console.log(JSON.stringify(row))
const note = line => console.error(line)   // stderr: host measurement, not part of the record
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
emit({ kind: 'manifest', experiment: 'machinery-cost', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'deterministic counts recorded; wall time only on stderr',
    limitations: ['counts are the record; wall time is a host measurement, not device latency', 'model bench, no browser GPU', 'one host'] })

// --- Questions the census left open, as predictions. ---
emit({ kind: 'prediction', phase: 'machinery',
    hypothesis: 'the O(frames) reference scan is inexpensive relative to a tick, so the shape argument alone does not justify new reporting',
    manipulationCheck: 'the scan must visit the whole registry, and the registry must differ across sizes',
    falsifier: 'the scan costs as much as or more than a tick' })
emit({ kind: 'prediction', phase: 'machinery',
    hypothesis: 'a blind retry is one check per opportunity, not a synchronous spin',
    manipulationCheck: 'the withheld reply must park the frame and the registry must be non-trivial',
    falsifier: 'a no-progress opportunity costs more than one tick' })

const fan = n => Array.from({ length: n }, (_, i) => `as a${i} do\n wait 10\nend`).join('\n')
function referenceScan(scheduler, H) {
    let visited = 0, live = 0, due = 0, nextWake = Infinity
    for (const frame of scheduler.registry.values()) {
        visited++
        if (frame.done) continue
        live++
        if (frame.suspension) due++
        if (frame.resumeAt > H && frame.resumeAt < nextWake) nextWake = frame.resumeAt
    }
    return { visited, live, due, nextWake: Number.isFinite(nextWake) ? nextWake : null }
}
let sink = 0
const time = (fn, reps) => { const t0 = performance.now(); for (let i = 0; i < reps; i++) sink += fn() ? 1 : 0; return (performance.now() - t0) / reps }

// --- Control: the scan actually classifies a stop, not a no-op. ---
{
    const cpu = buildWorld({ capacity: 512, clock: () => 0, breathEvery: 4 })
    cpu.hotSwapChild('host', fork('host', 'loop 8 do\n fw 1\nend\nwait 0.1'), { fresh: true, deferStart: true })
    cpu.withSlice(-1, () => cpu.tick(0))
    requireEvidence('control: the scan sees the parked frame', referenceScan(cpu, 0).due === 1)
}

// --- A. Scan work scales with the registry; it visits every frame. ---
const scanBySize = {}
for (const N of [64, 256]) {
    const scheduler = buildWorld({ capacity: 4096, clock: () => 0 })
    scheduler.hotSwapChild('host', fork('host', 'fw 1\n' + fan(N)), { fresh: true, deferStart: true })
    for (let i = 0; i < 4 && !scheduler.done; i++) scheduler.withSlice(null, () => scheduler.tick(0))
    const scan = referenceScan(scheduler, 0)
    scanBySize[N] = { registry: scheduler.registry.size, visited: scan.visited, live: scan.live, nextWake: scan.nextWake }
    emit({ kind: 'cost', part: 'scan', n: N, registry: scheduler.registry.size, visitedPerScan: scan.visited, live: scan.live, nextWake: scan.nextWake })
}
requireEvidence('scan manipulation: the registry differs across sizes', scanBySize[64].registry !== scanBySize[256].registry)
requireEvidence('scan: one scan visits the whole registry', scanBySize[64].visited === scanBySize[64].registry && scanBySize[256].visited === scanBySize[256].registry)

// --- B. A blind retry is one tick per opportunity with no work. ---
const responder = delayedResponder()
const stalled = buildWorld({ capacity: 4096, clock: () => 0, admitAsync: responder.admit })
stalled.hotSwapChild('host', fork('host', fan(64) + '\nfw 1'), { fresh: true, deferStart: true })
stalled.withSlice(null, () => stalled.tick(0))
await settle()
let noProgressTicks = 0, motions = 0
for (let i = 0; i < 8; i++) {
    const produced = stalled.withSlice(null, () => stalled.tick(0))
    if (!produced) noProgressTicks++
    for (const frame of stalled.registry.values()) for (const event of frame.channel.drain()) if (event.type === 'path') motions++
}
emit({ kind: 'cost', part: 'retry', opportunities: 8, noProgressTicks, admissionCalls: responder.calls.length,
    motions, registry: stalled.registry.size, suspension: stalled.root.children.get('host').suspension?.kind ?? null })
requireEvidence('retry manipulation: the reply is withheld and the frame is parked', responder.calls.length === 1 && stalled.root.children.get('host').suspension?.kind === 'admission')
requireEvidence('retry: exactly one no-progress tick per opportunity, no spin', noProgressTicks === 8 && motions === 0)

// --- C. Wall time (stderr only): is the scan cheap relative to a tick? ---
{
    const rows = []
    for (const N of [64, 256]) {
        const scheduler = buildWorld({ capacity: 4096, clock: () => 0 })
        scheduler.hotSwapChild('host', fork('host', 'fw 1\n' + fan(N)), { fresh: true, deferStart: true })
        for (let i = 0; i < 4 && !scheduler.done; i++) scheduler.withSlice(null, () => scheduler.tick(0))
        for (let i = 0; i < 500; i++) { referenceScan(scheduler, 0); scheduler.tick(0) }   // warm
        const scanUs = time(() => referenceScan(scheduler, 0).visited, 20000) * 1000
        const tickUs = time(() => scheduler.tick(0), 20000) * 1000
        rows.push({ N, registry: scheduler.registry.size, scanUs: +scanUs.toFixed(3), tickUs: +tickUs.toFixed(3), scanToTick: +(scanUs / tickUs).toFixed(2) })
    }
    note('host wall-time (not device latency; supplementary): ' + JSON.stringify(rows) + ' sink=' + sink)
}

emit({ kind: 'reading', subject: 'machinery cost',
    scan: { visitsWholeRegistry: true, shapeO: 'O(frames)' },
    retry: { perOpportunity: 'one tick', spin: false },
    note: 'a reference scan visits every live frame once; the tick already traverses the tree once, so a summary could piggyback on that pass (unmeasured). Neither the scan shape nor the retry rules the alternatives in or out; the architectural leap is not justified by these data.' })
emit({ kind: 'verdict', experiment: 'machinery-cost',
    earned: ['the scan visits the whole registry (O(frames))', 'a blind retry is exactly one no-progress tick per opportunity, no spin'],
    conditional: 'host timing is retained only on stderr; "cheaper than a tick" is a host observation, not a device claim, and this reader is simpler than the P1 summary',
    notEarned: ['that any owner needs a new reporting mechanism', 'that a pump-boundary summary is or is not cheap (unmeasured)', 'that the driver pumps once per opportunity (this instrument calls tick once by construction)'],
    promotion: 'rejected', runtimeChanged: false })
