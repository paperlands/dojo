// probe-status: active
// Rigor pass: re-test P4/P7 invariance with MANIPULATION CHECKS, so an equal result cannot
// be the equality of "the varied cause never engaged the mechanism". No runtime edit.
// Run: node probe/live-rendering/rigor.mjs > probe/live-rendering/records/rigor-run.jsonl
// Snap: node probe/live-rendering/rigor.mjs --snapshot > probe/live-rendering/records/rigor-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/rigor.mjs'
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
    ...['test/js/laws/harness.mjs', self, contract].map(p => [p, hash(readFileSync(join(root, p)))])]
    .sort(([a], [b]) => a.localeCompare(b))
emit({ kind: 'manifest', experiment: 'P4-P7-rigor', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    scope: 'model bench (frozen clock, headless sink), not the browser runtime' })

// --- Hypotheses, fixed before observation. ---
emit({ kind: 'prediction', phase: 'P4',
    hypothesis: 'canonical surviving geometry is invariant to channel capacity EVEN WHEN CAPACITY BINDS, and retained stage stock is accounted',
    manipulationCheck: 'capacity 1 and 2 must show an owed debt; 16 and 512 must not',
    falsifier: 'a capacity loses/reorders/duplicates ink, stock is unaccounted, or the small capacity never parks (vacuous)' })
emit({ kind: 'prediction', phase: 'P7',
    hypothesis: 'fixed-input meaning is invariant to the work allowance EVEN WHEN THE ALLOWANCE CHANGES THE SCHEDULE',
    manipulationCheck: 'the spent allowance must take strictly more ticks and show a breath park; unpaced must not',
    falsifier: 'the allowance changes canonical geometry, or the two schedules are identical (vacuous)' })

const round = n => Math.round(n * 1e6) / 1e6
function probe(source, { capacity = 512, slice = null, maxTicks = 500 } = {}) {
    const scheduler = buildWorld({ capacity, clock: () => 0 })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    const points = []
    let ticks = 0, debtSeen = false, breathSeen = false
    for (let i = 0; i < maxTicks && !scheduler.done; i++) {
        scheduler.withSlice(slice, () => scheduler.tick(0))
        ticks++
        for (const frame of scheduler.registry.values()) {
            if (frame.suspension?.owed) debtSeen = true
            if (frame.suspension?.kind === 'breath') breathSeen = true
            for (const event of frame.channel.drain()) {
                if (event.type === 'path') for (const p of event.points) points.push(p.map(round))
            }
        }
    }
    const host = scheduler.root.children.get('host')
    return { done: scheduler.done, ticks, debtSeen, breathSeen, stock: scheduler.stock.resident,
        canonical: { points, tip: host ? host.transform.deref().position.map(round) : null, errors: scheduler.errors.map(e => e.message) } }
}
const canon = stringify => stringify

// --- Instrument control: the comparator separates shape, not just length. ---
const shapeA = probe('fw 1\nfw 1')
const shapeA2 = probe('fw 1\nfw 1')
const shapeB = probe('fw 1\nrt 90\nfw 1')
requireEvidence('control: the same geometry repeats', JSON.stringify(shapeA.canonical) === JSON.stringify(shapeA2.canonical))
requireEvidence('control: same point count, different shape, compares unequal',
    shapeA.canonical.points.length === shapeB.canonical.points.length && JSON.stringify(shapeA.canonical) !== JSON.stringify(shapeB.canonical))

// --- P4: capacity binds, meaning and accounting hold. ---
const p4Source = 'fw 1\nfw 2\nfw 3'
const p4 = Object.fromEntries([1, 2, 16, 512].map(capacity => [capacity, probe(p4Source, { capacity })]))
emit({ kind: 'phase', phase: 'P4', manipulation: { debtByCapacity: Object.fromEntries([1, 2, 16, 512].map(c => [c, p4[c].debtSeen])), ticksByCapacity: Object.fromEntries([1, 2, 16, 512].map(c => [c, p4[c].ticks])) },
    canonicalEqual: [1, 2, 16].every(c => JSON.stringify(p4[c].canonical) === JSON.stringify(p4[512].canonical)),
    stockByCapacity: Object.fromEntries([1, 2, 16, 512].map(c => [c, p4[c].stock])), segments: p4[512].canonical.points.length / 2,
    verdict: 'rigorous on this fixture' })
requireEvidence('P4 manipulation: capacity 1 and 2 bind (owed debt)', p4[1].debtSeen === true && p4[2].debtSeen === true)
requireEvidence('P4 manipulation: capacity 16 and 512 do not bind', p4[16].debtSeen === false && p4[512].debtSeen === false)
requireEvidence('P4 meaning: canonical geometry equal across capacities', [1, 2, 16].every(c => JSON.stringify(p4[c].canonical) === JSON.stringify(p4[512].canonical)))
requireEvidence('P4 accounting: retained stock equals surviving segments at every capacity',
    [1, 2, 16, 512].every(c => p4[c].stock === p4[c].canonical.points.length / 2))

// --- P7: the allowance changes the schedule, meaning holds. ---
const p7Source = 'loop 6 do\n fw 1\nend'
const unpaced = probe(p7Source, { slice: null })
const spent = probe(p7Source, { slice: -1 })
emit({ kind: 'phase', phase: 'P7', manipulation: { ticksUnpaced: unpaced.ticks, ticksSpent: spent.ticks, breathUnpaced: unpaced.breathSeen, breathSpent: spent.breathSeen },
    canonicalEqual: JSON.stringify(unpaced.canonical) === JSON.stringify(spent.canonical),
    stockEqual: unpaced.stock === spent.stock, verdict: 'rigorous on this fixture' })
requireEvidence('P7 manipulation: the spent allowance takes strictly more ticks', spent.ticks > unpaced.ticks)
requireEvidence('P7 manipulation: a breath park occurs only when paced', spent.breathSeen === true && unpaced.breathSeen === false)
requireEvidence('P7 meaning: canonical geometry equal under both allowances', JSON.stringify(unpaced.canonical) === JSON.stringify(spent.canonical))
requireEvidence('P7 accounting: retained stock equal', unpaced.stock === spent.stock)

emit({ kind: 'verdict', experiment: 'P4-P7-rigor', fixed: 'P4/P7 invariance is now non-vacuous: the varied cause is shown to engage the mechanism',
    stillOpen: ['the model bench is not the browser runtime; capacity/residency in the real compositor is a separate witness', 'P4 here exercises debt, not replacement/clear leaks', 'one process run on small fixtures; no variance study'],
    promotion: 'rejected', runtimeChanged: false })
