import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { pointStateOf, preparePointRead } from '../../../assets/js/turtling/laws/point_state.js'
import { AUTHORED, pointSubjects, pointQuery, bindWorld } from '../../../assets/js/turtling/laws/authored.js'
import { bindLaw } from '../../../assets/js/turtling/laws/replacement.js'
import { heldIdentity } from '../../../assets/js/turtling/laws/constraints.js'
import { frameWorldTransform, worldTransform } from '../../../assets/js/turtling/scheduler.js'
import { pointCandidates, exposed } from '../../../assets/js/turtling/laws/batch.js'

function world(source) {
    const scheduler = buildWorld({ capacity: 4096, breathEvery: 1024 })
    const host = scheduler.hotSwapChild('host', fork('host', source))
    drive(scheduler, { maxTicks: 1000 })
    assert.equal(host.error, null)
    assert.equal(host.unresolved, null)
    return { scheduler, host }
}

for (const source of [
    'let A\nlet B = (0,0,0)\nlet distance(A,B)=0',
    'let A\nlet B\nlet C=(0,0,0)\nlet distance(A,B)=0\nlet distance(B,C)=0',
    'let A\nlet B\nlet distance(A,B)=0',
    'let A\nlet A.distance=5\nlet A.y=0',
    'let A\nlet A.distance=5\nlet A.tilt=45',
    'let A\nas A do\n fw 1\nend',
]) test(`prepared point reading agrees with scanning: ${source.replaceAll('\n', '; ')}`, () => {
    const { scheduler, host } = world(source)
    const read = preparePointRead(scheduler)
    for (const frame of host.children.values()) {
        assert.deepEqual(read(frame), pointStateOf(frame, scheduler))
        assert.equal(read(frame), read(frame), 'one interpretation per identity per pass')
    }
})

test('a partner pin stays visible through the full indexed context', () => {
    const { scheduler, host } = world('let A\nlet B=(0,0,0)\nlet distance(A,B)=0')
    const state = preparePointRead(scheduler)(host.children.get('A'))
    assert.equal(state.tag, 'pinned')
    assert.equal(state.truth.pinned, true)
    assert.equal(state.truth.coincident, false)
})

test('preparation is lazy and performs linear law incidence work, not points × laws', () => {
    const count = 120
    const { scheduler, host } = world(Array.from({ length: count }, (_, i) => `let P${i}=(${i},0,0)`).join('\n'))
    let snapshots = 0, incidenceReads = 0
    const active = scheduler.laws.active.bind(scheduler.laws)
    scheduler.laws.active = () => { snapshots++; return active() }
    const points = AUTHORED.position.points
    AUTHORED.position.points = law => { incidenceReads++; return points(law) }
    try {
        const read = preparePointRead(scheduler)
        assert.equal(snapshots, 0)
        for (const frame of host.children.values()) { read(frame); read(frame) }
        assert.equal(snapshots, 1)
        assert.equal(incidenceReads, 2 * count, 'one index visit and one point query per law')
    } finally {
        AUTHORED.position.points = points
    }
})

test('each new pass sees motion, holds, retraction and body attachment', () => {
    const { scheduler, host } = world('let A\nlet B=(0,0,0)\nlet distance(A,B)=0')
    const A = host.children.get('A')
    assert.equal(preparePointRead(scheduler)(A).truth.pinned, true)
    scheduler.laws.clear()
    A.transform.swap(pose => ({ ...pose, position: [2, 3, 4] }))
    assert.deepEqual(preparePointRead(scheduler)(A).at, [2, 3, 4])
    A.held = 'unresolved attempt'
    assert.equal(preparePointRead(scheduler)(A).interaction.offered, false)
    A.held = null
    assert.equal(preparePointRead(scheduler)(A).interaction.offered, true)
    A.actorState = {}
    assert.deepEqual(preparePointRead(scheduler)(A), pointStateOf(A, scheduler))
    assert.equal(preparePointRead(scheduler)(A).role, 'headed')
})

test('typed incidence, self-zero and unavailable contributions agree with the scan', () => {
    const { scheduler, host } = world('let A\nlet B')
    const A = host.children.get('A'), B = host.children.get('B')
    const laws = [
        bindLaw({ feature: 'distance', endpoints: [A.id, B.id], frame: host.id, predicate: 0 }),
        bindLaw({ feature: 'distance', endpoints: [A.id, A.id], frame: host.id, predicate: 0 }),
        bindLaw({ feature: 'coordinate', endpoints: [A.id], frame: host.id, axis: 'x', predicate: 0,
            expression: { type: 'coordinate', references: [A.id], frame: host.id, axis: 'x', value: null } }),
        bindLaw({ feature: 'position', endpoints: [String(A.id)], frame: host.id, predicate: [0, 0, 0] }),
    ]
    for (const law of laws) scheduler.laws.apply(law)
    const read = preparePointRead(scheduler)
    assert.deepEqual(read(A), pointStateOf(A, scheduler))
    assert.equal(read(A).truth.pinned, false, 'a numeric id never borrows its string namesake pin')
    assert.ok(read(A).refusal)

    const active = scheduler.laws.active(), indexed = new Map()
    for (const law of active) for (const id of new Set(pointSubjects(law))) {
        if (!indexed.has(id)) indexed.set(id, [])
        indexed.get(id).push(law)
    }
    const ctx = bindWorld(id => scheduler.registry.get(id), {
        writerId: A.id, live: frameWorldTransform, placement: worldTransform,
        heldOf: id => heldIdentity(scheduler.registry.get(id), active, scheduler.registry),
    })
    assert.deepEqual(pointQuery(A.id, indexed, ctx), pointQuery(A.id, active, ctx))
})

test('prepared candidates remain topmost-first and never offer a pinned or headed place', () => {
    const { scheduler, host } = world('let A\nlet D\nlet B=(0,0,0)\nlet C\nas C do\n fw 1\nend')
    const read = preparePointRead(scheduler)
    const candidates = pointCandidates(scheduler.registry.values(), frame =>
        exposed(frame) && read(frame).interaction.offered)
    assert.deepEqual(candidates, [host.children.get('D'), host.children.get('A')])
    const D = host.children.get('D')
    D.actorState = {}
    assert.equal(preparePointRead(scheduler)(D).interaction.offered, false, 'a later head revokes the next offer')
})

test('scan and prepared holds agree across every four-point coincidence graph and pin assignment', () => {
    const { scheduler, host } = world('let A\nlet B\nlet C\nlet D')
    const frames = [...host.children.values()]
    const edges = []
    for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) {
        edges.push(bindLaw({ feature: 'distance', endpoints: [frames[a].id, frames[b].id],
            scope: host.id, frame: host.id, predicate: 0 }))
    }
    const pins = frames.map(frame => bindLaw({ feature: 'position', endpoints: [frame.id],
        scope: host.id, frame: host.id, predicate: [0, 0, 0] }))
    for (let graph = 0; graph < 64; graph++) for (let fixed = 0; fixed < 16; fixed++) {
        scheduler.laws.clear()
        edges.forEach((law, i) => { if (graph & (1 << i)) scheduler.laws.apply(law) })
        pins.forEach((law, i) => { if (fixed & (1 << i)) scheduler.laws.apply(law) })
        const read = preparePointRead(scheduler)
        for (const frame of frames) assert.deepEqual(read(frame), pointStateOf(frame, scheduler),
            `graph=${graph}, pins=${fixed}, frame=${frame.name}`)
    }
})
