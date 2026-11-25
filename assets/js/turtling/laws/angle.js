// Realization and independent validation for the three-point angle law.
// (id:laws-build-solve-seam, id:laws-build-p2b)
//
// angle(A, B, C) = θ is measured at the vertex B between the arms BA and BC as an
// ORDINARY unsigned angle in [0°, 180°]. Three points, but not three movers: with B
// and C held, A's locus is one circle of directions about the axis BC — a SINGLE
// nappe, without the apex.
//
// That is why this module is not realizeTilt. A cone represents both nappes and
// includes the apex, so θ and 180 − θ are one surface there and `openAngle` collapses
// them; for a tilt that is the intended reading, and for an angle it is a different
// claim. The narrow reading placed 135° at 45°, and `validateAngle` catches that — but
// the accepted candidate is not the whole story: a mark drawn from the same double
// cone would still ADVERTISE the wrong set. A gate rejects; it repairs neither pose nor locus.
//
// Pure: plain tuples in, plain tuples out. No frames, no scheduler, no solver.
//
// Declared before testing: the realization is exact (floating noise), and the
// independent check reads the same ACCEPT_TOL the distance seam declares, in degrees.

import { sub, add, scale, dot, cross, len, finite3, directionBetween, INVALID, unit as unitKernel } from "./vec3.js"
import { RAD, openAngle } from "./cone.js"
import { REALIZE_TOL, ACCEPT_TOL, DEFAULT_ARM } from "./realize.js"

const unit = (v) => unitKernel(v, REALIZE_TOL)

// A DECLARED order of fallback generators for an interior angle with no azimuth to
// conserve. A generator parallel to the axis contributes none, so the first candidate
// that has one is taken. The declaration is the policy; no candidate is a repair.
export const FALLBACK_GENERATORS = [[0, 0, 1], [0, 1, 0], [1, 0, 0]]

// Both arms from the vertex, or a stated refusal. A zero arm has no direction, so the
// angle is UNDEFINED there rather than some default — which is the apex the cone locus
// would otherwise hand back as a pose. (nonzero-arm guard)
function arms(target, apex, toward) {
    if (!finite3(apex) || !finite3(toward) || !finite3(target)) return { ok: false, reason: 'an angle needs three finite points' }
    const arm = directionBetween(apex, target)
    const axis = directionBetween(apex, toward)
    if (arm === INVALID || !arm) return { ok: false, reason: 'the first arm has no direction: the vertex and A coincide' }
    if (axis === INVALID || !axis) return { ok: false, reason: 'the second arm has no direction: the vertex and C coincide' }
    return { ok: true, arm, axis }
}

// The predicate, read from the three points themselves. Ordinary and unsigned, so
// swapping the arms is the same law and 135° is not 45°. (id:laws-freedom)
export function angleOf(target, apex, toward) {
    const u = arms(target, apex, toward)
    if (!u.ok) return u
    // The stable unsigned measurement: atan2(|u × w|, u · w). acos loses resolution
    // wherever the arms are nearly parallel or nearly opposed — precisely the 0° and 180°
    // cases — so a near-endpoint reading would be rejected by a tolerance that should not
    // have to move. (id:laws-build-solve-seam)
    return { ok: true, radians: Math.atan2(len(cross(u.arm, u.axis)), dot(u.arm, u.axis)) }
}

// Producer A — the ordinary reading, and the law's own: the locus is the directions at
// exactly `want` from the axis, and `want` is taken VERBATIM. The point keeps its own
// arm length, so the law moves the angle and nothing else. (id:laws-freedom)
//
// THE SELECTION KERNEL. One place turns a request into a point on an angle locus, and BOTH
// entry points call it: nearest() from the geometry kernel and realizeAngle() here. They
// cannot drift apart again, because there is only one selection.
//
// POLICIES are inputs, never hidden: which generator stands in where no azimuth can be
// conserved, and what arm a request without one gets. A policy can move the AZIMUTH and
// nothing else — the angle is authored, so no policy can change it. (id:laws-freedom)
//
// MEASUREMENT IS NOT HERE. angleOf and validateAngle derive the predicate from the three
// points and never read a selection back, so a producer cannot certify itself.
export const ANGLE_POLICY = Object.freeze({ generator: null, generators: FALLBACK_GENERATORS, arm: DEFAULT_ARM })

// The azimuth the request already has, or null where it has none.
const conservedAcross = (dir, axis) => {
    if (!dir) return null
    const lat = sub(dir, scale(axis, dot(dir, axis)))
    return len(lat) > REALIZE_TOL ? unit(lat) : null
}

// The declared order, a caller's own generator first when it named one.
const declaredAcross = (axis, policy) => {
    for (const cand of [policy.generator, ...(policy.generators ?? FALLBACK_GENERATORS)]) {
        const c = Array.isArray(cand) ? unit(cand) : null
        if (!c) continue
        const lat = sub(c, scale(axis, dot(c, axis)))
        if (len(lat) > REALIZE_TOL) return unit(lat)
    }
    return null
}

export function selectAngle(locus, request, policy = ANGLE_POLICY) {
    const apex = locus?.apex, axis = locus?.axis, degrees = locus?.degrees
    // The inputs are checked HERE, not left to the gate. An ok:true that the gate must then
    // refuse is a selection claiming a member it never produced — and the gate's refusal only
    // proves the gate works, not that the claim was safe. (id:laws-build-solve-seam)
    if (!finite3(apex)) return { ok: false, reason: 'an angle locus needs a finite apex' }
    const along = finite3(axis) ? unit(axis) : null
    if (!along) return { ok: false, reason: 'an angle locus needs a nonzero, finite axis' }
    // The domain belongs to the law, so it is REFUSED rather than clamped: a silent clamp
    // discards the condition the author wrote.
    if (!Number.isFinite(degrees) || degrees < 0 || degrees > 180) {
        return { ok: false, reason: 'the angle must be a finite number of degrees in [0, 180]' }
    }
    const rad = degrees * RAD
    const sin = Math.sin(rad), cos = Math.cos(rad)
    const d = finite3(request) ? sub(request, apex) : null
    const r = d ? len(d) : 0
    const apart = r > REALIZE_TOL
    // ARM POLICY: the request's own radius where it has one — the law never mentions it —
    // else the declared arm. It must be FINITE and POSITIVE: a negative arm reverses the
    // direction and would move the ANGLE itself, which the law owns. Refused, not obeyed.
    const arm = apart ? r : policy.arm
    if (!Number.isFinite(arm) || arm <= REALIZE_TOL) {
        return { ok: false, reason: 'the arm must be a finite, positive length' }
    }
    // A straight angle is a RAY: the azimuth does not exist, so no generator is consulted
    // and an axial seed is an ordinary case rather than a degeneracy to refuse.
    const straight = Math.abs(sin) <= REALIZE_TOL
    const conserved = straight ? null : conservedAcross(apart ? unit(d) : null, along)
    const across = straight ? null : (conserved ?? declaredAcross(along, policy))
    if (!straight && !across) return { ok: false, reason: 'the locus has no generator: the axis is not a direction' }
    const skirt = straight ? scale(along, cos) : add(scale(along, cos), scale(across, sin))
    const at = add(apex, scale(skirt, arm))
    if (!finite3(at)) return { ok: false, reason: 'the selected point is not finite geometry' }
    // The apex is EXCLUDED from this locus, so a selection landing on it is not a member.
    if (len(sub(at, apex)) <= REALIZE_TOL) return { ok: false, reason: 'the apex is excluded from this locus' }
    return {
        ok: true,
        at,
        azimuth: straight ? 'ray' : (conserved ? 'conserved' : 'declared'),
        arm: apart ? 'kept' : 'declared',
        selection: Object.freeze({
            policy: "angle-preserve-request-arm",
            azimuth: straight ? 'ray' : (conserved ? 'conserved' : 'declared'),
            arm: apart ? 'kept' : 'declared',
            length: arm,
            generator: across ? Object.freeze([...across]) : null,
        }),
    }
}

// The law's producer: a thin wrapper over the one selection above, so there is no second
// copy to drift. (id:laws-freedom)
export function realizeAngle(target, apex, toward, want, up = null) {
    if (!finite3(apex) || !finite3(toward)) return { ok: false, reason: 'the vertex and the second arm must be known' }
    if (!Number.isFinite(want) || want < 0 || want > 180) {
        return { ok: false, reason: 'the angle must be a finite number of degrees in [0, 180]' }
    }
    const axis = directionBetween(apex, toward)
    if (axis === INVALID || !axis) return { ok: false, reason: 'the second arm has no direction: the vertex and C coincide' }
    const picked = selectAngle({ apex, axis, degrees: want }, target, { ...ANGLE_POLICY, generator: up })
    return picked.ok
        ? { ok: true, pose: picked.at, selection: picked.selection,
            moved: !finite3(target) || len(sub(picked.at, target)) > REALIZE_TOL }
        : { ok: false, reason: picked.reason }
}

// Producer B — the SAME bound problem answered by the cone's narrow reading. It exists
// to be swapped in: the two agree below 90° and part company above it, so a witness can
// tell which producer ran. Bounded, and deliberately not the default. (id:laws-freedom)
export function realizeAngleNarrow(target, apex, toward, want, up = null) {
    if (!Number.isFinite(want)) return { ok: false, reason: 'the angle must be a finite number of degrees in [0, 180]' }
    return realizeAngle(target, apex, toward, openAngle(Math.min(Math.max(want, 0), 180)), up)
}

// The original predicate, checked independently of however the candidate was produced.
// A candidate at the vertex, with a zero arm, or at the wrong angle is rejected — the
// gate that keeps a substituted producer honest. (id:laws-build-solve-seam)
export function validateAngle(target, apex, toward, want) {
    if (!Number.isFinite(want) || want < 0 || want > 180) return { ok: false, reason: 'angle domain' }
    const a = angleOf(target, apex, toward)
    if (!a.ok) return { ok: false, reason: a.reason }
    const got = a.radians / RAD
    return Math.abs(got - want) <= ACCEPT_TOL
        ? { ok: true, degrees: got }
        : { ok: false, reason: `the angle is ${got}, not ${want}` }
}
