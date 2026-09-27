// Pass 2: an authored coordinate joins a distance, in either reach order, and a
// hand request composes both through the built-in continuation.
// (id:relationships-todo-plane-authored)
//
// Run: node --test test/js/laws/coordinate_join_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { stateOf, project, circleCurve, planePatch } from "../../../assets/js/turtling/laws/constraints.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const pos = (f) => frameWorldTransform(f).position.map((n) => +n.toFixed(6))
const onCircle = (p) => Math.abs(p[1]) < 1e-6 && Math.abs(Math.hypot(...p) - 5) < 1e-6

function seat(src, opts = { admit: pass }) {
    const scheduler = buildWorld(opts)
    const host = scheduler.hotSwapChild("host", fork("host", src))
    drive(scheduler)
    return { scheduler, host, A: host.children.get("A") }
}

test("a coordinate joins a distance in either reach order", () => {
    for (const src of [
        "let A\nlet B\nas B do\n  let A.y = 0\n  let A.distance = 5\nend",
        "let A\nlet B\nas B do\n  let A.distance = 5\n  let A.y = 0\nend",
    ]) {
        const { scheduler, A } = seat(src)
        assert.deepEqual(scheduler.laws.active().map((l) => l.feature).sort(), ["coordinate", "distance"])
        assert.ok(onCircle(pos(A)), `${src} -> ${pos(A)}`)
    }
})

test("a hand request composes the circle through the built-in continuation", () => {
    const { scheduler, A } = seat("let A\nlet B\nas B do\n  let A.y = 0\n  let A.distance = 5\nend", {})
    // Request [3,1,3]: y is dropped to the plane, then radially to radius 5.
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation, position: [3, 1, 3] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 5 })
    assert.equal(r.kind, "accept")
    const p = pos(A)
    assert.ok(Math.abs(p[1]) < 1e-6, "on the plane")
    assert.ok(Math.abs(Math.hypot(...p) - 5) < 1e-6, "on the sphere")
    const d = 5 / Math.SQRT2
    assert.ok(Math.abs(p[0] - d) < 1e-5 && Math.abs(p[2] - d) < 1e-5, "nearest point on the circle")
})

test("a coordinate address replaces on the same axis and conjoins across axes", () => {
    const { scheduler } = seat("let A\nlet B\nas B do\n  let A.y = 0\n  let A.y = 1\nend")
    // `A.y = 0` then `A.y = 1` is one address revised, not two truths.
    assert.equal(scheduler.laws.active().filter((l) => l.feature === "coordinate").length, 1)
    assert.equal(scheduler.laws.active()[0].predicate, 1)
})

test("a plane that misses the sphere is a contradiction, installing nothing", () => {
    const { scheduler, A } = seat("let A\nlet B\nas B do\n  let A.distance = 5\n  let A.y = 100\nend")
    assert.equal(scheduler.laws.active().length, 1, "the impossible coordinate does not install")
    assert.equal(scheduler.laws.active()[0].feature, "distance")
    assert.ok(Math.abs(Math.hypot(...pos(A)) - 5) < 1e-6, "the accepted world still satisfies the distance")
})

test("an authored law records what it attempted and why", () => {
    const { scheduler } = seat("let A\nlet B\nas B do\n  let A.distance = 5\n  let A.y = 100\nend")
    const a = scheduler.root._lastAttempt
    assert.equal(a.path, "reach")
    assert.ok(["contradiction", "unresolved", "obstructed"].includes(a.outcome))
    assert.match(String(a.message), /no point in common|plane misses the sphere/)
})

test("the freedom display names the circle, not the sphere", () => {
    const circle = stateOf({ at: [5, 0, 0], constraints: [
        { feature: "distance", other: [0, 0, 0], radius: 5, otherHeld: true },
        { feature: "coordinate", axis: "y", value: 0, plane: { point: [0, 0, 0], normal: [0, 1, 0] } },
    ] })
    assert.equal(circle.locus.kind, "circle")
    assert.equal(circle.dof, 1)

    const plane = stateOf({ at: [5, 0, 0], constraints: [
        { feature: "coordinate", axis: "y", value: 0, plane: { point: [0, 0, 0], normal: [0, 1, 0] } },
    ] })
    assert.equal(plane.locus.kind, "plane")
    assert.equal(plane.dof, 2)

    const uncertain = stateOf({ at: [5, 0, 0], constraints: [
        { feature: "distance", other: [0, 2, 0], radius: 2, otherHeld: true },
        { feature: "coordinate", axis: "y", value: 0, plane: { point: [0, 0, 0], normal: [0, 1, 0] } },
    ] })
    assert.equal(uncertain.locus, null, "an uncertain meet names nothing")
    assert.equal(uncertain.dof, null)
})

test("project lands on the named circle", () => {
    const circle = stateOf({ at: [5, 0, 0], constraints: [
        { feature: "distance", other: [0, 0, 0], radius: 5, otherHeld: true },
        { feature: "coordinate", axis: "y", value: 0, plane: { point: [0, 0, 0], normal: [0, 1, 0] } },
    ] })
    const at = project(circle, [3, 1, 3])
    assert.ok(Math.abs(at[1]) < 1e-9, "on the plane")
    assert.ok(Math.abs(Math.hypot(...at) - 5) < 1e-9, "on the circle")
    assert.ok(Math.abs(at[0] - 5 / Math.SQRT2) < 1e-9 && Math.abs(at[2] - 5 / Math.SQRT2) < 1e-9)
})

test("a lone coordinate projects an off-plane wish onto its plane", () => {
    const { scheduler, A } = seat("let A\nlet B\nas B do\n  let A.y = 0\nend", {})
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation, position: [2, 3, 0] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 3 })
    assert.equal(r.kind, "accept", "a wish off the plane lands on it")
    const p = pos(A)
    assert.ok(Math.abs(p[1]) < 1e-6, "on the plane")
    assert.ok(Math.abs(p[0] - 2) < 1e-6 && Math.abs(p[2]) < 1e-6, "the wish's in-plane part is kept")
})

test("the ghost geometry samples the circle and bounds the plane", () => {
    const curve = circleCurve({ kind: "circle", center: [0, 0, 0], radius: 5, normal: [0, 1, 0] })
    assert.ok(Array.isArray(curve) && curve.length > 8)
    for (const p of curve) {
        assert.ok(Math.abs(p[1]) < 1e-9, "on the plane")
        assert.ok(Math.abs(Math.hypot(...p) - 5) < 1e-9, "on the circle")
    }
    const patch = planePatch({ kind: "plane", point: [0, 0, 0], normal: [0, 1, 0] }, [2, 0, 3])
    assert.equal(patch.corners.length, 5, "a closed loop")
    for (const p of patch.corners) assert.ok(Math.abs(p[1]) < 1e-9, "the patch is in the plane")
    assert.equal(patch.axes.length, 2, "two in-plane tangents")
})

test("two coordinate planes meet in a line the hand can follow", () => {
    const { scheduler, host } = seat("let X\nlet X.y = 20\nlet X.z = 5", {})
    const X = host.children.get("X")
    assert.deepEqual(pos(X), [0, 20, 5])
    const r = scheduler.requestMotion(X, { rotation: X.transform.deref().rotation, position: [7, 1, 1] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 3 })
    assert.equal(r.kind, "accept", "a wish projects onto the line, not refused")
    assert.deepEqual(pos(X), [7, 20, 5], "the unconstrained axis keeps the wish; the rest is fixed")
})

test("the display names a line from two planes and a point from three", () => {
    const cs = [
        { feature: "coordinate", axis: "y", value: 20, plane: { point: [0, 20, 0], normal: [0, 1, 0] } },
        { feature: "coordinate", axis: "z", value: 5, plane: { point: [0, 0, 5], normal: [0, 0, 1] } },
    ]
    const line = stateOf({ at: [0, 20, 5], constraints: cs })
    assert.equal(line.locus.kind, "line")
    assert.equal(line.dof, 1)
    assert.deepEqual(line.locus.dir.map((n) => +n.toFixed(6)), [1, 0, 0])
    assert.deepEqual(project(line, [7, 1, 1]), [7, 20, 5])

    const point = stateOf({ at: [0, 20, 5], constraints: [...cs,
        { feature: "coordinate", axis: "x", value: 3, plane: { point: [3, 0, 0], normal: [1, 0, 0] } }] })
    assert.equal(point.locus.kind, "point")
    assert.equal(point.dof, 0)
})

test("a finite solution set can be explored and crossed", () => {
    // B at the origin; the line y=0,z=0 (the x-axis) meets its radius-5 sphere at (±5,0,0).
    const { scheduler, host } = seat("let X\nlet B\nlet X.y = 0\nlet X.z = 0\nas B do\n  let X.distance = 5\nend", {})
    const X = host.children.get("X")
    const first = pos(X)
    assert.equal(Math.abs(first[0]), 5, "X is on one of the two branches")
    assert.deepEqual([first[1], first[2]], [0, 0])

    // A deliberate move toward the other branch crosses to it.
    const other = first[0] > 0 ? [-14, 0, 0] : [14, 0, 0]
    const r = scheduler.requestMotion(X, { rotation: X.transform.deref().rotation, position: other }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 5 })
    assert.equal(r.kind, "accept")
    assert.equal(Math.sign(pos(X)[0]), -Math.sign(first[0]), "the branch was crossed")
})
