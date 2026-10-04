// The angle law, pure, and the producer it must be able to swap for.
//
// angle(A, B, C) = θ is THREE points but one bound problem: with B and C held, A's locus
// is a single nappe of the cone about BC, without its apex. The incumbent cone represents
// both nappes and includes the apex, so its narrow reading answers 135° with 45°. That
// disagreement is the whole witness: two bounded producers, one bound problem, one
// acceptance gate, and the gate can tell which one ran.
//
// It also records what a gate CANNOT fix. The accepted pose is only half the claim; a mark
// drawn from the same double cone advertises the wrong set however correct the pose is. A
// gate repairs a pose, not a locus.
// (id:laws-build-solve-seam, id:laws-build-p2b)
// Run: node --test test/js/laws/angle_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { angleOf, realizeAngle, realizeAngleNarrow, validateAngle, selectAngle, ANGLE_POLICY } from "../../../assets/js/turtling/laws/angle.js"
import { angle, cone, circle, nearest, dofOf, meet, meetAll } from "../../../assets/js/turtling/laws/meet.js"
import { marksOf, stateOf } from "../../../assets/js/turtling/laws/constraints.js"

const V = [0, 0, 0]                       // the vertex B
const C = [1, 0, 0]                       // the second arm, along +x
const deg = (rad) => (rad * 180) / Math.PI
const orDeg = (p) => deg(angleOf(p, V, C).radians)
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} vs ${b}`)
// A point at angle `a` from the axis, in the xy-plane, at radius `r`.
const onAxis = (a, r = 2) => [r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180), 0]

test("the predicate: three points read at the vertex, ordinary and unsigned", () => {
    near(orDeg(onAxis(45)), 45, "acute")
    near(orDeg(onAxis(135)), 135, "supplementary — 135° is not collapsed to 45°")
    near(orDeg(onAxis(90)), 90, "right")
    // Arm symmetry: swapping the arms is the same law.
    near(angleOf(C, V, onAxis(135)).radians, angleOf(onAxis(135), V, C).radians, "arm symmetry")
})

test("the law's producer takes the angle verbatim, above 90° as well as below", () => {
    for (const want of [45, 90, 135]) {
        const r = realizeAngle(onAxis(want + 40), V, C, want)     // start deliberately wrong
        assert.ok(r.ok, `${want}°: ${r.reason}`)
        assert.ok(validateAngle(r.pose, V, C, want).ok, `${want}° was realized as ${orDeg(r.pose)}°`)
        near(orDeg(r.pose), want, `${want}° placement`)
    }
})

test("two producers answer one bound problem, and part company only above 90°", () => {
    const start = onAxis(20)
    const ordinary = realizeAngle(start, V, C, 135).pose
    const narrow = realizeAngleNarrow(start, V, C, 135).pose
    assert.ok(validateAngle(ordinary, V, C, 135).ok, "the ordinary producer satisfies the gate")
    assert.equal(validateAngle(narrow, V, C, 135).ok, false, "the narrow producer is REFUSED — this tells them apart")
    near(orDeg(narrow), 45, "it answered 135° with 45°: the cone's two nappes, collapsed")
    // Below the right angle the two readings coincide, so nothing else may distinguish them.
    near(orDeg(realizeAngle(start, V, C, 45).pose), orDeg(realizeAngleNarrow(start, V, C, 45).pose), "agreement at 45°")
})

test("supplementary: 135° is a real pose, on the far side of the vertex", () => {
    const r = realizeAngle(onAxis(20), V, C, 135)
    assert.ok(r.ok)
    assert.ok(r.pose[0] < 0, "the direction lies past the vertex plane — exactly what the double cone collapses away")
    assert.ok(validateAngle(r.pose, V, C, 135).ok)
})

test("arm reversal: the azimuth is conserved, the polarity belongs to the law", () => {
    const high = [0, 2, 0]                                        // 90° from the axis, azimuth +90
    const r = realizeAngle(high, V, C, 45)
    assert.ok(r.ok)
    assert.ok(r.pose[1] > 0, "the move stayed on the target's own side of the axis")
    assert.ok(r.pose[0] > 0, "and took the 45° direction the law asked for")
    // Reversing the arm through the axis is still the same law: the ENCLOSED angle.
    assert.ok(orDeg([-2, 0.0000001, 0]) > 179.9, "the antipodal reading is the enclosed one")
    near(orDeg(realizeAngle(onAxis(30), V, C, 180).pose), 180, "180° lands on the opposite ray")
})

test("the law moves the angle and nothing else: the arm length is conserved", () => {
    const r = realizeAngle([3, 0, 0], V, C, 60)                   // r = 3
    assert.ok(r.ok)
    assert.ok(Math.abs(Math.hypot(...r.pose) - 3) < 1e-9, "a length the law never mentions was not changed")
})

test("a zero arm has no direction: the angle is undefined there, never a default", () => {
    assert.equal(angleOf(V, V, C).ok, false, "A on the vertex")
    assert.equal(angleOf(onAxis(45), V, V).ok, false, "C on the vertex")
    assert.equal(validateAngle(V, V, C, 45).ok, false, "the apex is not a pose of this law, however it was proposed")
    // But a target AT the vertex is a repair, not a refusal: the pose lands ON the locus.
    const r = realizeAngle(V, V, C, 45)
    assert.ok(r.ok, r.reason)
    assert.ok(validateAngle(r.pose, V, C, 45).ok, "the repaired pose is a member of the locus")
    assert.ok(Math.hypot(...r.pose) > 0, "and it is not the apex the cone would have handed back")
})

test("refusals are stated, never approximated", () => {
    for (const bad of [-1, 181, NaN, Infinity]) {
        assert.equal(realizeAngle(onAxis(20), V, C, bad).ok, false, `want ${bad}`)
        assert.equal(validateAngle(onAxis(20), V, C, bad).ok, false, `gate on want ${bad}`)
    }
    assert.equal(realizeAngle(onAxis(20), V, V, 45).ok, false, "a vertex with no second arm")
})

test("the gate catches a candidate no producer made", () => {
    assert.ok(validateAngle(realizeAngle(onAxis(20), V, C, 45).pose, V, C, 45).ok, "the honest one passes")
    assert.equal(validateAngle(onAxis(60), V, C, 45).ok, false, "a right point at the wrong angle")
    assert.equal(validateAngle([Infinity, 0, 0], V, C, 45).ok, false, "non-finite geometry")
    assert.equal(validateAngle([0, 0, 0], V, C, 45).ok, false, "a degenerate arm")
})

// --- the honest locus: one nappe, apex excluded, drawn from the same fields --------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const onLaw = (p, d) => {
    const a = angleOf(p, V, C)
    return a.ok && Math.abs(deg(a.radians) - d) < 1e-6
}

test("the locus and the producer are one geometry: nearest agrees with realizeAngle", () => {
    for (const d of [45, 90, 135, 180]) {
        const locus = angle(V, C, d)
        const target = onAxis(d + 30)
        const offered = nearest(locus, target)
        const produced = realizeAngle(target, V, C, d)
        assert.ok(offered.ok && produced.ok, `${d}°: ${offered.kind ?? ''} ${produced.reason ?? ''}`)
        assert.ok(Math.hypot(...sub(offered.at, produced.pose)) < 1e-9, `${d}°: the two entry points agree`)
        assert.ok(validateAngle(offered.at, V, C, d).ok, `${d}°: and the gate accepts what is offered`)
    }
})

test("what is drawn is what is accepted — and never the other nappe", () => {
    for (const d of [30, 45, 90, 135, 150]) {
        const ring = marksOf(angle(V, C, d), {}).curves[0]
        assert.ok(ring && ring.length > 2, `${d}°: a ring to draw`)
        for (const p of ring) assert.ok(onLaw(p, d), `${d}° advertised a point at ${orDeg(p)}°`)
        // At 90° the two nappes coincide — the plane — so there is no other one to exclude.
        if (d !== 90) assert.ok(!ring.some((p) => onLaw(p, 180 - d)), `${d}° also advertised ${180 - d}°`)
    }
})

test("0°, 90° and 180° are covered, not only open cones", () => {
    assert.equal(dofOf(angle(V, C, 0)), 1, "0° is a ray")
    assert.equal(dofOf(angle(V, C, 180)), 1, "180° is a ray")
    assert.equal(dofOf(angle(V, C, 90)), 2, "90° is a surface")
    const straight = marksOf(angle(V, C, 180), { at: [-2, 0, 0] })
    assert.equal(straight.curves.length, 0, "a ray draws no ring")
    assert.equal(straight.spokes.length, 1, "it draws the arm it is")
    for (const d of [0, 90, 180]) {
        const r = nearest(angle(V, C, d), onAxis(20))
        assert.ok(r.ok && validateAngle(r.at, V, C, d).ok, `${d}°: offered and accepted`)
        assert.ok(Math.hypot(...r.at) > 0, `${d}°: never the apex`)
    }
})

test("the apex is excluded from the locus, not silently a member", () => {
    const offered = nearest(angle(V, C, 135), V)
    assert.ok(offered.ok, "a nearest is still offered…")
    assert.equal(offered.branch, "declared", "…but declared, because none exists")
    assert.ok(Math.hypot(...offered.at) > 0, "and it is not the apex")
    assert.ok(validateAngle(offered.at, V, C, 135).ok, "the declared choice is a real member")
    assert.equal(validateAngle(V, V, C, 135).ok, false, "the apex itself is not a pose of this law")
})

test("an unimplemented intersection is unsupported, never empty, never dropped", () => {
    assert.equal(meet(angle(V, C, 135), circle(V, [0, 0, 1], 2)).kind, "unresolved")
    assert.equal(meetAll([angle(V, C, 135), cone(V, C, 45)]).kind, "unresolved", "never silently discarded")
})

test("the double-nappe tilt semantics are untouched by the new kind", () => {
    const c = cone(V, C, 45)
    assert.equal(dofOf(c), 2, "a cone keeps its two degrees")
    assert.deepEqual(nearest(c, V), { ok: true, at: [0, 0, 0] }, "and still hands back its apex, unchanged")
})

test("a record reaches the display: stateOf forwards the angle and marksOf draws it", () => {
    const s = stateOf({ at: [3, 1, 0], constraints: [{ feature: "angle", set: angle(V, C, 135) }] })
    assert.equal(s.status, "accepted")
    assert.equal(s.interaction.offered, true)
    assert.equal(s.locus?.kind, "angle", "the named-set projection must not drop the kind")
    const ring = marksOf(s.locus, {}).curves[0]
    assert.ok(ring && ring.length > 2, "the display receives the geometry the state names")
    for (const p of ring) assert.ok(onLaw(p, 135), `drew ${orDeg(p)}° from a 135° state`)
})

test("regressions: the two repaired inputs stay repaired", () => {
    const axial = realizeAngle([0, 0, 2], V, [0, 0, 1], 0)
    assert.ok(axial.ok, `an already-valid axial seed was refused: ${axial.reason}`)
    assert.equal(axial.moved, false, "it was already valid, so nothing moved")
    const straight = realizeAngle([3, 4, 5], V, [0.1, 0.2, 0.7], 0)
    assert.ok(validateAngle(straight.pose, V, [0.1, 0.2, 0.7], 0).ok, "the straight candidate meets the gate")
})

test("one kernel: matching policies make the two entry points identical", () => {
    const want = 135, up = [0, 1, 0]
    const locus = angle(V, C, want)
    const policy = { ...ANGLE_POLICY, generator: up }
    const viaNearest = nearest(locus, V, { policy })
    const viaProducer = realizeAngle(V, V, C, want, up)
    assert.ok(viaNearest.ok && viaProducer.ok)
    assert.ok(Math.hypot(...sub(viaNearest.at, viaProducer.pose)) < 1e-9, "one shared selection contract")
    assert.deepEqual(selectAngle(locus, V, policy).at, viaProducer.pose, "and both are the kernel")
})

test("the policy moves the azimuth and nothing else", () => {
    const want = 135
    const locus = angle(V, C, want)
    const a = selectAngle(locus, V, { ...ANGLE_POLICY, generator: [0, 1, 0] })
    const b = selectAngle(locus, V, { ...ANGLE_POLICY, generator: [0, -1, 0] })
    assert.notDeepEqual(a.at, b.at, "a declared generator is a real choice")
    assert.equal(a.azimuth, "declared")
    assert.ok(validateAngle(a.at, V, C, want).ok && validateAngle(b.at, V, C, want).ok, "no policy can change the angle")
})

test("the gate never consults the kernel: a hand-built member passes", () => {
    // Built from 135° alone — no locus, no producer, no selection.
    const t = (135 * Math.PI) / 180
    const hand = [4 * Math.cos(t), 4 * Math.sin(t), 0]
    assert.ok(validateAngle(hand, V, C, 135).ok, "the predicate reads the three points, not a producer")
    assert.equal(validateAngle(hand, V, C, 45).ok, false)
})

test("a hostile policy is refused at the selection, not passed to the gate", () => {
    const locus = angle(V, C, 45)
    const atApex = V                                          // no radius of its own
    for (const arm of [-1, 0, -0.0, NaN, Infinity, -Infinity]) {
        const r = selectAngle(locus, atApex, { ...ANGLE_POLICY, arm })
        assert.equal(r.ok, false, `arm ${arm} was obeyed and reported ${JSON.stringify(r.at)}`)
    }
    // The negative arm is the one that MOVED THE ANGLE: it reversed the direction, so 45°
    // came back as 135°. That is the falsification, kept as a named case.
    assert.notEqual(Math.sin((45 * Math.PI) / 180), Math.sin(((45 + 180) * Math.PI) / 180))
    assert.equal(selectAngle(locus, atApex, { ...ANGLE_POLICY, arm: -1 }).ok, false)
})

test("out-of-domain degrees are refused, never silently clamped", () => {
    for (const d of [-1, 181, NaN, Infinity, -Infinity]) {
        const r = selectAngle({ apex: V, axis: C, degrees: d }, onAxis(20))
        assert.equal(r.ok, false, `${d}° was clamped instead of refused: ${JSON.stringify(r.at)}`)
    }
})

test("the axis must be a real direction, and is normalized rather than obeyed raw", () => {
    assert.equal(selectAngle({ apex: V, axis: [0, 0, 0], degrees: 0 }, onAxis(20)).ok, false, "a zero axis")
    assert.equal(selectAngle({ apex: V, axis: [NaN, 0, 0], degrees: 45 }, onAxis(20)).ok, false, "a non-finite axis")
    assert.equal(selectAngle({ apex: V, axis: [0, 0, 0], degrees: 45 }, onAxis(20)).ok, false, "a zero axis is not a direction")
    const scaled = selectAngle({ apex: V, axis: [3, 0, 0], degrees: 45 }, onAxis(20))
    const normal = selectAngle({ apex: V, axis: [1, 0, 0], degrees: 45 }, onAxis(20))
    assert.ok(scaled.ok && normal.ok)
    assert.deepEqual(scaled.at, normal.at, "a non-unit axis is normalized, not obeyed as given")
})
