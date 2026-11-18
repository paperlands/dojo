// The effective view of one rendered frame: frozen data, two pure helpers, and
// the frame fan. Run with: node --test test/js/host/view_snapshot_test.mjs
// (id:host-embedding-slice-1-view)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { PerspectiveCamera, Vector3 } from '../../../assets/js/utils/three-entry.js'
import {
    worldToViewOf, createViewSnapshot, projectPoint, unprojectRay,
} from '../../../assets/js/turtling/view_snapshot.js'
import { createViewFan } from '../../../assets/js/turtling/view_fan.js'
import { Group, Matrix4, Raycaster, Vector2 } from '../../../assets/js/utils/three-entry.js'
import { SE3, AXIS_X, AXIS_Z } from '../../../assets/js/turtling/se3.js'
import { createCompositor } from '../../../assets/js/turtling/compositor.js'
import { createFocus } from '../../../assets/js/turtling/focus.js'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { eyeCameraPose } from '../../../assets/js/turtling/view.js'
import { buildWorld, fork } from '../laws/harness.mjs'
import { headlessWorld, projectPoint as publicProjectPoint, unprojectRay as publicUnprojectRay } from './harness.mjs'

const W = 320
const H = 240
const RECT = { left: 40, top: 20, width: W, height: H, right: 40 + W, bottom: 20 + H }

function camera({ position = [0, 0, 500] } = {}) {
    const c = new PerspectiveCamera(60, W / H, 0.1, 10000)
    c.position.set(...position)
    c.lookAt(0, 0, 0)
    c.updateMatrixWorld()
    c.updateProjectionMatrix()
    return c
}

function viewOf(overrides = {}) {
    const c = camera()
    return createViewSnapshot({
        status: 'ready', frame: 7, time: 1234,
        width: W, height: H, dpr: 2, rect: RECT,
        worldToView: worldToViewOf(c, null),
        projection: c.projectionMatrix,
        ...overrides,
    })
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const near = (a, b, eps = 1e-6) => Math.abs(a[0] - b[0]) < eps
    && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps

describe('units and composition', () => {
    test('the origin projects to the centre of the content box, in CSS content px', () => {
        const p = projectPoint(viewOf(), [0, 0, 0])
        assert.ok(p)
        assert.ok(close(p.x, W / 2), `x ${p.x}`)
        assert.ok(close(p.y, H / 2), `y ${p.y}`)
    })

    test('the client box offset is not baked into the point', () => {
        const shifted = viewOf({ rect: { ...RECT, left: 401, top: 202, right: 401 + W, bottom: 202 + H } })
        const p = projectPoint(shifted, [0, 0, 0])
        assert.ok(close(p.x, W / 2) && close(p.y, H / 2))
        assert.equal('rect' in shifted, false, 'client placement is not a rendering fact')
    })

    test('worldToView carries the reframe exactly once', () => {
        const c = camera()
        const plain = projectPoint(viewOf(), [10, 0, 0])
        // scene = reframe · world: a −10 shift makes world 20 land where 10 did.
        const moved = createViewSnapshot({
            status: 'ready', width: W, height: H, rect: RECT,
            worldToView: worldToViewOf(c, {
                rotation: { x: 0, y: 0, z: 0, w: 1 }, position: [-10, 0, 0],
            }),
            projection: c.projectionMatrix,
        })
        const shifted = projectPoint(moved, [20, 0, 0])
        assert.ok(plain && shifted)
        assert.ok(close(plain.x, shifted.x) && close(plain.y, shifted.y))
    })

    test('the snapshot is the canonical small shape', () => {
        const v = viewOf()
        assert.deepEqual(Object.keys(v).sort(), [
            'dpr', 'frame', 'height', 'kind', 'projection', 'reason',
            'status', 'time', 'width', 'worldToView',
        ])
    })
})

describe('status is measured', () => {
    for (const status of ['collapsed', 'transformed', 'unavailable']) {
        test(`${status}: every helper refuses`, () => {
            const v = viewOf({ status, width: 0, height: 0 })
            assert.equal(v.status, status)
            assert.equal(projectPoint(v, [0, 0, 0]), null)
            assert.equal(unprojectRay(v, 10, 10), null)
            assert.equal(v.worldToView, null)
            assert.equal(v.projection, null)
        })
    }
    test('a zero box cannot project even when it claims ready', () => {
        const v = viewOf({ width: 0, height: 0 })
        assert.equal(projectPoint(v, [0, 0, 0]), null)
        assert.equal(unprojectRay(v, 0, 0), null)
    })
})

describe('clip and sparse input', () => {
    test('behind the eye is null', () => {
        assert.equal(projectPoint(viewOf(), [0, 0, 600]), null)
    })
    test('past the far plane is null', () => {
        assert.equal(projectPoint(viewOf(), [0, 0, -20000]), null)
    })
    test('at the eye is null', () => {
        assert.equal(projectPoint(viewOf(), [0, 0, 500]), null)
    })
    test('beyond the frame is null', () => {
        assert.equal(projectPoint(viewOf(), [100000, 0, 0]), null)
    })
    test('non-finite and short points are null', () => {
        const v = viewOf()
        assert.equal(projectPoint(v, [NaN, 0, 0]), null)
        assert.equal(projectPoint(v, [0, Infinity, 0]), null)
        assert.equal(projectPoint(v, [0, 0]), null)
        assert.equal(projectPoint(v, null), null)
        assert.equal(projectPoint(v, { x: 0, y: 0, z: 0 }), null)
        assert.equal(unprojectRay(v, NaN, 10), null)
        assert.equal(unprojectRay(v, 10, Infinity), null)
        assert.equal(unprojectRay(v, -1, 10), null)
        assert.equal(unprojectRay(v, W + 1, 10), null)
    })
    test('a missing matrix refuses instead of inventing a projection', () => {
        const v = viewOf({ worldToView: null })
        assert.equal(v.worldToView, null)
        assert.equal(projectPoint(v, [0, 0, 0]), null)
        assert.equal(unprojectRay(v, 1, 1), null)
    })
})

describe('project and unproject agree', () => {
    test('the ray through the centre is the eye looking at the origin', () => {
        const ray = unprojectRay(viewOf(), W / 2, H / 2)
        assert.ok(ray)
        assert.ok(near(ray.origin, [0, 0, 500]))
        assert.ok(near(ray.direction, [0, 0, -1]), `direction ${ray.direction}`)
    })

    test('a point on the ray projects back to the same pixel', () => {
        const v = viewOf()
        for (const [x, y] of [[0, 0], [W, H], [W / 3, H / 4], [W - 1, 3]]) {
            const ray = unprojectRay(v, x, y)
            assert.ok(ray, `ray at ${x},${y}`)
            const point = [
                ray.origin[0] + ray.direction[0] * 400,
                ray.origin[1] + ray.direction[1] * 400,
                ray.origin[2] + ray.direction[2] * 400,
            ]
            const back = projectPoint(v, point)
            assert.ok(back, `project at ${x},${y}`)
            assert.ok(close(back.x, x) && close(back.y, y), `${x},${y} -> ${back.x},${back.y}`)
        }
    })

    test('a reframe unwraps the ray and the eye into the consumer world', () => {
        const c = camera()
        const v = createViewSnapshot({
            status: 'ready', width: W, height: H, rect: RECT,
            worldToView: worldToViewOf(c, {
                rotation: { x: 0, y: 0, z: 0, w: 1 }, position: [10, 0, 0],
            }),
            projection: c.projectionMatrix,
        })
        // scene = reframe · world, so the consumer-world eye sits at R⁻¹·C.
        const ray = unprojectRay(v, W / 2, H / 2)
        assert.ok(near(ray.origin, [-10, 0, 500]))
        const back = projectPoint(v, [-10, 0, 0])
        assert.ok(close(back.x, W / 2) && close(back.y, H / 2))
    })
})

describe('a stored view cannot move', () => {
    test('the view is deeply frozen plain data', () => {
        const v = viewOf()
        assert.ok(Object.isFrozen(v))
        assert.ok(Object.isFrozen(v.projection))
        assert.ok(Object.isFrozen(v.worldToView))
        assert.throws(() => { v.status = 'collapsed' })
        assert.equal(v.kind, 'view')
        assert.equal(v.frame, 7)
        assert.equal(v.time, 1234)
        assert.equal(v.dpr, 2)
    })

    test('later camera and reframe changes do not touch an old view', () => {
        const c = camera()
        const reframe = { rotation: { x: 0, y: 0, z: 0, w: 1 }, position: [0, 0, 0] }
        const v = createViewSnapshot({
            status: 'ready', width: W, height: H, rect: RECT,
            worldToView: worldToViewOf(c, reframe), projection: c.projectionMatrix,
        })
        const before = projectPoint(v, [10, 0, 0])
        c.position.set(200, 0, 500)
        c.lookAt(0, 0, 0)
        c.updateMatrixWorld()
        reframe.position[0] = 900
        assert.deepEqual(projectPoint(v, [10, 0, 0]), before)
    })

    test('a stored view stays usable after its fan is cleared', () => {
        const v = viewOf()
        const fan = createViewFan()
        const stop = fan.watch(() => {})
        stop()
        fan.clear()
        assert.ok(projectPoint(v, [0, 0, 0]))
        assert.ok(unprojectRay(v, W / 2, H / 2))
    })

    test('a JSON round trip keeps the view usable', () => {
        const v = viewOf()
        const restored = JSON.parse(JSON.stringify(v))
        assert.equal(projectPoint(restored, [0, 0, 0]).x, projectPoint(v, [0, 0, 0]).x)
        const ray = unprojectRay(restored, W / 2, H / 2)
        assert.ok(near(ray.direction, [0, 0, -1]))
        const cloned = structuredClone(v)
        assert.equal(cloned.kind, 'view')
        assert.equal(projectPoint(cloned, [10, 0, 0]).x, projectPoint(v, [10, 0, 0]).x)
    })

    test('before a first frame the view is unproven, not painted', () => {
        const v = createViewSnapshot({
            status: 'ready', width: W, height: H, rect: RECT,
            worldToView: worldToViewOf(camera(), null), projection: camera().projectionMatrix,
        })
        assert.equal(v.frame, null)
        assert.equal(v.time, null)
    })
})

describe('the composition order is load-bearing', () => {
    test('the actual compositor supplies M⁻¹·E⁻¹ to the snapshot', () => {
        const scheduler = buildWorld({ capacity: 512, clock: () => 0 })
        scheduler.hotSwapChild('host', fork('host', 'as eye do\n  fw 100\n  rt 90\nend'))
        const c = camera(), focus = createFocus(scheduler)
        const offset = SE3.rotateLocal(SE3.identity(), AXIS_Z, 30)
        const compositor = createCompositor(scheduler, {
            scene: new Group(), camera: c, materials: { clear() {} },
            requestRender() {}, viewOffset: () => offset,
        }, { focus, createText: () => ({}) })
        compositor.advance(0)
        const eye = [...scheduler.registry.values()].find(f => f.isLens)
        focus.light = { kindled: eye.address, warm: [] }
        compositor.advance(16)
        const eyeInverse = SE3.invert(eyeCameraPose(frameWorldTransform(eye)))
        const world = SE3.apply(SE3.invert(eyeInverse), SE3.apply(offset, [20, 10, 0]))
        const scenePoint = SE3.apply(SE3.invert(offset), SE3.apply(eyeInverse, world))
        const native = new Vector3(...scenePoint).project(c)
        const snapshot = createViewSnapshot({
            status: 'ready', width: W, height: H,
            worldToView: worldToViewOf(c, compositor.viewReframe()), projection: c.projectionMatrix,
        })
        const actual = projectPoint(snapshot, world)
        assert.ok(actual)
        assert.ok(close(actual.x, (native.x * 0.5 + 0.5) * W))
        assert.ok(close(actual.y, (0.5 - native.y * 0.5) * H))
        const wrong = new Vector3(...SE3.apply(eyeInverse, SE3.apply(SE3.invert(offset), world))).project(c)
        assert.ok(!close(native.x, wrong.x) || !close(native.y, wrong.y), 'control sees swapped factors')
        compositor.dispose()
    })
})

describe('the frame fan', () => {
    test('delivers in installation order and off is immediate and idempotent', () => {
        const fan = createViewFan()
        const seen = []
        const stopA = fan.watch((p) => seen.push(['a', p.n]))
        fan.watch((p) => seen.push(['b', p.n]))
        fan.notify({ n: 1 })
        stopA()
        stopA()
        fan.notify({ n: 2 })
        assert.deepEqual(seen, [['a', 1], ['b', 1], ['b', 2]])
        assert.equal(fan.size, 1)
    })

    test('registration wakes exactly one frame', () => {
        let wakes = 0
        const fan = createViewFan(() => wakes++)
        fan.watch(() => {})
        fan.watch(() => {})
        assert.equal(wakes, 2, 'one wake per registration, not a loop')
    })

    test('a watcher removed during the fan hears no later turn', () => {
        const fan = createViewFan()
        const seen = []
        let stopB = () => {}
        fan.watch(() => { seen.push('a'); stopB() })
        stopB = fan.watch(() => seen.push('b'))
        fan.notify({})
        fan.notify({})
        assert.deepEqual(seen, ['a', 'a'])
    })

    test('a watcher added during the fan waits for the next breath', () => {
        const fan = createViewFan()
        const seen = []
        fan.watch(() => {
            seen.push('a')
            if (seen.length === 1) fan.watch(() => seen.push('late'))
        })
        fan.notify({})
        assert.deepEqual(seen, ['a'])
        fan.notify({})
        assert.deepEqual(seen, ['a', 'a', 'late'])
    })

    test('clearing inside a callback revokes its siblings immediately', () => {
        const fan = createViewFan()
        const seen = []
        fan.watch(() => { seen.push('first'); fan.clear() })
        fan.watch(() => seen.push('second'))
        fan.notify({})
        assert.deepEqual(seen, ['first'])
        assert.equal(fan.size, 0)
    })

    test('one throwing callback never stops its siblings; faults surface together', () => {
        const fan = createViewFan()
        const seen = []
        fan.watch(() => { throw new Error('first') })
        fan.watch(() => seen.push('middle'))
        fan.watch(() => { throw new Error('last') })
        assert.throws(() => fan.notify({}), (error) => {
            assert.ok(error instanceof AggregateError)
            assert.deepEqual(error.errors.map((e) => e.message), ['first', 'last'])
            return true
        })
        assert.deepEqual(seen, ['middle'])
    })

    test('a single fault surfaces as itself, not wrapped', () => {
        const fan = createViewFan()
        fan.watch(() => { throw new Error('only') })
        assert.throws(() => fan.notify({}), /only/)
    })

    test('a non-function observer is refused', () => {
        assert.throws(() => createViewFan().watch(null), TypeError)
    })
})


describe('representation and public composition', () => {
    test('native rays still project at clip edges after nonidentity camera and frame changes', () => {
        for (let i = 0; i < 24; i++) {
            const c = camera({ position: [120 * Math.sin(i), 80 * Math.cos(i), 600] })
            const reframe = SE3.rotateLocal(SE3.rotateLocal(SE3.identity(), AXIS_Z, i * 13), AXIS_X, i * 7)
            reframe.position = [90, i, 50]
            const undo = SE3.invert(reframe)
            const view = viewOf({ worldToView: worldToViewOf(c, reframe), projection: c.projectionMatrix })
            for (const [x, y] of [[0, 0], [W, H], [W * 0.27, H * 0.63]]) {
                const native = new Raycaster()
                native.setFromCamera(new Vector2(x / W * 2 - 1, 1 - y / H * 2), c)
                const origin = SE3.apply(undo, native.ray.origin.toArray())
                const direction = undo.rotation.rotateVec(...native.ray.direction.toArray())
                const ray = unprojectRay(view, x, y)
                assert.ok(near(ray.origin, origin) && near(ray.direction, direction))
                const point = origin.map((v, k) => v + 250 * direction[k])
                const pixel = projectPoint(view, point)
                assert.ok(pixel, `pose ${i}, pixel ${x},${y}`)
                assert.ok(close(pixel.x, x) && close(pixel.y, y))
            }
        }
    })

    test('plain matrices are accepted without retaining their arrays', () => {
        const original = viewOf()
        const matrix = [...original.worldToView], lens = [...original.projection]
        const view = viewOf({ worldToView: matrix, projection: lens })
        matrix[0] = 999
        lens[0] = 999
        assert.deepEqual(projectPoint(view, [10, 0, 0]), projectPoint(original, [10, 0, 0]))
    })

    test('missing, sparse, non-finite and singular matrices cannot produce a ray', () => {
        for (const matrix of [Array(16), Array(15).fill(0), Array(16).fill(NaN), new Matrix4().makeScale(0, 1, 1)]) {
            const view = viewOf({ worldToView: matrix })
            assert.equal(unprojectRay(view, W / 2, H / 2), null)
        }
        assert.equal(projectPoint(viewOf(), Array(3)), null)
        assert.equal(projectPoint(viewOf(), [0, 0, 499.95]), null, 'inside the near plane')
        assert.equal(worldToViewOf(camera(), { position: [0, 0, 0] }), null)
    })

    test('the package-facing door exports helpers and preserves observation lifetime', async () => {
        assert.equal(publicProjectPoint, projectPoint)
        assert.equal(publicUnprojectRay, unprojectRay)
        const { world, turtle } = headlessWorld()
        const view = viewOf(), seen = []
        let wakes = 0
        const fan = createViewFan(() => wakes++)
        turtle.lastView = () => view
        turtle.onViewFrame = fn => fan.watch(fn)
        turtle.requestRender = () => wakes++
        const dispose = turtle.dispose.bind(turtle)
        turtle.dispose = () => { fan.clear(); dispose() }
        const off = world.onFrame(frame => seen.push(frame.view))
        await (await world.play('fw 1')).finished
        fan.notify(Object.freeze({ view }))
        await (await world.play('fw 2')).finished
        fan.notify(Object.freeze({ view }))
        world.requestFrame()
        assert.equal(wakes, 2)
        assert.deepEqual(seen, [view, view], 'world observers survive replacement')
        assert.deepEqual(world.view.project([10, 0, 0]), publicProjectPoint(view, [10, 0, 0]))
        assert.deepEqual(world.view.unproject(160, 120), publicUnprojectRay(view, 160, 120))
        world.dispose()
        fan.notify(Object.freeze({ view }))
        off(); off()
        assert.equal(seen.length, 2)
        assert.equal(world.view.snapshot(), null)
        assert.equal(world.view.project([0, 0, 0]), null)
        assert.equal(world.view.unproject(160, 120), null)
        world.requestFrame()
        assert.equal(wakes, 2)
        assert.ok(publicProjectPoint(structuredClone(view), [10, 0, 0]))
    })
})
