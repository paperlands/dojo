// probe-status: concluded
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deps, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'
import { SE3 } from '../../assets/js/turtling/se3.js'

const dir = fileURLToPath(new URL('../../assets/js/turtling/', import.meta.url))
const files = ['scheduler.js', 'executor.js']
const [scheduler, executor] = await Promise.all(files.map(f => readFile(join(dir, f), 'utf8')))
const scratch = await mkdtemp(join(tmpdir(), 'dojo-attempt-cross-'))
const print = (name, value) => console.log(JSON.stringify({ case: name, ...value }))
function edit(source, before, after) {
    assert.equal(source.split(before).length, 2, `unique anchor: ${before}`)
    return source.replace(before, () => after)
}

function schedulerArm(s, mode) {
    s = edit(s, '    root._lastAttempt = snapshotFact({ ...entry, revision: root._motionRevision ?? 0 })',
        '    root._lastAttempt = snapshotFact({ ...entry, revision: root._motionRevision ?? 0 })\n    root.__attempts?.push(root._lastAttempt)')
    if (mode === 'restart') return s
    // Retain receiver membership; only its pose stops defining the question.
    s = edit(s, '    for (const [key, entry] of child.consumed) {',
        '    for (const [key, entry] of child.consumed) {\n        if (entry.receiver === true) continue')
    s = edit(s, '[...child.consumed.keys()].every((key) => known.has(key))',
        '[...child.consumed].every(([key, entry]) => entry.receiver === true || known.has(key))')
    // Test policy only: installation spatial reads at use; pure figures still capture.
    s = edit(s, 'if (view && view.readings.has(frame) && !isLiveReceiver(view, frame))',
        'if (observer?.installation !== true && view && view.readings.has(frame) && !isLiveReceiver(view, frame))')
    s = edit(s, '    if (readingQuestion) return\n    const view = questionViewOf(observer)',
        '    if (readingQuestion || (observer?.installation === true && (POSITION[property] || ORIENTATION[property]))) return\n    const view = questionViewOf(observer)')
    if (mode === 'live') return s
    s = edit(s, '        unobserved() { frame.observation = null },', `        unobserved() { frame.observation = null },
        captureAim(subject) {
            if (frame.installation !== true || (wiredDeps && wiredDeps !== frame.deps)) return null
            const root = metaRootFrame(frame)
            const receiver = motionDestination(frame, root._registry)
            if (!receiver) throw new Error('the retained receiver has left the world')
            const revision = root._configurationRevision
            const local = SE3.clone(receiver.transform.deref())
            const basis = SE3.clone(worldTransform(receiver))
            const point = resolveBeingFacet(frame, subject, 'position')
            if (revision !== root._configurationRevision) throw new Error('observation wrote geometry')
            root.__aims?.push({ revision, point, from: local.position, basis: basis.position })
            return { revision, subjectId: subject.id, point: point.slice(), local, basis }
        },`)
    s = edit(s, '    evaluator.endObservation = door.unobserved',
        '    evaluator.endObservation = door.unobserved\n    evaluator.captureAim = door.captureAim')
    if (!['footprint', 'handoff'].includes(mode)) return s
    const field = 'baseRevision: value.baseRevision })'
    assert.equal(s.split(field).length, 3, 'sync and delayed request construction both carry the observation')
    s = s.replaceAll(field, 'baseRevision: value.baseRevision, aim: value.aim })')
    return edit(s, `const motionBaseChanged = (ctx, request) => request.baseRevision !== undefined &&
    request.baseRevision !== metaRootFrame(ctx)._configurationRevision`, `function motionBaseChanged(ctx, request) {
    const root = metaRootFrame(ctx)
    if (request.baseRevision === undefined || request.baseRevision === root._configurationRevision) return false
    const aim = request.aim
    if (!aim) return true
    const subject = root._registry.get(aim.subjectId)
    const receiver = motionDestination(ctx, root._registry)
    return !subject || !receiver || !liveIn(root._registry, subject) ||
        !identicalPose(aim.local, receiver.transform.deref()) ||
        !identicalPose(aim.basis, worldTransform(receiver)) ||
        !sameValue(aim.point, frameWorldTransform(subject).position)
}`)
}

function executorArm(s, mode) {
    if (mode === 'restart' || mode === 'live') return s
    s = edit(s, 'import { evalOrBlock, readsDeferred }', 'import { evalOrBlock, readsDeferred, retryBlocked }')
    s = edit(s, `            } else {
                yield* callCommand(node.value, args, state, stroke)
            }`, `            } else {
                const capture = state.deps.mathEvaluator.captureAim
                if (node.value === 'faceto' && args.length === 1 && isBeing(args[0]) && capture && state.motionProtocol) {
                    const subject = args[0]
                    for (let n = 0; n < 2; n++) {
                        const aim = yield* retryBlocked(() => capture(subject))
                        if (!aim) { yield* callCommand(node.value, args, state, stroke); break }
                        const outcome = yield* callCommand(node.value, [], state, stroke, aim.revision, aim)
                        if (outcome !== 'stale') break
                        if (n === 1) yield { type: 'motionUnresolved', reason: 'stale motion base' }
                    }
                } else yield* callCommand(node.value, args, state, stroke)
            }`)
    s = edit(s, 'function* callCommand(name, args, state, stroke, baseRevision) {',
        'function* callCommand(name, args, state, stroke, baseRevision, aim) {')
    const start = s.indexOf('function* callCommand'), end = s.indexOf('// Convenience: drain a generator', start)
    assert.ok(start >= 0 && end > start)
    let call = s.slice(start, end)
    call = edit(call, '    const convert = target ? state.deps.space.sample() : null',
        `    const cursor = ${mode === 'stamp' ? 'state.transform' : 'aim?.local ?? state.transform'}
    const convert = target ? (${mode === 'stamp' ? 'null' : 'aim ? storageSpace(() => aim.basis).sample() : null'}) ?? state.deps.space.sample() : null`)
    call = edit(call, '    if (target) args = [yield* bindTarget(args, state, world.position[2])]',
        '    if (target) args = aim ? [aim.point] : [yield* bindTarget(args, state, world.position[2])]')
    for (const [a, b] of [
        ['convert.toWorld(state.transform)', 'convert.toWorld(cursor)'], ['convert ? world : state.transform', 'convert ? world : cursor'],
        ['stroke.lastPos = [...state.transform.position]', 'stroke.lastPos = [...cursor.position]'],
        ['convert.toLocalRotation(patch.rotation) : state.transform.rotation', 'convert.toLocalRotation(patch.rotation) : cursor.rotation'],
        ['convert.toLocalPoint(patch.position) : [...state.transform.position]', 'convert.toLocalPoint(patch.position) : [...cursor.position]'],
        ['            from: state.transform,', '            from: cursor,'],
        ['            baseRevision,', ['footprint', 'handoff'].includes(mode) ? '            baseRevision, aim,' : '            baseRevision,'],
        ['            result.transform = state.transform', '            result.transform = cursor'],
        ['                result.point = [...state.transform.position]', '                result.point = [...cursor.position]'],
    ]) call = edit(call, a, b)
    if (mode === 'handoff') call = edit(call, '        state.transform = result.transform\n    }',
        '        state.transform = result.transform\n    } else if (aim) state.transform = SE3.clone(cursor)')
    return s.slice(0, start) + call + s.slice(end)
}

async function mirror(mode) {
    const base = join(scratch, mode), turtle = join(base, 'turtling')
    await mkdir(turtle, { recursive: true })
    for (const item of await readdir(join(dir, '..'))) if (item !== 'turtling') await symlink(join(dir, '..', item), join(base, item))
    for (const item of await readdir(dir)) if (!files.includes(item)) await symlink(join(dir, item), join(turtle, item))
    await writeFile(join(turtle, files[0]), schedulerArm(scheduler, mode))
    await writeFile(join(turtle, files[1]), executorArm(executor, mode))
    return import(pathToFileURL(join(turtle, files[0])).href)
}

const IDENTITY = SE3.identity()
const ROTATED = SE3.clone({ position: [12,-8,4], rotation: { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 } })
const accept = request => ({ accepted: true, transform: request.requested })
const settleAt = (f, cut, count = 16) => { for (let i = 0; i < count; i++) f.tick(cut) }
function setup(m, source, origin, deferred = 1) {
    const responder = delayedResponder({ defer: deferred })
    const s = m.createScheduler(m.metaRoot(), { createDeps: deps, clock: () => 0,
        motionAdmissionAsync: request => request.command === 'faceto' ? responder.admit(request) : accept(request),
        motionAdmission: accept })
    const attempts = s.root.__attempts = [], aims = s.root.__aims = []
    let host
    const replace = (src) => { host = s.hotSwapChild('host', fork('host', src, origin), { fresh: true }) }
    replace(source)
    const at = n => host.children.get(n)
    const world = n => m.frameWorldTransform(at(n)).position.slice()
    const hand = (n, position, ref = 'world') => {
        const f = at(n)
        const t = ref === null ? f.transform.deref() : m.frameWorldTransform(f)
        const local = ref === null ? SE3.unapply(m.worldTransform(f), position) : position
        const verdict = s.requestMotion(f, { ...SE3.clone(t), position: local }, s.motionRevision, ref)
        assert.equal(verdict.kind, 'accept', JSON.stringify({ n, verdict }))
    }
    const labels = []
    function tick(cut) {
        s.tick(cut)
        for (const f of s.registry.values()) for (const e of f.channel.drain()) if (e.type === 'label') labels.push(String(e.text))
    }
    return { s, at, world, hand, tick, attempts, aims, replace, responder, labels }
}
const SOURCE = `let fox
let prey
let spare
wait 0.1
def hunt target animal do
  as animal do
    faceto target
    fw 3
  end
end
let pursuit = hunt prey fox`
const add = (xs, ds) => xs.map((x, i) => x + ds[i])
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]))
const expectedStep = (from, to) => distance(from, to) === 0 ? add(from, [3,0,0]) : add(from, to.map((v, i) => 3 * (v - from[i]) / distance(from, to)))

async function trial(m, kind, origin = IDENTITY) {
    const source = kind === 'law' ? SOURCE.replace('def hunt', 'let distance(fox, (0,0,0)) = 5\ndef hunt') : SOURCE
    const twice = kind === 'twice' || kind === 'unrelated-twice'
    const w = setup(m, source, origin, twice ? 2 : 1)
    settleAt(w, 0)
    const start = w.world('fox')
    if (kind === 'law') w.hand('fox', [5,0,0], null)
    w.hand('prey', add(start, kind === 'law' ? [10,0,0] : [0,5,0]))
    settleAt(w, 100)
    const first = w.responder.calls[0], owner = w.at('pursuit'), old = w.s.installationsOf(owner)[0].frame
    assert.ok(first, 'one actual pending reply')
    assert.equal(old.suspension?.kind, 'admission')
    if (['receiver', 'both', 'twice', 'coincident'].includes(kind)) w.hand('fox', add(start, [10,0,0]), null)
    if (kind === 'coincident') w.hand('prey', w.world('fox'))
    if (kind === 'basis') w.hand('fox', add(start, [10,0,0]))
    if (['peer','both'].includes(kind)) w.hand('prey', add(start, [0,-5,0]))
    if (kind === 'unrelated' || kind === 'unrelated-twice') w.hand('spare', add(start, [20,0,0]))
    if (kind === 'swap') w.replace('let fox = (20,0,0)')
    const accepted = w.world('fox'), target = kind === 'swap' ? null : w.world('prey')
    first.resolve(accept(first.request)); await settle()
    settleAt(w, 110)
    if (twice && w.responder.calls.length > 1) {
        const second = w.responder.calls[1]
        assert.ok(second, 'a real retry, parked again')
        if (kind === 'twice') w.hand('prey', add(start, [0,-5,0]))
        else w.hand('spare', add(start, [25,0,0]))
        second.resolve(accept(second.request)); await settle()
        settleAt(w, 120)
    }
    const actual = w.world('fox')
    return { run: w.at('pursuit')?.runIncarnation ?? null, old: w.s.registry.has(old.id), done: w.s.done,
        accepted, target, actual, ideal: target ? expectedStep(accepted, target) : accepted,
        unresolved: w.s.installationsOf(owner)[0]?.frame.unresolved?.reason ?? null,
        motions: w.attempts.filter(a => a.path === 'program-motion').map(({ command, from, verdict, gate, baseRevision }) =>
            ({ command, from, verdict, gate: gate?.status, base: baseRevision })),
        aims: w.aims, errors: w.s.errors.map(e => e.message) }
}


async function waiting(m) {
    const w = setup(m, SOURCE.replace('  as animal do', '  as animal do\n    wait 0.1'), IDENTITY)
    settleAt(w, 0); w.hand('prey', [0,5,0]); settleAt(w, 100)
    const owner = w.at('pursuit'), old = w.s.installationsOf(owner)[0].frame
    assert.equal(old.resumeAt, 200)
    w.hand('prey', [0,-5,0])
    settleAt(w, 199)
    const before = { aims: w.aims.length, offered: w.responder.calls.length, run: owner.runIncarnation }
    settleAt(w, 200)
    const first = w.responder.calls[0]
    assert.ok(first, 'the authored wait, not the hand, makes aim eligible')
    first.resolve(accept(first.request)); await settle(); settleAt(w, 201)
    return { before, old: w.s.registry.has(old.id), actual: w.world('fox'), aims: w.aims.length }
}
function completed(m) {
    const w = setup(m, 'let prey\ndef stamp target do\n  label target.y\nend\nlet mark = stamp prey', IDENTITY)
    settleAt(w, 0)
    assert.deepEqual(w.labels, ['0'])
    w.hand('prey', [0,7,0]); settleAt(w, 100)
    return { run: w.at('mark').runIncarnation, labels: w.labels }
}

try {
    const hash = x => createHash('sha256').update(x).digest('hex')
    print('sources', { node: process.version, scheduler: hash(scheduler), executor: hash(executor) })
    const rows = {}
    for (const mode of ['restart','live','stamp','coherent','footprint','handoff']) {
        const m = await mirror(mode)
        const row = {}
        for (const [name, kind, origin] of [['no-edit','none'], ['peer','peer'], ['receiver','receiver'],
            ['rotated','both',ROTATED], ['basis','basis',ROTATED], ['coincident','coincident',IDENTITY], ['unrelated','unrelated'], ['swap','swap']]) row[name] = await trial(m, kind, origin)
        if (['coherent','footprint','handoff'].includes(mode)) {
            row.twice = await trial(m, 'twice')
            row.unrelatedTwice = await trial(m, 'unrelated-twice')
        }
        row.law = await trial(m, 'law')
        row.figure = completed(m)
        if (mode === 'handoff') row.waiting = await waiting(m)
        print(mode, row)
        rows[mode] = row
    }
    assert.ok(distance(rows.restart.receiver.actual, rows.restart.receiver.ideal) < 1e-8)
    assert.ok(distance(rows.live.receiver.actual, rows.live.receiver.ideal) > 1)
    assert.ok(distance(rows.stamp.receiver.actual, rows.stamp.receiver.ideal) > 1)
    for (const row of Object.values(rows)) {
        assert.deepEqual(row.figure, { run: 2, labels: ['0','7'] })
        assert.equal(row.swap.old, false); assert.deepEqual(row.swap.motions, [])
        assert.deepEqual(row.swap.actual, row.swap.accepted)
        assert.ok(distance(row['no-edit'].actual, row['no-edit'].ideal) < 1e-8)
        assert.deepEqual(row.law.actual, [5,0,0])
        assert.ok(row.law.motions.some(a => a.command === 'fw' && a.verdict === 'refuse' && a.gate === 'violation'))
    }
    for (const row of [rows.coherent, rows.footprint, rows.handoff]) {
        for (const k of ['peer','receiver','rotated','basis']) {
            assert.ok(distance(row[k].actual, row[k].ideal) < 1e-8, k)
            assert.equal(row[k].run, 1); assert.equal(row[k].old, true)
            assert.deepEqual(row[k].motions.map(a => a.verdict), ['stale','accept','accept'])
        }
        assert.deepEqual(row.twice.motions.map(a => a.verdict), ['stale','stale'])
        assert.deepEqual(row.twice.actual, row.twice.accepted)
        assert.equal(row.twice.unresolved, 'stale motion base')
    }
    assert.deepEqual(rows.coherent.unrelated.motions.map(a => a.verdict), ['stale','accept','accept'])
    assert.deepEqual(rows.footprint.unrelated.motions.map(a => a.verdict), ['accept','accept'])
    assert.equal(rows.coherent['no-edit'].motions[0].verdict, 'stale', 'global revision also moves upon seating')
    assert.equal(rows.footprint['no-edit'].motions[0].verdict, 'accept')
    assert.equal(rows.coherent.unrelatedTwice.unresolved, 'stale motion base')
    assert.deepEqual(rows.footprint.unrelatedTwice.actual, [0,3,0])
    assert.deepEqual(rows.footprint.coincident.actual, [3,0,0], 'EXPECTED RED: a no-op has no verdict to refresh the cursor')
    assert.deepEqual(rows.handoff.coincident.actual, [13,0,0])
    assert.deepEqual(rows.handoff.coincident.motions.map(a => a.command), ['faceto','fw'])
    assert.deepEqual(rows.handoff.waiting, { before: { aims: 0, offered: 0, run: 1 }, old: true, actual: [0,-3,0], aims: 1 })
    for (const row of Object.values(rows)) for (const trial of Object.values(row)) {
        if (trial.errors) assert.deepEqual(trial.errors, [])
    }
} finally {
    await rm(scratch, { recursive: true, force: true })
}
