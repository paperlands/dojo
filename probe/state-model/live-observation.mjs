// probe-status: concluded
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Group, PerspectiveCamera } from '../../assets/js/utils/three-entry.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { deps, fork, delayedResponder, settle } from '../../test/js/laws/harness.mjs'

const home = fileURLToPath(new URL('../../assets/js/', import.meta.url))
const dir = join(home, 'turtling')
const scheduler = await readFile(join(dir, 'scheduler.js'), 'utf8')
const compositor = await readFile(join(dir, 'compositor.js'), 'utf8')
const scratch = await mkdtemp(join(tmpdir(), 'dojo-observe-cross-'))
const hash = s => createHash('sha256').update(s).digest('hex')
const emit = (caseName, data) => console.log(JSON.stringify({ case: caseName, ...data }))
function change(source, before, after) {
    assert.equal(source.split(before).length, 2, `exactly one anchor: ${before}`)
    return source.replace(before, () => after)
}

function vary(s, receiver, peers) {
    if (receiver) {
        s = change(s,
        '    for (const [key, entry] of child.consumed) {',
        '    for (const [key, entry] of child.consumed) {\n        if (entry.receiver === true) continue')
        s = change(s, '[...child.consumed.keys()].every((key) => known.has(key))',
            '[...child.consumed].every(([key, entry]) => entry.receiver === true || known.has(key))')
    }
    if (peers) {
        s = change(s,
            '    if (view && view.readings.has(frame) && !isLiveReceiver(view, frame)) return view.readings.get(frame).world',
            '    // Scratch P: use the ordinary spatial observation path below.')
        s = change(s, '    if (readingQuestion) return\n    const view = questionViewOf(observer)',
            '    if (readingQuestion || POSITION[property] || ORIENTATION[property]) return\n    const view = questionViewOf(observer)')
    }
    return change(s, '    root._lastAttempt = snapshotFact({ ...entry, revision: root._motionRevision ?? 0 })',
        '    root._lastAttempt = snapshotFact({ ...entry, revision: root._motionRevision ?? 0 })\n    root.__observeAttempt?.(root._lastAttempt)')
}
async function mirror(name, receiver, peers) {
    const base = join(scratch, name), turtle = join(base, 'turtling')
    await mkdir(turtle, { recursive: true })
    for (const item of await readdir(home)) if (item !== 'turtling') await symlink(join(home, item), join(base, item))
    for (const item of await readdir(dir)) if (!['scheduler.js', 'compositor.js'].includes(item)) await symlink(join(dir, item), join(turtle, item))
    await writeFile(join(turtle, 'scheduler.js'), vary(scheduler, receiver, peers))
    await writeFile(join(turtle, 'compositor.js'), compositor)
    const mod = basename => import(pathToFileURL(join(turtle, basename)).href)
    return { ...await mod('scheduler.js'), ...await mod('compositor.js') }
}

const quant = n => +n.toFixed(8) || 0
const accept = request => ({ accepted: true, transform: request.requested })
const cadence = [[16], [50], [16, 16, 800, 16, 250, 33]]
function setup(m, source, options = {}) {
    const s = m.createScheduler(m.metaRoot(), { createDeps: deps, clock: () => 0,
        execOpts: { color: '#c02' }, ...options })
    let host
    const replace = src => { host = s.hotSwapChild('host', fork('host', src), { fresh: true }); return host }
    const at = name => host.children.get(name)
    const state = f => {
        const pose = m.frameWorldTransform(f), r = pose.rotation
        return [...pose.position, r.w, r.x, r.y, r.z].map(n => n === 0 ? 0 : n)
    }
    const pose = (name) => at(name) ? state(at(name)) : null
    const trace = [], labels = [], attempts = []
    s.root.__observeAttempt = attempt => {
        if (attempt.path !== 'program-motion') return
        const writer = s.registry.get(attempt.owner), owner = writer?.questionView?.owner ?? writer?.parent
        attempts.push({ cut: quant(s.root._frontier), owner: owner?.name, run: owner?.runIncarnation,
            command: attempt.command, from: attempt.from?.map(quant), requested: attempt.requested?.map(quant),
            verdict: attempt.verdict, gate: attempt.gate?.status, base: attempt.baseRevision })
    }
    function traceOf(names) {
        let previous
        s.onAcceptedChange(() => {
            const poses = names.map(pose)
            if (JSON.stringify(poses) === previous) return
            previous = JSON.stringify(poses)
            trace.push([quant(s.root._frontier), poses])
        })
    }
    const collect = () => {
        for (const f of s.registry.values()) for (const e of f.channel.drain()) if (e.type === 'label') labels.push(String(e.text))
    }
    const tick = (t) => { s.tick(t); collect() }
    const drive = (from, to, delta = 16) => { for (let t = from; t <= to && !s.done; t += delta) tick(t) }
    const hand = (name, xyz, ref = 'world') => {
        const f = at(name), t = { ...SE3.clone(m.frameWorldTransform(f)), position: xyz }
        const result = s.requestMotion(f, t, s.motionRevision, ref)
        assert.equal(result.kind, 'accept', JSON.stringify(result))
    }
    const show = () => m.createCompositor(s, { scene: new Group(), camera: new PerspectiveCamera(),
        materials: { getInk: () => ({}), clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { frameMs: 16, createText() { throw Error('no compositor fixture authors labels') },
        focus: { kindled: null, isFocused: () => false, inFocusedSubtree: () => false } })
    const errors = () => s.errors.map(e => e.message)
    replace(source); collect()
    return { s, at, replace, pose, trace, labels, attempts, traceOf, tick, drive, hand, show, errors }
}

function pair(m, style) {
    const half = style === 'wait' ? '    wait 0.1\n    fw 2\n' : ''
    const names = style === 'distinct' ? ['fox','fox2'] : ['fox','fox']
    const seats = [`let a = step ${names[0]}`, `let b = turn ${names[1]}`]
    if (style === 'reversed') seats.reverse()
    const w = setup(m, `let fox
let fox2
def step animal do
  as animal do
    fw 1
${half}  end
end
def turn animal do
  as animal do
    rt 90
    fw 3
  end
end
${seats.join('\n')}`)
    w.drive(0, 800)
    return { done: w.s.done, runs: ['a','b'].map(n => w.at(n)?.runIncarnation),
        poses: names.map(w.pose), errors: w.errors(),
        motions: w.attempts.length < 12 ? w.attempts : w.attempts.slice(0, 6), total: w.attempts.length }
}

const PURSUIT = `def hunt prey predator do
  as predator do
    loop 60 do
      faceto prey
      fw 3
      wait 1/24
    end
  end
end
as rabbit do
  loop 60 do
    fw 5
    rt 1
    wait 1/24
  end
end
let fox
let hunting = hunt rabbit fox`
function pursuit(m, schedule, ordinary = false) {
    const w = setup(m, ordinary ? PURSUIT.replace('let hunting = ', '') : PURSUIT)
    w.traceOf(['rabbit', 'fox'])
    const c = w.show()
    let n = 0, t = 0
    while (!w.s.done && n < 2000) { t += schedule[n++ % schedule.length]; c.advance(t) }
    c.dispose()
    const fw = w.attempts.filter(a => a.command === 'fw' && a.verdict === 'accept')
    return { done: w.s.done, run: w.at('hunting')?.runIncarnation ?? null, n: w.trace.length,
        digest: hash(JSON.stringify(w.trace)).slice(0, 16), motionDigest: hash(JSON.stringify(fw)).slice(0, 16),
        forward: fw.length, fox: w.pose('fox')?.slice(0, 3), errors: w.errors() }
}

function waiting(m, target, explicit = false) {
    const src = `let fox
let rabbit
def walk animal prey n do
  as animal do
    label prey.y
    fw 1
    wait 1
    label prey.y
    fw 2
  end
end
let walking = walk fox rabbit ${explicit ? 'fox.y' : '0'}`
    // The explicit-y variant uses a peer read-free body with respect to its own receiver.
    const w = setup(m, src)
    w.drive(0, 200, 20)
    assert.equal(w.pose('fox')[0], 1)
    const owner = w.at('walking'), old = w.s.installationsOf(owner)[0].frame
    const before = { run: owner.runIncarnation, deadline: old.resumeAt, labels: w.labels.slice() }
    if (target === 'fox') w.hand('fox', [50,explicit ? 7 : 0,0], null)
    else w.hand('rabbit', [0,7,0])
    w.tick(500)
    const current = w.s.installationsOf(owner)[0]?.frame
    const mid = { run: owner.runIncarnation, retired: !w.s.registry.has(old.id), deadline: current?.resumeAt }
    w.drive(510, 2600, 10)
    return { before, mid, run: owner.runIncarnation, labels: w.labels, done: w.s.done, fox: w.pose('fox')[0], errors: w.errors() }
}

function completedFigure(m, explicit = false) {
    const w = setup(m, `let rabbit
def stamp prey y do
  label ${explicit ? 'y' : 'prey.y'}
  fw 1
end
let mark = stamp rabbit ${explicit ? 'rabbit.y' : '0'}`)
    w.drive(0, 200, 20)
    assert.equal(w.s.done, true); assert.deepEqual(w.labels, ['0'])
    w.hand('rabbit', [0,7,0]); w.tick(500); w.drive(510, 800)
    return { run: w.at('mark').runIncarnation, labels: w.labels, errors: w.errors() }
}

function constrained(m) {
    const w = setup(m, `let fox = (5,0,0)
let distance(fox, (0,0,0)) = 5
def push animal do
  as animal do
    fw 1
  end
end
let move = push fox`)
    w.drive(0, 300)
    return { done: w.s.done, fox: w.pose('fox')[0], laws: w.s.laws.count(), attempts: w.attempts, errors: w.errors() }
}

async function delayed(m, swap, input = 'subject') {
    const responder = delayedResponder({ defer: 1 })
    const w = setup(m, `let fox
let rabbit
wait 0.1
def hunt prey animal do
  as animal do
    faceto ${input.endsWith('point') ? 'prey.x prey.y' : 'prey'}
    fw 3
  end
end
let hunting = hunt rabbit fox`, { motionAdmissionAsync: responder.admit, motionAdmission: accept })
    w.tick(0)
    w.hand('rabbit', [0,5,0])
    w.drive(100, 200, 10)
    const call = responder.calls[0], owner = w.at('hunting'), old = w.s.installationsOf(owner)[0].frame
    assert.equal(call?.request.command, 'faceto', 'first actual admission is still pending')
    assert.deepEqual(w.attempts, [])
    if (swap) w.replace('let fox = (20,0,0)')
    else if (input.startsWith('receiver')) w.hand('fox', [10,0,0], null)
    else w.hand('rabbit', [0,-5,0])
    call.resolve(accept(call.request)); await settle()
    w.drive(210, 900, 10)
    return { oldLive: w.s.registry.has(old.id), run: w.at('hunting')?.runIncarnation ?? null,
        fox: w.pose('fox')?.slice(0, 3), attempts: w.attempts, done: w.s.done, errors: w.errors() }
}

try {
    emit('sources', { node: process.version, scheduler: hash(scheduler), compositor: hash(compositor) })
    const rows = {}
    for (const [name, r, p] of [['restart', false, false], ['R', true, false], ['P', false, true], ['RP', true, true]]) {
        const m = await mirror(name, r, p)
        const row = { pair: Object.fromEntries(['distinct','shared','wait','reversed'].map(k => [k, pair(m, k)])),
            pursuit: cadence.map(d => pursuit(m, d)), ordinary: cadence.map(d => pursuit(m, d, true)),
            hand: [waiting(m, 'fox'), waiting(m, 'fox', true), waiting(m, 'rabbit')],
            figure: [completedFigure(m), completedFigure(m, true)], law: constrained(m),
            delayed: await delayed(m, false), delayedPoint: await delayed(m, false, 'point'), delayedReceiver: await delayed(m, false, 'receiver'),
            delayedReceiverPoint: await delayed(m, false, 'receiver-point'),
            swap: await delayed(m, true) }
        rows[name] = row
        emit(name, row)
    }
    for (const row of Object.values(rows)) {
        assert.ok(row.pair.distinct.done)
        assert.deepEqual(row.pair.distinct.runs, [1,1])
        assert.equal(row.pair.distinct.motions.filter(a => a.verdict === 'accept').length, 3)
        assert.equal(row.swap.oldLive, false)
        assert.deepEqual(row.swap.fox, [20,0,0])
        assert.deepEqual(row.swap.attempts, [])
    }
    const { restart, R, P, RP } = rows
    assert.deepEqual(restart.pair, P.pair, 'peer reads do not explain receiver feedback')
    assert.deepEqual(R.pair, RP.pair)
    assert.equal(restart.pair.wait.done, false)
    assert.ok(restart.pair.shared.total > 3, 'even a terminating restart can repeat effects')
    assert.deepEqual(R.pair.shared.poses[0].slice(0, 3), [1,-3,0])
    assert.deepEqual(R.pair.reversed.poses[0].slice(0, 3), [0,-4,0])
    assert.deepEqual(R.pair.wait.poses[0].slice(0, 3), [1,-5,0])
    assert.ok(R.pair.wait.done)
    assert.deepEqual(R.pair.wait.runs, [1,1])
    assert.deepEqual(R.pair.wait.motions.map(a => [a.owner, a.command, a.cut, a.verdict]),
        [['a','fw',0,'accept'], ['b','rt',0,'accept'], ['b','fw',0,'accept'], ['a','fw',100,'accept']])

    assert.deepEqual(R.pursuit, restart.pursuit)
    assert.equal(new Set(restart.pursuit.map(a => a.digest)).size, 3)
    assert.deepEqual(RP.pursuit, P.pursuit)
    assert.equal(new Set(P.pursuit.map(a => a.motionDigest)).size, 1)
    for (const [i, a] of P.pursuit.entries()) {
        assert.ok(a.done); assert.equal(a.run, 1); assert.equal(a.forward, 60)
        assert.equal(a.digest, P.ordinary[i].digest, 'full accepted pose/cut sequence matches ordinary call')
    }

    for (const row of [R, RP]) {
        assert.deepEqual(row.hand[0].mid, { run: 1, retired: false, deadline: 1000 })
        assert.equal(row.hand[0].fox, 52)
        assert.deepEqual(row.hand[1], restart.hand[1], 'explicit receiver scalar still replaces')
        assert.equal(row.delayedReceiver.attempts[0].verdict, 'accept', 'EXPECTED RED: no base on bare aim')
        assert.deepEqual(row.delayedReceiver.fox, [0,3,0], 'EXPECTED RED: old reply undoes the hand')
        const retry = row.delayedReceiverPoint.attempts
        assert.deepEqual(retry.slice(0, 2).map(a => a.verdict), ['stale', 'accept'])
        assert.ok(retry[1].base > retry[0].base)
        assert.deepEqual(retry[1].from, [0,0,0], 'EXPECTED RED: refreshing the read did not refresh the receiver cursor')
        assert.deepEqual(row.delayedReceiverPoint.fox, [0,3,0])
    }
    for (const row of [P, RP]) {
        assert.deepEqual(row.hand[2].labels, ['0', '7']); assert.equal(row.hand[2].run, 1)
        assert.deepEqual(row.figure[0].labels, ['0'], 'EXPECTED RED: finished implicit figure stays stale')
        assert.deepEqual(row.figure[1].labels, ['0', '7'])
        assert.equal(row.delayed.attempts[0].base, null)
        assert.deepEqual(row.delayed.fox, [0,3,0], 'EXPECTED RED: old direction lands')
        assert.equal(row.delayedPoint.run, 1)
        assert.deepEqual(row.delayedPoint.attempts.map(a => a.verdict), ['stale', 'accept', 'accept'])
        assert.deepEqual(row.delayedPoint.fox, [0,-3,0], 'stamping and rereading fixes the peer-only change')
    }
    for (const row of Object.values(rows)) {
        assert.equal(row.law.fox, 5); assert.deepEqual(row.law.attempts.map(a => a.gate), ['violation'])
        assert.equal(row.law.attempts[0].verdict, 'refuse')
    }
} finally {
    await rm(scratch, { recursive: true, force: true })
}
