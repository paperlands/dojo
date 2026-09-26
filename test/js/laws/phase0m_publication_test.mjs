// Phase 0m — publication is one bounded repair.
//
// Acceptance for the reentrancy witness: a notifier that requests another move
// must not let an older publication overwrite a newer acceptance. The repair is
// one guard at the publication site plus one explicit rule at the door — a
// request raised while a publication is open is refused `busy` and retried.
// No queue, no version store.
//
// Requirements, one test each:
//   1. no half-installed component;
//   2. no older head publication after a newer acceptance;
//   3. an explicit rule for callbacks requesting another move;
//   4. unchanged unconstrained execution.
//
// The witness for the repair is requirement 2: with `root.notifyingCommit` never
// set, it reports accepted geometry (2,7) against visible heads (1,6).
// Run: node --test test/js/laws/phase0m_publication_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, drive, world } from "./harness.mjs"
import { takeSync } from "../../../assets/js/turtling/scheduler.js"

// Equal world displacement of both ends preserves |AB| = 5 (the phase0i fixture).
const pair = ({ command, requested, frame }) => {
    if (command !== "hand") return { accepted: true, transform: requested }
    const other = frame.parent.children.get(frame.name === "a" ? "b" : "a")
    const current = frame.transform.deref()
    const delta = requested.position[0] - current.position[0]
    const pose = { ...other.transform.deref(), position: [other.transform.deref().position[0] + delta, 0, 0] }
    return { accepted: true, transform: requested, component: [{ frame: other, transform: pose }] }
}

const headX = (frame) => takeSync(frame)?.find((e) => e.type === "head")?.position[0]

const setup = () => {
    const scheduler = buildWorld({ admit: pair })
    const a = scheduler.hotSwapChild("a", fork("a", ""))
    const b = scheduler.hotSwapChild("b", fork("b", "goto 5 0"))
    drive(scheduler)
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [0, 5])
    takeSync(a); takeSync(b)   // discard the seating heads
    return { scheduler, a, b }
}

test("1. acceptance: no watcher sees a half-installed component", () => {
    const { scheduler, a, b } = setup()
    const seen = []
    a.transform.watch("p0m-half", () => seen.push([world("a", scheduler)[0], world("b", scheduler)[0]]))
    assert.equal(scheduler.requestMotion(a, at(1), scheduler.motionRevision).kind, "accept")
    assert.ok(seen.length > 0, "the publication notified")
    // Every observation is a complete pair. The install of both members happens
    // before any watcher runs.
    assert.ok(seen.every(([x, y]) => Math.abs(x - y) === 5),
        `a watcher read a partially installed pair: ${JSON.stringify(seen)}`)
})

test("2. acceptance: a visible head never names an older configuration", () => {
    const { scheduler, a, b } = setup()
    let armed = true
    a.transform.watch("p0m-reentrancy", () => {
        if (!armed) return
        armed = false
        // A callback requests another valid move from inside publication.
        scheduler.requestMotion(a, at(2), scheduler.motionRevision)
    })

    assert.equal(scheduler.requestMotion(a, at(1), scheduler.motionRevision).kind, "accept")
    // Whatever the rule decided, display and accepted geometry must name one
    // configuration. Without the guard this is geometry (2,7) against heads (1,6).
    assert.equal(headX(a), world("a", scheduler)[0], "A's head names A's accepted pose")
    assert.equal(headX(b), world("b", scheduler)[0], "B's head names B's accepted pose")

    // And a later acceptance moves the head with it: no older head survives a
    // newer acceptance.
    if (scheduler.requestMotion(a, at(2), scheduler.motionRevision).kind === "accept") {
        assert.equal(headX(a), world("a", scheduler)[0])
        assert.equal(headX(b), world("b", scheduler)[0])
    }
})

test("3. acceptance: the rule for a callback requesting another move is explicit and retryable", () => {
    const { scheduler, a, b } = setup()
    let nested
    let armed = true
    a.transform.watch("p0m-rule", () => {
        if (!armed) return
        armed = false
        nested = scheduler.requestMotion(a, at(2), scheduler.motionRevision)
    })

    assert.equal(scheduler.requestMotion(a, at(1), scheduler.motionRevision).kind, "accept")
    assert.equal(nested?.kind, "busy", "a request raised inside publication is refused")
    assert.match(nested.message, /publication/)
    // Refused is not dropped: retrying after the publication lands the move whole.
    const retry = scheduler.requestMotion(a, at(2), scheduler.motionRevision)
    assert.equal(retry.kind, "accept")
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [2, 7])
    assert.equal(headX(a), 2)
    assert.equal(headX(b), 7)
})

test("4. acceptance: unconstrained execution is unchanged", () => {
    // No admission policy: the publication machinery must never engage.
    const scheduler = buildWorld({})
    const a = scheduler.hotSwapChild("a", fork("a", "goto 1 0\nfw 2"))
    drive(scheduler)
    assert.equal(scheduler.root.notifyingCommit, undefined,
        "publication is a law-seam affair; the default path never opens one")
    assert.equal(scheduler.motionRevision, 0, "no acceptance, no revision")
    assert.equal(a.error, null)
    // The unconstrained path still lands exactly where it always did.
    assert.equal(world("a", scheduler)[0], 3)
    assert.deepEqual(takeSync(a)?.find((e) => e.type === "head")?.position[0], 3)
})

// The readout recompute is a notification, not an install. It runs inside the
// publication gate, so a readout subscriber that requests motion is refused and
// retried — it cannot overwrite the commit whose values it is reading.
// (id:laws-p0m-publication, id:laws-build-p3-slider)
test("5. acceptance: a readout subscriber cannot re-enter publication", () => {
    const { scheduler, a, b } = setup()
    let nested
    let armed = true
    scheduler.readouts.watch(() => {
        if (!armed) return
        armed = false
        nested = scheduler.requestMotion(a, at(9), scheduler.motionRevision)
    })
    scheduler.readouts.register(a, "x", (snapshot) => snapshot.world(a)[0])

    assert.equal(scheduler.requestMotion(a, at(7), scheduler.motionRevision).kind, "accept")
    assert.equal(nested?.kind, "busy", "a request raised from a readout is refused")
    assert.match(nested.message, /publication/)
    // The outer publication is whole: accepted geometry, displayed head and the
    // revision all name the same configuration.
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [7, 12])
    assert.equal(headX(a), 7, "A's head names A's accepted pose")
    assert.equal(headX(b), 12, "B's head names B's accepted pose")
    assert.equal(scheduler.motionRevision, 1, "one commit, one revision")
    // Refused is not dropped: the retry lands whole.
    assert.equal(scheduler.requestMotion(a, at(9), scheduler.motionRevision).kind, "accept")
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [9, 14])
    assert.equal(headX(a), 9)
})

// One failing subscriber must not silence the fan or leave the commit half-made:
// every subscriber is invited, the gate is restored, and the failure is re-raised.
// (id:laws-p0m-publication)
test("6. acceptance: a failing subscriber never leaves a half-finished publication", () => {
    const { scheduler, a, b } = setup()
    const seen = []
    a.transform.watch("p0m-throw", () => { throw new Error("subscriber fault") })
    b.transform.watch("p0m-after", () => seen.push([world("a", scheduler)[0], world("b", scheduler)[0]]))

    assert.throws(() => scheduler.requestMotion(a, at(3), scheduler.motionRevision), /subscriber fault/)
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [3, 8], "the commit is whole")
    assert.ok(seen.length > 0, "the sibling after the throwing watcher still heard it")
    assert.ok(seen.every(([x, y]) => Math.abs(y - x) === 5), "and saw a complete pair")
    assert.equal(scheduler.root.notifyingCommit, false, "the gate is restored")
    a.transform.unwatch("p0m-throw")   // the fault is heard once; a later request is free
    assert.equal(scheduler.requestMotion(a, at(4), scheduler.motionRevision).kind, "accept",
        "a later request is not blocked by the restored gate")
})

test("7. acceptance: a throwing readout never silences the display fan", () => {
    const { scheduler, a, b } = setup()
    const seen = []
    scheduler.readouts.watch(() => { throw new Error("readout fault") })
    a.transform.watch("p0m-display", () => seen.push([world("a", scheduler)[0], world("b", scheduler)[0]]))
    scheduler.readouts.register(a, "x", (snapshot) => snapshot.world(a)[0])

    assert.throws(() => scheduler.requestMotion(a, at(4), scheduler.motionRevision), /readout fault/)
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [4, 9], "the commit is whole")
    assert.ok(seen.length > 0, "the display fan ran despite the readout failure")
})

// The display projection is part of the commit, not a later courtesy: a subscriber
// failure is reported only after geometry AND its head have landed together.
// (id:laws-p0m-publication)
test("8. acceptance: a subscriber failure never strands the head behind the geometry", () => {
    const { scheduler, a, b } = setup()
    scheduler.readouts.watch(() => { throw new Error("readout fault") })
    scheduler.readouts.register(a, "x", (snapshot) => snapshot.world(a)[0])

    assert.throws(() => scheduler.requestMotion(a, at(7), scheduler.motionRevision), /readout fault/)
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [7, 12], "the commit is whole")
    assert.equal(headX(a), 7, "A's head names the accepted pose even though a subscriber failed")
    assert.equal(headX(b), 12, "B's head too")
})
