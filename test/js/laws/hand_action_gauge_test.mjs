// Circle phase is one axial vector in the baseline frame: ±n spellings are one turn, identity
// and accepted state are exact, an orthogonal non-half-turn chart is inapplicable. The two
// measured outcomes: an order-swap mirror, and a rejected largest-component sign gauge.
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive, worldOf } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { actionBetween, applyAction, composeActions } from "../../../assets/js/turtling/laws/action.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { SE3, AXIS_Y, AXIS_Z } from "../../../assets/js/turtling/se3.js"

const near = (actual, expected) => assert.ok(actual && Math.hypot(...actual.map((x, i) => x - expected[i])) < 1e-8,
    `${actual} != ${expected}`)
const circle = (normal) => ({ kind: "circle", center: [0, 0, 0], normal, radius: 5 })
const spin = (axis, radians, p) => Versor.fromAxisAngle({ x: axis[0], y: axis[1], z: axis[2] }, radians * 180 / Math.PI)
    .rotateVec(...p)
const unit = (v) => { const l = Math.hypot(...v); return v.map(x => x / l) }
const move = (s, a, position) => {
    const verdict = s.requestMotion(a, { ...a.transform.deref(), position }, s.motionRevision)
    assert.equal(verdict.kind, "accept", verdict.message)
    return verdict
}
const seat = (s, source, key = "host") => {
    const host = s.hotSwapChild(key, fork(key, source))
    drive(s)
    assert.deepEqual(s.errors, [])
    return host
}

// --- real engine: equivalent truths, other spelling, same replay ---------------------
test("swapping two equivalent distance laws does not mirror the retained circle phase", () => {
    // Two spheres whose intersection is the z=0 circle, radius 8. meetSphereSphere orients
    // that circle by argument order, so the second spelling reads the normal as -z.
    const pair = (first, second) => `goto 8 0 0
let a
let distance(a, (0,0,${first})) = 10
let distance(a, (0,0,${second})) = 10`
    const s = buildWorld()
    let a = seat(s, pair(-6, 6)).children.get("a")
    near(worldOf(a), [8, 0, 0])
    move(s, a, [0, 8, 0])
    const accepted = [...frameWorldTransform(a).position]
    assert.ok(accepted[1] > 1, `the drag landed off the axis: ${accepted}`)

    a = seat(s, pair(6, -6)).children.get("a")
    near(frameWorldTransform(a).position, accepted)
    assert.ok(Math.abs(frameWorldTransform(a).position[1] + accepted[1]) > 1, "not the mirrored replay")

    // Same truths with no hand input: the source baseline is untouched by either spelling.
    near(worldOf(seat(buildWorld(), pair(6, -6)).children.get("a")), [8, 0, 0])
})

// --- gauge, sign, half turn ---------------------------------------------------------
test("a circle phase is gauge-free under n -> -n and under scaling the normal", () => {
    const action = actionBetween(circle([0, 0, 1]), [5, 0, 0], [0, 5, 0])
    for (const normal of [[0, 0, 1], [0, 0, -1], [0, 0, 7], [0, 0, -1e-6]])
        near(applyAction(action, circle(normal), [5, 0, 0]), [0, 5, 0])
})

test("an ordinary negative phase and an exact half turn replay identically under -n", () => {
    const back = actionBetween(circle([0, 0, 1]), [5, 0, 0], [0, -5, 0])
    near(applyAction(back, circle([0, 0, 1]), [5, 0, 0]), [0, -5, 0])
    near(applyAction(back, circle([0, 0, -1]), [5, 0, 0]), [0, -5, 0])

    const half = actionBetween(circle([0, 0, 1]), [5, 0, 0], [-5, 0, 0])
    near(applyAction(half, circle([0, 0, 1]), [5, 0, 0]), [-5, 0, 0])
    near(applyAction(half, circle([0, 0, -1]), [5, 0, 0]), [-5, 0, 0])
})

// --- continuity: a continuous plane change is a continuous replay -------------------
test("a continuously changing plane normal never flips the retained phase", () => {
    const PHI = Math.PI / 3, base = [0, 0, 5]          // on every swept plane (all contain +z)
    const dragN = unit([1, -(1 - 1e-2), 0])
    const target = (n) => spin(n, PHI, base)
    const action = actionBetween(circle(dragN), base, target(dragN))
    for (const eps of [-1e-2, -1e-4, -1e-6, 0, 1e-6, 1e-4, 1e-2]) {
        const n = unit([1, -(1 + eps), 0])
        const played = applyAction(action, circle(n), base)
        near(played, target(n))                        // same intent, no jump across the tie
        near(applyAction(action, circle(n.map((x) => -x)), base), played)   // and gauge-free
    }
})

// --- partial domain: inapplicability is not identity -------------------------------
test("an orthogonal chart is inapplicable, while an identity turn stays identity", () => {
    const quarter = actionBetween(circle([0, 0, 1]), [5, 0, 0], [0, 5, 0])
    assert.equal(applyAction(quarter, circle([1, 0, 0]), [5, 0, 0]), null)
    // Capability is a direction fact: scaling the normal or the turn cannot change it.
    assert.equal(applyAction(quarter, circle([1e6, 0, 0]), [5, 0, 0]), null)
    assert.equal(applyAction({ kind: "circle", phaseVector: [0, 0, 1e-6] }, circle([1, 0, 0]), [5, 0, 0]), null)
    assert.ok(applyAction(quarter, circle([1e-6, 0, 1]), [5, 0, 0]))
    near(applyAction({ kind: "circle", phaseVector: [0, 0, 0] }, circle([1, 0, 0]), [5, 0, 0]), [5, 0, 0])
})

// --- composition: same line, cancellation, wrap, and the honest refusal ------------
test("circle turns compose only about one line, with a canonical wrap", () => {
    const quarter = actionBetween(circle([0, 0, 1]), [5, 0, 0], [0, 5, 0])
    near(applyAction(composeActions(quarter, quarter), circle([0, 0, 1]), [5, 0, 0]), [-5, 0, 0])

    const cancel = composeActions(quarter, actionBetween(circle([0, 0, 1]), [0, 5, 0], [5, 0, 0]))
    near(applyAction(cancel, circle([0, 0, 1]), [5, 0, 0]), [5, 0, 0])

    const half = actionBetween(circle([0, 0, 1]), [5, 0, 0], [-5, 0, 0])
    near(applyAction(composeActions(half, half), circle([0, 0, 1]), [5, 0, 0]), [5, 0, 0])

    // 120 + 120 = 240 wraps to -120, and plays as the same point as a direct 240 turn.
    const third = actionBetween(circle([0, 0, 1]), [5, 0, 0], spin([0, 0, 1], 2 * Math.PI / 3, [5, 0, 0]))
    const wrapped = composeActions(third, third)
    near(applyAction(wrapped, circle([0, 0, 1]), [5, 0, 0]), spin([0, 0, 1], 4 * Math.PI / 3, [5, 0, 0]))

    // Different circle planes are a general rotation, not one circle turn.
    assert.throws(() => composeActions(third, actionBetween(circle([1, 0, 0]), [0, 5, 0], [0, 0, 5])), TypeError)
})

// --- numeric: identity is no turn at all, never a small one -------------------------
test("a one-unit edit on a huge circle is a real phase, not identity", () => {
    const R = 1e12
    const big = { kind: "circle", center: [0, 0, 0], normal: [0, 0, 1], radius: R }
    const action = actionBetween(big, [R, 0, 0], [R, 1, 0])   // ~1e-12 rad
    assert.ok(action && Math.hypot(...action.phaseVector) > 0, "a nonzero phase is retained")
    const played = applyAction(action, big, [R, 0, 0])
    assert.ok(played && Math.abs(played[1] - 1) < 1e-9 && Math.abs(played[0] - R) < 1e-3,
        `the one-unit edit was lost: ${played}`)
})

test("a direction has no scale: a tiny normal and a tiny axis keep their capability", () => {
    const action = actionBetween(circle([0, 0, 1]), [5, 0, 0], [0, 5, 0])
    near(applyAction(action, circle([0, 0, 1e-13]), [5, 0, 0]), [0, 5, 0])
    // Two tiny axes at right angles are not parallel, so they must not silently sum.
    assert.throws(() => composeActions({ kind: "circle", phaseVector: [1e-13, 0, 0] },
        { kind: "circle", phaseVector: [0, 1e-13, 0] }), TypeError)
})

test("a half turn is orientation-free even on an orthogonal chart", () => {
    const half = actionBetween(circle([0, 0, 1]), [5, 0, 0], [-5, 0, 0])
    // The chart is now the y-z plane: a half turn about x maps (0,5,0) to (0,-5,0).
    near(applyAction(half, circle([1, 0, 0]), [0, 5, 0]), [0, -5, 0])
    // Any other phase keeps the orthogonal chart inapplicable: a quarter turn is a mirror.
    const quarter = actionBetween(circle([0, 0, 1]), [5, 0, 0], [0, 5, 0])
    assert.equal(applyAction(quarter, circle([1, 0, 0]), [0, 5, 0]), null)
})

// --- exactness: identity is no displacement, not a deadzone ------------------------
test("identity is exact: a 1e-11 displacement is a translation, a zero one is null", () => {
    assert.equal(actionBetween(null, [0, 0, 0], [0, 0, 0]), null)
    const tiny = actionBetween(null, [0, 0, 0], [1e-11, 0, 0])
    assert.deepEqual(tiny, { kind: "translation", by: [1e-11, 0, 0] })
    near(applyAction(tiny, null, [0, 0, 0]), [1e-11, 0, 0])
})

test("an admitted 1e-11 translation is retained across a rerun", () => {
    const s = buildWorld()
    let a = seat(s, "let a").children.get("a")
    move(s, a, [1e-11, 0, 0])
    assert.ok(Math.abs(frameWorldTransform(a).position[0] - 1e-11) < 1e-20)
    assert.ok(a.handBase, "the accepted baseline is retained, not treated as a no-op")

    s.hotSwapChild("host", fork("host", "let a"), { fresh: true })
    drive(s)
    assert.deepEqual(s.errors, [])
    a = s.root.children.get("host").children.get("a")
    assert.ok(Math.abs(frameWorldTransform(a).position[0] - 1e-11) < 1e-20,
        `the published edit was forgotten: ${frameWorldTransform(a).position}`)
})

// --- half-turn capability bound: roundoff, not an angular deadzone ------------------
test("a rigidly re-expressed half turn stays answerable on an orthogonal chart", () => {
    const frame = SE3.translateLocal(SE3.rotateLocal(SE3.rotateLocal(SE3.identity(), AXIS_Z, 70), AXIS_Y, 35), 10, 20, 30)
    const point = (p) => SE3.apply(frame, p)
    const rotate = (v) => frame.rotation.rotateVec(...v)
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const n = unit([1, 2, 3])
    const u = unit(cross(n, [1, 0, 0])), m = unit(cross(n, u))
    const from = u.map((x) => x * 5), to = from.map((x) => -x)
    const locus = { kind: "circle", center: point([0, 0, 0]), normal: rotate(n), radius: 5 }
    const action = actionBetween(locus, point(from), point(to), frame)
    // Re-expression can lose an ulp of the unit normal's norm; capability must survive it.
    assert.ok(Math.abs(Math.hypot(...action.phaseVector) - Math.PI) <= 4 * Math.PI * Number.EPSILON)
    near(applyAction(action, { ...locus, normal: rotate(m) }, point(from), frame), point(to))
})

test("a phase outside the half-turn roundoff bound stays inapplicable on an orthogonal chart", () => {
    const circle = { kind: "circle", center: [0, 0, 0], normal: [0, 0, 1], radius: 5 }
    assert.equal(applyAction({ kind: "circle", phaseVector: [0, 0, Math.PI - 1e-12] },
        { ...circle, normal: [1, 0, 0] }, [0, 5, 0]), null)
    near(applyAction({ kind: "circle", phaseVector: [0, 0, Math.PI] }, { ...circle, normal: [1, 0, 0] }, [0, 5, 0]), [0, -5, 0])
})
