// The hostile-producer witness: a deliberately faulty producer must not publish anything.
// Satisfying every RELATIONSHIP does not establish that every PROPOSED POSE is valid — so
// every edit is validated at two boundaries (candidate preparation and effective
// installation), and a refusal changes nothing: no geometry, no law, no ownership, no
// revision, no notification. (id:laws-activation-order, D058)
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive } from "./harness.mjs"
import { AUTHORED } from "../../../assets/js/turtling/laws/authored.js"
import { addressOf } from "../../../assets/js/turtling/laws/replacement.js"
import { INAPPLICABLE } from "../../../assets/js/turtling/laws/verdict.js"

const byName = (scheduler, name) => [...scheduler.registry.values()].find((f) => f.name === name)
const at = (frame) => {
    const p = frame.transform.deref().position
    return [p[0], p[1], p[2]]
}

// Run the baseline and the faulty revision in ONE source, so a single synchronous drive sees
// both: the first declaration through the real producer, the revision through the fault.
const runFaulty = (source, fault = (lawful, a, b) => ({ ok: true, world: lawful.world,
    worlds: new Map([[a.id, lawful.world], [b.id, [NaN, 0, 0]]]) })) => {
    const scheduler = buildWorld()
    const real = AUTHORED.coordinate.propose
    let calls = 0
    AUTHORED.coordinate.propose = (spec) => {
        const lawful = real(spec)
        calls += 1
        if (calls === 1 || !lawful.ok) return lawful   // the baseline stands
        const a = byName(scheduler, "A"), b = byName(scheduler, "B")
        return fault(lawful, a, b)
    }
    try {
        scheduler.hotSwapChild("host", fork("host", source))
        drive(scheduler, { maxTicks: 80 })
    } finally {
        AUTHORED.coordinate.propose = real
    }
    return scheduler
}

test("hostile producer: an invalid edit for an unowned frame is refused, and nothing changes", () => {
    const scheduler = runFaulty("let A\nlet B\nlet C\nlet A.x = 1\nlet A.x = 3")
    const host = scheduler.root.children.get("host")
    const A = byName(scheduler, "A"), B = byName(scheduler, "B"), C = byName(scheduler, "C")

    // The refusal is EXPLICIT and names the frame — never a silent pass.
    const refused = host.unresolved ?? host.error
    assert.ok(refused, "the refusal is reported")
    assert.match(JSON.stringify(refused), /B/, "and it names the frame whose edit was invalid")

    // No geometry changed — not the lawful edit for A, not the invalid one for B.
    assert.deepEqual(at(A), [1, 0, 0], "A keeps the accepted pose; the lawful edit did not land alone")
    assert.deepEqual(at(B), [0, 0, 0], "B is untouched")
    assert.deepEqual(at(C), [0, 0, 0], "C is untouched")

    // No law installed or revised, and the accepted owner stands.
    const laws = scheduler.laws.active()
    assert.equal(laws.length, 1, "one relationship only")
    assert.equal(laws[0].feature, "coordinate")
    assert.equal(laws[0].owner.line, 4, "the accepted owner is the baseline declaration")
    assert.equal(laws[0].expression.value, 1, "the accepted payload stands")

    // The advertised revision guarantee: a refusal names NO revision, and no subscriber saw
    // a commit — the accepted geometry was never half-installed.
    assert.equal(scheduler.root._motionRevision, 1, "no revision is named on refusal")
})

test("hostile producer: a lawful proposal still lands, so the check is not a blanket refusal", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet A.x = 1\nlet A.x = 3"))
    drive(scheduler, { maxTicks: 80 })
    assert.equal(host.error ?? null, null, "a lawful revision is accepted")
    assert.ok(Math.abs(at(byName(scheduler, "A"))[0] - 3) < 1e-9, "and it lands")
    assert.deepEqual(scheduler.laws.active().map((l) => l.owner.line), [3], "one law, the latest owner")
    assert.equal(addressOf(scheduler.laws.active()[0]).includes("coordinate"), true)
})

test("hostile producer: a valid but UNRELATED edit is refused by the operation's own scope", () => {
    // The geometry is lawful — B's pose is finite and B has no obligation. But this operation
    // is `A.x`, and publication rights over B do not make moving B this operation's intent.
    const scheduler = runFaulty("let A\nlet B\nlet A.x = 1\nlet A.x = 3", (lawful, a, b) =>
        ({ ok: true, world: lawful.world, worlds: new Map([[a.id, lawful.world], [b.id, [7, 0, 0]]]) }))
    const host = scheduler.root.children.get("host")
    assert.equal(host.error?.kind, "rejected", "valid geometry is not permission to move an unrelated frame")
    assert.match(host.error.message, /B/, "and the refusal names the frame")
    assert.deepEqual(at(byName(scheduler, "B")), [0, 0, 0], "B never moves")
    assert.deepEqual(at(byName(scheduler, "A")), [1, 0, 0], "and A keeps its accepted pose")
    assert.equal(scheduler.root._motionRevision, 1, "no revision is named")
})

test("candidate outcomes are named, never overloaded: INAPPLICABLE is a distinct value", () => {
    assert.ok(Object.isFrozen(INAPPLICABLE), "the sentinel is immutable")
    assert.deepEqual(INAPPLICABLE, { kind: "inapplicable" })
    assert.notEqual(INAPPLICABLE, null, "and is not `null`")
    assert.notEqual(INAPPLICABLE.kind, "rejected", "nor a refusal")
})
