// EXPERIMENT 2 — LABORATORY INTEGRATION (the injected relation, through the
// existing admission/publication seam). (id:laws-experiment-2-midpoint)
//
// This is NOT source-supported syntax. The midpoint relation is injected by the
// test; the scheduler knows nothing about it. What is exercised is the seam:
// `motionAdmission` proposes a component, `publish` commits every pose with one
// revision and one notify — so no watcher sees a mixed configuration.
//
// Run: node --test test/js/laws/midpoint_lab_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, drive, fork, at, world, nz, IDENT } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { componentHandFirst } from "./midpoint_ref.mjs"

// World positions of the three injected identities, read once.
const readWorld = (scheduler) => ({
    a: [...frameWorldTransform(scheduler.root.children.get("a")).position],
    b: [...frameWorldTransform(scheduler.root.children.get("b")).position],
    m: [...frameWorldTransform(scheduler.root.children.get("m")).position],
})


const localAt = (local) => ({ rotation: IDENT.rotation, position: [local[0], local[1], local[2]] })

// The injected relation's responder. `policy` chooses the movement policy.
// `record` keeps an ordered trace of every admission:
//   actor · requested world target · the whole proposed component (world).
function midpointResponder(record, policy) {
    const names = ["a", "b", "m"]
    return ({ requested, frame }) => {
        // The scheduler is reached through the registry's root via the parent.
        const root = frame.parent
        const origins = {
            a: [...root.children.get("a").origin.position],
            b: [...root.children.get("b").origin.position],
            m: [...root.children.get("m").origin.position],
        }
        const current = {
            a: [...frameWorldTransform(root.children.get("a")).position],
            b: [...frameWorldTransform(root.children.get("b")).position],
            m: [...frameWorldTransform(root.children.get("m")).position],
        }
        const who = frame.name
        const to = [
            origins[who][0] + requested.position[0],
            origins[who][1] + requested.position[1],
            origins[who][2] + requested.position[2],
        ]
        const out = policy === "component-hand-first"
            ? componentHandFirst(current, { who, to })
            : { ok: true, policy, poses: current, met: false, moved: false, blocked: true, reason: "the other two are held" }

        if (record) record.push({
            from: { a: [...current.a], b: [...current.b], m: [...current.m] },
            actor: who, requested: to, met: out.met, blocked: out.blocked,
            poses: { a: [...out.poses.a], b: [...out.poses.b], m: [...out.poses.m] },
        })
        if (out.blocked) return { accepted: false }

        const writerLocal = [
            out.poses[who][0] - origins[who][0],
            out.poses[who][1] - origins[who][1],
            out.poses[who][2] - origins[who][2],
        ]
        const component = names.filter((n) => n !== who).map((n) => ({
            frame: root.children.get(n),
            transform: localAt([
                out.poses[n][0] - origins[n][0],
                out.poses[n][1] - origins[n][1],
                out.poses[n][2] - origins[n][2],
            ]),
        }))
        return { accepted: true, transform: { rotation: requested.rotation, position: writerLocal }, component }
    }
}

// a at origin 0, b at origin 10, m at origin 5. a and b wait; m walks to world 8.
const seat = (scheduler) => {
    scheduler.hotSwapChild("a", fork("a", "wait 1\nwait 1", at(0)))
    scheduler.hotSwapChild("b", fork("b", "wait 1\nwait 1", at(10)))
    scheduler.hotSwapChild("m", fork("m", "goto 3 0\nwait 1", at(5)))
}

test("L1 component hand-first: one commit moves the whole relation", () => {
    const record = []
    const scheduler = buildWorld({ admit: midpointResponder(record, "component-hand-first"), settledOnly: false })
    const samples = []
    const sample = () => {
        const w = readWorld(scheduler)
        samples.push([w.a[0], w.b[0], w.m[0]])
    }
    seat(scheduler)
    sample()
    drive(scheduler, { after: sample })

    const before = record[0]
    assert.equal(before.actor, "m")
    assert.deepEqual(before.requested, [8, 0, 0], "the hand asked for world 8")
    assert.equal(before.met, true)

    const after = readWorld(scheduler)
    assert.deepEqual(nz(after.a), [3, 0, 0], "A followed by the same displacement")
    assert.deepEqual(nz(after.b), [13, 0, 0], "B followed by the same displacement")
    assert.deepEqual(nz(after.m), [8, 0, 0], "M met the hand")
    assert.equal(2 * after.m[0], after.a[0] + after.b[0], "2M = A + B still holds")

    // No mixed configuration: the relation holds at every accepted sample, and
    // no sample shows one member at its new value beside another at its old one.
    for (const [a, b, m] of samples) {
        assert.ok(Math.abs(2 * m - a - b) < 1e-9, `half a component: ${JSON.stringify([a, b, m])}`)
    }
    assert.ok(samples.some(([a, b, m]) => a === 3 && b === 13 && m === 8), "the component landed")
    assert.deepEqual(record[0].from, { a: [0, 0, 0], b: [10, 0, 0], m: [5, 0, 0] },
        "the admission saw the accepted pre-state")
})

test("L2 the current default on the same world blocks the request", () => {
    const record = []
    const scheduler = buildWorld({ admit: midpointResponder(record, "request-only"), settledOnly: false })
    seat(scheduler)
    drive(scheduler)

    assert.equal(record[0].blocked, true)
    assert.equal(record[0].met, false)
    const after = readWorld(scheduler)
    assert.deepEqual(nz(after.a), [0, 0, 0], "nothing else moved either")
    assert.deepEqual(nz(after.b), [10, 0, 0])
    assert.deepEqual(nz(after.m), [5, 0, 0], "the midpoint did not follow the hand")
    assert.equal(world("m", scheduler)[0], 5)
})
