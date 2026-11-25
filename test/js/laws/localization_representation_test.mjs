// Representation, not policy: one chart crossing (localize.js), and no target ever becomes a
// heading. Which rotation a carried follower keeps is OPEN — this fence must not settle it.
// (id:world-coordinate-foundation-phases, id:laws-free-relations-contract)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SE3, AXIS_X, AXIS_Y, AXIS_Z } from '../../../assets/js/turtling/se3.js'
import { toLocalPose, toWorldPose, toLocalPoint, toWorldPoint } from '../../../assets/js/turtling/localize.js'
import { positionPose } from '../../../assets/js/turtling/laws/candidate.js'

const IDENT = SE3.identity()

// A room is a placement: where the frame's own chart sits in the world.
const translate = (position) => SE3.compose({ rotation: IDENT.rotation, position }, IDENT)
const rooms = {
    identity: IDENT,
    translated: translate([7, -3, 2]),
    rotated: SE3.rotateLocal(IDENT, AXIS_Z, 37),
    tilted: SE3.compose(SE3.compose(translate([2, 5, -1]), SE3.rotateLocal(IDENT, AXIS_Y, 90)),
        SE3.rotateLocal(IDENT, AXIS_X, 23)),
}

const gap = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]))
const sameRotation = (a, b) => [AXIS_X, AXIS_Y, AXIS_Z].every((axis) =>
    gap(a.rotateVec(axis.x, axis.y, axis.z), b.rotateVec(axis.x, axis.y, axis.z)) < 1e-12)

test('the local point is the same chart crossing as the SE3 door, in every room', () => {
    for (const [name, room] of Object.entries(rooms)) {
        for (const world of [[1, 0, 0], [0, 5, 0], [0, 0, -2], [3, -4, 12]]) {
            assert.ok(gap(toLocalPoint(room, world), SE3.unapply(room, world)) < 1e-12, `${name}: local point`)
            assert.ok(gap(toWorldPoint(room, toLocalPoint(room, world)), world) < 1e-12, `${name}: round trip`)
        }
    }
})

test('a FULL pose survives the round trip through any room', () => {
    const pose = SE3.compose(translate([-2, 1, 3]), SE3.rotateLocal(SE3.rotateLocal(IDENT, AXIS_Z, 61), AXIS_X, -14))
    for (const [name, room] of Object.entries(rooms)) {
        const local = toLocalPose(room, pose)
        const back = toWorldPose(room, local)
        assert.ok(gap(back.position, pose.position) < 1e-12, `${name}: position`)
        assert.ok(sameRotation(back.rotation, pose.rotation), `${name}: rotation`)
    }
})

test('a position-only answer converts the point and leaves the rotation alone', () => {
    const stored = SE3.rotateLocal(SE3.rotateLocal(IDENT, AXIS_Z, 37), AXIS_Y, -8)
    for (const [name, room] of Object.entries(rooms)) {
        const world = { transform: () => room }
        const frame = { transform: { deref: () => ({ rotation: stored.rotation, position: [0, 0, 0] }) } }
        for (const at of [[1, 2, 3], [-4, 0, 9]]) {
            const pose = positionPose(world, frame, at)
            assert.ok(gap(pose.position, toLocalPoint(room, at)) < 1e-12, `${name}: the point crosses the chart`)
            assert.equal(pose.rotation, stored.rotation, `${name}: the stored rotation is carried, not re-derived`)
        }
    }
})

test('the target never becomes a heading: moving the wish moves no rotation', () => {
    const world = { transform: () => rooms.tilted }
    // One stored pose, by reference: a carried rotation is the same object, never re-derived.
    const storage = { rotation: SE3.rotateLocal(IDENT, AXIS_Z, 12).rotation, position: [0, 0, 0] }
    const frame = { transform: { deref: () => storage } }
    for (const at of [[0, 0, 0], [9, 0, 0], [0, -7, 4]]) {
        assert.equal(positionPose(world, frame, at).rotation, storage.rotation,
            'a position answer is not a rotation answer')
    }
})
