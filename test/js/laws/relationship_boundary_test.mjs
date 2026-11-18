// The boundary between ASSIGNMENT FEEDBACK and a RELATIONSHIP.
//
// A dependent position is a change callback: on change, re-apply. That is assignment
// feedback, and it may not stand on itself (D054). A RELATIONSHIP is a different object
// and its own authority — the expression and its resolved references, the coordinate
// frame and domain guards, source ownership, and an independent evaluation a separate
// gate accepts. A change callback must not become that authority, and a cycle in
// legitimate relational geometry is a solver limitation, never the assignment refusal.
// (id:laws-dependency-driven-place, id:relationships-row-contract, D056)
// Run: node --test test/js/laws/relationship_boundary_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"

const selfDependent = (errors) => errors.some((e) => /cannot be defined by itself/.test(e.message))

test("assignment feedback refuses a place standing on itself", () => {
    const s = buildWorld({})
    s.hotSwapChild("host", fork("host", "let A\nlet A = (A.x + 1, 0, 0)"))
    drive(s)
    assert.ok(selfDependent(s.errors), "the assignment cycle is diagnosed")
})

test("a relationship whose payload reads live state is sampled, not refused", () => {
    // The payload of a relation is not a coordinate that tracks; it is read at reach.
    // Reading a live place there is legitimate, so the assignment refusal never fires.
    const s = buildWorld({})
    const host = s.hotSwapChild("host", fork("host", ["let A", "let B", "let B.distance = A.x"].join("\n")))
    drive(s)
    assert.equal(s.errors.length, 0, "a relational payload is not assignment feedback")
    assert.ok(host.children.get("B"), "the point is placed")
})

test("a relational composition the solver cannot close is unresolved, never a wound", () => {
    const s = buildWorld({})
    const host = s.hotSwapChild("host", fork("host", [
        "let A", "let B", "let C",
        "as O do", "  let C.position = [10, 0, 0]", "end",
        "as A do", "  let B.distance = 5", "  wait 1", "  let B.distance = 10", "end",
        "as B do", "  let C.distance = 5", "end",
    ].join("\n")))
    drive(s)
    const A = host.children.get("A")
    assert.equal(A.error, null, "a solver limit is not a wound")
    assert.ok(A.unresolved, "the scope ends unresolved")
    assert.ok(!selfDependent(s.errors), "the assignment restriction never reaches relational geometry")
})

test("a relationship carries frame, guards, ownership and resolved references together", () => {
    const s = buildWorld({})
    s.hotSwapChild("host", fork("host", ["let A", "as B do", "  let A.distance = 5", "end"].join("\n")))
    drive(s)
    const law = s.laws.active().find((l) => l.feature === "distance")
    assert.ok(law, "the relationship is on the record")
    assert.equal(law.endpoints.length, 2, "its resolved references are bound")
    assert.ok(law.frame != null, "its coordinate frame is bound")
    assert.ok(law.owner != null, "its source owns it")
    assert.deepEqual(law.guards, { finite: true, nonNegative: true }, "its domain guards are bound")
})
