// One witness, adapted to the pure meet and the scheduler, so the two agree by
// construction; the browser leg is the same source. No second World.
// (id:codex-play-eyes, id:relationships-todo-plane-authored)
//
// Run: node --test test/js/laws/witness_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { planeOfAxis, meetPlaneSphere, nearestOnMeet } from "../../../assets/js/turtling/laws/relationships.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { AXIS_Z } from "../../../assets/js/turtling/se3.js"

// source · declaring frame · ordered request · held context · expected pose
const WITNESS = {
    source: "let A\nlet B\nas B do\n  let A.y = 0\n  let A.distance = 5\nend",
    frame: { position: [0, 0, 0], rotation: Versor.fromAxisAngle(AXIS_Z, 0) },
    request: [3, 1, 3],
    held: "B",
    at: [5 / Math.SQRT2, 0, 5 / Math.SQRT2],
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`)
const same = (p) => { near(p[0], WITNESS.at[0]); near(p[1], WITNESS.at[1]); near(p[2], WITNESS.at[2]) }

test("the pure meet and the scheduler agree on one witness", () => {
    // Pure: the shipped meet, not a copy.
    const meet = meetPlaneSphere(planeOfAxis(WITNESS.frame, "y", 0), [0, 0, 0], 5)
    same(nearestOnMeet(meet, WITNESS.request).at)

    // Scheduler: the same witness through the real runtime and continuation.
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", WITNESS.source))
    drive(scheduler)
    const A = host.children.get("A")
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation, position: WITNESS.request }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 5 })
    assert.equal(r.kind, "accept")
    same([...frameWorldTransform(A).position])
})

test("the browser rung is the same source", () => {
    assert.equal(readFileSync("scripts/play/rungs/coordinate.txt", "utf8").trimEnd(), WITNESS.source)
})
