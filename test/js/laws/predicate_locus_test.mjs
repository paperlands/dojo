// Joint band membership does not imply a nonempty nominal equality-locus. Every predicate can
// be satisfied while the exact pairwise locus is empty. Facts only; what an empty nominal locus
// certifies about contradiction remains an open question, not a claim made here.
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive, worldOf } from "./harness.mjs"
import { lawWorld, worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { lawViolation } from "../../../assets/js/turtling/laws/verdict.js"
import { addressOf } from "../../../assets/js/turtling/laws/replacement.js"
import { meetAll, sphere } from "../../../assets/js/turtling/laws/meet.js"
import { pointQuery } from "../../../assets/js/turtling/laws/authored.js"
import { lawContext } from "../../../assets/js/turtling/laws/candidate.js"
import { toLocalPoint } from "../../../assets/js/turtling/localize.js"
import { ACCEPT_TOL } from "../../../assets/js/turtling/laws/relationships.js"

const t = ACCEPT_TOL
const SRC = "let A=(0,0,0)\nlet B=(0,0,0)\ngoto 1.00000075 0\nlet p\n"
    + "let distance(p,A)=1\nlet distance(p,B)=1.0000015"
const near = (a, b, why) => assert.ok(Math.hypot(...a.map((v, i) => v - b[i])) < 1e-12, `${why}: ${a} != ${b}`)
const residual = (a, b, r) => Math.hypot(...a.map((v, i) => v - b[i])) - r

// Two pinned coincident anchors, one free point accepted between their two bands.
const fixture = () => {
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", SRC))
    drive(s)
    return { s, host, p: host.children.get("p"), A: host.children.get("A"),
        B: host.children.get("B"), scope: s.laws.active() }
}
// An empty error list is not evidence of a settled world: ask the frames themselves.
const settled = ({ host, p, scope }) => {
    assert.equal(host.done, true, "the host run is done")
    for (const frame of [host, p]) {
        assert.ok(frame.error == null, `${frame.name} carries no error`)
        assert.ok(frame.unresolved == null, `${frame.name} is not unresolved`)
    }
    assert.equal(scope.length, 4, "four rows installed")
}

test("two residual bands inside t can leave no common exact sphere", () => {
    // Concentric, radii 1 and 1+1.5t: the joint band [1-t,1+t] ∩ [1+.5t,1+2.5t] is nonempty at
    // 1+.75t, while the exact spheres share no point.
    const r1 = 1, r2 = 1 + 1.5 * t, at = 1 + 0.75 * t
    assert.ok(Math.abs(at - r1) < 0.9 * t && Math.abs(at - r2) < 0.9 * t, "both residuals clear the margin")
    assert.equal(meetAll([sphere([0, 0, 0], r1), sphere([0, 0, 0], r2)]).kind, "empty")
    // Control: a gap the same constant calls small still names a set.
    assert.equal(meetAll([sphere([0, 0, 0], r1), sphere([0, 0, 0], 1 + 0.5 * t)]).kind, "sphere")
})

test("two coincident anchors accept a point the nominal meet calls empty", () => {
    const { s, host, p, A, B, scope } = fixture()
    assert.deepEqual(s.errors, [], "no refusal reported")
    settled({ host, p, scope })
    near(worldOf(p), [1 + 0.75 * t, 0, 0], "the accepted point sits between the two bands")

    assert.deepEqual(scope.map((law) => law.feature).sort(), ["distance", "distance", "position", "position"])
    const addresses = scope.map((law) => addressOf(law))       // tagged JSON keys, bound once
    assert.equal(new Set(addresses).size, 4, "four distinct addresses: nothing replaced anything")
    assert.deepEqual(addresses.map((key) => JSON.parse(key)[0]).sort(),
        ["distance", "distance", "position", "position"])
    const distances = scope.filter((law) => law.feature === "distance")
    assert.deepEqual(distances.map((law) => law.endpoints[1]).sort(), [A.id, B.id].sort(),
        "the two distance rows name (p,A) and (p,B), never replacing one another")
    for (const law of distances) {
        const key = JSON.parse(addressOf(law))
        assert.ok(law.endpoints.includes(p.id), "p is a participant of both")
        assert.deepEqual(key[1].map((part) => part[1]).sort(),
            [A.id, B.id, p.id].filter((id) => law.endpoints.includes(id)).sort(),
            "the address carries exactly the bound identities")
    }

    // The original gate is the authority, and it holds at the accepted configuration.
    assert.equal(lawViolation(scope, new Map(), s.registry, lawWorld).status, "valid")
    const r1 = residual(worldOf(p), worldOf(A), 1)
    const r2 = residual(worldOf(p), worldOf(B), 1 + 1.5 * t)
    assert.ok(Math.abs(r1) < 0.9 * t && Math.abs(r2) < 0.9 * t,
        `measured residuals ${r1} / ${r2} stay inside t with margin`)

    // ...while the exact locus of the two truths is empty, queried independently.
    const query = pointQuery(p.id, scope, lawContext(s.registry, null, lawWorld, { writerId: p.id }))
    assert.equal(query.complete, true, "both sets form")
    assert.equal(meetAll(query.sets).kind, "empty")
})

test("outside the band the original gate rejects", () => {
    const { s, host, p, A, B, scope } = fixture()
    settled({ host, p, scope })
    // Ask the same gate at a point well outside both bands, stated in the frame's own chart.
    const outside = [1 + 3 * t, 0, 0]
    const pose = { rotation: p.transform.deref().rotation, position: toLocalPoint(worldTransform(p), outside) }
    const check = lawViolation(scope, new Map([[p, pose]]), s.registry, lawWorld)
    assert.equal(check.status, "violation")
    assert.equal(check.law.feature, "distance", "a distance row is what fails")
    assert.ok(check.residual > t, `the reported residual ${check.residual} exceeds the band`)
    assert.ok(Math.abs(residual(outside, worldOf(A), 1) - 3 * t) < 1e-12, "r1 is +3t from its truth")
    assert.ok(Math.abs(residual(outside, worldOf(B), 1 + 1.5 * t) - 1.5 * t) < 1e-12, "r2 is +1.5t")
})
