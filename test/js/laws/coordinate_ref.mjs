// Experiment 4, pure core: a framed coordinate truth joined with a distance.
// (id:relationships-todo-coordinate-spike, id:relationships-transition-hypothesis)
//
// EXPERIMENT-LOCAL. No parser, scheduler, law store or display change. This asks
// one question the shipped runtime cannot answer: can two truths of different
// kinds share ONE candidate decision, in either reach order, and give back the
// right freedom when one is retracted?
//
// The shipped shape proposes per feature (`scheduler.js::PROPOSE[feature]`) and
// realizes a joint component only for a tree of distances
// (`component.js::realizeDistanceTree` refuses any non-distance law). Here the
// truth carries its MEANING and its stable frame; the meet is computed over the
// whole active set — the component, not the latest row.
//
// One measurement is shared by reading, candidate and check, exactly as
// `relations.js::measure` and `relationships.js::planeOf` already do.

export const REL_TOL = 1e-9
export const ACCEPT_TOL = 1e-6

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
const unit = (v) => {
    const n = len(v)
    return n > REL_TOL ? v.map((x) => x / n) : null
}

const AXIS_VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

// ---------------------------------------------------------------------------
// Truths. A truth owns a stable frame binding and a payload; it is not a method.
// ---------------------------------------------------------------------------

// local_axis(p) = value, in the frame's stable placement. The world normal is
// the frame's own axis, rotated ONCE at binding. (id:laws-decl-frame)
export function coordinateTruth(pose, axis, value) {
    const e = AXIS_VEC[axis]
    if (!e || !finite3(pose?.position) || typeof pose.rotation?.rotateVec !== "function") return null
    if (!Number.isFinite(value)) return null
    const normal = pose.rotation.rotateVec(e[0], e[1], e[2])
    const point = [0, 1, 2].map((i) => pose.position[i] + value * normal[i])
    return { kind: "coordinate", axis, value, normal, point }
}

export function distanceTruth(center, radius) {
    if (!finite3(center) || !Number.isFinite(radius) || radius < 0) return null
    return { kind: "distance", center: [...center], radius }
}

const planeOffset = (t) => dot(t.normal, t.point)

// ---------------------------------------------------------------------------
// Independent checks: the original predicate, read in the frame that was bound.
// ---------------------------------------------------------------------------

export function validateCoordinate(p, t, tol = ACCEPT_TOL) {
    if (!finite3(p) || !t) return { ok: false, reason: "non-finite geometry" }
    const residual = dot(t.normal, p) - planeOffset(t)
    return Math.abs(residual) <= tol
        ? { ok: true, residual }
        : { ok: false, residual, reason: `the ${t.axis} coordinate is off by ${residual}` }
}

export function validateDistance(p, center, radius, tol = ACCEPT_TOL) {
    if (!finite3(p) || !finite3(center)) return { ok: false, reason: "non-finite geometry" }
    if (!Number.isFinite(radius) || radius < 0) return { ok: false, reason: "distance domain" }
    const d = len(sub(p, center))
    return Math.abs(d - radius) <= tol
        ? { ok: true, distance: d }
        : { ok: false, distance: d, reason: `distance is ${d}, not ${radius}` }
}

export const validates = (p, t, tol = ACCEPT_TOL) =>
    t.kind === "coordinate" ? validateCoordinate(p, t, tol) : validateDistance(p, t.center, t.radius, tol)

// ---------------------------------------------------------------------------
// The meet: the feasible set of the whole active set, named where it is exact.
// `n` is a unit normal, so d = n·center − offset is the signed centre-to-plane
// distance and the intersection is a circle, a tangent point, or empty.
// ---------------------------------------------------------------------------

export function meetPlaneSphere(t, s, tol = ACCEPT_TOL) {
    const d = dot(t.normal, s.center) - planeOffset(t)
    const foot = [0, 1, 2].map((i) => s.center[i] - d * t.normal[i])
    const gap = s.radius - Math.abs(d)
    if (gap < -tol) return { kind: "empty", gap, d, reason: "the plane misses the sphere" }
    // Near the tangency tolerance we cannot name point, circle or near-miss:
    // report numerical uncertainty rather than exact topology. (id:laws-freedom)
    if (Math.abs(gap) <= tol) {
        return { kind: "uncertain", gap, d, reason: "within the tangency tolerance: topology is numerically uncertain" }
    }
    const rho = Math.sqrt(gap * (s.radius + Math.abs(d)))
    return { kind: "circle", center: foot, radius: rho, normal: [...t.normal], d, gap }
}

// A repeatable in-plane direction when the request sits on the circle's centre:
// the choice is policy, disclosed, not a truth. (id:laws-decl-anchor)
function inPlaneSeed(normal) {
    const seed = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const raw = [
        normal[1] * seed[2] - normal[2] * seed[1],
        normal[2] * seed[0] - normal[0] * seed[2],
        normal[0] * seed[1] - normal[1] * seed[0],
    ]
    return unit(raw) ?? [1, 0, 0]
}

// Nearest point of a named feasible set to the hand's request. The map is a
// consequence of the MEET, not of any one relation's row.
export function nearestOn(feasible, request) {
    if (!finite3(request)) return { ok: false, kind: "unresolved", reason: "the request is not a point" }
    if (feasible.kind === "empty") return { ok: false, kind: "contradiction", reason: feasible.reason }
    if (feasible.kind === "point") return { ok: true, at: [...feasible.at] }
    if (feasible.kind === "space") return { ok: true, at: [...request] }
    if (feasible.kind === "sphere") {
        const u = unit(sub(request, feasible.center)) ?? [1, 0, 0]
        return { ok: true, at: feasible.center.map((c, i) => c + u[i] * feasible.radius) }
    }
    if (feasible.kind === "plane") {
        const off = dot(feasible.normal, request) - planeOffset(feasible)
        return { ok: true, at: request.map((x, i) => x - off * feasible.normal[i]) }
    }
    if (feasible.kind === "circle") {
        const n = feasible.normal
        const off = dot(n, request) - dot(n, feasible.center)
        const q = request.map((x, i) => x - off * n[i])         // request projected to the circle's plane
        let u = sub(q, feasible.center)
        const un = dot(u, n)
        u = u.map((x, i) => x - un * n[i])                       // ... and to the plane through the centre
        const uh = unit(u) ?? inPlaneSeed(n)
        return { ok: true, at: feasible.center.map((c, i) => c + uh[i] * feasible.radius) }
    }
    return { ok: false, kind: "unresolved", reason: "no named meet for this component" }
}

// The exact feasible set of the active truths, named only where bound geometry
// proves it: a plane, a sphere, their circle, a tangent point — or space.
export function feasibleSet(truths) {
    const coords = truths.filter((t) => t.kind === "coordinate")
    const dists = truths.filter((t) => t.kind === "distance")
    if (coords.length === 0 && dists.length === 0) return { kind: "space", dof: 3 }
    if (coords.length === 1 && dists.length === 0) {
        const t = coords[0]
        return { kind: "plane", normal: [...t.normal], point: [...t.point], dof: 2 }
    }
    if (coords.length === 0 && dists.length === 1) {
        const s = dists[0]
        // A zero radius is not a 2-surface: with the other point held it is a point.
        if (s.radius <= REL_TOL) return { kind: "point", at: [...s.center], dof: 0 }
        return { kind: "sphere", center: [...s.center], radius: s.radius, dof: 2 }
    }
    if (coords.length === 1 && dists.length === 1) {
        const m = meetPlaneSphere(coords[0], dists[0])
        const dof = m.kind === "circle" ? 1 : m.kind === "point" ? 0 : null
        return { ...m, dof }
    }
    // A component the named meet cannot prove stays unresolved — never a guess.
    return { kind: "unresolved", dof: null, reason: "a component method is needed" }
}

// ---------------------------------------------------------------------------
// The shipped shape, for the counterexample: each row proposes target-only.
// ---------------------------------------------------------------------------

export function realizeDistance(target, center, want) {
    const d = finite3(target) ? len(sub(target, center)) : NaN
    if (Math.abs(d - want) <= REL_TOL) return [...target]
    const u = d > REL_TOL ? sub(target, center).map((x) => x / d) : [1, 0, 0]
    return center.map((c, i) => c + u[i] * want)
}

export function sequentialProject(request, truths) {
    let p = [...request]
    for (const t of truths) {
        if (t.kind === "coordinate") {
            const off = dot(t.normal, p) - planeOffset(t)
            p = p.map((x, i) => x - off * t.normal[i])
        } else if (t.kind === "distance") {
            p = realizeDistance(p, t.center, t.radius)
        }
    }
    return p
}

// ---------------------------------------------------------------------------
// The transition skeleton: one play, one event, one verdict. Method-agnostic —
// the same `reach`/`retract`/`request` serve a coordinate, a distance, both, or
// an affine word. (id:relationships-transition-hypothesis, id:relationships-eidos)
// ---------------------------------------------------------------------------

export function createPlay({ poses = {}, truths = [] } = {}) {
    return { poses: { ...poses }, truths: [...truths], revision: 0 }
}

const sameAddress = (a, b) => a === b

// reach installs at an address: a later reach there replaces, a different one
// conjoins. owner is the source site; address is the truth's own key.
export function reach(play, { owner, address, truth }) {
    const next = { ...play, truths: [...play.truths], revision: play.revision + 1 }
    const at = next.truths.findIndex((t) => sameAddress(t.address, address))
    const record = { ...truth, owner, address }
    if (at >= 0) next.truths[at] = record
    else next.truths.push(record)
    return { play: next, verdict: at >= 0 ? "revised" : "reached" }
}

export function retract(play, owner) {
    const before = play.truths.length
    const next = { ...play, truths: play.truths.filter((t) => t.owner !== owner), revision: play.revision + 1 }
    return { play: next, verdict: next.truths.length === before ? "noop" : "retracted" }
}

// One request on the whole active set of the target's component. The method sees
// the component, so a second truth of another kind cannot be silently dropped.
export function request(play, target, hand) {
    const active = play.truths.filter((t) => t.target === target)
    const feasible = feasibleSet(active)
    const near = nearestOn(feasible, hand)
    if (!near.ok) return { play, verdict: near.kind, reason: near.reason, feasible }
    const untouched = active.some((t) => !validates(near.at, t, ACCEPT_TOL).ok)
    if (untouched) return { play, verdict: "unresolved", reason: "a proposed point breaks an active truth", feasible }
    const next = { ...play, poses: { ...play.poses, [target]: near.at }, revision: play.revision + 1 }
    return { play: next, verdict: "accepted", feasible, at: near.at }
}
