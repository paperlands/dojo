// The accepted installation is ONE: the law, its accepted geometry, the driver, the
// producer associations and the exposure change together. A publication that refuses
// installs none of them. (id:laws-activation-order, id:laws-dependency-driven-place)
//
// Before this control: a dependent position whose final publication was refused left a
// registered driver with no accepted law — an orphan producer. Driver installation was
// performed because a CANDIDATE said commit, not because publication accepted it.
//
// REOPEN when a driver can be installed outside the accepted-publication boundary, or a
// refused publication can still leave a producer association. (Step 1 gate)
// Run: node --test test/js/laws/driven_installation_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const accept = ({ requested }) => ({ accepted: true, transform: requested })

// 1. A LATE refusal — the target is a running member — installs neither the law nor its
//    driver. A candidate is not an acceptance.
test("a refused publication leaves no position law and no orphan driver", () => {
    const scheduler = buildWorld({ admit: accept })
    const running = scheduler.hotSwapChild("A", fork("A", "wait 100"))
    scheduler.hotSwapChild("host", fork("host", "let B\nlet A.position = (B.x, 100)"))
    drive(scheduler, { maxTicks: 5 })
    assert.equal(running.done, false, "A is still walking, so the pin cannot be atomic")
    assert.equal(scheduler.laws.active().filter((l) => l.feature === "position").length, 0,
        "the refused pin installed no law")
    assert.equal(scheduler.readouts.size, 0,
        "the refused pin installed no driver — no orphan producer")
    assert.ok(scheduler.errors.some((e) => /running member/.test(e.message)),
        "the refusal is reported, not silent")
})

// 2. An ACCEPTED dependent place still installs law and driver together and stays live —
//    atomicity is not the same as disabling the mechanism.
test("an accepted dependent place installs its law and its driver as one, and tracks", () => {
    const scheduler = buildWorld({ admit: accept })
    const host = scheduler.hotSwapChild("host", fork("host", "let B\nlet A = (B.x, 100)"))
    drive(scheduler)
    assert.equal(scheduler.laws.active().filter((l) => l.feature === "position").length, 1,
        "the accepted pin installed its law")
    assert.equal(scheduler.readouts.size, 1, "and its driver, in the same installation")
    const A = host.children.get("A")
    const B = host.children.get("B")
    assert.deepEqual(frameWorldTransform(A).position, [0, 100, 0], "A starts on B.x = 0")
    scheduler.requestMotion(B, { rotation: B.transform.deref().rotation, position: [7, 0, 0] },
        scheduler.motionRevision)
    drive(scheduler)
    assert.equal(frameWorldTransform(A).position[0], 7, "the installed driver is live: A tracks B")
})
