// probe-status: active
// P3 identity repair: capture BOTH frames and the actual guard inputs, not an incarnation count.
// The admission fence keys on frame.run, not runIncarnation. No runtime edit.
// Run: node probe/live-rendering/identity.mjs > probe/live-rendering/records/identity-run.jsonl
// Snap: node probe/live-rendering/identity.mjs --snapshot > probe/live-rendering/records/identity-instrument.jsonl
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorld, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/identity.mjs'
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
emit({ kind: 'manifest', experiment: 'p3-identity', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'headless model bench; both frames + guard inputs + mutation; no runtime edit',
    limitations: ['model sink, no browser', 'this does not prove coherent display replacement or newest-pending coalescing'] })

emit({ kind: 'prediction', phase: 'P3',
    hypothesis: 'the stale-reply fence keys on frame.run; runIncarnation does not distinguish the replacement',
    manipulationCheck: 'the replacement must be a distinct frame object and a fresh reply on it must apply',
    falsifier: 'the obsolete reply mutates the new answer, or a fresh reply is also dropped' })

const seat = (source, config = {}) => {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild('host', fork('host', source), { fresh: true, deferStart: true })
    return scheduler
}
const hostOf = scheduler => scheduler.root.children.get('host')
const tick = (scheduler, horizon = 0) => scheduler.withSlice(null, () => scheduler.tick(horizon))
const drain = scheduler => { for (const frame of scheduler.registry.values()) frame.channel.drain() }
const record = frame => ({ id: frame.id, run: frame.run, runIncarnation: frame.runIncarnation ?? null,
    suspension: frame.suspension?.kind ?? null, seq: frame.suspension?.seq ?? null, done: frame.done })

const responder = delayedResponder({ defer: Infinity })
const slot = seat('fw 1\nwait 0.1\nfw 2', { admitAsync: responder.admit })
tick(slot)
await settle()
const oldFrame = hostOf(slot)
const oldRecord = record(oldFrame)
const oldCall = responder.calls.find(call => call.request.frame === oldFrame)

slot.hotSwapChild('host', fork('host', 'fw 9'), { fresh: false, deferStart: false })
const newFrame = hostOf(slot)
const newRecord = record(newFrame)
const newCall = responder.calls.find(call => call.request.frame === newFrame)
const poseBefore = newFrame.transform.deref().position.slice()

emit({ kind: 'identity', part: 'frames', old: oldRecord, replacement: newRecord,
    sameObject: oldFrame === newFrame, retiredFromRegistry: slot.registry.get(oldFrame.id) === undefined })
requireEvidence('manipulation: the replacement is a distinct frame object', oldFrame !== newFrame)
requireEvidence('manipulation: the old frame left the registry', slot.registry.get(oldFrame.id) === undefined)
requireEvidence('the fence input (run) differs across the replacement', oldRecord.run !== newRecord.run && oldRecord.id !== newRecord.id)
requireEvidence('runIncarnation does NOT distinguish the replacement', oldRecord.runIncarnation === newRecord.runIncarnation)

// Obsolete reply for the OLD run: must be dropped.
oldCall.resolve({ accepted: true, transform: { rotation: oldCall.request.requested.rotation, position: [100, 0, 0] } })
await settle()
for (let pass = 0; pass < 6 && !slot.done; pass++) { tick(slot); drain(slot) }
const poseAfterObsolete = hostOf(slot).transform.deref().position.slice()
emit({ kind: 'identity', part: 'obsolete-reply', carried: [100, 0, 0], poseBefore, poseAfterObsolete,
    errors: slot.errors.map(e => e.message) })
requireEvidence('obsolete reply does not mutate the new answer', JSON.stringify(poseAfterObsolete) === JSON.stringify(poseBefore) && slot.errors.length === 0)

// Fresh reply on the REPLACEMENT run: must apply. This is the causal contrast.
newCall.resolve({ accepted: true, transform: { rotation: newCall.request.requested.rotation, position: [50, 0, 0] } })
await settle()
for (let pass = 0; pass < 6 && !slot.done; pass++) { tick(slot); drain(slot) }
const poseAfterFresh = hostOf(slot).transform.deref().position.slice()
emit({ kind: 'identity', part: 'fresh-reply', carried: [50, 0, 0], poseAfterFresh })
requireEvidence('a fresh reply on the replacement run applies (the fence is cause, not blanket refusal)', JSON.stringify(poseAfterFresh) === JSON.stringify([50, 0, 0]))

emit({ kind: 'verdict', experiment: 'p3-identity',
    earned: ['the fence keys on frame.run/id and drops the obsolete reply while a fresh one applies'],
    correction: 'the earlier runIncarnation check did not distinguish old and new identity',
    stillOpen: ['coherent display replacement and newest-pending coalescing are not tested'],
    promotion: 'rejected', runtimeChanged: false })
