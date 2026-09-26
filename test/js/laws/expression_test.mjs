// Typed, framed predicates: the relation vocabulary, guards, bounds and address
// stability. (id:laws-build-p3a, id:eval-relational)
// Run: node --test test/js/laws/expression_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { KIND, RELATION, kindOf, predicateOk, boundsOf, boundedValue } from "../../../assets/js/turtling/laws/expression.js"
import { bindLaw } from "../../../assets/js/turtling/laws/replacement.js"

test("vocabulary: the law relations are the evaluator's RELATIONAL and SPATIAL", () => {
    assert.equal(RELATION.distance.family, "relational")
    assert.equal(RELATION.bearing.family, "relational")
    assert.equal(RELATION.sync.family, "relational")
    for (const property of ["x", "y", "z", "heading", "elevation", "position"]) {
        assert.equal(RELATION[property].family, "spatial", `${property} is a spatial property`)
    }
})

test("kind: distance is a length, bearing and heading angles, sync a duration", () => {
    assert.equal(kindOf("distance"), KIND.length)
    assert.equal(kindOf("bearing"), KIND.angle)
    assert.equal(kindOf("heading"), KIND.angle)
    assert.equal(kindOf("sync"), KIND.duration)
    assert.equal(kindOf("position"), KIND.point)
})

test("guard: the domain is bound to the relation, and a negative length is out", () => {
    assert.equal(predicateOk("distance", 5), true)
    assert.equal(predicateOk("distance", -5), false)
    assert.equal(predicateOk("distance", NaN), false)
    assert.equal(predicateOk("bearing", -90), true, "a bearing is signed")
    assert.equal(predicateOk("sync", -3), true, "sync is signed")
    assert.equal(predicateOk("position", [1, 2, 3]), true)
    assert.equal(predicateOk("position", [1, 2]), false)
})

test("bounds: a length slider is lower-bounded at zero; a bearing is unbounded", () => {
    assert.deepEqual(boundsOf("distance"), { min: 0, max: Infinity })
    assert.equal(boundsOf("bearing"), null)
    assert.equal(boundedValue(-3, boundsOf("distance")), 0, "a negative input is clamped")
    assert.equal(boundedValue(7, boundsOf("distance")), 7)
})

test("bound law: lowering preserves identities, relation, kind, guard and ownership", () => {
    const law = bindLaw({ feature: "distance", endpoints: [1, 2], scope: 2, frame: 2,
        predicate: 5, owner: { line: 3 } })
    assert.equal(law.relation, "distance", "the evaluator's relation name survives")
    assert.equal(law.kind, KIND.length)
    assert.deepEqual(law.guards, { finite: true, nonNegative: true })
    assert.deepEqual(law.bounds, { min: 0, max: Infinity })
    assert.deepEqual([...law.sourceIds].sort((a, b) => a - b), [1, 2], "the endpoint identities survive")
    assert.equal(law.owner.line, 3, "source ownership survives")
})

test("address: revising the one scalar payload keeps the address", () => {
    const field = { feature: "distance", endpoints: [1, 2], scope: 2, frame: 2 }
    const first = bindLaw({ ...field, predicate: 5, owner: { line: 1 } })
    const second = bindLaw({ ...field, predicate: 10, owner: { line: 2 } })
    assert.equal(first.address, second.address, "the value is not part of the address")
    assert.notDeepEqual(first.owner, second.owner, "but the owner moves")
})
