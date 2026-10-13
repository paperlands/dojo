// The payload boundary, exercised DIRECTLY. (id:laws-payload-boundary, D058)
//
// Hypothesis: a proposal derives its inputs from the BOUND CANDIDATE (the term), not from
// the loose fields a driver happened to save. The term's frame is the one that interprets
// its payload; the ownership scope (observer) does not override it.
//
// Counterexample (before this bound): a supplied term with no loose `value` is refused
// ("payload must be finite"), and a term whose frame is translated away from its declaring
// scope proposes in the scope's placement instead of the frame's.
//
// REOPEN when a proposal reads anything from a field outside the bound candidate, or when a
// term's frame is not the one its payload is placed through.
//
// Run: node --test test/js/laws/payload_boundary_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { applyLaw } from "../../../assets/js/turtling/laws/verdict.js"
import { bindLaw } from "../../../assets/js/turtling/laws/replacement.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"

const near = (a, b, tol = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol)
const rot = (r = Versor.raw(1, 0, 0, 0)) => r

// A minimal pump: frames with a placement atom (deref), an empty law store, and a world
// whose live read composes an override onto the placement — the same contract verdict_test
// drives. A proposal's validity is checked against the PLACEMENT, never the live head.
function stub(places) {
    const frames = new Map(places.map(([id, pos, r]) => [id, { id, name: id, transform: { deref: () => ({ position: pos, rotation: rot(r) }) } }]))
    const registry = { get: (id) => frames.get(id) ?? null }
    const world = {
        transform: (f) => f.transform.deref(),
        read: (f, overrides) => {
            const at = f.transform.deref()
            if (overrides?.has(f)) {
                const w = SE3.compose(at, overrides.get(f))
                return { position: w.position, rotation: w.rotation }
            }
            return { position: at.position, rotation: at.rotation }
        },
    }
    return { frames, registry, world, pump: { registry, laws: { active: () => [] }, readouts: {} } }
}
const poseOf = (out) => out.poses?.[0]?.pose.position ?? null

// 1. A term-only position proposal commits from the bound term alone — no loose `value`.
test("a term-only position proposal commits from the bound term", () => {
    const s = stub([["T", [0, 0, 0]], ["O", [0, 0, 0]]])
    const term = { type: "position", references: ["T"], frame: "O", axis: null, value: [2, 3, 0], source: null }
    const out = applyLaw({ feature: "position", target: s.frames.get("T"), observer: s.frames.get("O"), owner: null, term }, s.pump, s.world)
    assert.equal(out.kind, "commit", out.message ?? "the term's payload is the proposal")
    assert.ok(near(poseOf(out), [2, 3, 0]), `proposed from the term, got ${JSON.stringify(poseOf(out))}`)
})

// 2. A term-only coordinate proposal commits from the bound term alone.
test("a term-only coordinate proposal commits from the bound term", () => {
    const s = stub([["T", [0, 0, 0]], ["O", [0, 0, 0]]])
    const term = { type: "coordinate", references: ["T"], frame: "O", axis: "y", value: 3, source: null }
    const out = applyLaw({ feature: "coordinate", target: s.frames.get("T"), observer: s.frames.get("O"), owner: null, term, axis: "y" }, s.pump, s.world)
    assert.equal(out.kind, "commit", out.message ?? "the term's payload is the proposal")
    assert.ok(near(poseOf(out), [0, 3, 0]), `proposed onto the term's plane, got ${JSON.stringify(poseOf(out))}`)
})

// 3. A term whose frame is TRANSLATED away from the ownership scope proposes in the FRAME.
test("a translated declaration context does not reinterpret the bound world point", () => {
    const s = stub([["T", [0, 0, 0]], ["O", [0, 0, 0]], ["F", [10, 0, 0]]])
    const term = { type: "position", references: ["T"], frame: "F", axis: null, value: [2, 0, 0], source: null }
    const out = applyLaw({ feature: "position", target: s.frames.get("T"), observer: s.frames.get("O"), owner: null, term }, s.pump, s.world)
    assert.equal(out.kind, "commit", out.message ?? "the term's frame places the point")
    assert.ok(near(poseOf(out), [2, 0, 0]), `world payload, got ${JSON.stringify(poseOf(out))}`)
})

// 4. A term whose frame is ROTATED proposes through the rotated frame.
test("a rotated declaration context does not reinterpret the bound world point", () => {
    // F rotated 90° about z: its local +x points to world +y.
    const s = stub([["T", [0, 0, 0]], ["O", [0, 0, 0]], ["F", [0, 0, 0], Versor.raw(Math.SQRT1_2, 0, 0, Math.SQRT1_2)]])
    const term = { type: "position", references: ["T"], frame: "F", axis: null, value: [2, 0, 0], source: null }
    const out = applyLaw({ feature: "position", target: s.frames.get("T"), observer: s.frames.get("O"), owner: null, term }, s.pump, s.world)
    assert.equal(out.kind, "commit", out.message ?? "the term's frame places the point")
    assert.ok(near(poseOf(out), [2, 0, 0]), `world payload, got ${JSON.stringify(poseOf(out))}`)
})

// 5. A supplied term preserves its references at BINDING. This is a binding-level control —
//    participant USE during proposal is proven by case 7, which admits only the term's own.
test("a supplied term keeps its references whole", () => {
    const term = { type: "distance", references: ["A", { frame: "F", value: [0, 0, 0] }], radius: 5, source: null }
    const law = bindLaw({ feature: "distance", endpoints: ["A", "B"], scope: "S", frame: "S", expression: term })
    assert.equal(law.expression.references.length, 2, "both references survive binding")
    assert.deepEqual(law.expression.references[0], "A")
    assert.equal(law.expression.references[1].frame, "F", "the framed second reference is intact")
})

// 6. An invalid term payload is refused at the BOUNDARY. This is not a publication-atomicity
//    witness — an empty stub law store cannot prove that. The accepted prefix surviving a
//    refusal is a scheduler witness (see driven_installation_test).
test("an invalid term payload is refused, and nothing is accepted", () => {
    const s = stub([["T", [0, 0, 0]], ["O", [0, 0, 0]]])
    const term = { type: "position", references: ["T"], frame: "O", axis: null, value: [Infinity, 0, 0], source: null }
    const out = applyLaw({ feature: "position", target: s.frames.get("T"), observer: s.frames.get("O"), owner: null, term }, s.pump, s.world)
    assert.notEqual(out.kind, "commit", "a non-finite payload never commits")
    assert.equal(out.poses ?? null, null, "no accepted prefix is invented")
})

// 7. A supplied term and an unrelated loose target are REJECTED: the law verifies A, so the
//    operation may not move T. (id:laws-payload-boundary)
test("a supplied term and an unrelated loose target are rejected", () => {
    const s = stub([["A", [0, 0, 0]], ["T", [0, 0, 0]], ["O", [0, 0, 0]]])
    const term = { type: "position", references: ["A"], frame: "O", axis: null, value: [0, 0, 0], source: null }
    const out = applyLaw({ feature: "position", target: s.frames.get("T"), observer: s.frames.get("O"), owner: null, term }, s.pump, s.world)
    assert.notEqual(out.kind, "commit", "the operation may not move a frame the law does not name")
})
