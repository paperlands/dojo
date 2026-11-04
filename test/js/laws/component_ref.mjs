// Experiment 6, pure core: two derived relations, context-supplied writers, and
// a satisfy/ follow split. (id:laws-experiment-6-distinctions)
//
// The review of experiment 5 found three defects and two guards:
//   1. validity dependency is not solve connectivity — a shared frame must not
//      merge independent solve components;
//   2. a row's `subject` made a symmetric relation directional, so `request` on
//      the other endpoint was refused though nothing held it;
//   3. a truth edit is not a hand request at the current pose — reaching
//      `2M = A + B` with M = 6 was obstructed though M = 5 is a witness;
//   plus: two owner-distinct midpoints must still solve, and the coordinate
//   check must be independent of the candidate's interpretation of the frame.
//
// EXPERIMENT-LOCAL. No parser, scheduler, law store or display change.
//
//   references(row)   = roles + frame        → what a change must recheck
//   participants(row) = roles                → what a solve may move together
//
// `dependentsOf` is the direct-read set for a change; `solveComponentOf` is the
// transitive closure over participants. `reach` initializes (satisfy); a hand
// request follows. They share the method interface, not the operation.

import { meetPlaneSphere, nearestOn, REL_TOL, ACCEPT_TOL } from "./coordinate_ref.mjs"
import { SE3 } from "../../../assets/js/turtling/se3.js"

export { REL_TOL, ACCEPT_TOL }

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const finite3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
const unit = (v) => { const n = len(v); return n > REL_TOL ? v.map((x) => x / n) : null }

const AXIS_VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
const AXIS_IDX = { x: 0, y: 1, z: 2 }
// The candidate reads the plane through the frame's rotated axis...
const planeOf = (pose, axis, value) => {
    const normal = pose.rotation.rotateVec(...AXIS_VEC[axis])
    return { normal, point: pose.position.map((c, i) => c + value * normal[i]) }
}
// ...and the independent check transforms the point INTO the frame and reads the
// coordinate there — a separate path, so a wrong axis in the candidate cannot
// fool the validator. (id:relationships-row-contract)
const localAxis = (pose, p, axis) => SE3.unapply(pose, p)[AXIS_IDX[axis]]

// ---------------------------------------------------------------------------
// Rows: a meaning, its roles, its frame. No permanent direction or subject.
// ---------------------------------------------------------------------------

export const coordinate = ({ point, frame, axis, value }) =>
    ({ feature: "coordinate", roles: [point], frame, payload: { axis, value } })
export const distance = ({ a, b, radius }) =>
    ({ feature: "distance", roles: [a, b], frame: null, payload: { radius } })
export const midpoint = ({ a, m, b }) =>
    ({ feature: "midpoint", roles: [a, m, b], frame: null, payload: {} })

const guardOk = (t) => {
    if (t.feature === "distance") return Number.isFinite(t.payload.radius) && t.payload.radius >= 0
    if (t.feature === "coordinate") return AXIS_VEC[t.payload.axis] != null
    return true
}

const PREDICATES = {
    coordinate(t, poses) {
        const F = poses[t.frame], P = poses[t.roles[0]]
        if (!F || !P) return null
        return localAxis(F, P.position, t.payload.axis) - t.payload.value
    },
    distance(t, poses) {
        const A = poses[t.roles[0]], B = poses[t.roles[1]]
        if (!A || !B) return null
        return len(sub(A.position, B.position)) - t.payload.radius
    },
    midpoint(t, poses) {
        const A = poses[t.roles[0]], M = poses[t.roles[1]], B = poses[t.roles[2]]
        if (!A || !M || !B) return null
        return len(sub([2 * M.position[0], 2 * M.position[1], 2 * M.position[2]],
            add(A.position, B.position))) / 2
    },
}

export function checkTruth(t, poses) {
    const fn = PREDICATES[t.feature]
    if (!fn) return { ok: false, kind: "unsupported", message: `no predicate for '${t.feature}'` }
    if (!guardOk(t)) return { ok: false, kind: "relation", message: `the ${t.feature} payload is outside its domain` }
    const residual = fn(t, poses)
    if (residual === null || !Number.isFinite(residual)) {
        return { ok: false, kind: "unresolved", message: "a bound reference is unreadable" }
    }
    return Math.abs(residual) <= ACCEPT_TOL
        ? { ok: true, residual }
        : { ok: false, kind: "obstructed", residual, message: `the ${t.feature} is off by ${residual}` }
}

export function validateAll(truths, poses) {
    for (const t of truths) {
        const check = checkTruth(t, poses)
        if (!check.ok) return check
    }
    return { ok: true }
}

// ---------------------------------------------------------------------------
// The two derived relations.
// ---------------------------------------------------------------------------

export const createWorld = ({ poses = {}, truths = [] } = {}) =>
    ({ poses: { ...poses }, truths: [...truths], revision: 0 })

export const referencesOf = (t) => (t.frame == null ? [...t.roles] : [...new Set([...t.roles, t.frame])])
export const participantsOf = (t) => [...t.roles]

// Direct reads of `ids` — what must be rechecked when those identities change.
// No transitive closure: moving C does not disturb a truth that reads only F.
export function dependentsOf(truths, ids) {
    const set = new Set(ids)
    return truths.filter((t) => referencesOf(t).some((r) => set.has(r)))
}

// The transitive closure over participant roles — what a solve may move together.
export function solveComponentOf(truths, seeds) {
    const byRole = new Map()
    for (const t of truths) {
        for (const r of participantsOf(t)) {
            if (!byRole.has(r)) byRole.set(r, [])
            byRole.get(r).push(t)
        }
    }
    const roles = new Set(), found = new Set(), queue = [...(seeds ?? [])]
    while (queue.length > 0) {
        const r = queue.pop()
        if (roles.has(r)) continue
        roles.add(r)
        for (const t of byRole.get(r) ?? []) {
            found.add(t)
            for (const o of participantsOf(t)) if (!roles.has(o)) queue.push(o)
        }
    }
    return [...found]
}

// Two key variants, so an owner-derived key can never collide with an
// explicitly spelled address. (fail-closed probe)
export const addressOf = (row) => (row.address == null
    ? JSON.stringify(["owner", String(row.owner)])
    : JSON.stringify(["address", String(row.address)]))

function installAt(truths, row) {
    const key = addressOf(row)
    const at = truths.findIndex((x) => addressOf(x) === key)
    if (at < 0) return [...truths, row]
    return truths.map((x, i) => (i === at ? row : x))
}

// ---------------------------------------------------------------------------
// Methods: satisfy initializes; follow answers a hand. Shared interface.
// ---------------------------------------------------------------------------

const realized = (proposal) => ({ ok: true, proposal })
const cannot = (kind, reason) => ({ ok: false, kind, reason })
const rowsOf = (truths, feature) => truths.filter((t) => t.feature === feature)
const other = (t, writer) => t.roles.find((r) => r !== writer)

// A condition is the geometric meaning, independent of its owner. Two owners of
// one equation are one capability; matching sees the distinct conditions, while
// publication checks every original. (ownership-invariant motion)
export function conditionKey(row) {
    if (row.feature === "distance") {
        return JSON.stringify(["distance", [...row.roles].sort(), row.payload.radius])
    }
    if (row.feature === "coordinate") {
        return JSON.stringify(["coordinate", row.roles[0], row.frame, row.payload.axis, row.payload.value])
    }
    return JSON.stringify([row.feature, row.roles, row.frame, row.payload])
}

export function distinctConditions(rows) {
    const seen = new Map()
    for (const row of rows) {
        const key = conditionKey(row)
        if (!seen.has(key)) seen.set(key, row)
    }
    return [...seen.values()]
}

function distanceFollow({ truths, poses, writer, hand, held = [] }) {
    const rows = distinctConditions(rowsOf(truths, "distance"))
    if (rows.length !== 1) return cannot("unsupported", "one distance in this bounded case")
    const t = rows[0]
    if (!t.roles.includes(writer)) return cannot("unsupported", `${writer} is not an endpoint`)
    if (held.includes(writer)) return cannot("unsupported", `${writer} is held`)
    const S = poses[writer], B = poses[other(t, writer)]
    if (!S || !B) return cannot("unresolved", "an endpoint is not seated")
    const u = unit(sub(hand, B.position)) ?? [1, 0, 0]
    return realized({ [writer]: { ...S, position: B.position.map((c, i) => c + u[i] * t.payload.radius) } })
}

function coordinateFollow({ truths, poses, writer, hand, held = [] }) {
    const rows = distinctConditions(rowsOf(truths, "coordinate"))
    if (rows.length !== 1) return cannot("unsupported", "one coordinate in this bounded case")
    const t = rows[0]
    if (!t.roles.includes(writer)) return cannot("unsupported", `${writer} is not the point`)
    if (held.includes(writer)) return cannot("unsupported", `${writer} is held`)
    const F = poses[t.frame], P = poses[writer]
    if (!F || !P) return cannot("unresolved", "the frame or the point is not seated")
    const { normal, point } = planeOf(F, t.payload.axis, t.payload.value)
    const off = dot(normal, hand) - dot(normal, point)
    return realized({ [writer]: { ...P, position: hand.map((x, i) => x - off * normal[i]) } })
}

// Plane cut by sphere: one named analytic case, computed over the component.
function planeSphereFollow({ truths, poses, writer, hand, held = [] }) {
    if (truths.some((t) => t.feature !== "coordinate" && t.feature !== "distance")) {
        return cannot("unsupported", "not a coordinate + distance component")
    }
    const coords = distinctConditions(rowsOf(truths, "coordinate"))
    const dists = distinctConditions(rowsOf(truths, "distance"))
    if (coords.length !== 1 || dists.length !== 1) return cannot("unsupported", "one coordinate and one distance in this bounded case")
    const c = coords[0], d = dists[0]
    if (!c || !d) return cannot("unsupported", "a coordinate and a distance are needed")
    const shared = c.roles.find((r) => d.roles.includes(r))
    if (!shared) return cannot("unsupported", "they must share a point")
    if (writer !== shared) return cannot("unsupported", `${writer} is not the shared point`)
    if (held.includes(writer)) return cannot("unsupported", `${writer} is held`)
    const F = poses[c.frame], B = poses[other(d, shared)]
    if (!F || !B) return cannot("unresolved", "the frame or the other endpoint is not seated")
    const plane = planeOf(F, c.payload.axis, c.payload.value)
    const set = meetPlaneSphere(plane, { center: [...B.position], radius: d.payload.radius })
    const near = nearestOn(set, hand)
    if (!near.ok) return cannot(near.kind === "contradiction" ? "contradiction" : "unresolved", `the meet is ${set.kind}`)
    return realized({ [writer]: { ...poses[writer], position: near.at } })
}

// A tiny dense min-norm solve: min ‖d‖² s.t. A d = b. Returns d or null.
// A tiny dense linear solve with partial pivoting; null if singular.
function solveLinear(G, b) {
    const n = G.length
    const M = G.map((row, i) => [...row, b[i]])
    for (let col = 0; col < n; col++) {
        let piv = col
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
        if (Math.abs(M[piv][col]) < 1e-12) return null
        ;[M[col], M[piv]] = [M[piv], M[col]]
        const d = M[col][col]
        for (let c = col; c <= n; c++) M[col][c] /= d
        for (let r = 0; r < n; r++) {
            if (r === col) continue
            const f = M[r][col]
            if (f === 0) continue
            for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
        }
    }
    return M.map((row) => row[n])
}

// Solve A d = b exactly, minimum norm. Row-reduce first, so redundant equations
// (two owners of the same constraint) do not make the system singular: rank, not
// row count, decides. (counterexample 1)
function solveFeasible(A, b, m) {
    const rows = A.map((row, i) => ({ a: [...row], b: b[i] }))
    const n = rows.length
    let rank = 0
    for (let col = 0; col < m && rank < n; col++) {
        let p = -1
        for (let i = rank; i < n; i++) if (Math.abs(rows[i].a[col]) > 1e-9) { p = i; break }
        if (p < 0) continue
        ;[rows[rank], rows[p]] = [rows[p], rows[rank]]
        const piv = rows[rank].a[col]
        for (let j = col; j < m; j++) rows[rank].a[j] /= piv
        rows[rank].b /= piv
        for (let i = 0; i < n; i++) {
            if (i === rank) continue
            const f = rows[i].a[col]
            if (Math.abs(f) < 1e-12) continue
            for (let j = col; j < m; j++) rows[i].a[j] -= f * rows[rank].a[j]
            rows[i].b -= f * rows[rank].b
        }
        rank++
    }
    for (const row of rows) {
        if (row.a.every((x) => Math.abs(x) < 1e-9) && Math.abs(row.b) > 1e-7) return { consistent: false }
    }
    const Ar = rows.slice(0, rank).map((row) => row.a.slice(0, m))
    const br = rows.slice(0, rank).map((row) => row.b)
    if (rank === 0) return { consistent: true, d: new Array(m).fill(0) }
    const G = Array.from({ length: rank }, (_, i) => Array.from({ length: rank }, (_, j) => {
        let s = 0
        for (let t = 0; t < m; t++) s += Ar[i][t] * Ar[j][t]
        return s
    }))
    const y = solveLinear(G, br)
    if (!y) return { consistent: false }
    return { consistent: true, d: Array.from({ length: m }, (_, t) => {
        let s = 0
        for (let i = 0; i < rank; i++) s += Ar[i][t] * y[i]
        return s
    }) }
}

// Each midpoint row is one linear equation over the component's deltas:
// 2 dM − dA − dB. (guard A, counterexample 1)
function affineConstraintRows(mids, roles, idx) {
    return mids.map((t) => {
        const row = new Array(roles.length).fill(0)
        row[idx.get(t.roles[1])] += 2
        row[idx.get(t.roles[0])] -= 1
        row[idx.get(t.roles[2])] -= 1
        return row
    })
}

// One solve for satisfy and follow. In follow the writer is fixed to the hand;
// in satisfy the residuals are driven to zero and every permitted role may move.
// Held roles stay fixed; a solution that needs a held role is a POLICY
// obstruction, never a geometric impossibility. (counterexample 2)
function affineSolve({ mids, roles, poses, writer = null, hand = null, held = [] }) {
    const idx = new Map(roles.map((r, i) => [r, i]))
    const m = roles.length
    const base = affineConstraintRows(mids, roles, idx)
    const residual = (t, axis) =>
        2 * poses[t.roles[1]].position[axis] - poses[t.roles[0]].position[axis] - poses[t.roles[2]].position[axis]

    const attempt = (fixedIds) => [0, 1, 2].map((axis) => {
        const A = base.map((row) => [...row])
        const b = mids.map((t) => (writer != null ? 0 : -residual(t, axis)))
        for (const id of fixedIds) {
            if (!idx.has(id)) continue
            const row = new Array(m).fill(0)
            row[idx.get(id)] = 1
            A.push(row)
            b.push(id === writer ? hand[axis] - poses[id].position[axis] : 0)
        }
        return solveFeasible(A, b, m)
    })

    const solved = attempt([...held, ...(writer != null ? [writer] : [])])
    if (solved.every((s) => s.consistent)) {
        const proposal = {}
        for (let i = 0; i < m; i++) {
            proposal[roles[i]] = {
                ...poses[roles[i]],
                position: add(poses[roles[i]].position, [solved[0].d[i], solved[1].d[i], solved[2].d[i]]),
            }
        }
        return realized(proposal)
    }
    const freed = attempt(writer != null ? [writer] : [])
    if (freed.every((s) => s.consistent)) {
        return cannot("policy", "a configuration exists only by moving a held participant")
    }
    return cannot("contradiction", "no configuration satisfies the active truths")
}

function affineFollow({ truths, poses, writer, hand, held = [] }) {
    const mids = rowsOf(truths, "midpoint")
    if (mids.length === 0) return cannot("unsupported", "no midpoint rows")
    const roles = [...new Set(mids.flatMap((t) => t.roles))]
    if (!roles.includes(writer)) return cannot("unsupported", `${writer} is not a member`)
    if (held.includes(writer)) return cannot("unsupported", `${writer} is held`)
    for (const r of roles) if (!poses[r]) return cannot("unresolved", `member ${r} is not seated`)
    return affineSolve({ mids, roles, poses, writer, hand, held })
}

function affineSatisfy({ truths, poses, target, held = [] }) {
    const mids = rowsOf(truths, "midpoint")
    if (mids.length === 0) return cannot("unsupported", "no midpoint rows")
    const roles = [...new Set(mids.flatMap((t) => t.roles))]
    if (!roles.includes(target)) return cannot("unsupported", `${target} is not a member`)
    if (held.includes(target)) return cannot("unsupported", `${target} is held`)
    for (const r of roles) if (!poses[r]) return cannot("unresolved", `member ${r} is not seated`)
    return affineSolve({ mids, roles, poses, held })
}

const asSatisfy = (follow) => ({ truths, poses, target, held = [] }) =>
    follow({ truths, poses, writer: target, hand: poses[target]?.position, held })

const distanceMethod = { follow: distanceFollow, satisfy: asSatisfy(distanceFollow) }
const coordinateMethod = { follow: coordinateFollow, satisfy: asSatisfy(coordinateFollow) }
const planeSphereMethod = { follow: planeSphereFollow, satisfy: asSatisfy(planeSphereFollow) }
const affineMethod = { follow: affineFollow, satisfy: affineSatisfy }

// Explicit bounded cases, not a feature-keyed registry.
export function methodFor(truths) {
    const features = new Set(truths.map((t) => t.feature))
    const coords = distinctConditions(rowsOf(truths, "coordinate"))
    const dists = distinctConditions(rowsOf(truths, "distance"))
    if (features.size === 1 && features.has("midpoint")) return affineMethod
    if (features.size === 1 && features.has("coordinate") && coords.length === 1) return coordinateMethod
    if (features.size === 1 && features.has("distance") && dists.length === 1) return distanceMethod
    if (features.size === 2 && features.has("coordinate") && features.has("distance")
        && coords.length === 1 && dists.length === 1) return planeSphereMethod
    return null
}

// ---------------------------------------------------------------------------
// Events. One verdict, one world.
// ---------------------------------------------------------------------------

const refuse = (world, kind, reason) => ({ world, verdict: kind, reason })
const unchanged = (world, truths, verdict) => ({ world: { ...world, truths, revision: world.revision + 1 }, verdict })

export function reach(world, { owner, address = null, row, target, held = null, method = null }) {
    const t = { ...row, owner, address }
    if (!PREDICATES[t.feature]) return refuse(world, "unsupported", `no predicate for '${t.feature}'`)
    if (!guardOk(t)) return refuse(world, "relation", `the ${t.feature} payload is outside its domain`)
    if (!target || !t.roles.includes(target)) return refuse(world, "unsupported", "the declaration must name a participant")
    const truths = installAt(world.truths, t)
    if (validateAll(truths, world.poses).ok) return unchanged(world, truths, "reached")

    // Initialize: solve only the participants of the new truth, not every truth
    // that happens to share its frame.
    const comp = solveComponentOf(truths, [target])
    const run = method ?? methodFor(comp)
    if (!run?.satisfy) return refuse(world, "unsupported", "no bounded method realizes this composition")
    // A declaration holds its context participants unless the event says
    // otherwise; held=[] lets satisfy search the whole permitted component.
    const heldRoles = held === null ? t.roles.filter((r) => r !== target) : held
    const out = run.satisfy({ truths: comp, poses: world.poses, target, held: heldRoles })
    if (!out.ok) return refuse(world, out.kind ?? "unresolved", out.reason)
    const poses = { ...world.poses, ...out.proposal }
    const check = validateAll(truths, poses)
    if (!check.ok) return refuse(world, check.kind, `the candidate breaks the ${check.message ?? "active truth"}`)
    return { world: { ...world, poses, truths, revision: world.revision + 1 }, verdict: "reached" }
}

export function request(world, writer, hand, { method = null, held = [] } = {}) {
    const comp = solveComponentOf(world.truths, [writer])
    if (comp.length === 0) return refuse(world, "unsupported", "nothing is bound to this identity")
    const run = method ?? methodFor(comp)
    if (!run?.follow) return refuse(world, "unsupported", "no bounded method for this composition")
    if (!finite3(hand)) return refuse(world, "unresolved", "the request is not a point")
    const out = run.follow({ truths: comp, poses: world.poses, writer, hand, held })
    if (!out.ok) return refuse(world, out.kind ?? "unresolved", out.reason)
    const poses = { ...world.poses, ...out.proposal }
    // Recheck only what directly reads a moved identity — not the whole frame
    // neighbourhood. (defect 1)
    const check = validateAll(dependentsOf(world.truths, Object.keys(out.proposal)), poses)
    if (!check.ok) return refuse(world, check.kind, `the candidate breaks the ${check.message ?? "active truth"}`)
    return { world: { ...world, poses, revision: world.revision + 1 }, verdict: "accepted", at: poses[writer].position }
}

export function moveIdentity(world, id, pose) {
    const poses = { ...world.poses, [id]: pose }
    const check = validateAll(dependentsOf(world.truths, [id]), poses)
    if (!check.ok) return refuse(world, check.kind, check.message ?? "the move breaks an active truth")
    return { world: { ...world, poses, revision: world.revision + 1 }, verdict: "accepted" }
}

export function retract(world, owner) {
    const truths = world.truths.filter((t) => t.owner !== owner)
    if (truths.length === world.truths.length) return { world, verdict: "noop" }
    return { world: { ...world, truths, revision: world.revision + 1 }, verdict: "retracted" }
}

// Freedom, read from the same bound geometry. Near the tolerance boundary it
// reports uncertainty rather than exact topology. (id:laws-freedom)
export function namedSet(truths, poses, { point = null, held = [] } = {}) {
    const coords = distinctConditions(rowsOf(truths, "coordinate"))
    const dists = distinctConditions(rowsOf(truths, "distance"))
    if (truths.length === 0) return { kind: "space", dof: 3 }
    // Exact freedom needs the queried point and what is held; otherwise the
    // display would name one endpoint's locus as the assembly's. (claim 3)
    if (point == null) return { kind: "unknown", dof: null, reason: "name the queried point" }
    if (held.includes(point)) return { kind: "held", at: poses[point] ? [...poses[point].position] : null, dof: 0 }
    if (coords.length === 1 && dists.length === 0) {
        const c = coords[0]
        if (!c.roles.includes(point)) return { kind: "unknown", dof: null, reason: `${point} is not the subject` }
        if (!poses[c.frame] || AXIS_VEC[c.payload.axis] == null) return { kind: "unresolved", dof: null }
        const p = planeOf(poses[c.frame], c.payload.axis, c.payload.value)
        return { kind: "plane", normal: [...p.normal], point: [...p.point], dof: 2, query: point }
    }
    if (coords.length === 0 && dists.length === 1) {
        const d = dists[0]
        if (!d.roles.includes(point)) return { kind: "unknown", dof: null, reason: `${point} is not an endpoint` }
        const centre = d.roles.find((r) => r !== point)
        const B = poses[centre]
        if (!B) return { kind: "unresolved", dof: null }
        if (d.payload.radius <= REL_TOL) return { kind: "point", at: [...B.position], dof: 0, query: point, held: centre }
        return { kind: "sphere", center: [...B.position], radius: d.payload.radius, dof: 2, query: point, held: centre }
    }
    if (coords.length === 1 && dists.length === 1) {
        const c = coords[0], d = dists[0]
        const shared = c.roles.find((r) => d.roles.includes(r))
        if (!shared || shared !== point) return { kind: "unknown", dof: null, reason: "the queried point is not the shared subject" }
        if (AXIS_VEC[c.payload.axis] == null) return { kind: "unresolved", dof: null }
        const F = poses[c.frame], B = poses[d.roles.find((r) => r !== shared)]
        if (!F || !B) return { kind: "unresolved", dof: null }
        const plane = planeOf(F, c.payload.axis, c.payload.value)
        const meet = meetPlaneSphere(plane, { center: B.position, radius: d.payload.radius })
        const dof = meet.kind === "circle" ? 1 : meet.kind === "point" ? 0 : null
        return { ...meet, dof, query: point }
    }
    return { kind: "unresolved", dof: null }
}
