// The pure placement core on its own: laws, frames, a wish and captured positions in; world
// positions out. No scheduler and no adapter. Its production caller is the actor's program
// proposal (verdict.js::programFollowing); the ordinary hand still uses continueLaws.
// (id:laws-free-relations-review, id:laws-free-relations-compositional-center)
//
// Run: node --test test/js/laws/following_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { nearestChild, treeShape, treeFold, bondOf } from "../../../assets/js/turtling/laws/following.js"

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const law = (a, b, radius) => ({ feature: "distance", endpoints: [a, b],
    expression: { type: "distance", references: [a, b], radius } })
const frames = (...ids) => new Set(ids)

// An independent recurrence: each child on the sphere about its PLACED parent, nearest its own
// accepted position. Written from the request, not from the core.
function recurrence({ rootId, wish, order, accepted }) {
    const placed = new Map([[rootId, [...wish]]])
    for (const { parent, child, radius } of order) {
        const centre = placed.get(parent), at = accepted[child]
        const d = at.map((v, i) => v - centre[i])
        const L = Math.hypot(...d)
        placed.set(child, centre.map((v, i) => v + (radius * d[i]) / L))
    }
    return placed
}

test("a turning trace matches an independent recurrence", () => {
    const ids = [1, 2, 3]
    const shape = treeShape([law(1, 2, 5), law(2, 3, 5)], frames(...ids), 1)
    assert.ok(shape, "the chain is inside the method")
    const accepted = { 1: [0, 0, 0], 2: [5, 0, 0], 3: [10, 0, 0] }
    const edges = shape.order.map((e) => ({ ...e, at: accepted[e.child], bond: [1, 0, 0] }))
    const wish = [1, 1, 0]   // not exactly 5 from child 2, so the second segment must yaw
    const placed = treeFold({ rootId: 1, root: wish, edges })
    const reference = recurrence({ rootId: 1, wish, order: shape.order, accepted })
    for (const id of ids) assert.ok(dist(placed.get(id), reference.get(id)) < 1e-9, `${id}`)
    // and every edge is a length, not a straight line: the second segment yaws
    assert.ok(Math.abs(dist(placed.get(1), placed.get(2)) - 5) < 1e-9)
    assert.ok(Math.abs(dist(placed.get(2), placed.get(3)) - 5) < 1e-9)
    assert.ok(Math.abs(placed.get(3)[1] - accepted[3][1]) > 1e-6, "the far end moved off its old row")
})

test("a collinear root needs no yaw: the fold keeps the row", () => {
    const shape = treeShape([law(1, 2, 5), law(2, 3, 5)], frames(1, 2, 3), 1)
    const accepted = { 1: [0, 0, 0], 2: [5, 0, 0], 3: [10, 0, 0] }
    const edges = shape.order.map((e) => ({ ...e, at: accepted[e.child], bond: [1, 0, 0] }))
    const placed = treeFold({ rootId: 1, root: [2, 0, 0], edges })
    assert.ok(Math.abs(placed.get(2)[1]) < 1e-9 && Math.abs(placed.get(3)[1]) < 1e-9)
    assert.deepEqual([...placed.get(3)].map((n) => +n.toFixed(9)), [12, 0, 0])
})

test("the answer does not depend on how the laws were stored or spelled", () => {
    const forward = treeShape([law(1, 2, 5), law(2, 3, 5), law(3, 4, 5)], frames(1, 2, 3, 4), 1)
    const reversed = treeShape([law(4, 3, 5), law(3, 2, 5), law(2, 1, 5)], frames(1, 2, 3, 4), 1)
    const accepted = { 1: [0, 0, 0], 2: [5, 0, 0], 3: [10, 0, 0], 4: [15, 0, 0] }
    const fold = (shape) => treeFold({ rootId: 1, root: [1, 2, 0],
        edges: shape.order.map((e) => ({ ...e, at: accepted[e.child], bond: [1, 0, 0] })) })
    const a = fold(forward), b = fold(reversed)
    for (const id of [1, 2, 3, 4]) assert.ok(dist(a.get(id), b.get(id)) < 1e-9, `${id}`)
})

test("the domain is declined, never narrowed", () => {
    assert.equal(treeShape([law(1, 2, 5), law(2, 3, 5), law(3, 1, 5)], frames(1, 2, 3), 1), null, "a cycle")
    assert.equal(treeShape([law(1, 2, 5), { feature: "distance", endpoints: [2] }], frames(1, 2), 1),
        null, "a literal endpoint")
    assert.equal(treeShape([law(1, 2, 5), law(1, 2, 6)], frames(1, 2), 1), null, "two radii for one pair")
    assert.equal(treeShape([law(1, 2, 5), law(2, 9, 5)], frames(1, 2), 1), null, "a node outside the component")
    assert.equal(treeShape([{ feature: "tilt", endpoints: [1, 2] }], frames(1, 2), 1), null, "a mixed facet")
    assert.equal(treeShape([law(1, 2, -5)], frames(1, 2), 1), null, "a negative radius")
    // a self-zero is neutral, and a duplicate equal support is ONE edge
    const dup = treeShape([law(1, 2, 5), law(1, 2, 5)], frames(1, 2), 1)
    assert.ok(dup && dup.order.length === 1, "two equal supports collapse to one edge")
    assert.equal(treeShape([law(1, 1, 0), law(1, 2, 5)], frames(1, 2), 1).order.length, 1, "a self-zero is neutral")
})

test("a foreign root and an unreadable wish are refused, not answered", () => {
    // The root must belong to the component it roots: an empty law set over a foreign id is not
    // a shape, it is a mistake. And a wish that cannot be read has no placement at all.
    assert.equal(treeShape([], new Set([1]), 2), null, "a root outside the component")
    assert.equal(treeShape([law(1, 2, 5)], new Set([1, 2]), 3), null, "a root with no laws of its own")
    assert.equal(treeFold({ rootId: 1, root: [NaN, 0, 0], edges: [] }), null, "an unreadable wish")
    assert.equal(treeFold({ rootId: 1, root: [0, 0, Infinity], edges: [] }), null, "and an infinite one")
    assert.ok(treeFold({ rootId: 1, root: [0, 0, 0], edges: [] }), "a readable wish still places")
})

test("the kernel keeps its length promise: zero coincides, singular bonds are directions", () => {
    const centre = [1, 2, 3]
    const zero = nearestChild({ centre, at: [40, 0, 0], radius: 0 })
    assert.deepEqual(zero, centre)
    assert.notStrictEqual(zero, centre, "a proposal does not alias its input")
    const huge = nearestChild({ centre: [0, 0, 0], at: [0, 0, 0], radius: 1e9,
        bond: [1 + 5e-13, 0, 0] })
    assert.ok(Math.abs(dist(huge, [0, 0, 0]) - 1e9) < 1e-6, "near-unit bonds do not scale the radius")
    const long = nearestChild({ centre: [0, 0, 0], at: [0, 0, 0], radius: 5, bond: [3, 4, 0] })
    assert.ok(Math.abs(dist(long, [0, 0, 0]) - 5) < 1e-12, "a bond is a direction, not a length")
    assert.deepEqual(bondOf({ parentId: 1, childId: 2, axis: [1, 0, 0] }), [1, 0, 0])
    assert.ok(dist(bondOf({ parentId: 2, childId: 1, axis: [1, 0, 0] }), [-1, 0, 0]) < 1e-12)
    for (const request of [
        { centre: [NaN, 0, 0], at: [0, 0, 0], radius: 5 },
        { centre: [0, 0, 0], at: [NaN, 0, 0], radius: 5 },
        { centre: [0, 0, 0], at: [0, 0, 0], radius: 5, bond: [0, 0, 0] },
        { centre: [0, 0, 0], at: [1, 0, 0], radius: -1 },
    ]) assert.equal(nearestChild(request), null, "invalid inputs are not singular fallbacks")
})
