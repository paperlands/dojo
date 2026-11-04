// Position reads and point consumers share world geometry, not pose authority.
// Identity, observation and publication retain their existing owners.
// (id:world-coordinate-phase-2-reads)
//
// The scene makes world and local genuinely differ: the host is placed at the world point
// (100,20,30) by a world `jmpto`; the marker is offset body-relative by `fw 10` (never a
// coordinate command), so a world read answers the rotated/translated world point while a
// birth-local read answers (10,0,0).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from '../laws/harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { headingOf } from '../../../assets/js/turtling/laws/relations.js'
import { SE3, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const TOL = 1e-9
const near = (a, b) => Math.abs(a - b) <= TOL
const near3 = (a, b) => a.length === b.length && a.every((x, i) => near(x, b[i]))
const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n] }
const IDENT = SE3.identity()

const HOST = SE3.rotateLocal({ rotation: IDENT.rotation, position: [-4, 8, 2] }, AXIS_Z, 40)
const TARGET = [100, 20, 30]   // the host's world position
const LOCAL_PREY = [10, 0, 0]  // the marker's body-relative offset inside the room

const scene = ({ tail = '' }) => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `yaw 90
pitch 30
jmpto ${TARGET.join(' ')}
as room do
  fw 10
  let prey
  jmp -10
  ${tail}
end`, HOST))
    for (let i = 0; i < 24 && !scheduler.done; i++) scheduler.tick(i * 1000)
    assert.deepEqual(scheduler.errors, [], `runtime errors: ${scheduler.errors.map((e) => e.message)}`)
    const room = host.children.get('room')
    return { scheduler, host, room, prey: room.children.get('prey') }
}

const read = (frame, expr) => frame.deps.mathEvaluator.run(frame.deps.mathParser.parse(expr), {})
const readTriple = (frame, prefix) => ['x', 'y', 'z'].map((a) => read(frame, `${prefix}.${a}`))
const boundTriple = (frame, being) => ['x', 'y', 'z'].map((a) => frame.deps.mathEvaluator.resolveSubjectFacet(being, a))

test('dotted and bound-participant reads project the world pose', () => {
    const { room, prey } = scene({  })
    const world = frameWorldTransform(prey).position
    assert.ok(near3(readTriple(room, 'prey'), world), `dotted read ${readTriple(room, 'prey')} != ${world}`)
    assert.ok(near3(boundTriple(room, prey), world), 'a bound participant reads the same world projection')
    assert.ok(!near3(world, LOCAL_PREY), 'the world and local answers genuinely differ')
})

test('the own cursor is global but keeps its private authority', () => {
    const { room } = scene({  })
    const own = ['x', 'y', 'z'].map((a) => read(room, a))
    assert.ok(near3(own, TARGET), `own x/y/z ${own} != world ${TARGET}`)
    assert.ok(near3(room.transform.deref().position, [0, 0, 0]), 'the private cursor storage remains local')
})

test('coordinate projections do not depend on declaring ancestry', () => {
    const { room, prey, host } = scene({})
    assert.ok(near3(readTriple(room, 'prey'), frameWorldTransform(prey).position))
    assert.ok(near3(boundTriple(host, prey), readTriple(room, 'prey')))
    assert.ok(near3(['x', 'y', 'z'].map((a) => read(room, a)), TARGET))
})

test('the complete slice: world reads feed world commands', () => {
    const moved = scene({ tail: 'goto prey.x prey.y prey.z' })
    const preyWorld = frameWorldTransform(moved.prey).position
    assert.ok(near3(frameWorldTransform(moved.room).position, preyWorld),
        `goto(world reads) reaches ${preyWorld}, got ${frameWorldTransform(moved.room).position}`)

    const aimed = scene({ tail: 'faceto prey.x prey.y prey.z' })
    const world = frameWorldTransform(aimed.room)
    const prey = frameWorldTransform(aimed.prey).position
    const dir = unit([prey[0] - world.position[0], prey[1] - world.position[1], prey[2] - world.position[2]])
    assert.ok(near3(world.rotation.rotateVec(1, 0, 0), dir), 'faceto(world reads) aims at the world point')
})

test('origin is the root datum with world coordinates, not a loophole', () => {
    const { room } = scene({  })
    const root = room.parent.parent
    const world = frameWorldTransform(room.parent).position   // `world` is the reader's top-level program
    assert.ok(near3(readTriple(room, 'world'), world), `world stays the top-level program, got ${readTriple(room, 'world')}`)
    const rootWorld = frameWorldTransform(root).position
    const origin = readTriple(room, 'origin')
    const bound = boundTriple(room, root)
    assert.ok(near3(origin, rootWorld), `origin is the root datum in world coordinates, got ${origin} != ${rootWorld}`)
    assert.ok(near3(bound, rootWorld), 'a bound read of the same root identity converges on the same chart')
    assert.ok(near3(origin, bound), 'origin and a bound root read are not two interpretations of one identity')
})

test('orientation keeps its explicit reference convention', () => {
    const { room } = scene({  })
    const localHeading = headingOf(room.transform.deref().rotation)
    assert.ok(near(read(room, 'room.heading'), localHeading), 'room.heading stays the observer-birth-relative orientation')
    assert.ok(!near(read(room, 'world.heading'), localHeading), 'while the top-level program heading is a world orientation')
})
