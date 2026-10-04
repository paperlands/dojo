// probe-status: active
// Strengthened geometry oracle: compare style, ownership and transport as separate facets,
// not a flattened rounded point list. Reproduces the style blind spot it repairs.
// Run: node probe/live-rendering/gauge.mjs > probe/live-rendering/records/gauge-run.jsonl
// Snap: node probe/live-rendering/gauge.mjs --snapshot > probe/live-rendering/records/gauge-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/gauge.mjs'
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
emit({ kind: 'manifest', experiment: 'gauge-oracle', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'headless model bench; facet-wise comparison, no rounding; no runtime edit',
    limitations: ['model sink, no browser', 'no collinear simplification: sub-segmentation is a transport distinction, not merged'] })

emit({ kind: 'prediction', phase: 'gauge',
    hypothesis: 'a flattened point list is blind to style, ownership and transport; a facet-wise oracle is not',
    manipulationCheck: 'the style fixture must share flattened points with the plain fixture and differ in colour',
    falsifier: 'the facet oracle calls two different displays equal, or the plain fixture unequal' })

function capture(source, { capacity = 512 } = {}) {
    const scheduler = buildWorld({ capacity, clock: () => 0 })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    const events = []
    for (let i = 0; i < 20 && !scheduler.done; i++) {
        scheduler.withSlice(null, () => scheduler.tick(0))
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) {
                if (event.type === 'path') events.push({ address: frame.address ?? frame.name, color: event.color, thickness: event.thickness, points: event.points })
            }
        }
    }
    return { events, done: scheduler.done, errors: scheduler.errors.map(e => e.message) }
}
// The OLD weak oracle: flatten and round (kept to demonstrate the blind spot).
const flattenOld = c => JSON.stringify(c.events.flatMap(e => e.points.map(p => p.map(n => Math.round(n * 1e6) / 1e6))))
// The strengthened facets — kept separate, never merged.
const segments = c => JSON.stringify(c.events.flatMap(e => {
    const out = []
    for (let i = 1; i < e.points.length; i++) out.push({ address: e.address, from: e.points[i - 1], to: e.points[i], color: e.color, thickness: e.thickness })
    return out
}))
const ownership = c => JSON.stringify(c.events.map(e => e.address))
const transport = c => JSON.stringify(c.events.map(e => ({ address: e.address, points: e.points.length })))

// --- Controls: identical displays repeat; a styled spelling is NOT the plain one. ---
const plain = capture('fw 1\nfw 1')
const plainRepeat = capture('fw 1\nfw 1')
const styled = capture('fw 1\nbeColour red\nfw 1')
emit({ kind: 'facet', part: 'style', oldFlattenEqual: flattenOld(plain) === flattenOld(styled), segmentedEqual: segments(plain) === segments(styled),
    colors: [plain.events.map(e => e.color), styled.events.map(e => e.color)] })
requireEvidence('control: identical displays repeat in every facet', segments(plain) === segments(plainRepeat) && ownership(plain) === ownership(plainRepeat) && transport(plain) === transport(plainRepeat))
requireEvidence('blind spot reproduced: the flattened oracle calls the styled display equal', flattenOld(plain) === flattenOld(styled))
requireEvidence('repair: the facet oracle separates the styled display', segments(plain) !== segments(styled))

// --- Ownership differs while geometry matches. ---
const direct = capture('fw 1')
const housed = capture('as a do\n fw 1\nend')
emit({ kind: 'facet', part: 'ownership', oldFlattenEqual: flattenOld(direct) === flattenOld(housed), ownersEqual: ownership(direct) === ownership(housed) })
requireEvidence('ownership: flattened points match while the owner differs', flattenOld(direct) === flattenOld(housed) && ownership(direct) !== ownership(housed))

// --- Transport / segmentation differs while endpoints match. ---
const one = capture('fw 2')
const two = capture('fw 1\nfw 1')
emit({ kind: 'facet', part: 'transport', oldFlattenEqual: flattenOld(one) === flattenOld(two), transportEqual: transport(one) === transport(two), segmentsEqual: segments(one) === segments(two) })
requireEvidence('transport: one segment and two segments are separated', transport(one) !== transport(two) && segments(one) !== segments(two))

emit({ kind: 'reading', subject: 'gauge strength',
    note: 'the comparison supports plain-stroke fixtures. Style, ownership and transport are now separate facets. Visual equivalence between different spellings (say a batched vs split stroke) must be requested explicitly; it is not assumed by the same-question oracle. Rounding is removed, so sub-precision differences are not hidden.' })
emit({ kind: 'verdict', experiment: 'gauge-oracle',
    earned: ['the flattened oracle is blind to style (reproduced)', 'facet-wise comparison separates style, ownership and transport'],
    stillOpen: ['no collinear simplification: a visually identical split/batched stroke still differs by segmentation', 'no style beyond colour/thickness; no placement/transform facet'],
    promotion: 'rejected', runtimeChanged: false })
