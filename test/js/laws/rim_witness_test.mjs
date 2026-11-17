// Native locus, selected realization and effective view are distinct facts.
// Run: node --test test/js/laws/rim_witness_test.mjs
// (id:probe-rim-witness)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from './harness.mjs'
import { pointStateOf, preparePointRead } from '../../../assets/js/turtling/laws/point_state.js'
import { boundsOf } from '../../../assets/js/turtling/laws/constraints.js'
import { exposed, pointCandidates } from '../../../assets/js/turtling/laws/batch.js'
import { createGesture } from '../../../assets/js/turtling/laws/gesture.js'
import { circleRig } from '../../../assets/js/turtling/laws/hand.js'
import { fitPose, viewDirection } from '../../../assets/js/turtling/laws/fit.js'
import { frameWorldTransform, worldTransform } from '../../../assets/js/turtling/scheduler.js'
import { worldToViewOf, createViewSnapshot, projectPoint, unprojectRay } from '../../../assets/js/turtling/view_snapshot.js'
import { PerspectiveCamera } from '../../../assets/js/utils/three-entry.js'

const SOURCE = `let A
def rim a do
  let a.x = 3
  let distance(a,(0,0)) = 5
end
let ring = rim A`
const CIRCLE = { kind: 'circle', center: [3, 0, 0], radius: 4, normal: [1, 0, 0], d: -3, gap: 2 }
const lawful = a => {
    assert.ok(Math.abs(a[0] - 3) < 1e-12)
    assert.ok(Math.abs(a[1] ** 2 + a[2] ** 2 - 16) < 1e-12)
    assert.ok(Math.abs(Math.hypot(...a) - 5) < 1e-12)
}

function rim(t) {
    const scheduler = buildWorld({ capacity: 512, strokeMax: 0, breathEvery: 1000, clock: () => 0 })
    const host = scheduler.hotSwapChild('host', fork('host', SOURCE))
    const releases = [() => scheduler.removeChild('host')]
    t.after(() => { for (const release of releases.reverse()) release() })
    let ink = 0
    const pump = () => {
        for (let i = 0; i < 4; i++) {
            scheduler.tick(i * 16)
            for (const frame of scheduler.registry.values())
                for (const e of frame.channel.drain())
                    if (e.type === 'path') ink += e.points.length - 1
        }
    }
    pump()
    const A = host.children.get('A'), ring = host.children.get('ring')
    const at = () => [...frameWorldTransform(A).position]
    return { scheduler, host, A, ring, at, pump, releases, ink: () => ink }
}

function viewOf(pose) {
    const camera = new PerspectiveCamera(60, 4 / 3, .1, 1e7)
    camera.position.set(...pose.position)
    camera.lookAt(...pose.target)
    camera.updateMatrixWorld()
    return createViewSnapshot({ status: 'ready', width: 800, height: 600,
        worldToView: worldToViewOf(camera), projection: camera.projectionMatrix })
}

function fitted(world) {
    const state = pointStateOf(world.A, world.scheduler)
    return viewOf(fitPose(boundsOf(state.locus, state.at), {
        dir: viewDirection(state.locus.normal), aspect: 4 / 3, floor: 30,
    }))
}

function hand(world, view, controls = true) {
    const { scheduler } = world, read = preparePointRead(scheduler), lines = []
    const state = { controls, captured: false, rayCalls: 0 }
    const gesture = createGesture({
        candidates: () => pointCandidates(scheduler.registry.values(),
            f => exposed(f) && read(f).interaction.offered).map(f => ({ name: f.name, frame: f })),
        canTouch: f => pointStateOf(f, scheduler).interaction.offered,
        anchorOf: frameWorldTransform,
        birthOf: worldTransform,
        registered: f => scheduler.registry.get(f.id) === f,
        requestMotion: (...args) => scheduler.requestMotion(...args),
        homeOf: f => scheduler.handHome(f),
        revision: () => scheduler.motionRevision,
        wake() {},
        project: p => projectPoint(view, p),
        rayAt: (x, y) => { state.rayCalls++; return unprojectRay(view, x, y) },
        facing: () => unprojectRay(view, view.width / 2, view.height / 2).direction,
        locusOf: f => pointStateOf(f, scheduler).locus,
        detents: { paper: true, poles: true },
        capture: ({ frame }) => { state.captured = true; return scheduler.defer(frame) },
        release: () => { state.captured = false },
        setControls: enabled => { state.controls = enabled },
        controlsEnabled: () => state.controls,
        onReadout: line => lines.push(line),
        now: () => 0,
    })
    world.releases.push(() => gesture.dispose())
    return { gesture, lines, state }
}

function drag(world, view, dx, dy) {
    const { gesture, lines, state } = hand(world, view)
    const before = world.at(), p = projectPoint(view, before)
    assert.ok(p)
    assert.equal(gesture.pointerDown({ pointerId: 7, ...p }).claimed, true)
    assert.equal(state.controls, false)
    const moved = gesture.pointerMove({ pointerId: 7, x: p.x + dx, y: p.y + dy })
    world.pump()
    gesture.pointerUp({ pointerId: 7, x: p.x + dx, y: p.y + dy })
    world.pump()
    assert.equal(moved.outcome, 'accepted')
    assert.ok(state.rayCalls > 0, 'the native hand actually asks the public view for a ray')
    assert.equal(state.controls, true)
    assert.equal(state.captured, false)
    assert.deepEqual(lines.map(line => line.outcome), ['accepted'])
    assert.deepEqual(world.scheduler.errors, [])
    lawful(world.at())
    assert.equal(world.ring.runIncarnation, 1)
    assert.equal(world.scheduler.laws.count(), 2)
    assert.equal(world.ink(), 0, 'hand motion never deposits a circle stroke')
    return { before, after: world.at() }
}

test('the finite recipe denotes a whole native circle before any ink or gesture', t => {
    const world = rim(t), state = pointStateOf(world.A, world.scheduler)
    assert.deepEqual(world.scheduler.errors, [])
    assert.deepEqual(world.at(), [3, 0, 4])
    assert.equal(world.scheduler.laws.count(), 2)
    assert.equal(world.ink(), 0)
    assert.equal(state.dof, 1)
    assert.deepEqual(state.locus, CIRCLE)
    assert.deepEqual(boundsOf(state.locus, state.at), { center: [3, 0, 0], radius: 4 })
    assert.equal(state.interaction.offered, true)
    assert.equal(world.A.parent, world.host)
    assert.equal(world.ring.children.size, 0, 'the recipe did not clone its supplied being')
})

test('off-law wishes are admitted onto the same set without rebuilding its actual owner', t => {
    const world = rim(t), incarnation = world.ring.runIncarnation
    for (const [wish, expected] of [
        [[100, 0, 4], [3, 0, 4]], [[-8, -4, 0], [3, -4, 0]], [[0, 0, -8], [3, 0, -4]],
    ]) {
        assert.equal(world.scheduler.proposePlace(['host', 'A'], wish, world.scheduler.motionRevision).kind, 'accept')
        world.pump()
        assert.deepEqual(world.at(), expected)
        lawful(world.at())
        assert.equal(world.ring.runIncarnation, incarnation)
        assert.deepEqual(pointStateOf(world.A, world.scheduler).locus, CIRCLE)
        assert.equal(world.scheduler.laws.count(), 2)
    }
    assert.deepEqual(world.scheduler.errors, [])
})

test('an oblique native hand uses the public projection and ray and moves lawfully', t => {
    const world = rim(t)
    const result = drag(world, viewOf({ position: [20, 26, 32], target: [3, 0, 0] }), 90, 40)
    assert.notDeepEqual(result.after, result.before)
})

test('an edge-on native hand accepts but holds exactly instead of guessing a phase', t => {
    const world = rim(t), view = viewOf({ position: [0, 0, 500], target: [0, 0, 0] })
    const rig = circleRig(CIRCLE, world.at(), p => projectPoint(view, p))
    assert.equal(rig.observable, false)
    const result = drag(world, view, 120, 60)
    assert.deepEqual(result.after, result.before)
})

test('native extent-based framing makes the curve observable without enlarging it', t => {
    const world = rim(t), view = fitted(world)
    assert.equal(circleRig(CIRCLE, world.at(), p => projectPoint(view, p)).observable, true)
    const result = drag(world, view, 70, -40)
    assert.notDeepEqual(result.after, result.before)
    assert.deepEqual(pointStateOf(world.A, world.scheduler).locus, CIRCLE)
})

test('a complete native projected-circle gesture stays radial-exact with bounded phase error', t => {
    const world = rim(t), view = fitted(world), before = world.at()
    const rig = circleRig(CIRCLE, before, p => projectPoint(view, p))
    const { gesture, state } = hand(world, view), start = projectPoint(view, before)
    assert.equal(gesture.pointerDown({ pointerId: 9, ...start }).claimed, true)
    for (let i = 4; i <= 96; i += 4) {
        const p = rig.samples[i % 96].screen
        assert.ok(p)
        assert.equal(gesture.pointerMove({ pointerId: 9, ...p }).outcome, 'accepted')
        world.pump()
        lawful(world.at())
    }
    gesture.pointerUp({ pointerId: 9, ...start })
    world.pump()
    assert.ok(state.rayCalls > 0)
    assert.ok(Math.hypot(...world.at().map((v, i) => v - before[i])) < 1e-3,
        'phase search approximates the return along the exact circle')
    assert.equal(world.ring.runIncarnation, 1)
    assert.equal(world.scheduler.laws.count(), 2)
    assert.equal(world.ink(), 0, 'hand motion never deposits a circle stroke')
})

test('observing another camera view cannot change the mathematical set or realization', t => {
    const world = rim(t), before = world.at()
    const a = viewOf({ position: [20, 26, 32], target: [3, 0, 0] })
    const b = viewOf({ position: [0, 0, 500], target: [0, 0, 0] })
    assert.notDeepEqual(projectPoint(a, before), projectPoint(b, before))
    assert.deepEqual(world.at(), before)
    assert.deepEqual(pointStateOf(world.A, world.scheduler).locus, CIRCLE)
})


test('releasing the native hand preserves a previously disabled camera control', t => {
    const world = rim(t), view = fitted(world), { gesture, state } = hand(world, view, false)
    const p = projectPoint(view, world.at())
    assert.equal(gesture.pointerDown({ pointerId: 12, ...p }).claimed, true)
    assert.equal(state.controls, false)
    gesture.pointerMove({ pointerId: 12, x: p.x + 40, y: p.y + 25 })
    world.pump()
    gesture.pointerUp({ pointerId: 12, x: p.x + 40, y: p.y + 25 })
    assert.equal(state.controls, false)
    assert.equal(state.captured, false)
    lawful(world.at())
})
