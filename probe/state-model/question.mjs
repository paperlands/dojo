// probe-status: concluded
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Group, PerspectiveCamera } from '../../assets/js/utils/three-entry.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { parseProgram } from '../../assets/js/turtling/parse.js'
import { Parser } from '../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../assets/js/turtling/mafs/evaluate.js'

const dir = fileURLToPath(new URL('../../assets/js/turtling/', import.meta.url))
const schedulerSource = await readFile(join(dir, 'scheduler.js'), 'utf8')
const compositorSource = await readFile(join(dir, 'compositor.js'), 'utf8')
const digest = s => createHash('sha256').update(s).digest('hex')
const emit = (caseName, data) => console.log(JSON.stringify({ case: caseName, ...data }))
function change(s, before, after) {
    assert.equal(s.split(before).length, 2, `exactly one anchor: ${before}`)
    return s.replace(before, () => after)
}

function describe(s) {
    s = change(s, `        target, property, args, ground,
        baseline: value,
        live: () => resolveProperty(target, property, args, null, ground, false, interpretation),`, `        targetId: target.id, property, args, ground, interpretation,
        baseline: value,`)
    s = change(s, `        receiver: true, target: receiver,
        baseline: captureReceiver(receiver),
        live: () => captureReceiver(receiver),`, `        receiver: true, targetId: receiver.id,
        baseline: captureReceiver(receiver),`)
    return change(s, `        if (entry.receiver === true || !isLiveReceiver(child.questionView, entry.target)) {
            try { now = entry.live() } catch { /* retain an unavailable input's baseline */ }
        }`, `        const target = metaRootFrame(child)._registry.get(entry.targetId)
        if (target && liveIn(metaRootFrame(child)._registry, target) &&
            (entry.receiver === true || !isLiveReceiver(child.questionView, target))) {
            try {
                now = entry.receiver ? captureReceiver(target) : resolveProperty(target, entry.property,
                    entry.args, null, entry.ground, false, entry.interpretation)
            } catch { /* retain an unavailable input's baseline */ }
        }`)
}

function separate(s) {
    s = change(s, `            if (entry) entry.baseline = captureReceiver(writer.receiver)`, `            if (entry) {
                entry.baseline = captureReceiver(writer.receiver)
                entry.observed = entry.baseline
            }`)
    return change(s, `        baselines.push([key, entry.baseline])`, `        if (entry.receiver === true) {
            const observed = entry.observed ?? entry.baseline
            if (!sameValue(now, observed)) {
                entry.request = sameValue(now, entry.baseline) ? null : now
                entry.observed = now
            }
            if (entry.request) {
                now = entry.request
                changed = true
            }
        }
        baselines.push([key, entry.baseline])`)
}

const variants = { closure: s => s, record: describe, 'closure+split': separate, 'record+split': s => separate(describe(s)) }
const scratch = await mkdtemp(join(tmpdir(), 'dojo-question-cross-'))
async function mirror(name, rewrite) {
    const base = join(scratch, name)
    const turtle = join(base, 'turtling')
    await mkdir(turtle, { recursive: true })
    for (const item of await readdir(join(dir, '..'))) if (item !== 'turtling') {
        await symlink(join(dir, '..', item), join(base, item))
    }
    for (const item of await readdir(dir)) if (!['scheduler.js', 'compositor.js'].includes(item)) {
        await symlink(join(dir, item), join(turtle, item))
    }
    await writeFile(join(turtle, 'scheduler.js'), change(rewrite(schedulerSource), 'function questionMoved(frame) {',
        'function questionMoved(frame) {\n    if (metaRootFrame(frame).__stateModelForceOldTurn) return false'))
    await writeFile(join(turtle, 'compositor.js'), compositorSource)
    const url = name => pathToFileURL(join(turtle, name)).href
    return { ...await import(url('scheduler.js')), ...await import(url('compositor.js')) }
}

const pos = (m, f) => f ? m.frameWorldTransform(f).position.map(n => +n.toFixed(8)) : null
const rx = (m, f) => pos(m, f)?.[0]
const WINDOW = `let fox
def walk animal do
  as animal do
    loop 4 do
      fw 1
      wait 1
    end
  end
end
let walking = walk fox`
const PARTICIPANT = `let rabbit
let fox
def hunt prey predator do
  as predator do
    label prey.y
    fw 1
    wait 10
    label prey.y
  end
end
let hunting = hunt rabbit fox`
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
const SIBLINGS = `let fox
def step animal do
  as animal do
    fw 1
  end
end
let a = step fox
let b = step fox`

function setup(m, program) {
    const s = m.createScheduler(m.metaRoot(), { createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }), execOpts: { color: '#e77808' }, onShout() {}, clock: () => 0 })
    const host = s.hotSwapChild('host', { name: 'host', code: { ast: parseProgram(program), functions: null }, style: { color: '#e77808' }, env: null })
    const at = name => host.children.get(name)
    const labels = []
    const collect = () => {
        for (const f of s.registry.values()) for (const event of f.channel.drain()) if (event.type === 'label') labels.push(event.text)
    }
    function advance(t, service = true) {
        s.tick(t)
        collect()
        if (service) s.readouts.drain()
        collect()
    }
    function hand(f, xyz, ref) {
        const verdict = s.requestMotion(f, { ...SE3.clone(m.frameWorldTransform(f)), position: xyz }, s.motionRevision, ref)
        assert.equal(verdict.kind, 'accept', JSON.stringify(verdict))
    }
    const pending = () => s.readouts.list().some(n => n.keyed && n.pending)
    const errors = () => s.errors.map(e => e.message)
    return { s, host, at, labels, collect, advance, hand, pending, errors }
}

function window(m, kind, ref) {
    const w = setup(m, WINDOW)
    w.advance(0)
    const walking = w.at('walking'), fox = w.at('fox')
    const before = walking.runIncarnation
    assert.equal(rx(m, fox), 1)
    const old = w.s.installationsOf(walking)[0].frame
    if (kind !== 'own') w.hand(fox, [50, 0, 0], ref)
    const afterHand = [rx(m, fox), walking.runIncarnation, w.pending()]
    if (kind !== 'own') assert.deepEqual(afterHand, [50, before, true])
    if (kind === 'return') w.hand(fox, [1, 0, 0], ref)
    if (kind === 'delayed' || kind === 'withhold-only') {
        const drain = w.s.readouts.drain
        w.s.readouts.drain = () => {} // withhold service, not capture or publication
        if (kind === 'delayed') w.s.root.__stateModelForceOldTurn = true
        try {
            for (let i = 0; i < 12 && rx(m, fox) === 50; i++) w.advance(1000 + i * 16, false)
        } finally {
            w.s.readouts.drain = drain
            delete w.s.root.__stateModelForceOldTurn
        }
    }
    if (kind === 'natural-delay' || kind === 'own') w.advance(1000, false)
    const beforeService = [rx(m, fox), walking.runIncarnation, w.pending()]
    if (kind === 'withhold-only') assert.deepEqual(beforeService, [50, before, true], 'questionMoved fences the old run even when drain is withheld')
    if (kind === 'delayed') assert.deepEqual(beforeService.slice(0, 2), [51, before], JSON.stringify({ ref, errors: w.errors(), frontier: w.s.root._frontier, resumeAt: old.resumeAt, suspension: old.suspension?.kind, elapsed: old.elapsedTime, done: old.done, unresolved: old.unresolved }))
    w.s.readouts.drain()
    const afterService = [rx(m, fox), walking.runIncarnation, w.pending()]
    const retired = !w.s.registry.has(old.id)
    return { afterHand, beforeService, afterService, retired, errors: w.errors() }
}

function facet(m, name) {
    const w = setup(m, PARTICIPANT)
    w.advance(0)
    const hunting = w.at('hunting'), rabbit = w.at('rabbit')
    const consumed = [...hunting.consumed.values()].find(e => e.property === 'y')
    assert.ok(consumed, 'authored label really captures the y facet')
    if (name.startsWith('record')) {
        assert.equal(consumed.targetId, rabbit.id)
        assert.deepEqual(structuredClone(consumed), consumed)
    } else assert.equal(typeof consumed.live, 'function')
    w.hand(rabbit, [5, 0, 0], 'world'); w.s.readouts.drain(); w.advance(1000)
    const unconsumed = [hunting.runIncarnation, rx(m, w.at('fox')), w.labels.slice()]
    w.hand(rabbit, [5, 7, 0], 'world'); w.s.readouts.drain(); w.advance(2000)
    return { unconsumed, consumed: [hunting.runIncarnation, rx(m, w.at('fox')), w.labels.slice()], errors: w.errors() }
}

function withdraw(m) {
    const w = setup(m, PARTICIPANT)
    w.advance(0)
    const old = ['hunting', 'rabbit', 'fox'].map(w.at)
    w.hand(old[1], [0, 7, 0], 'world')
    assert.equal(w.pending(), true)
    w.s.removeChild('host')
    assert.ok(old.every(f => !w.s.registry.has(f.id)))
    const host = w.s.hotSwapChild('host', { name: 'host', code: { ast: parseProgram(PARTICIPANT) },
        style: { color: '#e77808' } }, { fresh: true })
    w.advance(1000)
    assert.equal(host.children.get('hunting').runIncarnation, 1)
    assert.ok(old.every(f => host.children.get(f.name)?.id !== f.id))
    assert.deepEqual(w.labels, ['0', '0'], 'the retired question does not supply the new reading')
    return { pending: w.pending(), fox: pos(m, host.children.get('fox')), errors: w.errors() }
}

function cadence(m, schedule) {
    const w = setup(m, PURSUIT)
    const trace = []
    w.s.onAcceptedChange(() => trace.push([+w.s.root._frontier.toFixed(8), w.at('hunting')?.runIncarnation ?? 0, pos(m, w.at('rabbit')), pos(m, w.at('fox'))]))
    const compositor = m.createCompositor(w.s, {
        scene: new Group(), camera: new PerspectiveCamera(),
        materials: { getInk: () => ({}), clear() {} }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { frameMs: 16, createText() { throw new Error('no authored labels in this fixture') }, focus: { kindled: null, isFocused: () => false, inFocusedSubtree: () => false } })
    let t = 0, frames = 0
    while (!w.s.done && frames < 2000) { t += schedule[frames++ % schedule.length]; compositor.advance(t) }
    assert.ok(w.s.done, 'bounded pursuit terminates'); assert.deepEqual(w.errors(), [])
    compositor.dispose()
    return { trace: digest(JSON.stringify(trace)).slice(0, 16), n: trace.length, run: w.at('hunting').runIncarnation, fox: pos(m, w.at('fox')) }
}

function feedback(m, separateReceivers) {
    const w = setup(m, separateReceivers ? SIBLINGS.replace('let fox', 'let fox\nlet fox2').replace('let b = step fox', 'let b = step fox2') : SIBLINGS)
    for (let i = 0; i < 24; i++) w.advance(i * 16)
    return { runs: ['a', 'b'].map(n => w.at(n).runIncarnation), done: w.s.done, pending: w.pending(), frontier: w.s.root._frontier, fox: rx(m, w.at('fox')), errors: w.errors() }
}

try {
    emit('sources', { node: process.version, scheduler: digest(schedulerSource), compositor: digest(compositorSource) })
    const rows = {}
    for (const [name, rewrite] of Object.entries(variants)) {
        const m = await mirror(name, rewrite)
        const trials = {}
        for (const [refName, ref] of [['slot', undefined], ['world', 'world']]) {
            trials[refName] = Object.fromEntries(['own', 'return', 'immediate', 'natural-delay', 'withhold-only', 'delayed'].map(k => [k, window(m, k, ref)]))
        }
        rows[name] = { trials, facet: facet(m, name), withdrawal: withdraw(m),
            cadence: [[16], [50], [16, 16, 800, 16, 250, 33]].map(d => cadence(m, d)),
            feedback: [feedback(m, true), feedback(m, false)] }
        emit(name, rows[name])
    }
    assert.deepEqual(rows.record, rows.closure, 'representation parity in the original semantics')
    assert.deepEqual(rows['record+split'], rows['closure+split'], 'representation parity under separated demand')
    const split = rows['closure+split']
    for (const ref of ['slot', 'world']) {
        for (const kind of ['own', 'return', 'immediate', 'natural-delay', 'withhold-only']) {
            assert.deepEqual(split.trials[ref][kind], rows.closure.trials[ref][kind], `${kind} control parity`)
        }
        assert.equal(rows.closure.trials[ref].delayed.retired, false)
        assert.equal(split.trials[ref].delayed.retired, true)
    }
    assert.deepEqual(split.cadence, rows.closure.cadence, 'a receiver-only change does not settle pursuit cadence')
    assert.ok(new Set(split.cadence.map(r => r.trace)).size > 1, 'renderer-schedule witness must distinguish the runs')
    for (const name of Object.keys(rows)) {
        const [independent, shared] = rows[name].feedback
        assert.equal(independent.done, true); assert.deepEqual(independent.runs, [1, 1])
        assert.equal(shared.done, false); assert.ok(shared.runs.every(r => r > 1))
    }
} finally {
    await rm(scratch, { recursive: true, force: true })
}
