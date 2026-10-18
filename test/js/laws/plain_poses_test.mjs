// plainPoses is the named projection: ids, quaternion components, position data only.
// No runtime payload or class internals cross; numerics are preserved exactly.
// Run: node --test test/js/laws/plain_poses_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plainPoses } from '../../../assets/js/turtling/laws/verdict.js'

test('projects frame ids and quaternion components without touching payload', () => {
    const cycle = { name: 'cache' }
    cycle.self = cycle
    const rotation = Object.create({ w: 1, x: 0, y: 0, z: 0 })
    Object.defineProperty(rotation, 'cache', { get() { throw new Error('cache was read') } })
    rotation.handle = cycle
    const pose = { rotation, position: [5, 0, 0], scale: [9, 9, 9] }
    const out = plainPoses([{ frame: { id: 7 }, pose }])
    assert.equal(out.length, 1)
    assert.equal(out[0].frame, 7)
    assert.notEqual(out[0].pose, pose, 'the pose is projected, not aliased')
    assert.notEqual(out[0].pose.rotation, rotation)
    assert.deepEqual(Object.keys(out[0].pose).sort(), ['position', 'rotation'])
    assert.deepEqual(out[0].pose.rotation, { w: 1, x: 0, y: 0, z: 0 })
    assert.equal('cache' in out[0].pose.rotation, false)
    assert.equal('handle' in out[0].pose.rotation, false)
    assert.equal('scale' in out[0].pose, false)
})

test('keeps NaN, -0, Infinity, sparse holes and missing components exactly', () => {
    const position = [NaN, , Infinity]
    const rotation = { w: NaN, x: -0, y: Infinity }
    const out = plainPoses([{ frame: 3, pose: { rotation, position } }])[0].pose
    assert.equal(out.position.length, 3)
    assert.ok(Number.isNaN(out.position[0]))
    assert.equal(1 in out.position, false, 'the hole stays a hole')
    assert.equal(out.position[2], Infinity)
    assert.ok(Number.isNaN(out.rotation.w))
    assert.ok(Object.is(out.rotation.x, -0))
    assert.equal(out.rotation.y, Infinity)
    assert.equal('z' in out.rotation, false, 'an absent component stays absent')
    assert.deepEqual(Object.keys(out.rotation).sort(), ['w', 'x', 'y'])
})

test('malformed/null values and non-array candidates pass through unchanged', () => {
    const refused = { frame: 4, world: [0, 0, 0] }
    assert.equal(plainPoses(refused), refused)
    assert.deepEqual(plainPoses([{ frame: 1, pose: { rotation: 7, position: 'bad' } }])[0].pose,
        { rotation: 7, position: 'bad' })
    assert.deepEqual(plainPoses([{ frame: 1, pose: { rotation: null, position: null } }])[0].pose,
        { rotation: null, position: null })
    assert.deepEqual(plainPoses([{ frame: 1, pose: null }])[0].pose, null)
    assert.equal(plainPoses(null), null)
    assert.equal(plainPoses(undefined), null)
})
