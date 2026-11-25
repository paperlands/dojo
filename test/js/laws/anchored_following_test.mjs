// Anchored following: a lawful pinned anchor bounds the free branch, but is not
// permission for held, wounded, stale or non-free pins. The original whole-law gate
// still decides alone. (id:laws-free-relations-f4-actor)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, worldOf } from './harness.mjs'
import { lawWorld } from '../../../assets/js/turtling/scheduler.js'
import { programFollowing } from '../../../assets/js/turtling/laws/program_following.js'
import { componentOf } from '../../../assets/js/turtling/laws/component.js'
import { lawViolation } from '../../../assets/js/turtling/laws/verdict.js'

const r6 = (v) => v.map((n) => +n.toFixed(6))
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const offeredFor = (frame, position) =>
    ({ kind: 'accept', pose: { ...frame.transform.deref(), position }, component: [] })

function run(scheduler, steps = 8) {
    let now = 0
    for (let i = 0; i < steps && !scheduler.done; i++) {
        now += 1000
        scheduler.tick(now)
        scheduler.readouts?.drain?.()
    }
}

function seat(source) {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host', source))
    run(scheduler)
    return { scheduler, host }
}

const BASE = `let Sun=(0,0,0)
let Earth
let Moon
let distance(Earth,Sun)=100
let distance(Moon,Earth)=20
wait 1
`

test('a lawful pinned anchor carries the free follower and stays fixed', () => {
    const { scheduler, host } = seat(BASE + `as Earth do
  jmpto (0, 100, 0)
end
`)
    const Sun = host.children.get('Sun'), Earth = host.children.get('Earth'), Moon = host.children.get('Moon')
    assert.deepEqual(r6(worldOf(Sun)), [0, 0, 0])
    assert.deepEqual(r6(worldOf(Earth)), [0, 100, 0])
    assert.ok(Math.abs(dist(worldOf(Earth), worldOf(Moon)) - 20) < 1e-6)
    assert.equal(scheduler.root._lastAttempt.verdict, 'accept')
    assert.equal(scheduler.root._lastAttempt.gate?.status, 'valid')
    assert.deepEqual(scheduler.errors, [])
})

test('a held pinned anchor is not anchor permission; the offer declines whole', () => {
    const { scheduler, host } = seat(`let A
jmp 5
let B
let distance(A,B)=5
jmp 5
let C
let distance(A,C)=5
let C.position=(5,5,0)`)
    const A = host.children.get('A'), C = host.children.get('C')
    C.heldAttempts = new Map([['hold', {}]])
    const offered = offeredFor(A, [10, 5, 0])
    assert.equal(programFollowing(offered, A, scheduler.registry, scheduler.laws, lawWorld), null)
    assert.deepEqual(offered.component, [])
})

test('a wounded pinned anchor is not anchor permission; the offer declines whole', () => {
    const { scheduler, host } = seat(`let A
jmp 5
let B
let distance(A,B)=5
jmp 5
let C
let distance(A,C)=5
let C.position=(5,5,0)`)
    const A = host.children.get('A'), C = host.children.get('C')
    C.unresolved = { reason: 'wound' }
    const offered = offeredFor(A, [10, 5, 0])
    assert.equal(programFollowing(offered, A, scheduler.registry, scheduler.laws, lawWorld), null)
    assert.deepEqual(offered.component, [])
})

test('a stale pinned anchor is not silently pruned; the offer declines whole', () => {
    const { scheduler, host } = seat(`let A
jmp 5
let B
let distance(A,B)=5
jmp 5
let C
let distance(A,C)=5
let C.position=(5,5,0)`)
    const A = host.children.get('A'), C = host.children.get('C')
    scheduler.registry.delete(C.id)
    const offered = offeredFor(A, [10, 5, 0])
    assert.equal(programFollowing(offered, A, scheduler.registry, scheduler.laws, lawWorld), null)
    assert.deepEqual(offered.component, [])
})

test('an off-radius root is refused by the external whole-law gate; nothing moves', () => {
    const { scheduler, host } = seat(BASE + `as Earth do
  jmpto (70, 70, 0)
end
`)
    assert.deepEqual(r6(worldOf(host.children.get('Sun'))), [0, 0, 0])
    assert.deepEqual(r6(worldOf(host.children.get('Earth'))), [100, 0, 0])
    assert.deepEqual(r6(worldOf(host.children.get('Moon'))), [80, 0, 0])
    assert.equal(scheduler.root._lastAttempt.verdict, 'refuse')
    assert.equal(scheduler.root._lastAttempt.gate?.status, 'violation')
})

test('a second planet beyond the pinned anchor is not acquired', () => {
    const { scheduler, host } = seat(`let Sun=(0,0,0)
let Earth
let Moon
let Mars
let distance(Earth,Sun)=100
let distance(Moon,Earth)=20
let distance(Mars,Sun)=200
wait 1
as Earth do
  jmpto (0, 100, 0)
end
`)
    assert.deepEqual(r6(worldOf(host.children.get('Sun'))), [0, 0, 0])
    assert.deepEqual(r6(worldOf(host.children.get('Earth'))), [0, 100, 0])
    assert.ok(Math.abs(dist(worldOf(host.children.get('Earth')), worldOf(host.children.get('Moon'))) - 20) < 1e-6)
    assert.deepEqual(r6(worldOf(host.children.get('Mars'))), [200, 0, 0])
    assert.equal(scheduler.root._lastAttempt.verdict, 'accept')
    assert.equal(scheduler.root._lastAttempt.gate?.status, 'valid')
})

test('no pin: the ordinary binary distance tree still follows exactly B', () => {
    const { scheduler, host } = seat(`let A
jmp 5
let B
let distance(A,B)=5`)
    const A = host.children.get('A')
    const out = programFollowing(offeredFor(A, [3, 0, 0]), A, scheduler.registry, scheduler.laws, lawWorld)
    assert.deepEqual(out.component.map(({ frame }) => frame.name), ['B'])
})

// The next two are graph-only guards: the injected rows carry endpoints, not a world
// claim. They prove non-distance participants are not silently dropped by the BFS.
test('no pin: a non-distance hyperedge keeps the old unsupported scope', () => {
    const { scheduler, host } = seat(`let A
jmp 5
let B
let distance(A,B)=5
jmp 5
let C
jmp 5
let Sun
let Sun.position=(0,0,0)`)
    const A = host.children.get('A'), B = host.children.get('B')
    const C = host.children.get('C'), Sun = host.children.get('Sun')
    const distanceLaw = scheduler.laws.active().find((l) => l.feature === 'distance')
    const angleLink = { feature: 'bearing', endpoints: [A.id, Sun.id, C.id], frame: A.id }
    const laws = { active: () => [distanceLaw, angleLink] }
    const out = programFollowing(offeredFor(A, [3, 0, 0]), A, scheduler.registry, laws, lawWorld)
    assert.equal(out, null)
    assert.ok(componentOf([angleLink], [A.id]).frames.has(C.id), 'C remains in the participant graph')
    assert.equal(B.parent, A.parent)
})

test('a pinned anchor with angle-like free participants keeps the free participant', () => {
    const { scheduler, host } = seat(`let A
jmp 5
let B
let distance(A,B)=5
jmp 5
let C
jmp 5
let Sun
let Sun.position=(0,0,0)`)
    const A = host.children.get('A'), C = host.children.get('C'), Sun = host.children.get('Sun')
    const distanceLaw = scheduler.laws.active().find((l) => l.feature === 'distance')
    const angleLink = { feature: 'bearing', endpoints: [A.id, Sun.id, C.id], frame: A.id }
    const pin = { feature: 'position', endpoints: [Sun.id], frame: A.id, predicate: [0, 0, 0] }
    const laws = { active: () => [distanceLaw, angleLink, pin] }
    const out = programFollowing(offeredFor(A, [3, 0, 0]), A, scheduler.registry, laws, lawWorld)
    assert.equal(out, null)
    assert.ok(componentOf([angleLink], [A.id]).frames.has(C.id), 'C is not dropped by the anchor')
})
