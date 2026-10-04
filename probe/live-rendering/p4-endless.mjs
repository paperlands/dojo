// probe-status: active
// P4 endless-drawing memory: total art must grow without bound unless output is withdrawn or the
// truth policy faults. "Bounded queues" is not "bounded total art". No runtime edit.
// Run: node probe/live-rendering/p4-endless.mjs > probe/live-rendering/records/p4-endless-run.jsonl
// Snap: node probe/live-rendering/p4-endless.mjs --snapshot > probe/live-rendering/records/p4-endless-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_RUN_SEGMENTS, setResident } from '../../assets/js/turtling/ledger.js'
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/p4-endless.mjs'
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
emit({ kind: 'manifest', experiment: 'P4-endless', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'headless model bench; bounded observation ceiling on an infinite program; no runtime edit',
    limitations: ['model sink, no browser GPU', 'the endless programs are CENSORED at the instrument ceiling, not proven unbounded', 'single process run'] })

// --- Hypotheses, fixed before observation. ---
emit({ kind: 'prediction', phase: 'P4',
    hypothesis: 'an endless drawing with no withdrawal grows retained stock linearly, with no plateau',
    manipulationCheck: 'it must actually admit one segment per opportunity; stock must strictly increase',
    falsifier: 'stock plateaus without a fault or withdrawal' })
emit({ kind: 'prediction', phase: 'P4',
    hypothesis: 'the plateau appears ONLY when output is explicitly withdrawn (erase each turn)',
    manipulationCheck: 'the withdrawing program must still draw: one path and one clear per opportunity',
    falsifier: 'the withdrawing program grows without bound' })
emit({ kind: 'prediction', phase: 'P4',
    hypothesis: 'the declared truth policy faults the run at the per-run segment ceiling',
    manipulationCheck: 'pre-load a run just at the ceiling, then draw one more segment',
    falsifier: 'the run passes the ceiling silently' })

function observe(source, { maxTicks = 14, step = 10 } = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0 })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    const stock = []
    let pathEvents = 0, clearEvents = 0
    for (let i = 0; i < maxTicks && !scheduler.done; i++) {
        scheduler.withSlice(null, () => scheduler.tick(i * step))
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) {
                if (event.type === 'path') pathEvents++
                if (event.type === 'clear') clearEvents++
            }
        }
        stock.push(scheduler.stock.resident)
    }
    return { stock, pathEvents, clearEvents, done: scheduler.done, errors: scheduler.errors.map(e => e.message) }
}
const strictlyIncreasing = values => values.every((v, i) => i === 0 || v > values[i - 1])

// --- Control: a finite drawing plateaus at completion (nothing left to add). ---
const finite = observe('fw 1\nfw 1\nfw 1', { maxTicks: 8 })
requireEvidence('control: a finite drawing plateaus at its total', finite.stock.every(v => v === 3) && finite.done === true)

// --- Endless drawing grows; no plateau. ---
const grow = observe('draw r n do\n fw 1\n wait 0.01\n r n\nend\nlet F = r 1')
emit({ kind: 'phase', phase: 'P4', part: 'endless grow', stock: grow.stock, pathEvents: grow.pathEvents, censored: !grow.done })
requireEvidence('grow manipulation: the drawing admitted one segment per opportunity', grow.pathEvents === grow.stock.length && grow.pathEvents > 0)
requireEvidence('grow: retained stock strictly increases (no plateau)', strictlyIncreasing(grow.stock))
requireEvidence('grow is censored at the instrument ceiling, not shown unbounded', grow.done === false)

// --- Withdrawal plateaus: the only bounded case. ---
const withdraw = observe('draw r n do\n fw 1\n erase\n wait 0.01\n r n\nend\nlet F = r 1')
emit({ kind: 'phase', phase: 'P4', part: 'endless withdraw', stock: withdraw.stock, pathEvents: withdraw.pathEvents, clearEvents: withdraw.clearEvents, censored: !withdraw.done })
requireEvidence('withdraw manipulation: it still drew one path per opportunity and a clear at least as often', withdraw.pathEvents === withdraw.stock.length && withdraw.clearEvents >= withdraw.pathEvents)
requireEvidence('withdraw: retained stock stays bounded', withdraw.stock.every(v => v <= 1))
requireEvidence('contrast: growth outruns withdrawal', grow.stock[grow.stock.length - 1] > Math.max(...withdraw.stock))

// --- The declared truth policy faults the run at the ceiling. ---
const ceiling = buildWorld({ capacity: 512, clock: () => 0 })
ceiling.hotSwapChild('host', fork('host', 'fw 1\nfw 1'), { fresh: true, deferStart: true })
setResident(ceiling.root.children.get('host'), ceiling.stock, MAX_RUN_SEGMENTS)
ceiling.withSlice(null, () => ceiling.tick(0))
for (const frame of ceiling.registry.values()) frame.channel.drain()
emit({ kind: 'phase', phase: 'P4', part: 'run ceiling', atStart: MAX_RUN_SEGMENTS, stock: ceiling.stock.resident, done: ceiling.done, errors: ceiling.errors.map(e => e.message) })
requireEvidence('ceiling: drawing past the per-run limit wounds the run', ceiling.done === true && ceiling.errors.some(e => /more than 1000000 lines/.test(e.message)))

emit({ kind: 'verdict', experiment: 'P4-endless',
    earned: ['an endless drawing grows retained stock linearly with no plateau over the observed prefix', 'stock stays bounded ONLY when output is withdrawn each turn', 'the run ceiling faults the run at MAX_RUN_SEGMENTS'],
    stillOpen: ['the endless programs are censored at the instrument ceiling; unboundedness is not proven', 'the real compositor/GPU residency is a separate witness'],
    promotion: 'rejected', runtimeChanged: false })
