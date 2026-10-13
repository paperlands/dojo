// Query uncertainty and redundant truth, at the VIEW boundary.
//
//   - An unavailable contribution is NAMED, not silently dropped: the affordance must never
//     advertise freedom it has not established, and a refusal is never read as "pinned" or
//     "mathematically impossible". Accepted geometry stands as observation. (D058)
//   - A verified tautology constrains NOTHING, so it can never disable an otherwise supported
//     meet. A zero distance is a POINT on both sides — set and record. (id:laws-freedom)
import { test } from "node:test"
import assert from "node:assert/strict"

import { pointQuery, constraintsView, AUTHORED } from "../../../assets/js/turtling/laws/authored.js"
import { bindLaw } from "../../../assets/js/turtling/laws/replacement.js"
import { stateOf } from "../../../assets/js/turtling/laws/constraints.js"
import { INAPPLICABLE } from "../../../assets/js/turtling/laws/verdict.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const I = SE3.identity()
const ctxOf = (other = null) => ({
    worldOf: (id) => (id === "A" ? [0, 1, 0] : other),
    placementOf: () => I, livePoseOf: () => I, writerId: "A",
})
const lawOf = (feature, term, predicate, axis = null) =>
    bindLaw({ feature, endpoints: ["A"], scope: "S", frame: "S", predicate, axis, expression: term })

const Y = lawOf("coordinate", { type: "coordinate", references: ["A"], frame: "S", axis: "y", value: 1 }, 1, "y")

test("an obligation to a missing participant is named in the view, never silently dropped", () => {
    const ghost = lawOf("distance", { type: "distance", references: ["A", "GHOST"], radius: 5 }, 5)
    const view = constraintsView("A", [ghost], ctxOf())
    assert.equal(view.complete, false, "the query is incomplete")
    assert.equal(view.constraints.length, 0, "no geometry survives")
    assert.equal(view.unavailable.length, 1, "but the contribution is REPORTED")
    assert.equal(view.unavailable[0].feature, "distance")

    // The display state keeps the accepted geometry as observation and refuses to offer motion.
    const state = stateOf({ at: [0, 1, 0], unavailable: view.unavailable, constraints: view.constraints })
    assert.equal(state.status, "previous", "accepted geometry stands as observation, not as an offer")
    assert.equal(state.dof, 0, "and no unestablished freedom is advertised")
    assert.deepEqual(state.at, [0, 1, 0], "the last accepted geometry is kept")
    assert.equal(state.refusal?.kind, "unsupported", "the refusal is named")
    assert.notEqual(state.tag, "pinned", "and is NOT read as pinned")
})

test("a supported query with no available motion is not a refusal", () => {
    const state = stateOf({ at: [0, 1, 0], constraints: pointQuery("A", [Y], ctxOf()).constraints })
    assert.equal(state.status, "accepted")
    assert.equal(state.refusal, null, "no refusal when every contribution is available")
    assert.ok(state.dof > 0, "and the motion it HAS is advertised")
})

test("a verified tautology is neutral: it never disables a supported meet", () => {
    const tautology = lawOf("distance", { type: "distance", references: ["A", "A"], radius: 0 }, 0)
    const alone = pointQuery("A", [Y], ctxOf())
    const withTautology = pointQuery("A", [Y, tautology], ctxOf())

    assert.equal(withTautology.complete, true, "the meet is still formed")
    assert.deepEqual(withTautology.sets.map((s) => s.kind), alone.sets.map((s) => s.kind), "identically")
    assert.equal(withTautology.unavailable.length, 0, "and the tautology is not 'unavailable'")

    const a = stateOf({ at: [0, 1, 0], constraints: alone.constraints, unavailable: alone.unavailable })
    const b = stateOf({ at: [0, 1, 0], constraints: withTautology.constraints, unavailable: withTautology.unavailable })
    assert.equal(b.dof, a.dof, "the tautology changes no capability")
    assert.equal(b.locus?.kind, a.locus?.kind)
})

test("a zero distance is a POINT on both sides: the set and its record agree", () => {
    const coincidence = lawOf("distance", { type: "distance", references: ["A", "B"], radius: 0 }, 0)
    const q = pointQuery("A", [coincidence], ctxOf([4, 1, 0]))
    const record = q.constraints[0]
    const set = q.sets[0]
    assert.equal(record.feature, "distance")
    assert.equal(set.kind, "point", "the query contributes a point, not a zero-radius sphere")
    assert.deepEqual(set.at, [4, 1, 0])
    assert.deepEqual(record.set, set, "one representation, not two")
})

test("a record keeps what a SET cannot tell us: authored meaning and policy, not geometry", () => {
    const c = AUTHORED.coordinate.constraint(Y, ctxOf())
    assert.equal(c.axis, "y", "the authored axis survives")
    assert.equal(c.value, 1, "the authored scalar survives")
    assert.equal(c.set.kind, "plane", "the geometry is the set")
    assert.equal(c.plane, undefined, "and is not duplicated beside it")

    const d = AUTHORED.distance.constraint(
        lawOf("distance", { type: "distance", references: ["A", "B"], radius: 5 }, 5),
        { ...ctxOf([5, 0, 0]), heldOf: () => true })
    assert.equal(d.otherHeld, true, "the policy fact survives — a set cannot tell held from free")
    assert.equal(d.set.kind, "sphere", "the geometry is the set")
    assert.equal(d.other, undefined, "and is not duplicated beside it")
    assert.equal(d.radius, undefined)
})

test("a fixed numeric pin's geometry needs no owner placement reader", () => {
    const pin = lawOf("position", { type: "position", references: ["A"], frame: "S", value: [1, 2, 3] }, [1, 2, 3])
    const blind = { worldOf: () => [1, 2, 3], placementOf: () => null, livePoseOf: () => null, writerId: "A" }
    const view = constraintsView("A", [pin], blind)
    assert.equal(view.complete, true)
    assert.deepEqual(view.unavailable, [])
    assert.equal(view.constraints.length, 1)
    assert.equal(view.constraints[0].pinned, true)
    assert.deepEqual(view.constraints[0].set.at, [1, 2, 3])
    const state = stateOf({ at: [1, 2, 3], unavailable: view.unavailable, constraints: view.constraints })
    assert.equal(state.status, "accepted")
    assert.equal(state.truth.pinned, true)
})

test("a candidate outcome vocabulary: stale, inapplicable and rejected are distinct", () => {
    // `INAPPLICABLE` is a shared, frozen sentinel — the caller tries the next producer.
    assert.ok(Object.isFrozen(INAPPLICABLE))
    assert.deepEqual(INAPPLICABLE, { kind: "inapplicable" })
    assert.notEqual(INAPPLICABLE, null, "`null` is never overloaded")
})
