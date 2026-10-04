// The CI COMPOSITION RUNG.
//
// ONE behavioural sequence: construct → agree → grab → drag → revise → obstruct → lose a
// reading. It exercises the PRODUCTION projection (`point_state`) and the REAL gesture kernel
// against the real scheduler — no test-side reconstruction of the point state, no simulated
// request path, and the same whole-law gate the scheduler runs.
//
// It does NOT exercise DOM listeners, WebGL projection or painting: those are the browser
// rung's obligation, and this rung does not claim them.
// (id:laws-decl-point-agent, id:laws-activation-order, D058)
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, worldTransform, lawWorld } from "../../../assets/js/turtling/scheduler.js"
import { createGesture } from "../../../assets/js/turtling/laws/gesture.js"
import { pointStateOf } from "../../../assets/js/turtling/laws/point_state.js"
import { constraintsView, bindWorld } from "../../../assets/js/turtling/laws/authored.js"
import { bindLaw } from "../../../assets/js/turtling/laws/replacement.js"
import { stateOf } from "../../../assets/js/turtling/laws/constraints.js"
import { lawViolation } from "../../../assets/js/turtling/laws/verdict.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const byName = (scheduler, name) => [...scheduler.registry.values()].find((f) => f.name === name)
const world = (frame) => { const p = frameWorldTransform(frame).position; return [p[0], p[1], p[2]] }
const pixel = (at) => ({ x: at[0] * 100, y: at[1] * 100 })
const onCircle = (deg, r) => [r * Math.cos(deg * Math.PI / 180), r * Math.sin(deg * Math.PI / 180), 0]

// MEASUREMENT, at the accepted configuration: the SAME whole-law gate the scheduler runs.
const measurement = (scheduler, overrides = new Map()) =>
    lawViolation(scheduler.laws.active(), overrides, scheduler.registry, lawWorld)

// The rig: deterministic projection/rays, and the REAL requestMotion. The gesture kernel is
// the shipped one, so this rung exercises the behaviour the shell drives.
const rig = (scheduler, framesOf) => {
    const seen = { requests: [], woke: 0, captured: null }
    const gesture = createGesture({
        candidates: () => framesOf().map((frame) => ({ name: frame.name, frame })),
        anchorOf: (frame) => frameWorldTransform(frame),
        birthOf: (frame) => worldTransform(frame),
        registered: (frame) => scheduler.registry.get(frame.id) === frame,
        // The PRODUCTION offer predicate — the same thing the display's pointer path reads,
        // not a lookalike. A pinned or unavailable point must not acquire capture. (D058)
        canTouch: (frame) => pointStateOf(frame, scheduler).interaction.offered,
        requestMotion: (frame, pose, revision) => {
            seen.requests.push({ frame, pose })
            return scheduler.requestMotion(frame, pose, revision)
        },
        revision: () => scheduler.motionRevision,
        wake: () => { seen.woke++ },
        project: (at) => pixel(at),
        rayAt: (x, y) => ({ origin: [x / 100, y / 100, 5], direction: [0, 0, -1] }),
        facing: () => [0, 0, -1],
        capture: ({ pointerId }) => { seen.captured = pointerId },
        release: () => { seen.captured = null },
        setControls: () => {},
        controlsEnabled: () => true,
        onReadout: () => {},
        // The PRODUCTION locus — the same projection the display reads. (D058)
        locusOf: (frame) => pointStateOf(frame, scheduler).locus,
        slop: 0,
    })
    return {
        seen,
        down: (at) => gesture.pointerDown({ pointerId: 1, ...pixel(at) }),
        move: (at) => gesture.pointerMove({ pointerId: 1, ...pixel(at) }),
        up: () => gesture.pointerUp({ pointerId: 1 }),
    }
}

test("CI composition rung: construct, agree, grab, drag, then a lawful source revision", () => {
    // The revision is a SECOND declaration, staged behind a `wait` — so the drag below happens
    // between the initial construction and the revision, in one run.
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet distance(A, origin) = 5\nlet A.z = 0\nwait 1\nlet distance(A, origin) = 3"))
    const gestures = rig(scheduler, () => [byName(scheduler, "A")].filter(Boolean))
    const story = {}

    drive(scheduler, { maxTicks: 60, after: (i) => {
        const A = byName(scheduler, "A")
        if (!A) return
        if (i === 0) {
            // 1-2. CONSTRUCT a supported sphere/plane circle, and confirm measurement,
            //      displayed locus and offered movement AGREE.
            story.constructed = host.error ?? null
            const state = pointStateOf(A, scheduler)
            story.measured = measurement(scheduler).status
            story.locus = state.locus?.kind
            story.radius = state.locus?.radius
            story.offered = state.interaction.offered
            story.dof = state.dof

            // 3. GRAB WITHOUT DISPLACEMENT: claimed, no jump, no unnecessary revision.
            const start = world(A)
            story.claimed = gestures.down(start).claimed
            story.rev0 = scheduler.motionRevision
            gestures.move(start)
            story.afterZeroDelta = world(A)
            story.revAfterGrab = scheduler.motionRevision

            // 4. DRAG through the REAL kernel: every accepted configuration remains lawful.
            story.dragged = []
            for (const deg of [30, 60, 90]) {
                gestures.move(onCircle(deg, 5))
                story.dragged.push({ at: world(A), status: measurement(scheduler).status })
            }
            gestures.up()
            // The count IMMEDIATELY before the source revision, so the assertion below tests
            // the revision's OWN increment — not the drags that preceded it.
            story.revAfterDrag = scheduler.motionRevision
        }
        if (i === 1) {
            // 5. THE LAWFUL SOURCE REVISION has landed: geometry, locus, owner and revision agree.
            const state = pointStateOf(A, scheduler)
            story.revised = {
                at: world(A), locus: state.locus?.kind, radius: state.locus?.radius,
                owner: scheduler.laws.active().find((l) => l.feature === "distance")?.owner?.line,
                revision: scheduler.motionRevision, status: measurement(scheduler).status,
            }
        }
    } })

    // 1-2. Construction, truth and observation tell one story.
    assert.equal(story.constructed, null, "the construction is supported")
    assert.equal(story.measured, "valid", "every obligation measures valid")
    assert.equal(story.locus, "circle", "the displayed locus is the named circle")
    assert.ok(Math.abs(story.radius - 5) < 1e-6, "at the sphere's radius")
    assert.equal(story.offered, true, "the point is offered")
    assert.equal(story.dof, 1, "a circle is one degree of freedom")

    // 3. A grab without displacement is inert.
    assert.equal(story.claimed, true, "the offered point is claimed")
    assert.deepEqual(story.afterZeroDelta, [5, 0, 0], "no jump")
    assert.equal(story.revAfterGrab, story.rev0, "no unnecessary revision")

    // 4. Every accepted drag configuration is STILL lawful, and the point moved.
    assert.ok(story.dragged.some((d) => Math.abs(d.at[0] - 5) > 1e-6), "the drag moved the point")
    for (const step of story.dragged) {
        assert.equal(step.status, "valid", `the accepted configuration at ${step.at} is lawful`)
        assert.ok(Math.abs(Math.hypot(step.at[0], step.at[1]) - 5) < 1e-6, "and it stays on the sphere")
        assert.ok(Math.abs(step.at[2]) < 1e-6, "and in the plane")
    }

    // 5. The revision moved the geometry, the locus, the owner and the revision together.
    assert.ok(Math.abs(Math.hypot(story.revised.at[0], story.revised.at[1]) - 3) < 1e-6,
        "the geometry follows the revision")
    assert.equal(story.revised.locus, "circle", "the locus is still the named circle")
    assert.ok(Math.abs(story.revised.radius - 3) < 1e-6, "at the REVISED radius")
    assert.equal(story.revised.owner, 5, "the owner is the latest declaration")
    assert.ok(story.revised.revision > story.revAfterDrag,
        "the source revision names its OWN revision, after the drags")
    assert.equal(story.revised.status, "valid")
})

test("CI composition rung: an obstructed revision changes neither revision nor owner nor geometry", () => {
    const scheduler = buildWorld()
    // The prefix is lawful: A is pinned exactly on its sphere. The revision is staged behind a
    // `wait`, so the ACCEPTED PREFIX can be snapshotted before the obstructing declaration.
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet distance(A, origin) = 5\nlet A.position = (5,0,0)\nwait 1\nlet distance(A, origin) = 10"))
    const prefix = {}
    drive(scheduler, { maxTicks: 60, after: (i) => {
        const A = byName(scheduler, "A")
        if (!A || i !== 0) return
        const law = scheduler.laws.active().find((l) => l.feature === "distance")
        prefix.revision = scheduler.motionRevision
        prefix.owner = law.owner.line
        prefix.radius = law.expression.radius
        prefix.at = world(A)
    } })

    const A = byName(scheduler, "A")
    assert.ok(host.error, "the conflicting revision is refused")
    const law = scheduler.laws.active().find((l) => l.feature === "distance")
    assert.equal(law.expression.radius, prefix.radius, "the accepted radius stands")
    assert.equal(law.owner.line, prefix.owner, "the accepted owner stands")
    assert.deepEqual(world(A), prefix.at, "no partial mutation")
    assert.equal(scheduler.motionRevision, prefix.revision, "and the refusal names no revision")

    const state = pointStateOf(A, scheduler)
    assert.equal(state.truth.pinned, true, "the pin is still a truth")
    assert.equal(measurement(scheduler).status, "valid", "the accepted configuration is lawful")

    // A PINNED point is not offered, and cannot acquire capture — the rig asks the PRODUCTION
    // offer, so touch and observation agree. (D058)
    const gestures = rig(scheduler, () => [A])
    assert.equal(state.interaction.offered, false, "a pinned point is not offered")
    assert.equal(gestures.down(world(A)).claimed, false, "and cannot acquire capture")
    assert.equal(gestures.seen.captured, null, "no capture was taken")
})

test("CI rung — LOWER-LEVEL contract: an unavailable contribution preserves observation", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet distance(A, origin) = 5\nlet A.z = 0"))
    drive(scheduler, { maxTicks: 60 })
    const A = byName(scheduler, "A")
    assert.equal(host.error ?? null, null, "the construction itself is supported")

    // The PLACEMENT reading is the production seam `point_state` wires: unavailable here, so
    // the obligations' sets cannot be formed. (D058)
    const blind = bindWorld((id) => scheduler.registry.get(id), {
        writerId: A.id, live: (f) => frameWorldTransform(f), placement: () => null,
    })
    const view = constraintsView(A.id, scheduler.laws.active(), blind)
    const state = stateOf({ at: frameWorldTransform(A).position,
        unavailable: view.unavailable, constraints: view.constraints })

    // OBSERVATION is preserved; the REFUSAL is explained; nothing unestablished is offered.
    assert.equal(view.complete, false, "the set-bearing contribution failed")
    assert.ok(view.unavailable.length > 0, "and it travels to the view")
    assert.equal(state.status, "previous", "the accepted geometry stands as observation")
    assert.equal(state.interaction.offered, false, "no unestablished movement is advertised")
    assert.equal(state.refusal?.kind, "unsupported", "the refusal is explained")
    assert.notEqual(state.tag, "pinned", "and is not read as pinned")

    // With the production readers the SAME construction is complete and offered — so the
    // refusal above is the READING, not the construction.
    const sighted = pointStateOf(A, scheduler)
    assert.equal(sighted.status, "accepted")
    assert.equal(sighted.refusal, null)
    assert.equal(sighted.interaction.offered, true)
    assert.equal(sighted.locus?.kind, "circle", "and it names its locus")
})

test("CI composition rung: pointStateOf FORWARDS an unavailable reference", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet distance(A, origin) = 5"))
    drive(scheduler, { maxTicks: 60 })
    const A = byName(scheduler, "A")
    assert.equal(host.error ?? null, null, "the baseline is supported")
    assert.equal(pointStateOf(A, scheduler).status, "accepted", "and offered")

    // A law whose participant is NOT in this world, applied through the PRODUCTION store — so
    // the failure is forwarded by `pointStateOf` itself, not reconstructed around it. (D058)
    scheduler.laws.apply(bindLaw({ feature: "distance", endpoints: [A.id, "GHOST"], scope: A.id,
        frame: A.id, predicate: 5,
        expression: { type: "distance", references: [A.id, "GHOST"], radius: 5 } }))

    const state = pointStateOf(A, scheduler)
    assert.equal(state.status, "previous", "the accepted geometry stands as observation")
    assert.equal(state.interaction.offered, false, "no unestablished movement is advertised")
    assert.ok(state.refusal, "the refusal is forwarded")
    assert.equal(state.refusal.unavailable[0].feature, "distance")
    assert.notEqual(state.tag, "pinned", "and it is not read as pinned")

    // And TOUCH agrees with observation: the production offer refuses, so capture is refused.
    const gestures = rig(scheduler, () => [A])
    assert.equal(gestures.down(world(A)).claimed, false, "an unavailable point cannot acquire capture")
    assert.equal(gestures.seen.captured, null, "no capture was taken")
})

test("CI composition rung: a walking, rotated declaring frame — the live head is not the placement", () => {
    const scheduler = buildWorld()
    // The declaring frame is a BODY: `rt 90` turns it a real 90 DEGREES, `fw 10` walks its
    // head, and `wait 1` commits the walk so the live head stands off its stable placement.
    const host = scheduler.hotSwapChild("host", fork("host",
        "as F do\n  rt 90\n  fw 10\n  wait 1\n  let A\n  let distance(A, [2,0,0]) = 5\nend"))
    drive(scheduler, { maxTicks: 80 })
    const A = byName(scheduler, "A"), F = byName(scheduler, "F")
    const state = pointStateOf(A, scheduler)
    assert.equal(host.error ?? null, null, "the construction is supported")
    assert.equal(measurement(scheduler).status, "valid", "and the whole configuration is lawful")

    // The two INPUTS genuinely differ here — so the selection below has force.
    const live = SE3.apply(frameWorldTransform(F), [2, 0, 0])
    const placement = SE3.apply(worldTransform(F), [2, 0, 0])
    assert.ok(Math.hypot(live[0] - placement[0], live[1] - placement[1], live[2] - placement[2]) > 1e-3,
        "the declaring head has walked off its placement")

    // The DISPLAYED centre selects the LIVE one — a substituted placement reader would fail
    // BOTH assertions. (id:laws-distance-literal-address)
    const shown = state.truth.distances[0].other
    const round = (v) => v.map((n) => +n.toFixed(6))
    assert.deepEqual(round(shown), round(live), "the displayed centre reads the live head")
    assert.notDeepEqual(round(shown), round(placement), "and not the stable placement")
})
