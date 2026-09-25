// The affected component and the bounded analytic tree realization, pure.
// (id:laws-build-p3, id:laws-build-solve-seam)
// Run: node --test test/js/laws/component_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { componentOf, realizeDistanceTree } from "../../../assets/js/turtling/laws/component.js"

const law = (a, b, predicate) => ({ feature: "distance", endpoints: [a, b], predicate })
const worldOf = (positions) => (id) => positions[id]

test("component: the connected set is derived from the law endpoints", () => {
    const l1 = law(1, 2, 5)
    const l2 = law(2, 3, 5)
    const unrelated = law(7, 8, 5)
    const comp = componentOf([l1, l2, unrelated], [1])
    assert.deepEqual([...comp.frames].sort((a, b) => a - b), [1, 2, 3])
    assert.deepEqual(comp.laws, [l1, l2], "the disconnected law is not in the component")
})

test("realize: a chain responds jointly, preserving each edge's original direction", () => {
    const world = worldOf({ 1: [0, 0, 0], 2: [5, 0, 0], 3: [0, 0, 0] })
    const out = realizeDistanceTree([law(1, 2, 10), law(2, 3, 5)], 1, world, (l) => l.predicate)
    assert.deepEqual(out.get(1), [0, 0, 0], "the anchor is held")
    assert.deepEqual(out.get(2), [10, 0, 0], "the revised edge takes its new length")
    assert.deepEqual(out.get(3), [5, 0, 0], "the child stays on the side it was on")
})

test("realize: a cycle, a non-distance law or a missing anchor is unsupported", () => {
    const world = worldOf({ 1: [0, 0, 0], 2: [1, 0, 0], 3: [2, 0, 0] })
    assert.equal(realizeDistanceTree(
        [law(1, 2, 5), law(2, 3, 5), law(3, 1, 5)], 1, world, (l) => l.predicate), null,
        "a cycle is not the analytic case")
    assert.equal(realizeDistanceTree(
        [{ feature: "position", endpoints: [1], predicate: [0, 0, 0] }], 1, world, () => 0), null,
        "a non-distance law is not this case")
    assert.equal(realizeDistanceTree([law(1, 2, 5)], 9, world, (l) => l.predicate), null,
        "a missing anchor is unsupported")
})

test("realize: a negative or non-finite radius is refused", () => {
    const world = worldOf({ 1: [0, 0, 0], 2: [5, 0, 0] })
    assert.equal(realizeDistanceTree([law(1, 2, -1)], 1, world, (l) => l.predicate), null)
    assert.equal(realizeDistanceTree([law(1, 2, NaN)], 1, world, (l) => l.predicate), null)
})
