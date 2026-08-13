// The follow camera — track mode's placement law.
// Run with: node --test test/js/stage/follow_test.mjs
//
// Guards the bug this was rebuilt for. The old follow ADDED a delta each head
// event, remembering the subject as the turtle's head MESH. An edit replays the
// walk from the start, and the mesh restarts at its spawn pose — so the sum no
// longer cancelled and the camera walked one whole program-extent per edit.
// Measured on hardware before the fix: four edits that all END at the same point
// left the camera at (400,−400,500) instead of (100,−100,500), receding from its
// own target 500 → 656 units and skewing the view oblique. The drawing shrank as
// the child typed.
//
// The cure is [[id:eye-view-pipeline]]'s rule — place from the pose, never integrate
// deltas — reaching the last relative writer in the render path. Which makes the
// property below the whole of it: only the ENDPOINT matters. How the subject got
// there, and how many times it has got there, cannot move the camera.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { followPosition } from "../../../assets/js/turtling/view.js"

// Walk a whole sequence of subject positions, as one run's head events do.
// Returns the resting {camera, target} — the target is always the last subject.
function walk(camera, target, subjects) {
    for (const s of subjects) {
        camera = followPosition(camera, target, s)
        target = s
    }
    return { camera, target }
}

const standoff = (c, t) => [c[0] - t[0], c[1] - t[1], c[2] - t[2]]

describe("follow: the standoff is the hand's, and it is kept", () => {
    test("a subject that has not moved moves nothing", () => {
        assert.deepEqual(followPosition([0, 0, 500], [0, 0, 0], [0, 0, 0]), [0, 0, 500])
    })

    test("the camera and its aim travel together", () => {
        // Whatever framing the child orbited to, following preserves it exactly.
        const camera = [30, -40, 500], target = [0, 0, 0]
        const next = followPosition(camera, target, [100, -100, 0])
        assert.deepEqual(standoff(next, [100, -100, 0]), standoff(camera, target))
    })

    test("an orbited standoff survives a long walk", () => {
        const camera = [120, 60, 300], target = [0, 0, 0]
        const subjects = Array.from({ length: 50 }, (_, i) => [i * 7, -i * 3, i])
        const rest = walk(camera, target, subjects)
        assert.deepEqual(standoff(rest.camera, rest.target), standoff(camera, target))
    })
})

describe("follow: only the endpoint matters", () => {
    const camera = [0, 0, 500], target = [0, 0, 0]
    const end = [100, -100, 0]

    test("two different paths to the same place rest the camera in the same place", () => {
        // `fw 100 / rt 90 / fw 100` and `fw 50 / fw 50 / rt 90 / fw 100` are the
        // same journey to the eye. They were NOT the same to the old follow.
        const short = walk(camera, target, [[100, 0, 0], end])
        const long = walk(camera, target, [[50, 0, 0], [100, 0, 0], [100, -50, 0], end])
        assert.deepEqual(short.camera, long.camera)
        assert.deepEqual(short.camera, [100, -100, 500])
    })

    test("REGRESSION — replaying a walk never moves the camera again", () => {
        // THE EDIT. Every re-eval replays the whole walk; the camera must rest
        // where it already rested. The old code added (100,−100,0) per replay.
        const subjects = [[100, 0, 0], end]
        let rest = walk(camera, target, subjects)
        const afterFirst = rest.camera
        for (let edit = 0; edit < 20; edit++) {
            rest = walk(rest.camera, rest.target, subjects)
            assert.deepEqual(rest.camera, afterFirst,
                `edit ${edit + 1} moved the camera — the drift is back`)
        }
        assert.deepEqual(rest.camera, [100, -100, 500])
    })

    test("a replay that starts from the subject's spawn is still still", () => {
        // The precise shape of the old failure: the run restarts at spawn (0,0,0),
        // which is NOT where the subject rests. Reading the target instead of the
        // head means the restart costs nothing.
        const subjects = [[0, 0, 0], [100, 0, 0], end]
        const first = walk(camera, target, subjects)
        const second = walk(first.camera, first.target, subjects)
        assert.deepEqual(second.camera, first.camera)
    })
})
