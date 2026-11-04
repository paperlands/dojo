// A literal centre is a framed value input within the distance relationship — not a
// new position law, not a synthetic participant, not a separate authority.
// (id:laws-distance-literal-address, id:laws-free-relations-contract)
//
//   View                A ↔ framed literal
//   Solve participants  A only
//   Validity references A position, F placement
//   Measurement         distance between resolved world points
//   Ownership           existing addressed replacement
//   Realization         existing bounded methods where applicable
// Run: node --test test/js/laws/literal_centre_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { frameWorldTransform, worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { bindLaw, addressOf, createLawStore } from "../../../assets/js/turtling/laws/replacement.js"
import { AUTHORED, bindWorld, boundTerm, boundParticipants, boundReferences, inputFrames, inputPosition, constraintsOn } from "../../../assets/js/turtling/laws/authored.js"
import { componentOf } from "../../../assets/js/turtling/laws/component.js"
import { heldIdentity } from "../../../assets/js/turtling/laws/constraints.js"
import { buildWorld, fork, drive } from "./harness.mjs"

const framed = (frame, value) => ({ frame, value })
const mk = (references, radius = 5, predicate = radius) => bindLaw({
    feature: "distance", endpoints: references.filter((r) => typeof r !== "object"), scope: "S", frame: "S",
    predicate, expression: { type: "distance", references, radius },
})
const ctxOf = (positions, frames = {}) => ({
    worldOf: (id) => positions[id] ?? null,
    placementOf: (id) => frames[id] ?? (id === "F" ? SE3.identity() : null),
})
const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) { const hit = find(child, name); if (hit) return hit }
    return null
}

test("literal centre: solve participants are live only; validity names the centre's frame", () => {
    const law = mk(["A", framed("F", [2, 0, 0])])
    assert.deepEqual(law.endpoints, ["A"], "the solve mirror holds the live endpoint only")
    assert.deepEqual(boundParticipants(law), ["A"], "the framed value is never a solve participant")
    assert.deepEqual(boundReferences(law), [
        { id: "A", aspect: "position" },
        { id: "F", aspect: "placement" },
    ])
    assert.deepEqual(inputFrames(law), ["F"], "the framed frame is a retraction dep, not an endpoint")
    assert.deepEqual([...componentOf([law], ["A"]).frames], ["A"], "solve connectivity excludes the framed frame")
})

test("literal centre: measurement is the distance between resolved world points", () => {
    const law = mk(["A", framed("F", [2, 0, 0])])
    assert.equal(AUTHORED.distance.measure(law, ctxOf({ A: [7, 0, 0] })).status, "valid", "|7 - 2| = 5")
    assert.equal(AUTHORED.distance.measure(law, ctxOf({ A: [8, 0, 0] })).status, "violation")
    // A moved frame moves the centre; the reading follows the placement, not a stored number.
    const turned = SE3.rotateLocal(SE3.identity(), { x: 0, y: 0, z: 1 }, 90)
    const moved = AUTHORED.distance.measure(law, ctxOf({ A: [7, 0, 0] }, { F: turned }))
    assert.equal(moved.status, "violation", "the framed centre is read through the frame's placement")
})

test("literal centre: the address keys on participants and centre, never the radius", () => {
    const base = mk(["A", framed("F", [2, 0, 0])])
    assert.equal(addressOf(base), addressOf(mk(["A", framed("F", [2, 0, 0])], 10)),
        "radius 5 -> 10 revises the same relationship")
    assert.notEqual(addressOf(base), addressOf(mk(["A", framed("F", [3, 0, 0])])),
        "a different centre is a different relationship")
    assert.equal(addressOf(base), addressOf(mk([framed("F", [2, 0, 0]), "A"])),
        "reversal in the same scope/frame reaches the same address")
    assert.notEqual(addressOf(base), addressOf(bindLaw({ feature: "distance", endpoints: ["A"], scope: "T", frame: "T",
        predicate: 5, expression: { type: "distance", references: ["A", framed("F", [2, 0, 0])], radius: 5 } })),
        "a different declaring scope is a different context")
})

test("literal centre: the framed value is an input, never an actor or a pin", () => {
    const law = mk(["A", framed("F", [2, 0, 0])])
    const input = boundTerm(law).references[1]
    assert.deepEqual(input, { frame: "F", value: [2, 0, 0] }, "a framed value descriptor, not an identity")
    assert.ok(Object.isFrozen(input) && Object.isFrozen(input.value), "the framed input is copied and frozen")
    // No position/pin law, no synthetic identity: only the distance relationship exists.
    const store = createLawStore()
    store.apply(law)
    assert.deepEqual(store.active().map((l) => l.feature), ["distance"])
    assert.deepEqual(store.active()[0].endpoints, ["A"])
})

test("literal centre: a zero distance to a framed centre holds the point there", () => {
    const A = { id: "A" }
    const registry = { get: (id) => (id === "A" ? A : null) }
    const zero = mk(["A", framed("F", [2, 0, 0])], 0)
    assert.equal(heldIdentity(A, [zero], registry), true, "a coincident fixed centre holds the point")
})

test("literal centre: removing the framed frame retracts the relationship", () => {
    const store = createLawStore()
    store.apply(mk(["A", framed("F", [2, 0, 0])]))
    assert.equal(store.count(), 1)
    assert.equal(store.retractIdentity("F"), "retracted", "the framed frame's loss retracts the law")
    assert.equal(store.count(), 0)
})

test("literal centre: the hand composes against the framed centre, no actor or pin installed", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let A"))
    drive(scheduler)
    const A = host.children.get("A")
    const law = bindLaw({ feature: "distance", endpoints: [A.id], scope: host.id, frame: host.id, predicate: 5,
        expression: { type: "distance", references: [A.id, { frame: host.id, value: [2, 0, 0] }], radius: 5 } })
    scheduler.laws.apply(law)
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature), ["distance"], "no position law is installed")
    const r = scheduler.requestMotion(A, { rotation: frameWorldTransform(A).rotation, position: [2, 0, 0] },
        scheduler.motionRevision, "world")
    assert.equal(r.kind, "accept", "the framed distance is a supported realisation")
    const at = frameWorldTransform(A).position
    assert.ok(Math.abs(Math.hypot(at[0] - 2, at[1], at[2]) - 5) < 1e-6, "A lands on the sphere about the framed centre")
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature), ["distance"], "the hand installed no pin")
})

test("literal centre: the typed address is injective — no token or delimiter collides", () => {
    const law = (references) => bindLaw({ feature: "distance", endpoints: references.filter((r) => typeof r !== "object"),
        scope: "S", frame: "S", predicate: 5, expression: { type: "distance", references, radius: 5 } })
    assert.notEqual(addressOf(law(["A", 1])), addressOf(law(["A", "1"])), "a number and its string are distinct")
    assert.notEqual(addressOf(law(["A|live:B", "C"])), addressOf(law(["A", "B|live:C"])),
        "a delimiter inside a token cannot shift a boundary")
    assert.notEqual(addressOf(law(["A", "framed:F:0,0,0"])), addressOf(law(["A", { frame: "F", value: [0, 0, 0] }])),
        "a framed value never replaces a live pair")
    assert.equal(addressOf(law(["A", 1])), addressOf(law([1, "A"])), "reversal canonicalizes")
})

// The boundary that broke: the law's own measurement and the displayed locus must read
// the SAME relative centre — while the declaring frame is moving and rotated, and under a
// candidate override. (id:laws-distance-literal-address)
test("boundary: law measurement and displayed locus agree for a moving, rotated relative centre", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host",
        "as F do\n  rt 90\n  fw 10\n  wait 1\n  let A\n  let distance(A, [2,0,0]) = 5\nend"))
    drive(scheduler, { maxTicks: 60 })
    const F = find(host, "F"), A = find(host, "A")
    const laws = scheduler.laws.active()
    const law = laws.find((l) => l.feature === "distance")
    const ref = law.expression.references.find((r) => r && r.relative)
    const reader = (overrides) => bindWorld((id) => scheduler.registry.get(id), {
        live: (f) => (overrides?.has(f)
            ? { position: SE3.compose(worldTransform(f), overrides.get(f)).position, rotation: SE3.compose(worldTransform(f), overrides.get(f)).rotation }
            : frameWorldTransform(f)),
        placement: (f) => worldTransform(f),
    })
    const near = (a, b, why) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-6, why))
    const measured = inputPosition(ref, reader(null))
    const displayed = constraintsOn(A.id, laws, { ...reader(null), writerId: A.id })
        .find((c) => c.feature === "distance")
    near(displayed.set.center, measured, "the displayed locus and the law measure the same centre")
    near(measured, SE3.apply(frameWorldTransform(F), [2, 0, 0]), "the centre stands on F's rotated live head")
    // A candidate override moves the head, and the law follows it.
    const override = new Map([[F, { rotation: SE3.identity().rotation, position: [1, 1, 0] }]])
    const moved = inputPosition(ref, reader(override))
    near(moved, SE3.apply(SE3.compose(worldTransform(F), override.get(F)), [2, 0, 0]), "the overridden head carries the centre")
    assert.ok(Math.hypot(...moved.map((x, i) => x - measured[i])) > 1e-3, "the override actually moved it")
})
