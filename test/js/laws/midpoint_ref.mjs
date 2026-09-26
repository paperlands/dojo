// EXPERIMENT 2 — the midpoint relation 2M = A + B, in the laboratory.
// (id:laws-experiment-2-midpoint)
//
// INJECTED RELATION. This is not source-supported syntax and it is not wired
// into the parser, the executor or the scheduler. It exists to compare two
// movement policies on one relationship, with exact analytic answers.
//
// Pure: plain vectors in, plain vectors out. No frames, no scheduler, no solver.

export const REALIZE_TOL = 1e-9
export const ACCEPT_TOL = 1e-6

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)

export const midpointOf = (a, b) => scale(add(a, b), 0.5)

// The residual is a LENGTH, but the `2M` spelling carries it doubled.
//   raw        |2M − A − B|      = 2 · (how far M sits from the true midpoint)
//   geometric  |2M − A − B| / 2  = the point error, in the world's units
export const rawMidpointResidual = (m, a, b) => len(sub(scale(m, 2), add(a, b)))
export const midpointResidual = (m, a, b) => rawMidpointResidual(m, a, b) / 2

// The independent validator: does the candidate configuration satisfy the
// original relation 2M = A + B, judged in geometric units? It never looks at
// how the candidate was produced.
export function validateMidpoint({ a, b, m }, tol = ACCEPT_TOL) {
    if (!finite3(a) || !finite3(b) || !finite3(m)) return { ok: false, reason: "non-finite geometry" }
    const residual = midpointResidual(m, a, b)
    return residual <= tol
        ? { ok: true, residual }
        : { ok: false, reason: `M is ${residual} from the midpoint`, residual }
}

const posesOf = ({ a, b, m }) => ({ a: [...a], b: [...b], m: [...m] })

// ---------------------------------------------------------------------------
// Policy 1 — the current default. Only the requested point may move; the other
// two remain fixed. Its locus is all that is left once the others are held:
//   m -> (a + b) / 2        a -> 2m − b        b -> 2m − a
// Each locus is a SINGLE point equal to the requested point's accepted position,
// so any non-trivial request is blocked. `met` says whether the request reached
// its target; `moved` says whether the point left its accepted position.
// ---------------------------------------------------------------------------
export function requestOnly({ a, b, m }, request, { pinned = [] } = {}, tol = REALIZE_TOL) {
    const cur = posesOf({ a, b, m })
    const who = request?.who
    if (!["a", "b", "m"].includes(who) || !finite3(request.to)) {
        return { ok: false, reason: "a request names a point and a finite target" }
    }
    if (pinned.includes(who)) {
        return { ok: true, policy: "request-only", poses: cur, met: false, moved: false, blocked: true, reason: "the requested point is pinned" }
    }
    const cand = posesOf(cur)
    if (who === "m") cand.m = midpointOf(cur.a, cur.b)
    else if (who === "a") cand.a = sub(scale(cur.m, 2), cur.b)
    else cand.b = sub(scale(cur.m, 2), cur.a)
    const met = len(sub(cand[who], request.to)) <= tol
    const moved = len(sub(cand[who], cur[who])) > tol
    return {
        ok: true, policy: "request-only", poses: cand, met, moved,
        blocked: !met,
        reason: met ? null : "the other two points are held; the requested point has no room",
    }
}

// ---------------------------------------------------------------------------
// Policy 2 — component hand-first. Meet the requested position exactly when it
// is feasible, then distribute the motion over the component so the Euclidean
// displacement is least (equal unit stay costs). Solved analytically per axis.
//
// deltas da, db, dm obey the relation's linearisation  da + db = 2 dm.
// The requested writer's delta is fixed to r = to − current; pinned deltas are
// zero; the remaining freedom is spent minimising ‖da‖²+‖db‖²+‖dm‖².
//
//   writer m, a and b free : da = db = dm = r
//   writer m, a pinned     : db = 2r
//   writer m, a and b both pinned : infeasible, the request is not met
//   writer a, b and m free : da = r, db = −r/5, dm = 2r/5
//   writer a, b pinned     : da = r, dm = r/2
//   writer a, m pinned     : da = r, db = −r
//   (writer b mirrors writer a)
// ---------------------------------------------------------------------------
export function componentHandFirst({ a, b, m }, request, { pinned = [] } = {}, tol = REALIZE_TOL) {
    const cur = posesOf({ a, b, m })
    const who = request?.who
    if (!["a", "b", "m"].includes(who) || !finite3(request.to)) {
        return { ok: false, reason: "a request names a point and a finite target" }
    }
    if (pinned.includes(who)) {
        return { ok: true, policy: "component-hand-first", poses: cur, met: false, moved: false, blocked: true, reason: "the requested point is pinned" }
    }
    const r = sub(request.to, cur[who])
    const freeA = !pinned.includes("a")
    const freeB = !pinned.includes("b")
    const freeM = !pinned.includes("m")
    const da = [0, 0, 0], db = [0, 0, 0], dm = [0, 0, 0]

    if (who === "m") {
        if (!freeA && !freeB) {
            return { ok: true, policy: "component-hand-first", poses: cur, met: false, moved: false, blocked: true, reason: "both endpoints are pinned; M cannot move" }
        }
        dm[0] = r[0]; dm[1] = r[1]; dm[2] = r[2]
        if (freeA && freeB) { da[0] = r[0]; da[1] = r[1]; da[2] = r[2]; db[0] = r[0]; db[1] = r[1]; db[2] = r[2] }
        else if (freeB) { db[0] = 2 * r[0]; db[1] = 2 * r[1]; db[2] = 2 * r[2] }
        else { da[0] = 2 * r[0]; da[1] = 2 * r[1]; da[2] = 2 * r[2] }
    } else {
        // The writer meets its target exactly; the rest minimises displacement.
        const rw = r
        if (who === "a") { da[0] = rw[0]; da[1] = rw[1]; da[2] = rw[2] }
        else { db[0] = rw[0]; db[1] = rw[1]; db[2] = rw[2] }
        const partnerFree = who === "a" ? freeB : freeA
        if (freeM && partnerFree) {
            const other = scale(rw, -1 / 5)
            const mid = scale(rw, 2 / 5)
            if (who === "a") { db[0] = other[0]; db[1] = other[1]; db[2] = other[2] }
            else { da[0] = other[0]; da[1] = other[1]; da[2] = other[2] }
            dm[0] = mid[0]; dm[1] = mid[1]; dm[2] = mid[2]
        } else if (freeM) {
            const mid = scale(rw, 0.5)
            dm[0] = mid[0]; dm[1] = mid[1]; dm[2] = mid[2]
        } else if (partnerFree) {
            const back = scale(rw, -1)
            if (who === "a") { db[0] = back[0]; db[1] = back[1]; db[2] = back[2] }
            else { da[0] = back[0]; da[1] = back[1]; da[2] = back[2] }
        } else {
            return { ok: true, policy: "component-hand-first", poses: cur, met: false, moved: false, blocked: true, reason: "the other two points are held; the relation cannot follow" }
        }
    }

    const cand = { a: add(cur.a, da), b: add(cur.b, db), m: add(cur.m, dm) }
    const met = len(sub(cand[who], request.to)) <= tol
    const moved = len(da) > tol || len(db) > tol || len(dm) > tol
    const check = validateMidpoint(cand)
    return { ok: true, policy: "component-hand-first", poses: cand, met, moved, blocked: !met, residual: check.residual, valid: check.ok }
}

// ---------------------------------------------------------------------------
// Ownership: two instances of the injected relation do not share internals.
// The address canonicalises only the declared symmetry (the endpoints A/B are
// an unordered pair; M is not). Labelled experiment bookkeeping, not a runtime.
// ---------------------------------------------------------------------------
export function midpointAddress({ a, b, m }) {
    const ends = [String(a), String(b)].sort()
    return ["midpoint", ...ends, String(m)].join("|")
}

export function createMidpointStore() {
    const byAddress = new Map()
    return {
        apply(law) {
            const key = midpointAddress(law)
            byAddress.set(key, { ...law })
            return key
        },
        retract(owner) {
            let hit = false
            for (const [key, law] of byAddress) if (law.owner === owner) { byAddress.delete(key); hit = true }
            return hit ? "retracted" : "noop"
        },
        count() { return byAddress.size },
        lawAt(address) { return byAddress.get(address) ?? null },
    }
}
