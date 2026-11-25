// The hand owns an intermediate pose; a declared behaviour resumes only at release.
// (id:declared-behaviour-hand-release)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from './harness.mjs'
import { createGesture } from '../../../assets/js/turtling/laws/gesture.js'
import { frameWorldTransform, worldTransform } from '../../../assets/js/turtling/scheduler.js'
import { createCompositor } from '../../../assets/js/turtling/compositor.js'
import { Group, PerspectiveCamera } from '../../../assets/js/utils/three-entry.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'

function fixture({ insidePrey = false } = {}) {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', `def hunt prey predator do
${insidePrey ? `  as prey do
    loop 500 do
      fw 5
      rt 1
      wait 1/24
    end
  end` : ''}
  as predator do
    loop 500 do
      faceto prey
      fw 3
      wait 1/24
    end
  end
end
${insidePrey ? '' : `let rabbit
as rabbit do
  loop 500 do
    fw 5
    rt 1
    wait 1/24
  end
end`}
let fox
let hunting = hunt ${insidePrey ? '"rabbit"' : 'rabbit'} fox`))
    const fox = host.children.get('fox'), hunting = host.children.get('hunting')
    const rabbit = host.children.get('rabbit') ?? hunting.children.get('rabbit')
    const paths = new Map()
    const drain = () => {
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) {
                if (event.type !== 'path') continue
                if (!paths.has(frame)) paths.set(frame, [])
                paths.get(frame).push(event)
            }
        }
    }
    let now = 0
    const pump = (count = 10) => {
        for (let i = 0; i < count; i++) {
            now += 20
            scheduler.tick(now)
            drain()
            scheduler.readouts.drain()
            drain()
        }
    }
    const gesture = createGesture({
        candidates: () => [{ name: 'fox', frame: fox }],
        anchorOf: frameWorldTransform,
        birthOf: worldTransform,
        registered: frame => scheduler.registry.get(frame.id) === frame,
        requestMotion: (...args) => scheduler.requestMotion(...args),
        revision: () => scheduler.motionRevision,
        wake() {},
        project: position => ({ x: position[0], y: position[1] }),
        rayAt: (x, y) => ({ origin: [x, y, 100], direction: [0, 0, -1] }),
        facing: () => [0, 0, -1],
        capture: ({ frame }) => scheduler.defer(frame),
        release() {},
        setControls() {},
        controlsEnabled: () => true,
        onReadout() {},
        slop: 0,
    })
    drain()
    pump(2)
    const grab = () => {
        const [x, y] = frameWorldTransform(fox).position
        assert.equal(gesture.pointerDown({ pointerId: 1, x, y }).claimed, true)
    }
    const move = (x, y) => assert.equal(gesture.pointerMove({ pointerId: 1, x, y }).outcome, 'accepted')
    return { scheduler, host, fox, rabbit, hunting, gesture, paths, drain, pump, grab, move }
}

for (const ending of ['pointerUp', 'pointerCancel', 'dispose']) {
    test(`grab defers hunt revisions until ${ending}, without stopping an independent rabbit`, () => {
        const w = fixture()
        w.grab()
        const run = w.hunting.runIncarnation
        const foxInk = w.paths.get(w.fox)?.length ?? 0
        const rabbitInk = w.paths.get(w.rabbit)?.length ?? 0
        const installation = w.scheduler.installationsOf(w.hunting)[0]
        for (let i = 1; i <= 3; i++) {
            w.move(100 * i, 50 * i)
            w.pump()
            assert.equal(w.hunting.runIncarnation, run, 'no new realization mid-grab')
            assert.equal(w.scheduler.installationsOf(w.hunting)[0], installation)
            assert.deepEqual(frameWorldTransform(w.fox).position, [100 * i, 50 * i, 0], 'only the hand moves fox')
            assert.equal(w.paths.get(w.fox)?.length ?? 0, foxInk, 'neither old nor new hunt draws while held')
        }
        assert.ok(w.paths.get(w.rabbit).length > rabbitInk, 'unrelated authored motion continues')
        w.gesture[ending]({ pointerId: 1 })
        assert.equal(w.gesture.grabbed, null)
        assert.equal(w.hunting.runIncarnation, run + 1, 'release coalesces intermediate demand into one fresh run')
        const rabbitAtRelease = frameWorldTransform(w.rabbit).position
        w.pump()
        const first = w.paths.get(w.fox)[foxInk]
        assert.deepEqual(first.points[0], [300, 150, 0], 'new ink begins at the final accepted hand pose')
        assert.ok(first.points[1][0] < 300, 'the fresh hunt aims back toward the rabbit')
        assert.notDeepEqual(rabbitAtRelease, [0, 0, 0])
        assert.deepEqual(w.scheduler.errors, [])
    })
}

test('the two-loop quoted-rabbit hunt also waits for the hand to release fox', () => {
    const w = fixture({ insidePrey: true })
    w.grab()
    const run = w.hunting.runIncarnation
    w.move(100, 50)
    w.pump(50)
    assert.equal(w.hunting.runIncarnation, run)
    assert.deepEqual(frameWorldTransform(w.fox).position, [100, 50, 0])
    w.gesture.pointerUp({ pointerId: 1 })
    assert.equal(w.hunting.runIncarnation, run + 1)
    w.pump(2)
    assert.notDeepEqual(frameWorldTransform(w.fox).position, [100, 50, 0])
    assert.deepEqual(w.scheduler.errors, [])
})

test('a revision queued before pointerdown cannot build during the grab', () => {
    const w = fixture()
    const run = w.hunting.runIncarnation
    const position = [100, 50, 0]
    assert.equal(w.scheduler.requestMotion(w.fox,
        { ...w.fox.transform.deref(), position }, w.scheduler.motionRevision).kind, 'accept')
    assert.equal(w.scheduler.readouts.hasPending(), true)
    w.grab()
    w.scheduler.readouts.drain()
    assert.equal(w.hunting.runIncarnation, run)
    w.gesture.pointerUp({ pointerId: 1 })
    assert.equal(w.hunting.runIncarnation, run + 1)
    w.pump()
    assert.deepEqual(w.scheduler.errors, [])
})

test('the real compositor keeps advancing unrelated motion while a grab defers a build', () => {
    const w = fixture()
    const compositor = createCompositor(w.scheduler, {
        scene: new Group(), camera: new PerspectiveCamera(),
        materials: { getInk: () => ({}), clear() {} }, requestRender() {},
        viewOffset: () => SE3.identity(),
    }, {
        focus: { kindled: null, isFocused: () => false, inFocusedSubtree: () => false },
        createText() { throw new Error('no labels in this witness') },
    })
    w.grab()
    w.move(100, 50)
    const run = w.hunting.runIncarnation
    const before = frameWorldTransform(w.rabbit).position
    for (let i = 0; i < 120; i++) compositor.advance(i * 16)
    assert.equal(w.hunting.runIncarnation, run)
    assert.deepEqual(frameWorldTransform(w.fox).position, [100, 50, 0])
    assert.notDeepEqual(frameWorldTransform(w.rabbit).position, before, 'the reveal horizon must not freeze on deferred hand demand')
    w.gesture.pointerUp({ pointerId: 1 })
    compositor.advance(120 * 16)
    assert.ok(w.hunting.runIncarnation > run)
    assert.deepEqual(w.scheduler.errors, [])
    compositor.dispose()
})
