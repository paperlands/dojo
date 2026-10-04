// probe-status: active
// Driver-pause cause witness: the epoch owner (timeline.rebaseEpoch) reports "the loop stopped"
// and folds the gap; test its boundary, its consumption at the compositor, and its cause limit.
// No runtime edit.
// Run: node probe/live-rendering/driver.mjs > probe/live-rendering/records/driver-run.jsonl
// Snap: node probe/live-rendering/driver.mjs --snapshot > probe/live-rendering/records/driver-instrument.jsonl
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
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const self = 'probe/live-rendering/driver.mjs'
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
emit({ kind: 'manifest', experiment: 'prep-driver-pause', node: process.version, platform: process.platform, arch: process.arch,
    dojoHead: git(['rev-parse', 'HEAD']), specsHead: git(['-C', 'specs', 'rev-parse', 'HEAD']),
    sourceManifestSha256: hash(JSON.stringify(manifest)), sourceManifest: manifest,
    dirtyRuntime: git(['status', '--short', '--', 'assets/js', 'test/js/laws/harness.mjs']),
    instrument: 'unit facts of the epoch owner + one headless compositor drive; no runtime edit',
    limitations: ['model sink, no browser GPU', 'the pause is a synthetic timestamp gap, not a real hidden tab', 'one process run'] })

// --- Hypotheses, fixed before observation. ---
emit({ kind: 'prediction', phase: 'driver-pause',
    hypothesis: 'the epoch owner separates "the loop stopped" from "the loop ran at cadence" with an exact boundary, and folds a pause so the reveal horizon does not jump',
    manipulationCheck: 'a cadence gap must stay under the floor and a pause gap over it; the pause must be the only frame that skips the pacer',
    falsifier: 'a cadence frame rebases, a pause frame does not, the horizon jumps by the gap, or the pacer skips on cadence' })
emit({ kind: 'prediction', phase: 'driver-pause',
    hypothesis: 'the owner reports that the loop stopped, not why: a hidden-tab gap and a blocking-call gap of equal size present identically',
    falsifier: 'the owner has a cause input that separates hidden-tab from a long blocking call' })

// --- The owner's own facts, earned directly. ---
const FRAME_MS = 1000 / 60
const FLOOR = idleFloorMs(FRAME_MS)
requireEvidence('owner control: the first frame establishes epoch, never rebases', rebaseEpoch(null, null, 123, FRAME_MS, FLOOR) === null)
requireEvidence('owner: the idle floor is one second at 60Hz cadence', FLOOR === 1000)
requireEvidence('owner boundary: a gap at the floor does not rebase', rebaseEpoch(0, 0, FLOOR, FRAME_MS, FLOOR) === 0)
requireEvidence('owner boundary: a gap just over the floor rebases by (gap - one frame)', rebaseEpoch(0, 0, FLOOR + 1, FRAME_MS, FLOOR) === FLOOR + 1 - FRAME_MS)
requireEvidence('owner: a cadence gap does not rebase', rebaseEpoch(0, 0, FRAME_MS, FRAME_MS, FLOOR) === 0)
requireEvidence('owner: a pause gap rebases', rebaseEpoch(0, 0, 5000, FRAME_MS, FLOOR) === 5000 - FRAME_MS)
emit({ kind: 'phase', phase: 'driver-pause', part: 'owner boundary',
    control: { floor: FLOOR, atFloorRebase: rebaseEpoch(0, 0, FLOOR, FRAME_MS, FLOOR), overFloorRebase: rebaseEpoch(0, 0, 1001, FRAME_MS, FLOOR), cadenceRebase: rebaseEpoch(0, 0, FRAME_MS, FRAME_MS, FLOOR) },
    verdict: 'exact' })

// --- Consumption at the compositor: a pause must not jump the reveal horizon. ---
const scheduler = buildWorld({ capacity: 512, clock: () => 0, breathEvery: 4 })
scheduler.hotSwapChild('host', fork('host', 'draw r n do\n loop n do\n  fw 1\n end\n wait 0.1\n fw 2\nend\nlet F = r 40'), { fresh: true, deferStart: true })
const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
ink._cached = true
const pacer = { budgetMs: 4, observes: 0, skips: 0, observe() { this.observes++ }, skip() { this.skips++ } }
const compositor = createCompositor(scheduler, {
    scene, camera: { position: new Vector3(0, 0, 1000) },
    materials: { getInk: () => ink, clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
}, { focus: createFocus(scheduler), pacer, createText: () => { throw Error('fixture has no labels') } })
const cadence = [0, 16, 33, 50, 66, 83]
const cadenceNow = []
for (const t of cadence) { compositor.advance(t); cadenceNow.push({ t, now: Math.round(scheduler.lastTickTime) }) }
const skipsBeforePause = pacer.skips
const cadenceUnjumpped = cadenceNow.every(({ t, now }) => Math.abs(now - t) <= 1)
compositor.advance(4000)          // a pause gap of 3917ms, far over the 1000ms floor
const pauseNow = scheduler.lastTickTime
const skipsAfterPause = pacer.skips
compositor.advance(4016)
const resumeNow = scheduler.lastTickTime
emit({ kind: 'phase', phase: 'driver-pause', part: 'compositor consumption',
    manipulation: { pauseGapMs: 4000 - 83, floorMs: FLOOR, cadenceUnjumpped, skipsBeforePause, skipsAfterPause },
    pause: { now: Math.round(pauseNow), resumedNow: Math.round(resumeNow), frameMs: Math.round(FRAME_MS) },
    verdict: 'pause folded to about one frame; horizon did not jump' })
requireEvidence('consumption: cadence advances the horizon without a jump', cadenceUnjumpped)
requireEvidence('consumption manipulation: the pause is far over the floor', 4000 - 83 > FLOOR)
const cadenceLastNow = cadenceNow[cadenceNow.length - 1].now
requireEvidence('consumption: the pause continues from the pause point, not the gap', pauseNow < 200 && Math.abs(pauseNow - (cadenceLastNow + FRAME_MS)) <= 1)
requireEvidence('consumption: the pacer skips the pause frame and no cadence frame', skipsAfterPause === skipsBeforePause + 1 && skipsBeforePause === 0)
requireEvidence('consumption: cadence resumes one frame after the pause', Math.abs(resumeNow - (pauseNow + FRAME_MS)) <= 1)
compositor.dispose(); ink.dispose()

// --- Cause limit: the same gap presents identically; there is no cause input. ---
const hiddenTab = rebaseEpoch(0, 0, 3000, FRAME_MS, FLOOR)
const blockingCall = rebaseEpoch(0, 0, 3000, FRAME_MS, FLOOR)
emit({ kind: 'reading', subject: 'driver-pause cause',
    hiddenTabRebase: hiddenTab, blockingCallRebase: blockingCall, ownerInputs: ['epoch', 'lastWallT', 't', 'frameMs', 'idleGapMs'],
    note: 'the owner decides from the gap alone; a hidden-tab pause and a long blocking call of equal size are the same reading. It reports "the loop stopped", which is the safe fold either way, not the cause.' })
requireEvidence('cause limit: equal gaps present identically', hiddenTab === blockingCall)
requireEvidence('cause limit: the owner has no cause input', rebaseEpoch.length === 5)

emit({ kind: 'verdict', experiment: 'prep-driver-pause',
    earned: ['loop-stopped vs loop-running at an exact 1000ms floor', 'a pause folds to ~one frame at the compositor and skips the pacer', 'equal gaps are cause-agnostic'],
    stillOpen: ['a real hidden tab vs a real blocking call is not separated here', 'needs a configured browser harness (Chromium/Firefox installed)', 'P3 supersession rig remains; P4 release is now earned (p4.mjs, p4-endless.mjs)'],
    promotion: 'rejected', runtimeChanged: false })
