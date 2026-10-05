// The law-verdict layer: read a configuration against the active laws, continue an
// accepted candidate to closure, propose the analytic candidate for a component, and
// decide a pin conflict. (id:laws-activation-order, id:laws-build-p3, id:laws-freedom)
//
// Pure w.r.t. scheduler state: bound laws, a registry, a pump handle, and an injected
// world reading in; an outcome out. It mutates no frame — the caller installs. The
// injected world carries TWO DIFFERENT readings, and they are not the same transform:
//
//   world.read(frame, overrides) -> { position, rotation, time }
//       the LIVE reading — where the frame's head is now. An override is a LOCAL pose,
//       composed onto the frame's placement.
//   world.transform(frame) -> SE3
//       the frame's world PLACEMENT — the composition of ancestor placements, where the
//       frame sits. It is what a world position is UNAPPLIED against to get a local one,
//       and what a law's own predicate is COMPOSED onto (a pin's target). It is NEVER the
//       live head pose.

import { measure } from "./relations.js"
import { meetAll, nearest as meetNearest } from "./meet.js"
import { realizeDistance, ACCEPT_TOL } from "./realize.js"
import { AUTHORED, bindWorld, boundTerm, isLiveInput, inputPosition, pointQuery, payloadOf } from "./authored.js"
import { componentOf, realizeDistanceTree } from "./component.js"
import { finite3 } from "./vec3.js"
import { addressOf, bindLaw } from "./replacement.js"
import { predicateOk } from "./expression.js"
import { freePoint, exposed } from "./batch.js"
import { heldIdentity, coincidentPartners, heldFrame, hasBody } from "./constraints.js"

// Re-exported: the scheduler imports the attempt hold from here. (id:laws-activation-verdicts)
export { heldFrame }
import { conditionOf, FINITE } from "../numerics.js"
import { SE3 } from "../se3.js"

// --- The whole-law gate ---

// Hard laws outrank requests: does a proposed configuration break an active law?
// ONE validator for every path — birth, revision, program motion, hand motion and
// delayed replies — so no path grows its own legality rule. (id:laws-activation-order)
// A reading outside its domain is not a satisfied law, and it is not a demonstrated
// contradiction either: both the law and the flag travel, so the settlement boundary
// can report a failure to measure instead of teaching an impossibility.
// (id:eval-relational, id:laws-contradiction)
//
// The gate is typed: `valid`, a `violation` (a known law whose original predicate a
// candidate breaks), or `cannot-measure` (an active law this gate does not recognize,
// or a missing/unreadable bound reference). An unknown AUTHORED form is refused earlier,
// at binding. `cannot-measure` is unresolved — never a silent pass, never proof of
// contradiction. (id:laws-activation-order)
const LAWFUL = Object.freeze({ status: 'valid' })
const cannotMeasure = (law, reason) => ({ status: 'cannot-measure', law, reason })

// The one world the AUTHORED rows read through: the live pose (with an optional candidate
// override map) and the stable placement. Injected, so the rows stay pure.
// (id:laws-decl-interface)
function lawCtx(registry, overrides, world, extras = {}) {
    return bindWorld((id) => registry.get(id), {
        live: (f) => world.read(f, overrides),
        placement: (f) => world.transform(f),
        ...extras,
    })
}

export function lawViolation(activeLaws, overrides, registry, world) {
    if (!activeLaws || activeLaws.length === 0) return LAWFUL
    const ctx = lawCtx(registry, overrides, world)
    for (const law of activeLaws) {
        const row = AUTHORED[law.feature]
        if (!row?.measure) return cannotMeasure(law, `the whole-law gate does not recognize '${law.feature}'`)
        const check = row.measure(law, ctx)
        if (check.status === 'cannot-measure') return cannotMeasure(law, check.reason)
        if (check.status === 'violation') return { status: 'violation', law, residual: check.residual }
    }
    return LAWFUL
}

export function brokenLaw(overrides, registry, laws, world) {
    return lawViolation(laws?.active(), overrides, registry, world)
}

const ownerLabel = (law) => law?.owner?.line != null ? `line ${law.owner.line}` : 'source'

// A located conflict: which two owners disagree, never just "a conflict".
export function conflictMessage(violation, candidate) {
    return `the ${violation.feature} at ${ownerLabel(violation)} conflicts with the ${candidate.feature} at ${ownerLabel(candidate)}`
}

// A live frame is circular; the record must be plain data a probe can serialize.
export const plainPoses = (x) => (Array.isArray(x)
    ? x.map((p) => ({ frame: p.frame?.id ?? p.frame, pose: p.pose }))
    : (x ?? null))

// --- Attempt holds, pins, and the affected component ---


// The position law that fixes a frame, or null. Its predicate is authored in the law's
// own frame, so the caller must interpret it there. (id:laws-decl-frame)
function pinnedLaw(laws, frameId) {
    for (const law of Array.isArray(laws) ? laws : laws.active()) {
        if (law.feature === 'position' && law.endpoints[0] === frameId) return law
    }
    return null
}

// A position pin's authored target, read from its term — never a rival field.
// (id:laws-free-relations-contract, D058)
function positionTarget(pin) {
    const t = boundTerm(pin)
    return { frame: t?.frame ?? pin.frame, value: t?.value ?? pin.predicate }
}

// A pin only CONFLICTS with a distance the other end cannot answer: a free, unpinned,
// unheld participant meets the pin by moving. Only an immovable partner — a body, a
// pin, a hold — makes the candidate a real obstruction. (P2, id:laws-freedom)
// The eligibility FACTS about one frame, named — never one global 'can move'. A hand that
// cannot touch, a method that cannot reconfigure and a transaction that cannot publish are
// different restrictions; each operation applies its own policy over these facts. (D058)
export function eligibilityOf(frame, laws, registry = null) {
    return {
        exposed: exposed(frame),
        seated: frame?.isPlace === true,
        settled: frame?.done === true,
        owned: hasBody(frame),
        broken: frame?.error != null || frame?.unresolved != null,
        pinned: pinnedLaw(laws, frame?.id) != null,
        held: heldFrame(frame),
        // Membership and propagated fixation are different facts: a coincident partner that
        // is itself held fixes this point; mere coincidence does not. (id:laws-freedom)
        coincident: coincidentPartners(frame, laws).length > 0,
        coupled: registry != null && coincidentPartners(frame, laws).some((other) =>
            other == null || typeof other === 'object' || heldIdentity(registry.get(other), laws, registry)),
    }
}

// A permitted mover: seated, exposed, settled, unowned, unbroken, unpinned, unheld.
const canMove = (frame, laws) => {
    const e = eligibilityOf(frame, laws)
    return e.exposed && e.seated && e.settled && !e.owned && !e.broken && !e.pinned && !e.held
}

// A distance reference's world point comes from `inputPosition`, the one interpreter —
// never a second reading. (id:laws-distance-literal-address)

// Is `target` at `worldPos` consistent with every active distance on it whose other end
// is fixed? A distance with a movable partner is not this pin's to refuse.
function conflictAt(target, worldPos, laws, registry, world) {
    const ctx = lawCtx(registry, null, world)
    for (const law of laws.active()) {
        if (law.feature !== 'distance') continue
        const term = boundTerm(law)
        if (!term) continue
        const [r0, r1] = term.references
        const targetRef = isLiveInput(r0) && registry.get(r0) === target ? r0
            : (isLiveInput(r1) && registry.get(r1) === target ? r1 : null)
        if (targetRef == null) continue
        const otherRef = targetRef === r0 ? r1 : r0
        if (isLiveInput(otherRef)) {
            const other = registry.get(otherRef)
            if (!other) continue
            if (canMove(other, laws)) continue   // the free partner meets this pin by moving
            const d = measure("distance", target, other, (f) => f === target
                ? { position: worldPos }
                : { position: world.read(f, null).position })
            if (conditionOf(d) !== FINITE) return { law, domain: true }
            if (Math.abs(d - term.radius) > ACCEPT_TOL) return { law, residual: d - term.radius }
        } else {
            // A framed centre is immovable: the pin must land on its sphere.
            const other = inputPosition(otherRef, ctx)
            if (!other) return { law, domain: true }
            const d = Math.hypot(worldPos[0] - other[0], worldPos[1] - other[1], worldPos[2] - other[2])
            if (!Number.isFinite(d)) return { law, domain: true }
            if (Math.abs(d - term.radius) > ACCEPT_TOL) return { law, residual: d - term.radius }
        }   
    }
    return null
}

// The complete affected set: the union of the old and proposed laws' connected
// component, not just the first conflicting pair. A hold that stops at the pair
// lets the rest of the component move as if the failure were not there.
// (id:laws-activation-verdicts)
export function affectedMembers(registry, laws, seeds, extra = []) {
    const ids = new Set(componentOf(laws, seeds).frames)
    for (const frame of extra) if (frame?.id !== undefined) ids.add(frame.id)
    const frames = []
    for (const id of ids) {
        const frame = registry.get(id)
        if (frame) frames.push(frame)
    }
    return frames
}

const unsupported = (spec, reason) => ({ kind: 'unresolved', message: reason, span: spec.owner })

// What a producer says when its topology does not apply: the caller tries the next one.
// Distinct from a named refusal, so `null` is never overloaded. (id:laws-activation-order)
export const INAPPLICABLE = Object.freeze({ kind: 'inapplicable' })
const STALE_OUTCOME = (spec) => ({ kind: 'stale', message: 'a proposed participant left the world', span: spec.owner })

// The ONE candidate boundary. A producer hands back a PROPOSAL — ID-keyed world positions —
// and this converts them once into pose edits, checks the ORIGINAL truths over the whole
// declared scope, and assembles the outcome. It never publishes: the scheduler owns that,
// including identity/source rights and notification order. (D058, id:laws-activation-order)
function settle(spec, candidate, worlds, pump, scope, world, { permitted, fail = null, stale = STALE_OUTCOME(spec), heads = null } = {}) {
    // The operation's permitted edits are REQUIRED input, not an option: an omitted allow-list
    // would silently widen every producer's permission. (id:laws-activation-order)
    if (!Array.isArray(permitted)) throw new Error("settle needs the operation's permitted edit ids")
    const poses = []
    for (const [id, target] of worlds) {
        // The operation's OWN intent. Valid geometry plus publication rights over a frame
        // does not establish that THIS operation should move it — a single-point method
        // admits only its point, a balanced pair its participants, a tree its admitted
        // members. Joint methods legitimately admit more; the check is method-specific.
        // (id:laws-activation-order)
        if (!permitted.includes(id) ||
            (spec.operation?.explicit && !spec.operation.movable.includes(id))) {
            return { kind: 'rejected', message: `this operation may not move '${pump.registry.get(id)?.name ?? id}'`, span: spec.owner }
        }
        const frame = pump.registry.get(id)
        if (!frame) return stale
        // EVERY proposed edit is validated, not only the candidate's own obligation. A
        // producer may not smuggle a non-finite point for a frame it does not own.
        // (id:laws-activation-order)
        if (!finite3(target)) return unsupported(spec, `a proposed position for '${frame.name}' is not a finite point`)
        const pose = { rotation: frame.transform.deref().rotation, position: SE3.unapply(world.transform(frame), target) }
        if (!SE3.isValid(pose)) return unsupported(spec, `the prepared pose for '${frame.name}' is invalid`)
        poses.push({ frame, pose })
    }
    const check = lawViolation(scope, new Map(poses.map(({ frame, pose }) => [frame, pose])), pump.registry, world)
    if (check.status === 'cannot-measure') return { kind: 'unresolved', message: check.reason, span: spec.owner }
    if (check.status !== 'valid') {
        // A REJECTION is named, never overloaded onto `null`: the geometry was formed and
        // the original truths refused it. (id:laws-activation-order)
        return fail ? fail(check, poses) : { kind: 'rejected', message: 'the candidate fails its original truths', span: spec.owner }
    }
    return { kind: 'commit', poses, address: candidate.address, law: candidate, heads: heads ?? poses, span: spec.owner }
}

// --- Continuation ---

// The hand's continuation: keep every untouched coordinate still and move the
// touched endpoint to the nearest admissible position under the active laws.
// Target-only projection; conserve untouched points. (id:laws-build-p2d, id:laws-activation-order)
//
// A distance is undirected. Which end this request moved is read from the
// request's own poses, never from the order the law stored its ends in: the moved
// end is projected back onto the law and the untouched end is conserved. When
// both ends moved, the request is the proposal and `brokenLaw` decides — the
// continuation never picks one by spelling. Following is an installed policy, not
// a secret of the address. (id:laws-build-p2d, id:laws-names)
export function continueLaws(verdict, writer, registry, laws, world) {
    if (!laws || verdict.kind !== 'accept') return verdict
    const poses = new Map([[writer, verdict.pose], ...verdict.component.map((m) => [m.frame, m.pose])])
    const ctx = lawCtx(registry, poses, world, { writerId: writer.id })
    // The writer's own truths meet as one named set. (id:laws-freedom)
    const comp = componentOf(laws.active(), [writer.id]).laws
    // One point query, not a fourth gather: the writer's truths meet as one set.
    const query = pointQuery(writer.id, comp, ctx)
    if (query.meets) {
        if (query.complete) {
            const wish = world.read(writer, poses).position
            const accepted = world.read(writer, null).position
            const near = meetNearest(meetAll(query.sets), wish, { keep: accepted })
            if (near.ok) {
                poses.set(writer, { rotation: verdict.pose.rotation, position: SE3.unapply(world.transform(writer), near.at) })
                verdict.pose = poses.get(writer)
                return verdict
            }
        }
    }
    const active = laws.active().filter((law) => law.feature === 'distance')
    if (active.length === 0) return verdict
    // A bounded sweep over the connected laws: projecting onto one circle may
    // disturb another. The bound stops a cycle from spinning; brokenLaw still
    // refuses any sweep that does not close, so a non-confluent cycle is never
    // published. (id:laws-build-p3, id:laws-contradiction)
    let changed = true
    for (let sweep = 0; changed && sweep <= active.length; sweep++) {
        changed = false
        for (const law of active) {
            const term = boundTerm(law)
            if (!term) continue
            const [r0, r1] = term.references
            const frameOf = (ref) => isLiveInput(ref) ? registry.get(ref) : null
            const a = frameOf(r0), b = frameOf(r1)
            const aMoved = a != null && poses.has(a)
            const bMoved = b != null && poses.has(b)
            // A hand that moved neither end has nothing to say to this law.
            if (!aMoved && !bMoved) continue
            // Both ends moved: the request proposed the pair. Its legality is
            // brokenLaw's question; the continuation must not move either silently.
            if (aMoved && bMoved) continue
            const moved = aMoved ? a : b
            const otherRef = aMoved ? r1 : r0
            const proposed = poses.get(moved)
            const otherPos = inputPosition(otherRef, ctx)
            if (!otherPos) continue
            const r = realizeDistance(world.read(moved, poses).position, otherPos, term.radius)
            if (!r.ok || !r.moved) continue
            poses.set(moved, { rotation: proposed.rotation, position: SE3.unapply(world.transform(moved), r.pose) })
            changed = true
        }
    }
    verdict.pose = poses.get(writer)
    for (const member of verdict.component) member.pose = poses.get(member.frame)
    return verdict
}

// --- Analytic candidates for a component ---

function componentMeetCandidate(spec, candidate, comp, pump, scope, world) {
    const meeters = comp.laws.filter((law) => AUTHORED[law.feature]?.meet)
    if (meeters.length === 0) return INAPPLICABLE
    const p = meeters[0].endpoints[0]
    if (!meeters.every((law) => law.endpoints[0] === p)) return unsupported(spec, 'a relation names another point')
    const point = pump.registry.get(p)
    if (!point) return unsupported(spec, 'the point is not seated')
    const ctx = lawCtx(pump.registry, null, world, { writerId: p })
    // The SAME point query: a named meet, or the feature that cannot form its set.
    const query = pointQuery(p, comp.laws, ctx)
    const failed = query.setBearing.find((c) => c.set == null)
    if (failed) return unsupported(spec, `cannot form the ${failed.feature}`)
    const met = meetAll(query.sets)
    if (met.kind === 'empty') {
        // Features, not identities. A distance set is anchored to the other
        // endpoint's LIVE position; a coordinate/tilt/bearing/position set is
        // anchored to its declaring scope's PLACEMENT frame. One identity can
        // carry both, and they move apart: the head walks, the placement stays.
        // So the emptiness is a contradiction only when no permitted mover can
        // change any set — no movable live anchor exists. Otherwise it is a
        // policy obstruction. Counting identities is not that proof.
        // (id:laws-decl-frame, id:laws-experiment-7-ruling)
        const movers = new Map()
        for (const { law } of query.setBearing) {
            if (law.feature !== 'distance') continue
            const other = law.endpoints.find((id) => id !== p)
            const frame = other != null ? pump.registry.get(other) : null
            // A live position is a permitted mover unless a pin fixes it.
            if (frame && !pinnedLaw(pump.laws, frame.id)) movers.set(frame.id, frame)
        }
        if (movers.size > 0) {
            const held = [...movers.values()]
            return { kind: 'obstructed',
                message: `the truths have no point in common while ${held.map((f) => `'${f.name}'`).join(', ')} hold their places`,
                span: spec.owner,
                members: affectedMembers(pump.registry, comp.laws, [p, ...held.map((f) => f.id)]) }
        }
        return { kind: 'contradiction', message: 'the truths have no point in common', span: spec.owner,
            members: affectedMembers(pump.registry, comp.laws, [p]) }
    }
    if (met.kind === 'uncertain' || met.kind === 'unresolved') return unsupported(spec, 'the meet is not a named set')
    const near = meetNearest(met, world.read(point, null).position)
    if (!near.ok) return unsupported(spec, 'the meet has no nearest point')
    // The SAME candidate boundary every producer exits through: prepare, check, assemble.
    // (id:laws-activation-order)
    // A named meet moves ONE point. (id:laws-activation-order)
    return settle(spec, candidate, new Map([[point.id, near.at]]), pump, scope, world, { permitted: [point.id] })
}

// The bounded methods behind ONE interface. Every producer returns the same vocabulary:
//   a candidate              — `{ kind: 'commit', poses, law, heads }`
//   not applicable           — `INAPPLICABLE` (try the next producer)
//   unresolved, with a reason — `{ kind, message, span }`
// The producers: 1) a single-point named meet, 2) an anchored distance tree, 3) the reach's
// balanced-pair initialization (selected by `policy`, in applyLaw).
// Dispatch is explicit: a new topology adds a producer, not another acceptance route; a new
// relation adds semantics, not every producer. (D058)
function componentCandidate(spec, candidate, pump, scope, world, anchorHint = null) {
    const active = [...pump.laws.active().filter((law) => addressOf(law) !== addressOf(candidate)), candidate]
    const comp = componentOf(active, candidate.endpoints)
    if (comp.laws.length < 2) return INAPPLICABLE
    // Producer 1: a component that names ONE point meets its truths as one set.
    if (comp.laws.some((law) => AUTHORED[law.feature]?.meet)) {
        return componentMeetCandidate(spec, candidate, comp, pump, scope, world)
    }
    // Producer 2: an anchored distance tree.
    return treeCandidate(spec, candidate, comp, pump, scope, world, anchorHint)
}

// Producer 2 — an anchored distance tree: radial propagation from ONE held anchor, which is
// a selection rather than a second solver. (id:laws-free-relations-f2)
function treeCandidate(spec, candidate, comp, pump, scope, world, anchorHint) {
    // The HELD anchor is ONE selection, not a second solver: the declaring frame when
    // it is in the component (a distance declared by a body), else the declared pin's
    // target (a pin over a distance). An explicit pair supplies its anchor.
    // (id:laws-free-relations-f2)
    const anchorId = anchorHint ?? (comp.frames.has(spec.observer.id) ? spec.observer.id : spec.target?.id)
    if (anchorId == null || !comp.frames.has(anchorId)) return unsupported(spec, 'a component outside the declaring frame')
    // A non-distance law is allowed ONLY as the anchor's own pin; anything else is unearned.
    const anchorPin = comp.laws.find((law) => law.feature === 'position' && law.endpoints[0] === anchorId)
    if (comp.laws.some((law) => law.feature !== 'distance' && law !== anchorPin)) {
        return unsupported(spec, 'a non-distance member is outside the analytic tree')
    }
    // The ADMITTED problem: the component members this operation may move, decided by
    // ELIGIBILITY ALONE — never by the edits a producer returns. The boundary requires this
    // input, so an interchangeable producer cannot widen its own permission.
    // (id:laws-activation-order)
    // Eligibility: only settled, unpinned, unheld members may be reconfigured. The held anchor
    for (const id of comp.frames) {
        if (id === anchorId) continue   // the held anchor does not move from the request
        const frame = pump.registry.get(id)
        // Only settled, unpinned, unheld frames may be reconfigured.
        // A held member is a prior attempt's hold, so a further failure re-holds it;
        // an unsettled or pinned member is outside the analytic tree and is unresolved.
        if (!frame || !frame.done) return unsupported(spec, 'a component member is not settled')
        if (heldFrame(frame)) return INAPPLICABLE
        if (pinnedLaw(pump.laws, id)) return unsupported(spec, 'a pinned component member cannot be reconfigured yet')
    }
    // The anchor's world: a pin fixes it; otherwise it stands where it is read. A free
    // partner is realized about it, so the pin holds while the partner answers. (P2)
    const anchorFrame = pump.registry.get(anchorId)
    const anchorTarget = anchorPin ? positionTarget(anchorPin) : null
    const pinFrame = anchorTarget ? pump.registry.get(anchorTarget.frame) : null
    const anchorWorld = anchorTarget
        ? (pinFrame ? SE3.apply(world.transform(pinFrame), anchorTarget.value) : null)
        : (anchorFrame ? world.read(anchorFrame, null).position : null)
    if (!anchorWorld) return unsupported(spec, 'the held anchor has no world')
    const worldAt = (id) => {
        if (id === anchorId) return anchorWorld
        const frame = pump.registry.get(id)
        return frame ? world.read(frame, null).position : null
    }
    const distances = comp.laws.filter((law) => law.feature === 'distance')
    const positions = realizeDistanceTree(distances, anchorId, worldAt, (law) => boundTerm(law)?.radius)
    if (!positions) return unsupported(spec, 'a cyclic or unanchored component')
    // The tree realizes every member; the declaring observer is a validity reference, not a
    // mover. (id:laws-activation-order)
    const move = new Map()
    for (const id of comp.frames) {
        if (id === spec.observer.id) continue
        const target = positions.get(id)
        if (target == null || !pump.registry.get(id)) return unsupported(spec, 'a component member left the registry')
        move.set(id, target)
    }
    // The SAME boundary: the joint candidate is checked over the whole declared scope, not
    // only its component. (id:laws-activation-order)
    // The tree's ADMITTED movable members are its permitted set — no more. (id:laws-activation-order)
    // The ADMITTED IDs come from the PROBLEM — the component, less the declaring observer —
    // independently of the edits the producer returns. A producer cannot widen its own
    // permission by naming a frame outside it. (id:laws-activation-order)
    const permitted = [...comp.frames].filter((id) => id !== spec.observer.id)
    return settle(spec, candidate, move, pump, scope, world, { permitted })
}

// A proposal returns an outcome; it never mutates a frame's lifetime. The caller
// hands that outcome to the one settlement boundary. (id:laws-activation-order)
// The REACH ENVELOPE a row's propose/validate consumes — not a `solveQuestion`, and not a
// grant of authority: the reach's own inputs, not an enforced permission model.
//   law                — the bound relationship (the authority)
//   retained           — the retained conjunction (retained + proposed)
// The primary reach exposes its bound law, retained truths and operation question.
// Flat reach fields remain adapters; hand continuation keeps its existing contract.
// (id:laws-free-relations-contract, D058)
// A reach chooses movers independently of mathematical input order. (D058)
function reachOperation(spec, row, candidate) {
    const requested = spec.operation
    if (requested != null && (typeof requested !== 'object' || Array.isArray(requested))) {
        return { kind: "relation", message: "a reach operation must be a question object", span: spec.owner }
    }
    const policy = requested && Object.hasOwn(requested, 'policy') ? requested.policy
        : row.reachPolicy?.(spec) ?? "target-only"
    if (!(row.reachPolicies ?? ["target-only"]).includes(policy)) {
        return { kind: "relation", message: `unknown reach policy '${policy}'`, span: spec.owner }
    }
    const references = candidate.expression?.references ?? candidate.endpoints
    const live = references.filter(isLiveInput)
    const movable = requested && Object.hasOwn(requested, 'movable') ? requested.movable
        : (policy === "balanced" ? live : [spec.target?.id ?? live[0]])
    if (!Array.isArray(movable) || movable.some((id) => !live.includes(id))) {
        return { kind: "relation", message: "a reach mover must be a bound live input", span: spec.owner }
    }
    return Object.freeze({
        policy,
        movable: Object.freeze([...new Set(movable)]),
        held: Object.freeze(references.filter((r) => !isLiveInput(r) || !movable.includes(r))),
        request: payloadOf(row.name, boundTerm(candidate)),
        explicit: requested != null,
    })
}

// The primary producer reads an accepted snapshot; the final gate reads the world. (D058)
function reachEnvelope(spec, candidate, scope, ctx, operation, registry) {
    const copyPose = (pose) => {
        if (!pose) return null
        const copy = SE3.clone(pose)
        return Object.freeze({ ...pose, rotation: Object.freeze(copy.rotation),
            position: Object.freeze(copy.position) })
    }
    const ids = new Set([spec.observer.id, ...scope.flatMap((law) =>
        [...(law.sourceIds ?? law.endpoints ?? []), boundTerm(law)?.frame ?? law.frame])])
    const snapshot = Object.freeze([...ids].filter((id) => id != null).map((id) =>
        Object.freeze({ id, live: copyPose(ctx.livePoseOf(id)), placement: copyPose(ctx.placementOf(id)) })))
    const byId = new Map(snapshot.map((entry) => [entry.id, entry]))
    const readers = bindWorld((id) => registry.get(id), {
        live: (frame) => byId.get(frame.id)?.live ?? null,
        placement: (frame) => byId.get(frame.id)?.placement ?? null,
    })
    return {
        ...spec, ...ctx, ...readers,
        law: candidate, retained: scope,
        operation: Object.freeze({ ...operation, snapshot }),
        reachPolicy: operation.policy,
        reachRequest: operation.request,
        measurementContext: spec.observer ?? null,
    }
}

export function applyLaw(spec, pump, world) {
    const row = AUTHORED[spec.feature]
    if (!row?.propose || !row?.validate) return { kind: 'unsupported', message: `Unsupported law: ${spec.feature}`, span: spec.owner }
    // Declaration context owns the law; explicit participants need no observer
    // endpoint or permanent anchor. (id:laws-free-relations-contract)
    // The reach supplies the typed references (live ids and framed values); a legacy
    // caller without them derives the endpoints. (id:laws-distance-literal-address)
    // Relationship inputs derive from the BOUND CANDIDATE: a supplied term's references ARE
    // the participants; the loose fields are the legacy road only. (id:laws-payload-boundary)
    const references = spec.term?.references ?? spec.references ?? row.endpoints(spec)
    // The operation acts on an ADMITTED participant. A loose target outside them is a
    // mismatch between the law verified and the move proposed — never a movement of a frame
    // the law says nothing about. (id:laws-payload-boundary)
    const admitted = references.filter(isLiveInput)
    if (spec.target != null && admitted.length > 0 && !admitted.includes(spec.target.id)) {
        return { kind: 'relation', message: `the operation's target is not among the law's bound participants`, span: spec.owner }
    }
    const candidate = bindLaw({
        feature: spec.feature,
        endpoints: references,
        scope: spec.observer.id,
        frame: spec.observer.id,
        // A proposal derives its inputs from the BOUND CANDIDATE: a supplied term is the
        // authority, carrying its own frame, references and payload. The loose fields are
        // only the road a declaration takes to BUILD one. (id:laws-payload-boundary, D058)
        predicate: spec.term ? (payloadOf(spec.feature, spec.term) ?? spec.value) : spec.value,
        owner: spec.owner,
        source: spec.source ?? spec.expression ?? null,
        ...(spec.term ? { expression: spec.term } : {}),
        axis: spec.axis,
    })
    // The bound domain guard, preserved through lowering: a negative length is a
    // domain error, never permission to drop a positive law. (id:laws-build-p3a)
    if (!predicateOk(candidate.feature, boundTerm(candidate)?.radius ?? candidate.predicate)) {
        return { kind: 'relation', span: spec.owner,
            message: `a ${candidate.feature} payload must be finite${candidate.guards?.nonNegative ? ' and non-negative' : ''}` }
    }
    const surviving = pump.laws.active().filter((law) => addressOf(law) !== addressOf(candidate))
    const scope = [...surviving, candidate]
    const operation = reachOperation(spec, row, candidate)
    if (operation.kind) return operation
    const policy = operation.policy
    spec = { ...spec, operation }
    const fact = row.staticVerdict?.(candidate)
    if (fact?.status === 'contradiction') {
        return { kind: 'contradiction', message: fact.reason, span: spec.owner,
            members: affectedMembers(pump.registry, scope, references) }
    }
    if (policy === 'balanced') {
        const current = lawViolation(scope, new Map(), pump.registry, world)
        if (current.status === 'valid') {
            return { kind: 'commit', poses: [], address: candidate.address,
                law: candidate, span: spec.owner }
        }
        if (current.status === 'cannot-measure' && current.law !== candidate) return unsupported(spec, current.reason)
        const comp = componentOf(scope, references)
        const geometric = comp.laws.filter((law) =>
            AUTHORED[law.feature]?.staticVerdict?.(law)?.status !== 'tautology')
        if (geometric.length > 1) {
            // A held anchor (a pin or a body) is not a coupled-obligation refusal: the
            // pair is realized ABOUT it. Exactly one anchor is the bounded case.
            // (id:laws-free-relations-f2)
            const anchors = [...comp.frames].filter((id) => {
                const frame = pump.registry.get(id)
                const e = frame && eligibilityOf(frame, scope, pump.registry)
                // An anchor is a pin, a body, a hold or a coupled partner — not a mover.
                return !!e && (!(e.exposed && e.seated && e.settled && !e.owned && !e.broken) || e.held || e.pinned)
            })
            if (anchors.length === 1) {
                const joint = componentCandidate(spec, candidate, pump, scope, world, anchors[0])
                if (joint !== INAPPLICABLE) return joint
            }
            return unsupported(spec, 'free-pair initialization cannot reconfigure coupled obligations yet')
        }
    }
    const ctx = lawCtx(pump.registry, null, world, {
        pinWorld: (id) => {
            const pin = pinnedLaw(pump.laws, id)
            const target = pin ? positionTarget(pin) : null
            const pose = target ? envelope.placementOf(target.frame) : null
            return pose ? SE3.apply(pose, target.value) : null
        },
        conflictAt: (target, worldPos) => conflictAt(target, worldPos, pump.laws, pump.registry, world),
        ownerOf: ownerLabel,
        tie: world.transform(spec.observer).rotation.rotateVec(policy === 'balanced' && references[0] > references[1] ? -1 : 1, 0, 0),
    })
    const envelope = reachEnvelope(spec, candidate, scope, ctx, operation, pump.registry)
    const placed = row.propose(envelope)
    if (!placed.ok) {
        if (placed.kind === 'obstructed' || placed.kind === 'contradiction') {
            return { kind: placed.kind, message: placed.reason, span: spec.owner,
                candidate: placed.world ? { frame: spec.target.id, world: placed.world } : null,
                residual: placed.residual ?? null,
                members: affectedMembers(pump.registry,
                    [...pump.laws.active().filter((law) => addressOf(law) !== addressOf(candidate)), candidate],
                    candidate.endpoints, [spec.target, spec.observer]) }
        }
        return { kind: placed.kind ?? 'relation', message: placed.reason, span: spec.owner }
    }
    const check = row.validate({ ...envelope, world: placed.world, worlds: placed.worlds })
    if (!check.ok) return { kind: check.kind ?? 'relation', message: check.reason, span: spec.owner }

    // The selected mover, not an argument slot, owns a single-point proposal. (D058)
    const worlds = placed.worlds ?? new Map([[operation.movable[0], placed.world]])
    if (policy === 'balanced' && (worlds.size !== new Set(references).size ||
        [...worlds.keys()].some((id) => !references.includes(id)))) {
        return { kind: 'relation', message: 'a free-pair proposal must name only its bound participants', span: spec.owner }
    }
    // The ONE candidate boundary: prepare the edits, check the original truths, assemble.
    const outcome = settle(spec, candidate, worlds, pump, scope, world, {
        // Method-specific: a balanced pair admits its participants; a target-only reach admits
        // the one point it moves. (id:laws-activation-order)
        permitted: operation.movable,
        fail: (gate, poses) => {
            if (policy === 'balanced') return { kind: 'relation', message: 'the free-pair proposal failed its original predicates', span: spec.owner }
            // Two lawful distances can move together: a connected distance tree responds
            // jointly before the candidate is called a failure. (id:laws-build-p3)
            const joint = componentCandidate(spec, candidate, pump, scope, world)
            if (joint !== INAPPLICABLE) return joint
            return { kind: 'obstructed', message: conflictMessage(gate.law, candidate), span: spec.owner,
                candidate: plainPoses(poses), residual: gate.residual,
                members: affectedMembers(pump.registry, [...surviving, candidate], candidate.endpoints,
                    [spec.target, spec.observer]) }
        },
    })
    return { ...outcome, operation: envelope.operation,
        ...(placed.selection ? { selection: placed.selection } : {}) }
}
