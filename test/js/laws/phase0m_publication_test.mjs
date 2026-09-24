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
// The witness for the repair is requirement 2: with `root._publishing` never
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
    assert.equal(scheduler.root._publishing, undefined,
        "publication is a law-seam affair; the default path never opens one")
    assert.equal(scheduler.motionRevision, 0, "no acceptance, no revision")
    assert.equal(a.error, null)
    // The unconstrained path still lands exactly where it always did.
    assert.equal(world("a", scheduler)[0], 3)
    assert.deepEqual(takeSync(a)?.find((e) => e.type === "head")?.position[0], 3)
})
