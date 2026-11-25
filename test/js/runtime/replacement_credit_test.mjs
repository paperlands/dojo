// Clear and replacement share credit; an empty answer must deliver its clear before ending.
// (id:output-ledger-replacement-credit)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from '../laws/harness.mjs'
import { createCompositor } from '../../../assets/js/turtling/compositor.js'
import { createFocus } from '../../../assets/js/turtling/focus.js'
import { parkBreath } from '../../../assets/js/turtling/scheduler.js'
import { createMaterialCache } from '../../../assets/js/turtling/render/line/material-cache.js'
import { Group, Vector3 } from '../../../assets/js/utils/three-entry.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'

function renderer(scheduler, createText = () => { throw Error('no labels in this witness') }) {
    const scene = new Group()
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) }, materials: createMaterialCache(),
        requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText })
    const segments = () => {
        const found = []
        scene.traverse(mesh => {
            if (!mesh.isLine2) return
            const a = mesh.geometry.getAttribute('instanceStart'), b = mesh.geometry.getAttribute('instanceEnd')
            for (let n = 0; n < mesh.geometry.instanceCount; n++) found.push([
                [a.getX(n), a.getY(n), a.getZ(n)], [b.getX(n), b.getY(n), b.getZ(n)],
            ])
        })
        return found
    }
    return { compositor, segments, scene }
}
const options = { capacity: 1, strokeMax: 0, breathEvery: 1024, clock: () => 0 }
const tick = scheduler => scheduler.tick(0)
const settle = scheduler => {
    for (let n = 0; n < 40 && !scheduler.done; n++) {
        tick(scheduler)
        for (const frame of scheduler.registry.values()) frame.channel.drain()
    }
    assert.equal(scheduler.done, true)
    assert.deepEqual(scheduler.errors, [])
}

for (const capacity of [1, 2, 64]) test(`replacement retains final scene ink with capacity ${capacity}`, () => {
    const scheduler = buildWorld({ ...options, capacity })
    const host = scheduler.hotSwapChild('host', fork('host', 'loop 3 do\n let F = fw count+1\nend'))
    const r = renderer(scheduler)
    try {
        r.compositor.flush()
        assert.equal(scheduler.done, true)
        assert.deepEqual(scheduler.errors, [])
        assert.deepEqual(host.children.get('F').transform.deref().position, [3, 0, 0])
        assert.deepEqual(r.segments(), [[[0, 0, 0], [3, 0, 0]]])
    } finally { r.compositor.dispose() }
})

test('ordered erase remains an event, not a replacement prefix', () => {
    const scheduler = buildWorld(options)
    scheduler.hotSwapChild('host', fork('host', 'fw 3\nerase\nfw 5'))
    const r = renderer(scheduler)
    try {
        r.compositor.flush()
        assert.equal(scheduler.done, true)
        assert.deepEqual(r.segments(), [[[3, 0, 0], [8, 0, 0]]])
    } finally { r.compositor.dispose() }
})

test('full-channel retries neither clear early nor retag or charge the held path twice', () => {
    const scheduler = buildWorld(options)
    const frame = scheduler.hotSwapChild('F', fork('F', 'fw 3'), { deferStart: true })
    frame.pendingClear = true
    const occupied = { type: 'beat', marker: 'occupied' }
    assert.equal(frame.channel.put(occupied), true)
    for (let n = 0; n < 3; n++) {
        tick(scheduler)
        assert.equal(frame.suspension.kind, 'credit')
        assert.equal(frame.pendingClear, true)
        assert.equal(frame.ink.resident, 1)
        assert.equal(frame._strokeRun, undefined)
    }
    assert.deepEqual(frame.channel.drain(), [occupied])
    tick(scheduler)
    const events = frame.channel.drain()
    assert.deepEqual(events.map(e => e.type), ['clear', 'path'])
    assert.equal(events[1].runId, 1)
    assert.equal(frame.pendingClear, false)
    assert.equal(frame.ink.resident, 1)
    settle(scheduler)
    assert.equal(frame.ink.resident, 1)
})

for (const blocked of ['writer', 'target']) test(`cross-carrier replacement refuses without effects when ${blocked} is full`, () => {
    const scheduler = buildWorld(options)
    const target = scheduler.hotSwapChild('R', fork('R', ''))
    for (const frame of scheduler.registry.values()) frame.channel.drain()
    const writer = scheduler.hotSwapChild('W', fork('W', 'fw 3'), { deferStart: true })
    writer.targetFrame = 'R'
    writer.pendingClear = true
    const occupied = { type: 'beat', marker: blocked }
    const blockedFrame = blocked === 'writer' ? writer : target
    assert.equal(blockedFrame.channel.put(occupied), true)
    tick(scheduler)
    assert.equal(writer.suspension?.kind, 'credit')
    assert.equal(writer.pendingClear, true)
    assert.equal(writer._strokeRun, undefined)
    assert.equal((blocked === 'writer' ? target : writer).channel.length, 0)
    assert.deepEqual(blockedFrame.channel.drain(), [occupied])
    tick(scheduler)
    assert.deepEqual(writer.channel.drain().map(e => e.type), ['clear'])
    const received = target.channel.drain()
    assert.deepEqual(received.map(e => e.type), ['path'])
    assert.equal(received[0].sourceId, writer.id)
    assert.deepEqual(received[0].points, [[0, 0, 0], [3, 0, 0]])
    assert.equal(writer.ink.resident, 1)
    settle(scheduler)
})

function blockedCompletion(result = { actorState: { commandCount: 7, marker: 'terminal' } }) {
    const scheduler = buildWorld(options)
    const frame = scheduler.hotSwapChild('F', fork('F', ''), { deferStart: true })
    let calls = 0
    frame.generator = { next() {
        assert.equal(++calls, 1, 'a terminal return cannot be recovered by calling next again')
        return { done: true, value: result }
    } }
    frame.pendingClear = true
    const occupied = { type: 'beat', marker: 'occupied' }
    frame.channel.put(occupied)
    tick(scheduler)
    return { scheduler, frame, result, occupied, calls: () => calls }
}

test('empty completion holds its return until clear admission, survives breath, and accounts once', () => {
    const r = blockedCompletion()
    const { scheduler, frame } = r
    assert.equal(frame.done, false, 'no-drainer completion must not silently drop its clear')
    assert.equal(scheduler.atCut, false)
    assert.equal(frame.commandCount, 0)
    const suspended = frame.suspension
    for (let n = 0; n < 3; n++) {
        parkBreath(frame)
        tick(scheduler)
        assert.equal(frame.suspension, suspended)
        assert.equal(frame.commandCount, 0)
        assert.equal(r.calls(), 1)
    }
    assert.deepEqual(frame.channel.drain(), [r.occupied])
    tick(scheduler)
    assert.deepEqual(frame.channel.drain(), [{ type: 'clear' }])
    assert.equal(frame.done, true)
    assert.equal(frame.suspension, null)
    assert.equal(frame.commandCount, 7)
    assert.equal(frame.actorState, r.result.actorState)
    assert.equal(frame.batch, null)
    tick(scheduler)
    assert.equal(frame.commandCount, 7)
    assert.equal(r.calls(), 1)
})

test('completion preserves a numeric return, not only actor-state returns', () => {
    const { scheduler, frame } = blockedCompletion(11)
    assert.equal(frame.done, false)
    frame.channel.drain()
    tick(scheduler)
    assert.equal(frame.commandCount, 11)
    assert.equal(frame.done, true)
})

test('retirement revokes a held completion without publishing or finalizing it later', () => {
    const { scheduler, frame } = blockedCompletion()
    assert.equal(frame.done, false)
    scheduler.removeChild('F')
    assert.equal(frame.suspension, null)
    frame.channel.drain()
    tick(scheduler)
    assert.deepEqual(frame.channel.drain(), [])
    assert.equal(frame.commandCount, 0)
    assert.equal(scheduler.registry.has(frame.id), false)
})

test('replacement discards an old held completion and gives the new source its own ink', () => {
    const { scheduler, frame } = blockedCompletion()
    assert.equal(frame.done, false)
    const replacement = scheduler.hotSwapChild('F', fork('F', 'fw 5'))
    assert.notEqual(replacement.id, frame.id)
    assert.equal(frame.suspension, null)
    frame.channel.drain()
    const r = renderer(scheduler)
    try {
        r.compositor.flush()
        assert.equal(replacement.done, true)
        assert.deepEqual(r.segments(), [[[0, 0, 0], [5, 0, 0]]])
        assert.equal(frame.commandCount, 0)
        assert.deepEqual(frame.channel.drain(), [])
    } finally { r.compositor.dispose() }
})


function reactive() {
    const scheduler = buildWorld(options)
    const host = scheduler.hotSwapChild('host', fork('host', [
        'def mark n do', ' when n > 0 do', '  fw n', ' end', 'end',
        'let X', 'let F = mark X.x', 'wait 100',
    ].join('\n')))
    const r = renderer(scheduler)
    r.compositor.flush()
    const point = host.children.get('X'), figure = host.children.get('F')
    const move = x => {
        const verdict = scheduler.requestMotion(point,
            { rotation: point.transform.deref().rotation, position: [x, 0, 0] }, scheduler.motionRevision)
        assert.equal(verdict.kind, 'accept')
        scheduler.readouts.drain()
    }
    return { scheduler, figure, move, ...r }
}

test('a native empty answer removes the previously painted answer at capacity one', () => {
    const r = reactive()
    try {
        r.move(3)
        r.compositor.flush()
        assert.deepEqual(r.segments(), [[[0, 0, 0], [3, 0, 0]]])
        r.move(0)
        r.compositor.flush()
        assert.equal(r.figure.done, true)
        assert.equal(r.figure.pendingClear, false)
        assert.deepEqual(r.segments(), [])
        assert.deepEqual(r.scheduler.errors, [])
    } finally { r.compositor.dispose() }
})

test('same-identity supersession discards a held completion, not the new run’s clear', () => {
    const r = reactive()
    try {
        r.move(1)
        const id = r.figure.id, oldRun = r.figure.run
        const obsolete = { commandCount: 700, marker: 'obsolete' }
        r.figure.generator = { next: () => ({ done: true, value: { actorState: obsolete } }) }
        assert.equal(r.figure.channel.put({ type: 'beat' }), true)
        tick(r.scheduler)
        assert.ok(r.figure.suspension?.completion)
        const count = r.figure.commandCount
        r.move(2)
        assert.equal(r.figure.id, id)
        assert.notEqual(r.figure.run, oldRun)
        assert.equal(r.figure.suspension, null)
        assert.equal(r.figure.pendingClear, true)
        assert.equal(r.figure.commandCount, count)
        r.compositor.flush()
        assert.deepEqual(r.segments(), [[[0, 0, 0], [2, 0, 0]]])
        assert.notEqual(r.figure.actorState, obsolete)
        assert.equal(r.figure.pendingClear, false)
        assert.deepEqual(r.scheduler.errors, [])
    } finally { r.compositor.dispose() }
})


test('label-only replacement reuses visible text without an intermediate hide', () => {
    const scheduler = buildWorld(options)
    scheduler.hotSwapChild('host', fork('host', 'loop 3 do\n let F = label count+1\nend'))
    const made = [], hides = []
    const r = renderer(scheduler, () => {
        const text = new Group()
        let visible = true
        Object.defineProperty(text, 'visible', {
            get: () => visible, set: value => { if (!value) hides.push(text); visible = value },
        })
        text.sync = cb => cb()
        made.push(text)
        return text
    })
    try {
        r.compositor.flush()
        assert.equal(scheduler.done, true)
        assert.deepEqual(scheduler.errors, [])
        assert.equal(made.length, 1, 'the replacement rewrites one pooled label, not three appended copies')
        assert.equal(String(made[0].text), '3')
        assert.equal(made[0].visible, true)
        assert.equal(hides.length, 0, 'clear + label must retain the willPrint rewrite policy')
    } finally { r.compositor.dispose() }
})

test('grid-only replacement keeps only the newest grid at capacity one', () => {
    const scheduler = buildWorld(options)
    scheduler.hotSwapChild('host', fork('host', 'loop 3 do\n let F = grid count+1\nend'))
    const r = renderer(scheduler)
    try {
        r.compositor.flush()
        const grids = []
        r.scene.traverse(object => { if (object.type === 'GridHelper') grids.push(object) })
        assert.equal(scheduler.done, true)
        assert.deepEqual(scheduler.errors, [])
        assert.equal(grids.length, 1)
        grids[0].geometry.computeBoundingBox()
        const bounds = grids[0].geometry.boundingBox
        assert.equal(bounds.max.x - bounds.min.x, 30)
    } finally { r.compositor.dispose() }
})

test('head-only replacement clears on completion without treating its pose as channel ink', () => {
    const scheduler = buildWorld(options)
    const frame = scheduler.hotSwapChild('F', fork('F', ''), { deferStart: true })
    const head = { type: 'head', position: [3, 0, 0], rotation: SE3.identity().rotation, headSize: 10, color: '#000000' }
    frame.generator = (function* () { yield head; return 1 })()
    frame.pendingClear = true
    tick(scheduler)
    assert.equal(frame.done, true)
    assert.equal(frame.commandCount, 1)
    assert.equal(frame.pendingClear, false)
    assert.equal(frame.sync.head, head)
    assert.deepEqual(frame.channel.drain(), [{ type: 'clear' }])
})


for (const retire of [false, true]) test(`parked cross-carrier output obeys ${retire ? 'retirement' : 'the current target'}`, () => {
    const scheduler = buildWorld(options)
    const oldTarget = scheduler.hotSwapChild('A', fork('A', ''))
    const nextTarget = scheduler.hotSwapChild('B', fork('B', ''))
    for (const frame of scheduler.registry.values()) frame.channel.drain()
    const writer = scheduler.hotSwapChild('W', fork('W', 'fw 3'), { deferStart: true })
    writer.targetFrame = 'A'
    writer.pendingClear = true
    const occupied = { type: 'beat', marker: 'occupied' }
    oldTarget.channel.put(occupied)
    tick(scheduler)
    assert.ok(writer.suspension?.owed)
    if (retire) {
        scheduler.removeChild('W')
        assert.equal(writer.suspension, null)
    } else writer.targetFrame = 'B'
    tick(scheduler)
    assert.deepEqual(oldTarget.channel.drain(), [occupied])
    const received = nextTarget.channel.drain()
    assert.deepEqual(received.map(e => e.type), retire ? [] : ['path'])
    assert.deepEqual(writer.channel.drain().map(e => e.type), retire ? [] : ['clear'])
    if (!retire) {
        assert.equal(received[0].sourceId, writer.id)
        assert.equal(received[0].runId, 1)
        assert.equal(writer.ink.resident, 1)
    }
    settle(scheduler)
})
