// A vector literal `[x,y]` is a displacement from the declaring frame's LIVE head — a
// moving centre, distinct from the placement-framed `(x,y)` / `origin`.
// (id:laws-distance-literal-address)
//
//   distance(A, origin)  → F's placement origin      (stable)
//   distance(A, (x,y))   → a point in F's placement   (stable)
//   distance(A, [x,y])   → F's live head ∘ [x,y]      (live, moving)
// Run: node --test test/js/laws/vector_centre_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { validityDependents } from "../../../assets/js/turtling/laws/component.js"
import { buildWorld, fork, drive } from "./harness.mjs"

const pos = (f) => (f ? frameWorldTransform(f).position.map((n) => +n.toFixed(4)) : null)
const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) { const hit = find(child, name); if (hit) return hit }
    return null
}
function run(source) {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", source))
    drive(scheduler, { maxTicks: 60 })
    return { scheduler, host, A: find(host, "A"), F: find(host, "F") }
}
const distanceLaws = (scheduler) => scheduler.laws.active().filter((l) => l.feature === "distance")

test("vector 1: A reaches the vector centre; no extra identity or position law", () => {
    const { scheduler, host, A } = run("let A\nlet distance(A, [2,0,0]) = 5")
    assert.equal(host.error, null)
    assert.deepEqual([...host.children.keys()], ["A"], "no synthetic identity")
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature), ["distance"], "no position law")
    assert.deepEqual(pos(A), [-3, 0, 0], "five from [2,0,0]")
})

test("vector 2: the address tags a relative centre distinctly from a framed one", () => {
    const vec = distanceLaws(run("let A\nlet distance(A, [2,0,0]) = 5").scheduler)[0]
    const framed = distanceLaws(run("let A\nlet distance(A, (2,0)) = 5").scheduler)[0]
    assert.notEqual(vec.address, framed.address, "same coords, different aspect, different relationship")
    const refs = vec.expression.references
    assert.equal(refs.find((r) => typeof r === "object").relative, true, "the term carries the relative flag")
})

test("vector 3: validity reads the frame's live position, not its placement", () => {
    const { scheduler, host } = run("let A\nlet distance(A, [2,0,0]) = 5")
    const law = distanceLaws(scheduler)[0]
    assert.deepEqual(validityDependents([law], [{ id: host.id, aspect: "position" }]).map((l) => l.feature), ["distance"],
        "the relative centre reads F's live head")
    assert.deepEqual(validityDependents([law], [{ id: host.id, aspect: "placement" }]), [],
        "a relative centre is not a placement read")
})

test("vector 4: the centre is the head, so it diverges from a coordinate once the head commits", () => {
    const BODY = (spelling) => `as F do\n  rt 90\n  fw 10\n  wait 1\n  let A\n  let distance(A, ${spelling}) = 5\nend`
    const vec = run(BODY("[2,0,0]"))
    const coord = run(BODY("(2,0)"))
    assert.notDeepEqual(pos(vec.A), pos(coord.A), "the head-relative and placement-relative centres differ")
    // The vector centre is the frame's live pose applied to the displacement.
    const centre = SE3.apply(frameWorldTransform(vec.F), [2, 0, 0])
    const at = frameWorldTransform(vec.A).position
    assert.ok(Math.abs(Math.hypot(...at.map((x, i) => x - centre[i])) - 5) < 1e-6, "A is five from the head-relative centre")
})

test("vector 5: the hand composes against the vector centre", () => {
    const { scheduler, A } = run("let A\nlet distance(A, [2,0,0]) = 5")
    const r = scheduler.requestMotion(A, { rotation: frameWorldTransform(A).rotation, position: [10, 0, 0] },
        scheduler.motionRevision, "world")
    assert.equal(r.kind, "accept")
    const at = frameWorldTransform(A).position
    assert.ok(Math.abs(Math.hypot(at[0] - 2, at[1], at[2]) - 5) < 1e-6, "A stays on the sphere about [2,0,0]")
})

test("vector 6: either input order installs and answers the hand", () => {
    for (const source of ["let A\nlet distance(A, [2,0,0]) = 5", "let A\nlet distance([2,0,0], A) = 5"]) {
        const { scheduler, host, A } = run(source)
        assert.equal(host.error, null, source)
        assert.equal(host.unresolved, null, source)
        const r = scheduler.requestMotion(A, { rotation: frameWorldTransform(A).rotation, position: [0, 0, 0] },
            scheduler.motionRevision, "world")
        assert.equal(r.kind, "accept", source)
    }
})

test("vector 7: a two-coordinate or signed vector parses like a coordinate", () => {
    const two = run("let A\nlet distance(A, [3,4]) = 5")
    assert.deepEqual(two.scheduler.laws.active()[0].expression.references[1].value, [3, 4, 0], "padded to three")
    const signed = run("let A\nlet distance(A, [-2,0]) = 5")
    assert.deepEqual(signed.scheduler.laws.active()[0].expression.references[1].value, [-2, 0, 0])
})
