// probe-status: active
// P4 extension: does INK RELEASE hold? erasing and replacement must return stock to the
// surviving geometry, invariant to channel capacity even when capacity binds. No runtime edit.
// Run: node probe/live-rendering/p4.mjs > probe/live-rendering/records/p4-run.jsonl
// Snap: node probe/live-rendering/p4.mjs --snapshot > probe/live-rendering/records/p4-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/p4.mjs'
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
emit({ kind: 'manifest', experiment: 'P4-ink-release', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'headless model bench; stock accounting under erase and replacement; no runtime edit',
    limitations: ['model sink, no browser GPU', 'single process run', 'replacement is a re-seat, not an in-play region swap'] })

// --- Hypotheses, fixed before observation. ---
emit({ kind: 'prediction', phase: 'P4',
    hypothesis: 'erasing releases resident ink: retained stock after completion equals the SURVIVING segments, not the cumulative total',
    manipulationCheck: 'the same program without erase retains MORE stock than with erase',
    falsifier: 'stock does not drop on erase (leak), or stock exceeds surviving segments' })
emit({ kind: 'prediction', phase: 'P4',
    hypothesis: 'a replacement releases the old subtree ink: retained stock equals the newest geometry',
    manipulationCheck: 'a re-seat changes the geometry and the stock, without summing them',
    falsifier: 'stock accumulates across replacement' })
emit({ kind: 'prediction', phase: 'P4',
    hypothesis: 'surviving geometry and retained stock are invariant to channel capacity, even when capacity binds',
    manipulationCheck: 'capacity 1 and 2 must show an owed debt; 16 and 512 must not',
    falsifier: 'a capacity loses/reorders ink or changes retained stock' })

const round = n => Math.round(n * 1e6) / 1e6
function run(source, { capacity = 512, slice = null, maxTicks = 500 } = {}) {
    const scheduler = buildWorld({ capacity, clock: () => 0 })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    const events = []
    let ticks = 0, debtSeen = false
    const collect = () => {
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) {
                if (event.type === 'path') events.push({ type: 'path', segs: event.points.length - 1, points: event.points.map(p => p.map(round)) })
                else events.push({ type: event.type })
            }
        }
    }
    for (let i = 0; i < maxTicks && !scheduler.done; i++) {
        scheduler.withSlice(slice, () => scheduler.tick(0))
        ticks++
        for (const frame of scheduler.registry.values()) if (frame.suspension?.owed) debtSeen = true
        collect()
    }
    const host = scheduler.root.children.get('host')
    return { done: scheduler.done, ticks, debtSeen, stock: scheduler.stock.resident, events,
        tip: host ? host.transform.deref().position.map(round) : null, errors: scheduler.errors.map(e => e.message) }
}
// Surviving ink = path segments after the last clear; a clear resets the count.
const survivingSegments = events => events.reduce((n, event) => event.type === 'clear' ? 0 : event.type === 'path' ? n + event.segs : n, 0)
const survivingGeometry = events => {
    let points = []
    for (const event of events) { if (event.type === 'clear') points = []; else if (event.type === 'path') points = points.concat(event.points) }
    return JSON.stringify(points)
}

// --- Instrument control: the comparator separates geometry. ---
requireEvidence('control: two different geometries differ', survivingGeometry(run('fw 1').events) !== survivingGeometry(run('fw 2').events))

// --- Erase releases ink. ---
const plain = run('fw 1\nfw 1\nfw 1')
const erased = run('fw 1\nfw 1\nfw 1\nerase\nfw 1\nfw 1')
emit({ kind: 'phase', phase: 'P4', part: 'erase',
    manipulation: { stockWithoutErase: plain.stock, stockWithErase: erased.stock, clearEvents: erased.events.filter(e => e.type === 'clear').length },
    accounting: { stock: erased.stock, survivingSegments: survivingSegments(erased.events) }, verdict: 'release holds' })
requireEvidence('erase manipulation: erase releases resident ink', erased.stock < plain.stock)
requireEvidence('erase accounting: retained stock equals surviving segments', erased.stock === survivingSegments(erased.events))
requireEvidence('erase: a clear event reaches the stream', erased.events.some(e => e.type === 'clear'))

// --- Capacity invariance of the erase fixture; capacity must bind. ---
const caps = [1, 2, 16, 512]
const byCap = Object.fromEntries(caps.map(capacity => [capacity, run('fw 1\nfw 1\nfw 1\nerase\nfw 1\nfw 1', { capacity })]))
emit({ kind: 'phase', phase: 'P4', part: 'erase capacity',
    manipulation: { debtByCapacity: Object.fromEntries(caps.map(c => [c, byCap[c].debtSeen])), ticksByCapacity: Object.fromEntries(caps.map(c => [c, byCap[c].ticks])) },
    stockByCapacity: Object.fromEntries(caps.map(c => [c, byCap[c].stock])),
    geometryEqual: caps.every(c => survivingGeometry(byCap[c].events) === survivingGeometry(byCap[512].events)), verdict: 'invariant when binding' })
requireEvidence('capacity manipulation: 1 and 2 bind (owed debt)', byCap[1].debtSeen === true && byCap[2].debtSeen === true)
requireEvidence('capacity manipulation: 16 and 512 do not bind', byCap[16].debtSeen === false && byCap[512].debtSeen === false)
requireEvidence('capacity: surviving geometry equal', caps.every(c => survivingGeometry(byCap[c].events) === survivingGeometry(byCap[512].events)))
requireEvidence('capacity: retained stock equal and accounted', caps.every(c => byCap[c].stock === survivingSegments(byCap[c].events)))

// --- Replacement releases the old subtree. ---
const replacement = buildWorld({ capacity: 512, clock: () => 0 })
replacement.hotSwapChild('host', fork('host', 'fw 1\nfw 1\nfw 1'), { fresh: true, deferStart: true })
const settleRuns = scheduler => { for (let i = 0; i < 20 && !scheduler.done; i++) scheduler.withSlice(null, () => scheduler.tick(0)); for (const frame of scheduler.registry.values()) frame.channel.drain() }
settleRuns(replacement)
const stockBefore = replacement.stock.resident
replacement.hotSwapChild('host', fork('host', 'fw 1\nfw 1\nfw 1\nfw 1\nfw 1'), { fresh: false, deferStart: false })
const afterEvents = []
for (let i = 0; i < 20 && !replacement.done; i++) {
    replacement.withSlice(null, () => replacement.tick(0))
    for (const frame of replacement.registry.values()) for (const event of frame.channel.drain()) if (event.type === 'path') afterEvents.push({ type: 'path', segs: event.points.length - 1, points: event.points })
}
const stockAfter = replacement.stock.resident
emit({ kind: 'phase', phase: 'P4', part: 'replacement',
    manipulation: { stockBefore, stockAfter, newGeometrySegments: 5 }, verdict: 'old subtree released' })
requireEvidence('replacement manipulation: geometry changed (3 -> 5 segments)', stockBefore === 3 && stockAfter === 5)
requireEvidence('replacement: retained stock equals the newest geometry, not the sum', stockAfter === 5 && stockAfter !== stockBefore + 5)
requireEvidence('replacement: no error', replacement.errors.length === 0)

emit({ kind: 'verdict', experiment: 'P4-ink-release',
    earned: ['erase releases resident ink (stock 3 -> 2), accounted to surviving segments', 'replacement releases the old subtree (3 -> 5, not 8)', 'surviving geometry and stock invariant to capacity while capacity binds'],
    stillOpen: ['the real compositor/GPU residency is a separate witness', 'an ENDLESS drawing is not tested; total memory not shown to plateau'],
    promotion: 'rejected', runtimeChanged: false })
