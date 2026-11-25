// M5: free downstream D is not a conditioning assignment; the point view over C's
// accepted constraints is conditional on D=accepted. Current policy keeps B radial and
// moves C/D. Regression for question-scoped work, not a new capability. (id:laws-free-relations-review)
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { lawWorld } from "../../../assets/js/turtling/scheduler.js"
import { lawViolation } from "../../../assets/js/turtling/laws/verdict.js"
import { programFollowing } from "../../../assets/js/turtling/laws/program_following.js"
import { bindLaw } from "../../../assets/js/turtling/laws/replacement.js"
import { makeDistanceTerm } from "../../../assets/js/turtling/laws/authored.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const SOURCE = `let A
jmp 5
let B
jmp 5
let C
jmp 5
let D
let distance(A,B)=5
let distance(B,C)=5
let distance(C,D)=5
let distance(C, (5,0,0)) = 5
`
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const placement = (frame) => {
    const t = lawWorld.transform(frame)
    return { position: [...t.position], rotation: [t.rotation.w, t.rotation.x, t.rotation.y, t.rotation.z] }
}
const localPose = (frame, world) => ({
    rotation: frame.transform.deref().rotation,
    position: SE3.unapply(lawWorld.transform(frame), world),
})
const fixture = () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", SOURCE))
    drive(scheduler, { maxTicks: 80 })
    assert.deepEqual(scheduler.errors, [])
    const [A, B, C, D] = ["A", "B", "C", "D"].map((n) => host.children.get(n))
    return { scheduler, host, A, B, C, D, frames: [A, B, C, D] }
}
const acceptedSnapshot = (frames) => frames.map((f) => [...lawWorld.read(f, null).position])
const stableSnapshot = (frames) => frames.map(placement)
const assertAcceptedAndStable = (frames, accepted, stable) => {
    assert.deepEqual(acceptedSnapshot(frames), accepted, "accepted live reads unchanged")
    assert.deepEqual(stableSnapshot(frames), stable, "stable placements unchanged")
}
const proposed = (A) => ({ kind: "accept", pose: localPose(A, [1, 0, 0]), component: [] })
const answerPoses = (A, answer) => new Map([[A, answer.pose],
    ...answer.component.map(({ frame, pose }) => [frame, pose])])
const effective = (frames, poses) => Object.fromEntries(frames.map((f) => [f.name, lawWorld.read(f, poses).position]))

test("a free downstream D stays free: B is radial, C/D move off accepted values", () => {
    const { scheduler, A, B, C, D, frames } = fixture()
    const laws = scheduler.laws.active()
    assert.equal(laws.length, 4, "AB, BC, CD and the unary literal")
    const accepted = acceptedSnapshot(frames)
    assert.deepEqual(accepted, [[0, 0, 0], [5, 0, 0], [10, 0, 0], [15, 0, 0]])
    const stable = stableSnapshot(frames)
    const lawCount = scheduler.laws.active().length

    const offered = proposed(A)
    const offeredPosition = [...offered.pose.position]
    const answer = programFollowing(offered, A, scheduler.registry, scheduler.laws, lawWorld)
    assert.ok(answer, "the current policy accepts the source question")
    assert.strictEqual(answer.pose, offered.pose)
    assert.strictEqual(answer.pose.rotation, offered.pose.rotation)
    for (const { frame, pose } of answer.component) {
        assert.strictEqual(pose.rotation, frame.transform.deref().rotation, `${frame.name} heading`)
    }

    const poses = answerPoses(A, answer)
    const at = effective(frames, poses)
    assert.deepEqual(at.A, [1, 0, 0], "given root moved")
    assert.ok(dist(at.B, [6, 0, 0]) < 1e-9, "radial B survives")
    assert.ok(dist(at.C, [10, 0, 0]) > 1, "free C moves off the accepted D=15 point")
    assert.ok(dist(at.D, [15, 0, 0]) > 1, "free D moves with C")
    assert.ok(Math.abs(dist(at.B, at.C) - 5) < 1e-9, "BC=5")
    assert.ok(Math.abs(dist(at.C, [5, 0, 0]) - 5) < 1e-9, "C literal=5")
    assert.ok(Math.abs(dist(at.C, at.D) - 5) < 1e-9, "CD=5")
    assert.equal(lawViolation(laws, poses, scheduler.registry, lawWorld).status, "valid")

    assert.deepEqual(offered.component, [])
    assert.deepEqual(offered.pose.position, offeredPosition)
    assertAcceptedAndStable(frames, accepted, stable)
    assert.equal(scheduler.laws.active().length, lawCount)
    assert.deepEqual(lawWorld.transform(C).position, [10, 0, 0])
    assert.ok(dist(at.C, [10, 0, 0]) > 1)
})

test("a free unplaced D conditions B immediately through its stable placement", () => {
    const { scheduler, host, A, B, C, D, frames } = fixture()
    const base = scheduler.laws.active()
    const typed = bindLaw({ feature: "distance", endpoints: [B.id], scope: host.id, frame: host.id, predicate: 10,
        expression: makeDistanceTerm([B.id, { frame: D.id, value: [0, 0, 0] }], 10) })
    const active = [...base, typed]
    assert.equal(lawViolation(active, null, scheduler.registry, lawWorld).status, "valid",
        "accepted B=5 is ten from D's stable placement at 15")
    const accepted = acceptedSnapshot(frames)
    const stable = stableSnapshot(frames)
    const lawCount = scheduler.laws.active().length
    const offered = proposed(A)
    const offeredPosition = [...offered.pose.position]

    const answer = programFollowing(offered, A, scheduler.registry, { active: () => active }, lawWorld)
    assert.ok(answer, "the typed row is covered by the current frontier")
    const poses = answerPoses(A, answer)
    const at = effective(frames, poses)
    const stableD = lawWorld.transform(D).position
    assert.ok(dist(at.B, [6, 0, 0]) > 1e-6, "B is not the radial 6: stable D=15 conditions it immediately")
    assert.ok(Math.abs(dist(at.B, stableD) - 10) < 1e-9, "|B - D stable placement| = 10")
    assert.ok(Math.abs(dist(at.B, at.C) - 5) < 1e-9, "BC=5")
    assert.ok(Math.abs(dist(at.C, [5, 0, 0]) - 5) < 1e-9, "C literal=5")
    assert.ok(Math.abs(dist(at.C, at.D) - 5) < 1e-9, "CD=5")
    assert.ok(dist(at.D, [15, 0, 0]) > 1e-6, "D's live position is free to move")
    assert.equal(lawViolation(active, poses, scheduler.registry, lawWorld).status, "valid",
        "originals plus the typed placement-read row hold")

    assert.deepEqual(offered.component, [])
    assert.deepEqual(offered.pose.position, offeredPosition)
    assertAcceptedAndStable(frames, accepted, stable)
    assert.equal(scheduler.laws.active().length, lawCount, "active array did not mutate the store")
})
