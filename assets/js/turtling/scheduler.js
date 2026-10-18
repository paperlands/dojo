// Cooperative scheduler for frame coroutines — green threads, not OS threads.
// Pump + park: preemptive slice (time) and backpressure (credit/residency) share one park.
// Instant law: no sibling advances past a parked mid-instant. (id:output-ledger-r2-instant)

import { createFrame, isBeing, isLiveBeing, liveIn } from "./frame.js"
import { isWithinRegion, isSuppliedParticipant, mayAddressParticipant } from "./participation.js"
import { createExecution } from "./execution.js"
import { installAmbientDoor } from "./ambient.js"
import { report, notice as noticeWire } from "./report.js"
import { matchPattern } from "./match.js"
import { execute, createActorState, headEventOf } from "./executor.js"
import { deriveBatch, exposed, freePoint } from "./laws/batch.js"
import { resolveTarget, reservedUnreached } from "./laws/resolution.js"
import { addressOf, bindLaw, createLawStore } from "./laws/replacement.js"
import { lawViolation, brokenLaw, heldFrame, continueLaws, conflictMessage, affectedMembers, plainPoses, applyLaw } from "./laws/verdict.js"
import { programFollowing } from "./laws/program_following.js"
import { predicateOk, kindOf } from "./laws/expression.js"
import { AUTHORED, bindWorld, driveOf, mayEstablishOf, withPayload } from "./laws/authored.js"
import { meetAll, nearest } from "./laws/meet.js"
import { measure, headingOf, elevationOf } from "./laws/relations.js"
import { createReadouts, same as sameValue } from "./laws/readout.js"
import { SE3 } from "./se3.js"
import { storageSpace, toLocalPose, toWorldPose } from "./localize.js"
import { snapshotFact } from "./observation.js"
import { keyedSeed, keyedStream } from "./mafs/keyed_stream.js"
import { parseMemo } from "./mafs/parse_memo.js"
import { chargeInk, woundInk, enforceResidency, resetInk, createStock } from "./ledger.js"
import { toSpace } from "./space.js"

// Lens: viewport Output, not scene. Name `eye`. (id:eye-lens-primitive)
const LENS_NAMES = new Set(["eye"])
export function isLensName(name) {
    return LENS_NAMES.has(name)
}

// Lens head → view event. (id:eye-output-bifurcation)
function lensOutput(frame, event) {
    if (frame.isLens && event.type === "head") {
        const world = frameWorldTransform(frame)
        return { type: "view", position: world.position, rotation: world.rotation, fov: event.fov }
    }
    return event
}

// --- Tree walk ---

// A reached slot has one sibling order across geometric children and installations.
// Replacement keeps that order; it confers no publication rights. (id:being-facets-writer-order)
function orderExecution(parent, child, prior = null) {
    child.executionOrder = prior?.executionOrder ??
        (parent.nextExecutionOrder = (parent.nextExecutionOrder ?? 0) + 1)
}

function visitPostOrder(ctx, fn) {
    for (const child of ctx.children.values()) {
        visitPostOrder(child, fn)
    }
    fn(ctx)
}

// An unfinished instant owns its whole execution branch, including nested installations.
// Otherwise retain post-order hierarchy and reached sibling order. (id:being-facets-writer-order)
function visitPostOrderMotionFirst(ctx, fn) {
    const order = (frame) => {
        const children = [...frame.children.values()]
        for (const record of frame.installations?.values() ?? []) children.push(record.frame)
        if (frame.installations?.size) children.sort((a, b) => a.executionOrder - b.executionOrder)
        const branches = children.map(order)
        branches.sort((a, b) => Number(b.open) - Number(a.open))
        return { frame, branches, open: !!frame.midInstant || branches.some((branch) => branch.open) }
    }
    const visit = ({ frame, branches }) => {
        for (const branch of branches) visit(branch)
        fn(frame)
    }
    visit(order(ctx))
}

function terminateAmbient(ctx) {
    for (const child of ctx.children.values()) {
        if (!child.done) terminateAmbient(child)
    }
    unwireWorldCache(ctx)
    ctx.observation = null
    ctx.done = true
    clearSuspension(ctx)
    ctx.channel.close()
}

function allDone(ctx) {
    if (!ctx.done) return false
    // A discovered meaning owes one bounded comparison before the world may idle.
    // (id:being-facets-root-repair)
    if (ctx.compareOwed === true) return false
    // Installations own execution: an unfinished installation keeps the world awake,
    // even though it is not a geometric child. (id:being-facets-p4-sequence)
    for (const record of ctx.installations?.values() ?? []) {
        if (!allDone(record.frame)) return false
    }
    for (const child of ctx.children.values()) {
        if (!allDone(child)) return false
    }
    return true
}

// Does any frame still owe the one bounded comparison a discovered meaning requires?
// (id:being-facets-root-repair)
function owesComparison(ctx) {
    const stack = [ctx]
    while (stack.length > 0) {
        const node = stack.pop()
        if (node.compareOwed === true) return true
        for (const child of node.children.values()) stack.push(child)
        for (const record of node.installations?.values() ?? []) stack.push(record.frame)
    }
    return false
}

// A frame's whole walk — itself plus everything it spawned. Exported because
// a SEAT needs its own count: `scheduler.commandCount` is this over the ROOT
// (every seat at every place) — so a ladder step cannot announce that total.
export function sumCounts(ctx) {
    let total = ctx.commandCount || 0
    for (const child of ctx.children.values()) {
        total += sumCounts(child)
    }
    return total
}

// origin = synthetic root (absolute); world = observer's top program. (id:ft-d4-world-root)
const ROOT_NAME = "origin"

// Address is the path from root — id dies on re-eval. (id:cmp-become-seed)
export function frameAddress(root, frame) {
    const names = []
    let f = frame
    while (f && f.parent && f.parent !== root) {
        names.unshift(f.name)
        f = f.parent
    }
    // f is now the top-level child of root (or root itself). Prefer its stable
    // registration key over its display name (names can collide across tabs).
    if (f) {
        let topKey = f.name
        for (const [k, v] of root.children) { if (v === f) { topKey = k; break } }
        names.unshift(topKey)
    }
    return names.join('/')
}

// --- World transform: inertial frame composition ---

// Local origin → world via parent chain; cached when watches wired.
function worldTransform(ctx) {
    if (ctx._worldWatched && !ctx._worldDirty && ctx._worldCache) return ctx._worldCache
    const chain = []
    let current = ctx
    while (current.parent) {
        // Use this child's birth origin (parent's transform at spawn time)
        // so siblings each keep their own inherited position/orientation.
        chain.push(current.origin || current.parent.transform.deref())
        current = current.parent
    }
    if (chain.length === 0) {
        ctx._worldCache = SE3.identity()
    } else {
        chain.reverse()
        ctx._worldCache = chain.reduce((a, b) => SE3.compose(a, b))
    }
    ctx._worldDirty = false
    return ctx._worldCache
}

// --- Inertial frame targeting ---

// Child-local → target-local via world pivot. (id:ft-d1-world-pivot)
function relativeTransform(ctx, target) {
    return SE3.compose(SE3.invert(worldTransform(target)), worldTransform(ctx))
}

// Project event into target frame; tag source. (id:ft-d2-per-source-trails)
function transformEvent(event, t, sourceId) {
    switch (event.type) {
        case 'path':
            return { ...event, sourceId, points: event.points.map(p => SE3.apply(t, p)) }
        case 'label':
            return { ...event, sourceId, position: SE3.apply(t, event.position) }
        case 'grid':
            return { ...event, sourceId, position: SE3.apply(t, event.position), rotation: t.rotation.multiply(event.rotation) }
        default:
            return event
    }
}

const _samePt = (a, b) =>
    a && b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6
// INSTALLATION compares EXACTLY. Approximate equality is a stroke-joining question, never a
// state question: a pose the whole-law gate validated must be the pose that lands, or the
// checked configuration and the effective installation are two different worlds.
const identicalPose = (a, b) => a && b &&
    a.position[0] === b.position[0] && a.position[1] === b.position[1] && a.position[2] === b.position[2] &&
    a.rotation.w === b.rotation.w && a.rotation.x === b.rotation.x &&
    a.rotation.y === b.rotation.y && a.rotation.z === b.rotation.z
// Geometry, not admission: a live being with a parent, not a lens, no wound. The hand asks it as
// a precondition; the program asks only whether the DEFAULT producer may run. Settlement is absent
// on purpose (a hand needs a settled actor; a program is the actor's own instant). (D063)
const isMotionDestination = (frame, registry) =>
    isLiveBeing(frame, registry) && frame.parent != null && !frame.isLens && !frame.error

const usesDefaultMotion = (pump) => pump.motionAdmission == null && pump.motionAdmissionAsync == null

// Execution ancestry owns the question; inputs retain identity, not their whole state.
// (id:execution-input-revisions)
function executionDepends(frame, input) {
    for (let node = frame; node; node = node.parent) {
        if (node === input || node.receiver === input) return true
        for (const entry of node.consumed?.values() ?? []) if (entry.target === input) return true
    }
    return false
}


// Stroke-run id from source geometry+width; colour does not break. (id:child-ink, id:ft-d7-deposit-runid)
function tagRun(ctx, value) {
    if (value.type !== 'path' || !value.points || !value.points.length) return
    // Thickness only: LineMaterial.linewidth is uniform per mesh. Colour is data.
    const style = `${value.thickness}`
    const continues = style === ctx._strokeStyle && _samePt(value.points[0], ctx._strokeEnd)
    if (!continues) ctx._strokeRun = (ctx._strokeRun || 0) + 1
    // Installation counters restart on replacement; their receiver's displayed ink does not.
    // (id:ft-d7-deposit-runid)
    value.runId = ctx.installation === true ? `${ctx.id}:${ctx._strokeRun}` : ctx._strokeRun
    ctx._strokeEnd = value.points[value.points.length - 1]
    ctx._strokeStyle = style
}

// Head rides the same projection as its ink — pose and heading. (id:ft-d5-head)
// headLocal = R_frame * R_local so group(target) * headLocal = world heading.
function projectHead(headEvent, frameTarget, frameTransform) {
    if (!frameTarget) return headEvent
    return {
        ...headEvent,
        position: SE3.apply(frameTransform, headEvent.position),
        rotation: frameTransform.rotation.multiply(headEvent.rotation),
    }
}

// SLOT vs CHANNEL — two queue disciplines (classic: mailbox vs latest-value).
// Channel: lossless; full refuses → park owing. Slot: conflates; newest wins; never owes.
// A pose that never painted was not lost — it was superseded. (id:output-ledger-r2-slot)
function putSync(ctx, event, key = event.type) {
    // The key is the identity of a displayed thing: a single head per frame keys by
    // kind, a declared object keys by its name so a COLLECTION of arrows coexists
    // and each conflates only with itself. (id:notation-coordinate-vector)
    ctx.sync[key] = event
}

// Reader empties the slot (conflation's other half). One owner — not the compositor.
export function takeSync(frame) {
    const slot = frame.sync
    let taken = null
    for (const type in slot) {
        if (!slot[type]) continue
        ;(taken ??= []).push(slot[type])
        slot[type] = null
    }
    return taken ?? EMPTY_SYNC
}

const EMPTY_SYNC = Object.freeze([])

// Deliver an already-charged deposit. null = taken; else refusal cause.
// Safe to retry — no side effects on refuse. (id:output-ledger-r2-credit)
function deliverDeposit(ctx, value, frameTarget, frameTransform, stock, destination = ctx) {
    // The deposit LANDS on the DESTINATION: for an installation's authored motion that is
    // the retained receiver; otherwise the writer itself. The writer keeps its run tag,
    // continuation and rights. (id:being-facets-p4-sequence)
    if (value.type === "head") {
        // Only the ordinary self-motion installs here. An installation's pose was already
        // COMMITTED at the boundary; this deposit projects it. (id:being-facets-p4-sequence)
        if (destination === ctx) {
            destination.transform.swap(() => ({ rotation: value.rotation, position: [...value.position] }))
        }
        putSync(destination, lensOutput(destination, projectHead(value, frameTarget, frameTransform)))
        return null
    }

    // Residency = working set full (stage stock). One cell, not N flags.
    // (id:output-ledger-r3-addressee, id:carving-todo-ledger-stock)
    if (stock?.full && value.type === 'path') return 'residency'

    // Credit = flow control: sink queue full (classic credit-based backpressure).
    const sink = frameTarget ? frameTarget.channel : destination.channel
    if (sink.full) return 'credit'

    // The held clear lands WITH the new ink: one step, so the swap is atomic to the view.
    // (id:laws-figures-phase34-inplace)
    if (ctx.pendingClear) { ctx.channel.put({ type: 'clear' }); ctx.pendingClear = false }
    tagRun(ctx, value)
    if (frameTarget) {
        sink.put(transformEvent(value, frameTransform, ctx.id))
    } else {
        sink.put(lensOutput(destination, value))
    }
    return null
}

// Charge once, deliver maybe later. Park holds a charged deposit — replaying
// must not charge again. (id:output-ledger-r3-stock-flow)
// null | 'ceiling' (wounded) | refusal cause to parkOwing
function offerDeposit(ctx, value, frameTarget, frameTransform, stock, destination = ctx) {
    if (!chargeInk(ctx, value, stock)) return 'ceiling'
    return deliverDeposit(ctx, value, frameTarget, frameTransform, stock, destination)
}

// --- Suspension: every way a frame stops, as one table ---
// `owns` is the instant law: no sibling observes past a frame that owns its
// instant. `unwinds` stops an inline drain. (id:output-ledger-r2-instant)
const SUSPENSIONS = {
    breath:    { owns: false, unwinds: true },
    credit:    { owns: true,  unwinds: true },
    residency: { owns: true,  unwinds: true },
    dataflow:  { owns: true,  unwinds: false },
    admission: { owns: true,  unwinds: true },
}

function suspend(frame, kind, parts) {
    if (!SUSPENSIONS[kind]) throw new Error(`Unknown suspension: ${kind}`)
    clearSuspension(frame)
    frame.suspension = { kind, owed: null, ...parts }   // owed stays null unless a debt is held
}

function clearSuspension(frame) {
    frame.suspension?.cancel?.()
    frame.suspension = null
}

// An admission opens an instant that stays owned until a wait/yield/done.
function openInstant(frame) { frame.midInstant = true }
function closeInstant(frame) { frame.midInstant = false }

// The frame a dataflow suspension waits on, or null. One reader for the wait-for graph.
const dataflowTarget = (frame) =>
    frame.suspension?.kind === 'dataflow' ? frame.suspension.on : null

// Breath = preemption: slice spent, generator stays put, owes nothing.
// A debt is not a breath: an outstanding deposit outranks it.
export function parkBreath(ctx) {
    if (ctx.suspension?.owed) return
    if (ctx.suspension?.kind === 'breath') return
    suspend(ctx, 'breath')
}

// Owing = blocked on a full queue / full stage. The deposit is held and replayed
// FIRST so emission order survives. Fresh deposit only; stepOnce reparks a
// standing debt in place. (id:output-ledger-r2-credit)
export function parkOwing(ctx, cause, deposit) {
    suspend(ctx, cause, { owed: deposit, since: null })
}

// Breath dies at pass start; a debt outlives the pass that made it.
function clearSpentPark(ctx) {
    if (ctx.suspension?.kind === 'breath') clearSuspension(ctx)
}

// --- Binding resolution: observation + inheritance ---

// Ambient name resolve: siblings then ancestors, by display name.
function metaRootFrame(frame) {
    const cached = frame._root
    if (cached) return cached
    // A rewind builds a fresh frame, so a frame never reparents: the root is stable and
    // worth caching along the path. A detached frame is its own root. (id:laws-living-figures-review-next)
    let root = frame
    while (root.parent) root = root.parent
    for (let node = frame; node; node = node.parent) {
        node._root = root
        if (node === root) break
    }
    return root
}

// world = observer's root-child (or self if observer is root).
function topLevelFrame(frame) {
    const root = metaRootFrame(frame)
    if (frame === root) return root
    let node = frame
    while (node.parent !== root) node = node.parent
    return node
}

// Reserved universe names resolve relative to the observer, not by frame.name.
// `world` → own top-level program; `origin` → synthetic root datum.
function resolveReserved(frame, name) {
    if (name === 'world') return topLevelFrame(frame)
    if (name === 'origin') return metaRootFrame(frame)
    return null
}

// First frame named `name` anywhere under `node`, skipping `self`. Post-order,
// so the answer does not depend on when a sibling happened to spawn.
function findInTree(node, name, self) {
    for (const child of node.children.values()) {
        const hit = findInTree(child, name, self)
        if (hit) return hit
    }
    return (node !== self && node.name === name) ? node : null
}

// Resolve a name to a frame. `reach` says how far the caller may look:
//
//   'near'   own children, siblings, then ancestors — the local neighbourhood.
//   'world'  anywhere in the tree. A FRAME OF REFERENCE need not be kin: any
//            frame can be one, so an ancestors-only walk made `as b a do`
//            silently draw in b's own frame whenever a was a sibling.
//
// Nearest wins before the wide search, so locality still decides between two
// frames of the same name.
function findFrame(frame, name, reach = 'near') {
    const reserved = resolveReserved(frame, name)
    if (reserved) return reserved

    // Own children are the nearest kin of all: a declaring body reads the place
    // it declared by bare name. Names collide across tabs, so proximity decides
    // before the wide walk below. (id:laws-decl-point-agent)
    for (const child of frame.children.values()) {
        if (child.name === name) return child
    }

    // Siblings (parent's children, or own children if root)
    const parent = frame.parent || frame
    for (const child of parent.children.values()) {
        if (child.name === name) return child
    }

    // Walk ancestors by name
    let ancestor = frame.parent
    while (ancestor) {
        if (ancestor.name === name) return ancestor
        ancestor = ancestor.parent
    }

    return reach === 'world' ? findInTree(metaRootFrame(frame), name, frame) : null
}

// The tree's shape-and-names generation. Bumped by every spawn, removal and
// rename — precisely the events that can turn a resolved reference into the
// wrong answer, or turn a missing one into a hit.
function bumpTree(frame) {
    const root = metaRootFrame(frame)
    root._treeGen = (root._treeGen || 0) + 1
    root._configurationRevision = (root._configurationRevision || 0) + 1
}

// Changing a frame's ORIGIN moves everything under it: the transform watcher covers
// motion, and origin is a plain field, so the subtree's cached world poses go stale
// unless they are told. (id:laws-figures-phase34-hand-frame)
function dirtyWorldSubtree(frame) {
    visitPostOrder(frame, (c) => { c._worldDirty = true })
    bumpTree(frame)
}

// Own/parent reference stable placement; named frames reference their live heads.
// Both conversion directions resolve through this one convention. (id:laws-figures-phase34-hand-frame)
function poseReference(frame, ref) {
    if (ref === 'parent') return frame.parent ? worldTransform(frame.parent) : SE3.identity()
    if (ref === 'own' || ref == null) return worldTransform(frame)
    const anchor = findReferenceFrame(frame, ref)
    return anchor ? frameWorldTransform(anchor) : null
}

function expressPose(frame, ref, pose) {
    if (ref === 'world') return pose
    const base = poseReference(frame, ref)
    return base ? toWorldPose(base, pose) : null
}

function statePose(frame, ref, worldPose) {
    if (ref === 'world') return worldPose
    const base = poseReference(frame, ref)
    return base ? toLocalPose(base, worldPose) : null
}

// The frame a `as <name> <frame> do` names. One door, so the drain, the tick
// and the compositor cannot disagree about where a frame's ink belongs.
//
// Memoized against the tree generation: the wide search is O(tree), and this is
// asked once per pass per frame AND once per layer per drawn frame. Measured at
// 1024 frames it was 29 µs a call when the reference sat late in the walk.
// A MISS is cached too — a name can only start existing via a spawn, and a
// spawn bumps the generation.
function findReferenceFrame(ctx, name) {
    const gen = metaRootFrame(ctx)._treeGen || 0
    const memo = ctx._ref
    if (memo !== undefined && memo.gen === gen && memo.name === name) return memo.frame
    const frame = findFrame(ctx, name, 'world')
    ctx._ref = { gen, name, frame }
    return frame
}

// P2 — ownership of a suspended instant. An admitted motion or a refusal park
// (credit/residency) means the frame is inside an instant; the suspension is a
// property of its whole spawn stack, so every ancestor owns it too. A read of a
// frame whose subtree is unsettled suspends — unless the reader is itself inside
// that instant, where the ancestor's committed pose is the reader's birth base
// and is the only value that can ever settle. (id:output-ledger-r2-instant, R2.5b)
function ownsInstant(frame) {
    return frame.midInstant === true || SUSPENSIONS[frame.suspension?.kind]?.owns === true
}

// A display cut closes every live instant, including descendants under ended owners.
// Closure neither certifies all due work serviced nor authorizes publication.
// (id:render-construction-cadence-wait-regression)
function atCut(frame) {
    // An ended body is closed, but its own children are still this region's ink —
    // closing the owner is not enough. (id:render-construction-cadence)
    if (!frame.done) {
        if (frame.midInstant) return false
        if (frame.suspension) return false
    }
    for (const child of frame.children.values()) {
        // A done child may still own a living descendant — descend regardless.
        // (id:render-construction-cadence)
        if (!atCut(child)) return false
    }
    return true
}

// No unfinished or unserviced logical obligation remains through H.
// Future waits settle; pending frames, derived moves and keyed builds do not.
// (id:live-rendering-reveal)
function settledThrough(registry, root, H, pump) {
    if (root._derivedMoves.length > 0) return false
    // A keyed readout answer waiting to build is an unserviced obligation (owner's own state).
    if (root._readouts?.hasWork?.()) return false
    for (const frame of registry.values()) {
        if (frame === root || frame.done) continue
        // Deferred execution is not due; an already-open instant still must close.
        // (id:execution-input-revisions)
        if (!pump.execution.permits(frame) && !ownsInstant(frame)) continue
        if (frame.suspension) return false
        if (frame.midInstant) return false
        if (frame.resumeAt <= H) return false
    }
    return true
}

function subtreeUnsettled(frame) {
    if (ownsInstant(frame)) return true
    if (frame.children.size === 0) return false   // hot path: a leaf target is O(1)
    for (const child of frame.children.values()) {
        if (subtreeUnsettled(child)) return true
    }
    return false
}

function isAncestorOf(ancestor, frame) {
    let node = frame
    while (node) {
        if (node === ancestor) return true
        node = node.parent
    }
    return false
}

// Wait-for graph: does any frame in `root`'s subtree already wait (transitively)
// on `reader`? If so, blocking the reader would close a dataflow cycle; the read
// falls back to the logically-prior committed pose instead. (D011)
function waitsOn(root, reader) {
    let node = dataflowTarget(root)
    const seen = new Set()
    while (node) {
        if (node === reader) return true
        if (seen.has(node)) break
        seen.add(node)
        node = dataflowTarget(node)
    }
    for (const child of root.children.values()) {
        if (waitsOn(child, reader)) return true
    }
    return false
}

// Resolve a name against the ambient tree — unified for 0-arity (variables) and n-arity (functions).
// Called from evaluator's resolveContext (args=undefined) and applyFunction (args=[...]).
function resolveBinding(frame, name, args) {
    if (typeof name === 'string' && name.includes('.')) {
        // Dotted: target.property or target.fn[args]
        const dot = name.indexOf('.')
        const targetName = name.slice(0, dot)
        const property = name.slice(dot + 1)
        // A declared-but-unreached name owns this scope from the start. Reading it
        // before its `let` is a located use-before-introduction — never an outer
        // namesake fallback, never a wait on this same continuation.
        // (id:laws-ordered-birth)
        if (frame.declared?.has(targetName) && !frame.children.has(targetName)) {
            throw new Error(`Use before introduction: ${targetName}`)
        }

        const target = findFrame(frame, targetName)
        // Admission — being, current registry, region containment — lives at the one
        // facet door below, so the gate and the resolver cannot choose different facts.
        // (id:being-facets-centers-review, id:laws-figure-protocol)
        return resolveFacet(frame, target, targetName, property, args)
    } else {
        // Unqualified: walk ancestor chain for fn binding
        // A scalar introduced by `let s = expr` is a value, not a frame. Its
        // declaring frame and its ancestors own the binding; between commits it
        // computes on demand. (id:laws-build-p3-readout-built)
        for (let node = frame; node; node = node.parent) {
            // A parameter is a sampled input: it has one value, fixed when its
            // declaration was reached. It is not a reading and never recomputes.
            // (id:eval-relational)
            if (node.params?.has(name)) return node.params.get(name)
            if (node.scalars?.has(name)) {
                // This scope owns the name. A failed reading is a wound, not
                // an outer namesake or an unbound variable. (id:eval-relational)
                return metaRootFrame(frame)._readouts?.value(node.scalars.get(name))
            }
        }
        const arity = args ? args.length : 0
        let ancestor = frame.parent
        while (ancestor) {
            const result = lookupFn(ancestor, name, arity, args)
            if (result !== undefined) return result
            ancestor = ancestor.parent
        }
        return undefined
    }
}

// One facet door: a dotted reach and a bound being both end here, so eligibility and the
// coordinate frame cannot diverge. `reference` is the reserved frame name the read came
// through; a bound being passes null, so a reserved interpretation is never inferred from
// a frame's presence. (id:being-facets-centers-review)
function resolveFacet(frame, target, reference, property, args) {
    recordRead(frame.deps?.mathEvaluator, target)
    const registry = metaRootFrame(frame)._registry
    if (!mayAddressParticipant(frame, target, registry)) {
        throw new Error(`closed region has no world read: ${reference ? `${reference}.${property}` : `${target.name}.${property}`}`)
    }
    if (!isBeing(target)) {
        // A missing name is a dataflow suspension while its parent can still spawn it;
        // only a finished parent makes it a wound. (D011)
        if (frame.inlineAdvancing || (frame.parent && !frame.parent.done)) {
            const err = new Error(`Blocked on assistant: ${reference}`)
            err.blocked = true
            throw err
        }
        throw new Error(`Undefined assistant: ${reference}`)
    }
    // A name resolved in this tree has no separate retirement question; only a CARRIED
    // identity must be certified by the registry. (id:being-facets-centers-review)
    if (!isLiveBeing(target, registry) && reference == null) throw new Error(`retired subject: ${target.name}`)
    // An observation is a synchronization point, not a peek at whatever committed pose
    // is lying there. A wait-for cycle is synchronous (Jacobi); a plain suspension parks.
    if (subtreeUnsettled(target) && !isAncestorOf(target, frame)) {
        if (waitsOn(target, frame)) {
            markCycle(frame, target)
        } else {
            const err = new Error(`Blocked on assistant: ${reference ?? target.name} (mid-instant)`)
            err.blocked = true
            err.blockedFrame = target
            throw err
        }
    }
    if (frame.suspension?.kind === 'dataflow') clearSuspension(frame)
    // Only orientation asks for a reader reference; position always projects world geometry.
    // (id:world-coordinate-phase-2-reads)
    const isWorld = reference === 'world'
    const isOrigin = reference === 'origin'
    const contains = target !== frame && isAncestorOf(target, frame)
    const ground = isWorld ? false : (isOrigin ? true : !contains)
    return resolveProperty(target, property, args, frame, ground)
}

// A bound being's facet, through the same door; retired and closed are the door's own
// refusals now. (id:being-facets-p2-seam)
function resolveBeingFacet(frame, being, property, args) {
    return resolveFacet(frame, being, null, property, args)
}

// A reading is the value, exactly. No floor and no decimal snapping: what a figure
// reads about another place is what that place IS. The eye's rounding is the
// display's business and never feeds back. (ruling 3: a reading is exact)
//
// A reading with no answer stays NOTHING — decided once, at `readable`, where every
// reading crosses the boundary. Projections return the value or nothing; they do not
// wrap themselves. (id:eval-relational)

const headingFromQuaternion = headingOf

// World-space transform: compose ancestor origins with local transform.
// Gives the frame's position/rotation in the global coordinate system.
function frameWorldTransform(frame) {
    const world = worldTransform(frame)
    const local = frame.transform.deref()
    return SE3.compose(world, local)
}

// A frame inside a detected wait-for cycle is read at its PRE-INSTANT pose for the
// whole frontier. That is Jacobi: every edge of the cycle sees one snapshot, so the
// result does not depend on which edge the scheduler resolved first. Acyclic reads
// keep Gauss-Seidel — wait for the target's completed instant.
// This is a read rule, not confluence for geometric relationships. (id:output-ledger-r2-instant)
function readLocal(frame) {
    const cyc = frame._cycleLocal
    if (cyc !== undefined && frame._cycleEpoch === metaRootFrame(frame)._obsEpoch) return cyc
    return frame.transform.deref()
}

function readWorldTransform(frame, observer, frozen = true) {
    // Question interpretation governs a captured input's value: a fresh operation snapshot
    // must not override the retained meaning. (id:being-facets-root-repair)
    const view = frozen ? questionViewOf(observer) : null
    if (view && view.readings.has(frame) && !isLiveReceiver(view, frame)) return view.readings.get(frame).world
    const capture = observer?.observation
    if (capture) {
        const entry = capture.poses.get(frame)
        if (!entry) {
            const error = new Error(`New ambient during observation: ${frame.name}`)
            error.blocked = true
            error.blockedFrame = frame
            throw error
        }
        return entry.world
    }
    return SE3.compose(worldTransform(frame), readLocal(frame))
}

// The nearest question view owns a read. A read inside an installation belongs to its
// owning declaration's question: the installation is the execution of that construction,
// not a separate reader. (id:declared-behaviour-revision-contract)
function questionViewOf(observer) {
    for (let node = observer; node; node = node.parent) {
        if (node.questionView) return node.questionView
    }
    return null
}

// Receiver progress belongs to the governing realization, including sibling writers.
// A separately named inner question retains its own capture authority.
// (id:declared-behaviour-revision-contract)
function isLiveReceiver(view, target) {
    return view?.owner?.consumed?.get(receiverKey(target))?.receiver === true
}

// The receiver's accepted pose as a comparable vector, and its key in the question's
// consumed footprint. (id:declared-behaviour-revision-contract)
const poseVector = (pose) => [pose.rotation.w, pose.rotation.x, pose.rotation.y, pose.rotation.z,
    pose.position[0], pose.position[1], pose.position[2]]
const receiverKey = (receiver) => `rx:${receiver.id}`
const captureReceiver = (receiver) => poseVector(frameWorldTransform(receiver))

// Does `start` already wait, transitively, on `reader`? The edge we are about to
// add would close a cycle, so the read must resolve against the snapshot.
function reachesReader(start, reader) {
    let node = dataflowTarget(start)
    const seen = new Set()
    while (node) {
        if (node === reader) return true
        if (seen.has(node)) break
        seen.add(node)
        node = dataflowTarget(node)
    }
    return false
}

// Pin every member of the cycle to the pose it held before the current observation
// baseline began.
function markCycle(reader, target) {
    const epoch = metaRootFrame(reader)._obsEpoch
    const mark = (frame) => {
        if (frame._cycleEpoch !== epoch) {
            frame._cycleLocal = frame.transform.deref()
            frame._cycleEpoch = epoch
        }
    }
    mark(reader)
    const visit = (frame) => {
        if (reachesReader(frame, reader)) mark(frame)
        for (const child of frame.children.values()) visit(child)
    }
    visit(target)
}

// The reader owns observation and admission; an installation's geometric reference is
// its retained receiver's birth basis, not the declaring source or current cursor.
// (id:being-facets-situated)
function observerBirth(observer, frozen = true) {
    const basis = observer.installation === true ? observer.receiver : observer
    if (observer.installation === true && !isLiveBeing(basis, metaRootFrame(observer)._registry)) {
        throw new Error('the retained receiver has left the world')
    }
    const view = frozen ? questionViewOf(observer) : null
    // An installation's basis is its receiver: a current-world cursor, not a captured read.
    const captured = isLiveReceiver(view, basis) ? null : view?.readings.get(basis)?.birth
    return captured
        ?? observer.observation?.poses.get(basis)?.birth ?? worldTransform(basis)
}

function poseInObserverBirth(target, observer, frozen = true, birth = null) {
    const world = readWorldTransform(target, observer, frozen)
    if (!observer && !birth) return world
    return SE3.compose(SE3.invert(birth ?? observerBirth(observer, frozen)), world)
}

// Position projections — a pose's coordinates. They follow the one world chart.
const POSITION = {
    x: (t) => t.position[0],
    y: (t) => t.position[1],
    z: (t) => t.position[2],
    position: (t) => t.position,
}

// Orientation projections — a pose's facing. They answer the reader's reference-dependent
// question, so they keep the ground convention. (id:world-coordinate-phase-2-reads)
const ORIENTATION = {
    heading: (t) => headingFromQuaternion(t.rotation),
    elevation: (t) => elevationOf(t.rotation),
}

// Temporal properties — lifecycle projections. `time` is local; `birthtime`
// is birth on the shared axis, so `birthtime + time` is an axis position. (id:host-beat)
const TEMPORAL = {
    time:     (frame) => frame.elapsedTime || 0,
    birthtime: (frame) => frame.birthtime || 0,
    done:     (frame) => frame.done ? 1 : 0,
    commands: (frame) => frame.commandCount,
}

// Relational properties — computed from observer + target in world space.
const RELATIONAL = {
    distance: (target, observer) => measure("distance", target, observer, (f) => worldReading(f, observer, null)),
    bearing: (target, observer) => measure("bearing", target, observer, (f) => worldReading(f, observer, null)),
    sync: (target, observer) => measure("sync", target, observer, (f) => worldReading(f, observer, null)),
}

// Resolve a property on a target frame — spatial, temporal, relational, or fn.
// `ground` selects the reader reference for orientation only. Position is always world-valued.
// (id:world-coordinate-phase-2-reads)
// A reading outside its guard's domain is a wound, never a number. The domain is
// the row's own, so a read and a law refuse the same values for the same reason.
// Measured 2026-09-26: a heading with no compass bearing answered NaN, a program
// turned by it (`rt A.heading`), and every coordinate of the host went NaN with no
// error anywhere — silent corruption of the figure. (id:eval-relational)
function readable(property, value, target) {
    // NOTHING is null OR undefined — a row may say "no answer" either way, and the
    // boundary turns it into one NOTHING before the domain guard sees it. A number we
    // cannot honour is a fault.
    if (value == null) return null
    if (predicateOk(property, value)) return value
    throw new Error(`No ${property}: ${target.name} answers outside its domain`)
}


function resolveProperty(target, property, args, observer, ground = false, frozen = true, interpretation = null) {
    // Report the frame to the readout graph: while a derived node computes, this frame is
    // a reference it stands on. A no-op outside a compute. (id:laws-dependency-driven-place)
    metaRootFrame(observer ?? target)._readouts?.readsink?.(target)
    // A free spatial point is a position, not a walker: it was seated with no body,
    // so an aim reading would invent an orientation nobody stated — a yaw through
    // `heading`, a level through `elevation`. Bearing to it is a real reading; its
    // own aim is not. (id:laws-affordance)
    if (!args && ORIENTATION[property] && freePoint(target)) {
        throw new Error(`No ${property}: ${target.name} is a free point`)
    }
    if (!args && POSITION[property]) {
        const read = POSITION[property](readWorldTransform(target, observer, frozen))
        if (frozen) recordQuestionRead(observer, target, property, args, ground, read)
        return readable(property, read, target)
    }
    if (!args && ORIENTATION[property]) {
        const birth = ground ? interpretation ?? (observer ? observerBirth(observer, frozen) : null) : null
        const read = ORIENTATION[property](ground
            ? poseInObserverBirth(target, observer, frozen, birth) : readWorldTransform(target, observer, frozen))
        if (frozen) recordQuestionRead(observer, target, property, args, ground, read, birth)
        return readable(property, read, target)
    }
    if (!args && TEMPORAL[property]) {
        const view = frozen ? questionViewOf(observer) : null
        if (view && view.readings.has(target) && !isLiveReceiver(view, target)) {
            const read = TEMPORAL[property](view.readings.get(target))
            if (frozen) recordQuestionRead(observer, target, property, args, ground, read)
            return readable(property, read, target)
        }
        return readable(property, TEMPORAL[property](target), target)
    }
    if (!args && observer && RELATIONAL[property]) {
        return readable(property, RELATIONAL[property](target, observer), target)
    }

    // fn binding — any arity
    const arity = args ? args.length : 0
    const result = lookupFn(target, property, arity, args)
    if (result !== undefined) return result

    throw new Error(`Undefined property: ${property} on assistant ${target.name}`)
}

// A capture discovers meaning; it does not consume it. (id:being-facets-root-repair)
let readingQuestion = false

// Record a consumed captured input. Only a declared participant is frozen, and the nearest
// question view owns the record. The baseline is the value the run actually read.
// (id:being-facets-root-repair)
function recordQuestionRead(observer, target, property, args, ground, value, birth = null) {
    if (readingQuestion) return
    const view = questionViewOf(observer)
    if (!view || !view.readings.has(target) || isLiveReceiver(view, target)) return
    // Revoked readers cannot amend a footprint. Shared readings retain their original question
    // authority through forwarding; pointer equality finds it without another registry.
    // (id:being-facets-root-repair)
    const root = metaRootFrame(observer)
    if (!root._registry || !liveIn(root._registry, observer)) return
    const reading = view.readings.get(target)
    let owner = view.owner
    for (let up = questionViewOf(owner.parent); up && up.readings.get(target) === reading; up = questionViewOf(owner.parent)) {
        owner = up.owner
    }
    if (!owner || !root._registry.has(owner.id)) return
    if (!owner.consumed) owner.consumed = new Map()
    // A footprint retains the interpretation, not the observer's execution machinery.
    // Equivalent grounded reads share the same basis regardless of writer incarnation.
    // (id:being-facets-root-repair)
    const rotation = birth?.rotation
    const key = rotation
        ? `${target.id}|${property}|g|${rotation.w},${rotation.x},${rotation.y},${rotation.z}`
        : `${target.id}|${property}`
    if (owner.consumed.has(key)) return
    const interpretation = birth ? SE3.clone(birth) : null
    owner.consumed.set(key, {
        target, property, args, ground,
        baseline: value,
        live: () => resolveProperty(target, property, args, null, ground, false, interpretation),
    })
    // One bounded comparison is owed for this newly discovered meaning.
    owner.compareOwed = true
}

// Look up a fn binding in a frame's userspace and evaluate it.
function lookupFn(frame, name, arity, args) {
    if (!frame.deps?.mathParser?.userspace) return undefined
    const key = name + ':' + arity
    if (!frame.deps.mathParser.userspace.has(key)) return undefined
    const [body, params] = frame.deps.mathParser.userspace.get(key)
    const ctx = {}
    if (params) params.forEach((p, i) => { ctx[p] = args[i] })
    return frame.deps.mathEvaluator.run(body, ctx)
}

// Actor-model filter: deliver only if pattern matches listensFor. (id:mailbox-listens-for)
function hears(frame, name) {
    if (frame.listensFor === null || frame.listensFor === undefined) return true
    for (const pattern of frame.listensFor) {
        if (matchPattern(pattern, name) !== null) return true
    }
    return false
}

function pushMailbox(frame, msg) {
    if (!hears(frame, msg.name)) return
    frame.mailbox.push(msg)
    if (frame.mailbox.length <= frame.maxMailbox) return

    // Full actor inbox wounds — drop-oldest would rewrite the figure. (id:mailbox-truth)
    frame.mailbox.pop()
    if (!frame.error) {
        woundInk(frame, `this one is hearing more than it can hold — ${frame.maxMailbox} letters are already waiting`)
    }
}

// Frame's dedup key: the ADDRESS (stable across re-eval), falling back to id
// only for bare createFrame test harnesses that skip wireChild entirely.
const addrOf = (frame) => frame.address ?? frame.id

// A frame of reference that names nothing: every deposit went home instead of
// where the author asked. Silence here draws the right figure in the wrong place.
function woundMissingReference(ctx) {
    if (ctx.error) return
    ctx.error = report({
        kind: 'walk',
        message: `there is no '${ctx.targetFrame}' to draw in — this one drew in its own frame`,
    })
    ctx.channel.put({ type: 'error', ...ctx.error, ambientId: ctx.id })
}

// Walk error is a record: message, span, kind. (id:cmp-runtime-provenance)
const errorRecord = (error) =>
    report({ kind: error.kind ?? 'walk', message: error.message, span: error.span ?? null })

// A batch is folded into commandCount when it ends. A wound is an end. Leaving
// the count on the batch makes sumCounts — the seat's authority — answer 0 for
// a run that did draw. Fold, then drop the batch, so commandsOf cannot add it twice.
function foldBatch(ctx) {
    if (!ctx.batch) return
    ctx.commandCount += ctx.batch.commandCount || 0
    ctx.actorState = ctx.batch
    ctx.batch = null
}

// Deliver once per address; never back to the emitter.
export function deliverShout(shout, target) {
    const addr = addrOf(target)
    const fromAddr = shout.from ? addrOf(shout.from) : null
    if (target === shout.from || addr === fromAddr) return
    // A letter crosses a construction boundary in neither direction: out, it cannot
    // be retracted by the answer that follows; in, it would change the answer
    // without changing the question. Local mail still composes inside the region.
    // (id:laws-figures-phase34-review)
    if (shout.from && !sameRegion(shout.from, target)) return
    if (!shout._delivered) shout._delivered = new Set()
    if (shout._delivered.has(addr)) return
    shout._delivered.add(addr)
    pushMailbox(target, { name: shout.name, payload: shout.payload })
}

// Deliver all deferred shouts to a specific frame (used at spawn time).
function deliverDeferredToFrame(shouts, frame) {
    for (const shout of shouts) {
        deliverShout(shout, frame)
    }
}

// Deliver buffered shouts to all registry frames, then clear the buffer.
function flushDeferredShouts(shouts, registry) {
    for (const shout of shouts) {
        for (const [id, target] of registry) {
            deliverShout(shout, target)
        }
    }
    shouts.length = 0
}

// The boundary is transitive: closure is inherited by every descendant of a
// construction, and KIND is not — a nested `as` stays an ambient, a contained one.
// Mail crosses it in neither direction. (id:laws-figures-phase34-review)
function closedRoot(frame) {
    let root = null
    for (let node = frame; node; node = node.parent) if (node.closed) root = node
    return root
}
const sameRegion = (a, b) => closedRoot(a) === closedRoot(b)

// Shout at push: self now; others deferred (or registry if no buffer).
function interceptShout(frame, value, registry, deferredShouts, onShout) {
    pushMailbox(frame, { name: value.name, payload: value.payload })
    if (deferredShouts) {
        deferredShouts.push({ from: frame, name: value.name, payload: value.payload })
    } else {
        // One predicate for both paths, so the boundary is not a special case.
        const letter = { from: frame, name: value.name, payload: value.payload }
        for (const [id, t] of registry) deliverShout(letter, t)
    }
    // The world hears open ambients only: a construction's letter stays inside.
    if (onShout && !closedRoot(frame)) onShout(frame.name, value.name, value.payload)
}

// Ordinary construction inputs are captured; explicit participants remain live addresses
// through the encounter door, never unrestricted world lookup.
// (id:being-facets-participant-membrane)
const DERIVED_BUDGET = 200_000

// Every external input a construction's free reads may resolve to, frozen at the
// question: the ancestors' parameters and scalars, nearest first. A derived cell
// reads from this and from its own parameters, and from nowhere else — so the
// question names every input, which is what licenses reuse. Conservative on
// purpose: fine-grained invalidation comes after the sound version is measured.
// (id:laws-figures-phase34-review)
function captureEnvironment(frame) {
    const captured = new Map()
    for (let node = frame; node; node = node.parent) {
        if (node.params) {
            for (const [name, value] of node.params) if (!captured.has(name)) captured.set(name, value)
        }
        if (node.scalars) {
            for (const [name, id] of node.scalars) {
                if (captured.has(name)) continue
                try {
                    captured.set(name, metaRootFrame(node)._readouts?.value(id))
                } catch {
                    captured.set(name, undefined)
                }
            }
        }
    }
    return captured
}

// The DECLARING SCOPE's own bindings — a call's parameters, and whatever else was bound
// where the declaration stood — are inputs too. They arrive with the payload as a
// snapshot, so they belong to that declaration and cannot leak past the call that made
// them. Engine bookkeeping (`__depth__`) is not an author's name and stays out.
// (id:turtle-ambient-calculus, id:laws-figures-phase34-input)
function declaredInputs(value) {
    const bound = new Map()
    bound.set('count', value.env?.loopCounter ?? 0)
    for (const [name, held] of Object.entries(value.env?.scope ?? {})) {
        if (name.startsWith('__')) continue
        bound.set(name, held)
    }
    return bound
}


// Everything a construction may read: its ancestors' parameters and scalars, then the
// names bound at the declaration site, nearest last so the site wins.
function captureFor(frame, value) {
    return new Map([...captureEnvironment(frame), ...declaredInputs(value)])
}


function resolveScopeValue(frame, name) {
    if (frame.params?.has(name)) return frame.params.get(name)
    // The region's own derived values are its private state, not an outside read:
    // a body-local `let s` stays readable inside the cell that declared it.
    // (id:laws-figures-phase34-review)
    const local = frame.scalars?.get(name)
    if (local !== undefined) return metaRootFrame(frame)._readouts?.value(local)
    return frame.capture?.get(name)
}

// CAPTURE, for arguments: read each bound expression afresh in the DECLARING frame.
// Names resolve there, so an inline argument means what the same expression bound at
// the site would mean — and because this runs again for every question, a moved input
// reaches the next answer instead of freezing the first.
// (id:laws-figures-phase34-input)
function evaluateArgs(frame, exprs, declared, seed) {
    if (!exprs?.length) return []
    const { mathParser, mathEvaluator } = frame.deps ?? {}
    if (!mathParser || !mathEvaluator) return exprs.map(() => undefined)
    // Arguments belong to the declaring scope, including names like x that
    // otherwise name a live evaluator constant. (id:laws-figures-phase34-input)
    mathEvaluator.parser = mathParser
    const scope = Object.fromEntries(declared ?? [])
    return exprs.map((expr, index) => {
        // The SAME binding interpretation as first acquisition: an argument that bound a
        // being keeps that identity; only an expression is re-read, because a live name is
        // a port. Re-finding the spelling could reach a namesake — exactly what D061
        // forbids. (id:being-facets-p2-seam)
        if (isBeing(seed?.[index])) return seed[index]
        return mathEvaluator.run(parseMemo(mathParser, expr, exprs), scope)
    })
}

// One encounter protocol in both contexts; only unqualified resolution differs.
// Passed participants admit scoped requests, not ownership of the outside world.
// (id:being-facets-participant-membrane)
function encounterDoor(frame, deps) {
    // Immutable read provenance: the deps that wired this door. A callback retained past a
    // rewire still closes over the mutable frame, so it is checked against this captured
    // wiring, never against whatever the frame now holds. (id:being-facets-root-repair)
    const wiredDeps = deps ?? null
    return {
        observe(command) {
            // Coherent point-aim reads are earned for installations; ordinary actors keep
            // their existing cycle/instant contract. (id:being-facets-situated)
            if (command === 'faceto' && frame.installation !== true) return undefined
            const root = metaRootFrame(frame)
            const poses = new Map()
            visitPostOrder(root, member => {
                const birth = worldTransform(member)
                poses.set(member, { birth, world: SE3.compose(birth, member.transform.deref()) })
            })
            frame.observation = { poses, revision: root._configurationRevision }
            return frame.observation.revision
        },
        unobserved() { frame.observation = null },
        // A bare name may bind a being, ITSELF included: a body's own name is a binding,
        // not a coordinate reachable only through a dot. Receiver legality stays with the
        // receiver-admission boundary. (P2, id:being-facets-p2-seam)
        subject(name) {
            if (ownsName(frame, name)) return undefined
            return findFrame(frame, name, 'world') ?? undefined
        },
        // This frame's OWN declaration, for a receiver selector: an inner binding shadows
        // a captured scope, but an ancestor must never redirect a passed participant.
        own(name) {
            if (frame.params?.has(name)) return frame.params.get(name)
            if (frame.scalars?.has(name)) return metaRootFrame(frame)._readouts?.value(frame.scalars.get(name))
            return undefined
        },
        isSubject: isBeing,
        // Presence, not value: a nearer lexical declaration owns the name even when its
        // value is not a subject, so a read cannot fall back to an outer namesake.
        // (id:being-facets-centers-review)
        owns(name) { return frame.params?.has(name) === true || frame.scalars?.has(name) === true },
        // A bound subject's facet read and a bare name's being both cross here — the ONE
        // facet door, whose region policy decides inside vs outside and live vs retired.
        // A callback from a replaced run holds no rights: its captured deps is not the
        // frame's current run. (id:being-facets-root-repair)
        facet(being, property, args) {
            if (wiredDeps && wiredDeps !== frame.deps) return undefined
            return resolveBeingFacet(frame, being, property, args)
        },
    }
}

function installEncounter(evaluator, frame, deps) {
    const door = encounterDoor(frame, deps)
    evaluator.beginObservation = door.observe
    evaluator.endObservation = door.unobserved
    evaluator.resolveSubject = door.subject
    evaluator.ownSubject = door.own
    evaluator.isSubject = door.isSubject
    evaluator.owns = door.owns
    evaluator.resolveSubjectFacet = door.facet
}

function closeDerivedDeps(deps, frame) {
    frame.capture = deps.capture ?? captureEnvironment(frame.parent ?? frame)
    deps.mathEvaluator.resolveExternal = (name) => {
        // Liveness only: a dotted read's reached frame is reported where it is resolved, and
        // the region's admission is asked there too — the membrane never re-reads a spelling,
        // so what it admits is what the resolver acts on. (id:laws-figure-protocol)
        recordRead(deps.mathEvaluator)
        if (typeof name === 'string' && name.includes('.')) return resolveBinding(frame, name)
        // A local value the construction captured is still its own business.
        return resolveScopeValue(frame, name)
    }
    if (deps.mathEvaluator.constants) {
        // The same stream the command door reads, so a figure has one randomness.
        // Entropy is an input from the figure's place, never the process RNG.
        // (id:cmp-become-seed, id:laws-figure-protocol)
        deps.mathEvaluator.constants.random =
            deps.figureRandom ?? keyedStream(keyedSeed(frame.address ?? frame.name))
    }
    installEncounter(deps.mathEvaluator, frame, deps)
    installStorage(deps, frame)
}

// The resolver NAMES what it reached: a dotted read records the frame it resolved, so
// a dependency is a REFERENCE, never a spelling. This is the whole dependency exposure
// — no syntactic scan of the expression by a consumer. (id:laws-dependency-driven-place)
function recordRead(evaluator, target) {
    const reads = evaluator?.reads
    if (!reads) return
    reads.live = true
    if (target) reads.frames.add(target)
}

// A nearer lexical binding owns the name; presence, not value, decides. An unready
// binding is not permission to fall back to an outer namesake. (id:being-facets-centers-review)
function ownsName(frame, name) {
    for (let node = frame; node; node = node.parent) {
        if (node.params?.has(name) || node.scalars?.has(name)) return true
    }
    return false
}

// The receiver's own storage basis, read live at each call. ONE adapter serves every
// coordinate consumer, so no command does origin arithmetic. (id:world-coordinate-phase-2)
function installStorage(deps, frame) {
    deps.space = storageSpace(() => {
        const receiver = motionDestination(frame, metaRootFrame(frame)._registry)
        if (!receiver) throw new Error('the retained receiver has left the world')
        return worldTransform(receiver)
    })
}

function bindResolve(deps, frame) {
    // The frame's ambient door, as ONE documented object: the algebra and the executor
    // see the tree only through this. (id:being-facets-centers-review)
    const door = {
        resolve(v, a) {
            const result = resolveBinding(frame, v, a)
            recordRead(deps.mathEvaluator)
            if (typeof v === 'string' && v.includes('.')) deps.mathEvaluator._observedSibling = true
            return result
        },
        ...encounterDoor(frame, deps),
    }
    installAmbientDoor(deps.mathEvaluator, door)
    installStorage(deps, frame)
}

// --- Child generator factory ---

// Fork spec → child generator + deps.
function createChildGenerator(value, createDeps, execOpts) {
    const childDeps = createDeps()
    if (value.env?.userspace) {
        for (const [k, v] of value.env.userspace) {
            childDeps.mathParser.userspace.set(k, v)
        }
    }
    // One stream per figure-run, keyed to its place. Both doors read it — the
    // evaluator constant and the command — so a figure has one randomness.
    // (id:cmp-become-seed, id:laws-figure-protocol)
    // Closure is inherited: a descendant of a construction is inside the boundary —
    // the same frozen environment, the same keyed stream, the same budgets. KIND is
    // not inherited: a nested `as` is still an ambient. (id:laws-figures-phase34-review)
    const closed = value.closed === true
    let figureRandom = null
    if (closed) {
        figureRandom = keyedStream(keyedSeed(value.figureSeed ?? value.name))
        childDeps.figureRandom = figureRandom
        // The environment this run will read, frozen at the question. A rebuild
        // re-snapshots it before the body is attached. (id:laws-figures-phase34-review)
        childDeps.capture = value.capture
    }
    // One actor mailbox: scheduler pushes, executor drains (same array).
    const mailbox = []
    const opts = {
        // The whole declaration context crosses this door, not just its colour: the
        // spawn payload already carries it, and colour alone left thickness and the
        // hidden head behind. (id:laws-figures-phase34-review)
        color: value.style?.color || execOpts.color,
        style: value.style,
        // A closed cell's derived budget is a working depth. It cannot raise
        // a host recurse ceiling, and the ceiling itself crosses this door.
        maxRecurseDepth: closed
            ? (execOpts.recurseCeiling != null ? Math.min(DERIVED_BUDGET, execOpts.recurseCeiling) : DERIVED_BUDGET)
            : execOpts.maxRecurseDepth,
        recurseCeiling: execOpts.recurseCeiling,
        maxRecurses: execOpts.maxRecurses,
        maxCommands: execOpts.maxCommands,
        commandCeiling: execOpts.commandCeiling,
        breathEvery: execOpts.breathEvery,
        strokeMax: execOpts.strokeMax,
        motionProtocol: execOpts.motionProtocol,
        observePureGoto: execOpts.observePureGoto,
        functions: value.code.functions,
        loopCounter: value.env?.loopCounter,
        birthtime: value.env?.birthtime,
        scope: value.env?.scope,
        lens: isLensName(value.name),
        // A closed figure's strict budget cannot raise the host recurse ceiling.
        // Ordinary ambients keep their effects. (id:laws-figure-protocol)
        strict: closed,
        ...(closed ? {
            maxReductions: DERIVED_BUDGET,
            maxRecurses: DERIVED_BUDGET, breathEvery: 256,
            random: figureRandom,
        } : {}),
        mailbox,
    }
    // The batch's state is BORN HERE, not on the generator's first next(), so a
    // frame can be asked what it has done while it is still doing it (commandsOf).
    const batch = createActorState(opts)
    // One parse, two meanings: the relationship batch is what the body declares,
    // the executable body is what it does. Derived ONCE, carried through wiring —
    // never re-interpreted downstream. (id:laws-decl-two-meanings)
    const relationshipBatch = deriveBatch(value.code.ast)
    // A figure whose question still holds nothing has no drawing yet — not a
    // wound. The cell stays; a later determined question rebuilds.
    // (id:eval-relational)
    const body = Array.isArray(value.question) && value.question.some((v) => v == null)
        ? []
        : relationshipBatch.body
    return {
        generator: execute(body, childDeps, { ...opts, actorState: batch }),
        deps: childDeps,
        mailbox,
        batch,
        relationshipBatch,
    }
}

// Commands walked so far: folded batches + the one still running. A batch is
// folded into commandCount exactly when it ends, and `batch` is dropped there,
// so nothing is counted twice and a wounded batch keeps what it did.
export function commandsOf(frame) {
    return (frame.commandCount || 0) + (frame.batch?.commandCount || 0)
}

// --- Scheduler metadata ---

// Superset of when-patterns; null = deliver all. (id:mailbox-listens-for)
//
// Memoized PER NODE ARRAY, not per call. Keying the whole answer on `functions`
// identity never hit, because spawn copies `{ ...state.functions }` fresh every
// time. Keying it on the AST alone hits always and LIES: a function body is
// walked too, and one buffer's tree is shared by every vocabulary seated on it,
// so the first seating's answer was handed to all the rest.
//
// Bodies are themselves stable arrays, so memoizing each one keeps the hit and
// the truth. This set must be a SUPERSET — one that is a subset is a frame that
// has gone quietly deaf. (id:carving-todo-listen-memo)
const LISTEN_MEMO = new WeakMap()

const NO_PATTERNS = Object.freeze([])

// What one node array hears, children included. Memoized on the array itself.
function heardIn(nodes) {
    if (!Array.isArray(nodes)) return NO_PATTERNS
    const hit = LISTEN_MEMO.get(nodes)
    if (hit) return hit

    const heard = []
    const walk = (ns) => {
        if (!Array.isArray(ns)) return
        for (const node of ns) {
            if (!node) continue
            if (node.type === 'When' && node.meta?.event && typeof node.value === 'string') {
                heard.push(node.value.slice(1, -1))
            }
            walk(node.children)
        }
    }
    walk(nodes)
    LISTEN_MEMO.set(nodes, heard)
    return heard
}

function listenPatterns(ast, functions) {
    if (!Array.isArray(ast)) return null
    const own = heardIn(ast)
    if (!functions) return own

    // functions is a plain object, not a Map. Nothing to add is the common
    // case, and then the memoized array goes back untouched.
    let all = null
    for (const fn of Object.values(functions)) {
        const more = heardIn(fn?.body)
        if (more.length === 0) continue
        if (!all) all = [...own]
        all.push(...more)
    }
    return all ?? own
}

function setListensFor(child, code) {
    child.listensFor = listenPatterns(code?.ast, code?.functions)
}

// A RUN'S IDENTITY — monotonic, world-wide. The seat animates per run, and a
// phase edge cannot name one: a run that starts and settles inside a single
// breath never shows `building`. (id:output-ledger-r2-progress)
let RUNS = 0

// Run-ephemeral state shared by attachMeta and rewireChild. (id:output-ledger-r2-credit, id:output-ledger-r3-stock-flow)
// WHAT DIES WITH A RUN — one list. A new per-run fact is added HERE, so a rewire cannot
// leave it standing, and a reader can see every run-scoped field at once. The frame
// also carries fields that OUTLIVE a run (its identity, its place in the tree, its
// command count); those are seeded once at attachMeta and are deliberately absent here.
// Two lifetimes, one place each. (id:eye-view-pipeline, id:laws-build-solve-seam)
const RUN_SEED = {
    observation: null,   // this run's frozen reads
    error: null,         // the wound that ended it, if any
    notices: () => [],   // what the author is owed of a figure that still draws
    unresolved: null,    // a question the world could not answer
    sync: () => ({}),    // the conflating head slot
    midInstant: false,   // a delayed admission reply belongs to the run that asked
    _strokeEnd: null,    // BOTH halves of the join test must go, or the next run's
    _strokeStyle: null,  // first path could continue the last one's (id:ft-d7-deposit-runid)
}

function resetRunState(frame, stock) {
    clearSuspension(frame)
    for (const [field, seed] of Object.entries(RUN_SEED)) {
        frame[field] = typeof seed === "function" ? seed() : seed
    }
    frame.run = ++RUNS
    resetInk(frame, stock)
}

// Scheduler fields on a frame (not the Frame primitive).
// TWO LIFETIMES. What is set here lasts as long as the frame is in the tree;
// what resetRunState sets lasts one RUN and is reborn on every rewire.
// Lens pose is live each frame — no stored baseline. (id:eye-view-pipeline)
function attachMeta(frame, targetFrame, stock) {
    frame.targetFrame = targetFrame || null
    frame.isLens = isLensName(frame.name)
    frame.commandCount = 0    // walked across ALL runs — rewire does not zero it
    frame.elapsedTime = 0
    frame.birthtime = 0       // birth on the shared axis (seconds)
    frame.actorState = null
    frame.maxMailbox = 8192
    frame.seed = null
    // Run state, but wireRun is a beat away; hold a safe value until it lands.
    frame.batch = null        // the running batch's state; null when nothing runs
    frame.listensFor = null   // null = deliver everything (unknown tree)
    frame.motionSeq = 0        // monotonic per frame; stale async replies are dropped
    resetRunState(frame, stock)
    return frame
}

// --- The seed — become, stage 1 (specs/compiler.org id:cmp-become-seed) ---

// A seed records the attached program: open swaps keep green-tree identity;
// closed calls compare bound code and inputs. (id:cmp-become-seed)
function seedOf(spec) {
    return {
        ast: [...(spec.code?.ast ?? [])],
        functions: spec.code?.functions ?? null,
        userspace: spec.env?.userspace ?? null,
        recipe: spec.recipe ?? null,
        question: spec.question?.slice() ?? null,
        style: { ...spec.style },
        bindings: new Map(Object.entries(spec.env?.scope ?? {}).filter(([name]) => !name.startsWith('__'))),
    }
}

// Captured vocabulary and style: compare bindings, not the fresh container.
function sameBindings(a, b) {
    const left = a instanceof Map ? a : new Map(Object.entries(a ?? {}))
    const right = b instanceof Map ? b : new Map(Object.entries(b ?? {}))
    return left.size === right.size && [...left].every(([key, value]) =>
        right.has(key) && sameValue(value, right.get(key)))
}

function sameSeed(seed, spec) {
    if (!seed) return false
    if (spec.profile === 'derived') {
        const next = seedOf(spec)
        return seed.recipe === next.recipe && sameValue(seed.question, next.question)
            && sameBindings(seed.functions, next.functions)
            && sameBindings(seed.userspace, next.userspace)
            && sameBindings(seed.style, next.style)
            && sameBindings(seed.bindings, next.bindings)
    }
    const next = spec.code?.ast ?? []
    if (seed.ast.length !== next.length) return false
    for (let i = 0; i < next.length; i++) {
        if (seed.ast[i] !== next[i]) return false
    }
    return seed.functions === (spec.code?.functions ?? null)
        && seed.userspace === (spec.env?.userspace ?? null)
        && (seed.style?.color ?? null) === (spec.style?.color ?? null)
}

// Invalidate worldTransform cache on self/ancestor change.
function wireWorldCacheInvalidation(child) {
    // Invalidate when own transform changes
    child.transform.watch('worldCache', () => { child._worldDirty = true })
    child.transform.watch('configurationRevision', () => {
        const root = metaRootFrame(child)
        root._configurationRevision = (root._configurationRevision || 0) + 1
    })
    // Invalidate when parent moves (affects child's world position)
    if (child.parent) {
        child.parent.transform.watch(`child:${child.id}`, () => {
            child._worldDirty = true
        })
    }
    child._worldWatched = true
}

// Unwatch when frame is terminated or removed.
function unwireWorldCache(child) {
    child.transform.unwatch('worldCache')
    child.transform.unwatch('configurationRevision')
    if (child.parent) {
        child.parent.transform.unwatch(`child:${child.id}`)
    }
}

// --- Shared child wiring ---

// A declared place with no body yet: the walk's reached pose, facing forward.
// That is the birth site, not a hidden pin and not a parse-time seat.
// (id:laws-ordered-birth, id:laws-decl-anchor)
function seatPlace(parent, name, pump, pose = null) {
    const place = attachMeta(
        createFrame(name, null, {
            parent,
            // ONE meaning per field: this is where the place was BORN, and `transform`
            // is the motion it accumulates afterwards. Seating the pose in `transform`
            // made motion overwrite the birth, so a nested read asking "where am I
            // relative to my birth?" had nothing to measure against.
            // (id:laws-figures-phase34-ground)
            origin: pose ? SE3.clone(pose) : SE3.identity(),
            ...pump.channelOpts,
            logicalBirth: parent.resumeAt > 0 ? parent.resumeAt : (parent.logicalBirth ?? 0),
        }),
        null,
        pump.stock
    )
    place.birthtime = parent.birthtime || 0
    // No generator: nothing to run, nothing to emit, no clock, and no tick
    // required before the place counts as established. (id:laws-decl-join-repair)
    place.done = true
    // The empty place has a point handle; `as A` may later give this same
    // identity a walking head. (id:laws-decl-handle)
    place.isPlace = true
    // The place's birth pose: the anchor a derived figure's pin marks. It stays
    // fixed while the walking head drifts. (id:laws-figure-protocol)
    place.birthPose = SE3.clone(pose ?? SE3.identity())
    orderExecution(parent, place)
    parent.children.set(name, place)
    bumpTree(parent)
    wireChild(place, pump.createDeps(), [], pump.registry, { ast: [], functions: {} }, null, null)
    return place
}

// A definition seat is provisional until its statement commits. A pin that fails
// validation (or cannot publish) must leave no identity, no exposure and no hold
// behind: one failed statement changes nothing. (id:laws-names, id:laws-activation-verdicts)
function withdrawPlace(parent, place, pump) {
    const root = metaRootFrame(parent)
    releaseAttemptsFor(root, new Set([place.id]))
    root._readouts?.release(place.id)
    // Seating registered lifecycle watchers (the parent's child:<id> among them);
    // undoing the seat means undoing every effect of it. (id:laws-names)
    unwireWorldCache(place)
    pump.registry.delete(place.id)
    parent.children.delete(place.name)
    bumpTree(parent)
}

function wireRun(child, deps, mailbox, executionState, code, relationshipBatch, pump = null) {
    child.deps = deps
    // The run incarnation: how many times this frame has been given a BODY to run.
    // A `birth`-seated identity carries no run state, so this tells an attach from a
    // rebuild, and a later outcome can tell which run may still publish.
    // (id:laws-figures-phase34-oracle, id:cmp-become-seed)
    if (executionState) child.runIncarnation = (child.runIncarnation ?? 0) + 1
    child.mailbox = mailbox
    // `child.batch` is mutable EXECUTOR state; the relationship batch is
    // source-owned declarations. Two meanings, two names. (id:laws-decl-two-meanings)
    child.batch = executionState
    // Participation is carried from the current parse at every seat and rewire —
    // derived, never a stored flag. (id:laws-decl-ownership)
    child.declared = relationshipBatch?.declared ?? new Set()
    // Reached participation: the same source ownership, but only after the walk
    // has run the declaration. Exposure is a query about this set, not the parse.
    // (id:laws-decl-exposure)
    child.reached = new Set()
    if (child.closed) closeDerivedDeps(deps, child)
    else bindResolve(deps, child)
    setListensFor(child, code)
    // A declaration is reached in the stream; the batch only names what the body
    // declares. Nothing is seated here. (id:laws-ordered-birth)
}

// Wire child: run wiring, plus the things that belong to its place in the tree.
// Frame must already be in the tree — the address reads its parent chain.
function wireChild(child, deps, mailbox, registry, code, executionState = null, relationshipBatch = null, pump = null) {
    child.address = frameAddress(metaRootFrame(child), child)
    wireRun(child, deps, mailbox, executionState, code, relationshipBatch, pump)
    wireWorldCacheInvalidation(child)
    registry.set(child.id, child)
}

// Fresh fork on an existing frame (keep id/tree/origin/address).
function rewireChild(child, value, pump) {
    // A rewired scope is a new source: the installations its old sites seated are gone
    // with those sites. (id:being-facets-p4-sequence)
    retireInstallationsUnder(child, pump)
    // A rewired scope is a new source: its old statement sites are gone, so their
    // laws are retracted before the new body states its own. (id:laws-build-p2c)
    if (pump.laws) pump.laws.retractScope(child.id)
    // An edit repairs the attempt: release the component its failure held.
    // (id:laws-activation-verdicts)
    releaseSourceAttempts(metaRootFrame(child), subtreeIds(child))
    metaRootFrame(child)._readouts?.release(child.id)
    // A closed region is replaced whole: the answer that follows owns the subtree,
    // so a child it does not declare is withdrawn with the previous answer.
    // (id:laws-figures-phase34-review)
    if (child.closed) releaseRegion(child, pump)
    // A rebuild keeps the frame, so it keeps the key: the same figure re-walks
    // the same stream and lands on the same drawing. (id:cmp-become-seed)
    if (value.closed) value.figureSeed = child.address ?? value.figureSeed
    const re = createChildGenerator(value, pump.createDeps, pump.execOpts)
    // A declared place keeps its accepted geometry: the new run begins where the
    // place stands, orientation included, and its first segment starts there
    // because the stroke takes its origin from the pose. (id:laws-decl-join-repair)
    if (child.isPlace === true) {
        // A place keeps its accepted geometry — a process stays where it walks.
        // A DERIVED figure is a value: a rebuild restarts the walk at its birth
        // pose, never at the last head, or every preemption drifts. The distinction
        // is the membrane again: a process owns its position, a value is rebuilt
        // from its definition. (id:laws-figure-protocol)
        // The rebuild re-anchors at the declaring pose and starts with NO motion of its
        // own — the same fact in the same slot an ambient uses. Writing the pose into
        // `transform` would put it in the field motion overwrites, which is how a place
        // came to lose its birth the moment it moved. (id:laws-figures-phase34-ground)
        if (value.profile === 'derived') {
            child.origin = SE3.clone(value.origin)
            re.batch.transform = SE3.identity()
        } else {
            re.batch.transform = child.transform.deref()
        }
    }
    child.profile = value.profile ?? null
    child.closed = value.closed === true
    child.generator = re.generator
    child.done = false
    wireRun(child, re.deps, re.mailbox, re.batch, value.code, re.relationshipBatch, pump)
    child.seed = seedOf(value)
    resetRunState(child, pump.stock)      // ink per RUN; park/sync/error never ride the new one
    // A NEW RUN IS A NEW CLOCK (D011), anchored at the parent's current instant:
    // resumeAt once it has waited, else its own birth. The old run's resumeAt is
    // past, so waiting would fast-forward the animation into one tick.
    // A fresh run joins the shared axis at the ACTUAL revision cut. Local zero is the run's
    // own elapsed time, not a global scheduling priority: inheriting the parent's stale wait
    // schedules expired deadlines, and taking frontier zero starves already-scheduled work.
    // (id:declared-behaviour-revision-clock)
    const cut = pump.now ?? 0
    child.resumeAt = 0
    child.logicalBirth = cut
    child.channel.drain()
    // RE-DERIVE IN PLACE: the cell and its show persist across a question, so the old answer
    // is not retracted HERE. It is replaced when the new one lands — the clear is discharged
    // immediately before the new run's first ink, which puts both in ONE publication step,
    // and a run that ends with nothing still empties the show. No frame is ever empty.
    // (id:laws-figures-phase34-inplace)
    child.pendingClear = true
}

// --- Inline child drain ---

// Inline drain at spawn; trampoline for nested spawns.
function advanceChild(initialChild, now, pump, deferredShouts) {
    const stack = [initialChild]

    while (stack.length > 0) {
        const child = stack[stack.length - 1]
        const spawned = drainUntilPause(child, now, pump, deferredShouts)
        if (spawned) {
            stack.push(spawned)
        } else {
            child.inlineAdvancing = false
            stack.pop()
            // Park mid-instant → unwind spawn stack; no sibling born into a partial instant.
            if (child.suspension && SUSPENSIONS[child.suspension.kind].unwinds) {
                for (const f of stack) f.inlineAdvancing = false
                return true
            }
        }
    }
    return false
}

// Effect table: one row per generator yield type. Unknown → deposit.
// (id:carving-todo-effects-table)
function breath(ctx, _value, _route, pump) {
    // Preemption offer (BEAM-style reduction breath): if the timeslice is spent,
    // park; else keep walking. Meter is reductions, not emits. (id:output-ledger-r3-meter)
    if (pump.outOfTime()) {
        parkBreath(ctx)
        return { verdict: 'parked' }
    }
    return { verdict: 'continue' }
}

function blocked(ctx, value) {
    // Cross-ambient read not ready — sleep, retry next tick (not a mid-instant
    // park). A suspension is part of the target's instant: record it so other
    // readers propagate it and the wait-for graph can tell a cycle. (D011)
    suspend(ctx, 'dataflow', { on: value?.target ?? null })
    return { verdict: 'paused' }
}

function wait(ctx, value, route, pump) {
    // Logical sleep: first wait anchors to logicalBirth, not wall clock (D011).
    closeInstant(ctx)
    const { now, frameTarget, frameTransform, destination } = route
    if (destination === null) return endUnresolved(ctx, 'the retained receiver has left the world')
    ctx.resumeAt = (ctx.resumeAt > 0 ? ctx.resumeAt : (ctx.logicalBirth ?? now)) + value.duration
    ctx.elapsedTime += value.duration / 1000
    // The wait carries the CURRENT CURSOR. For an installation the preceding accepted motion
    // already owns that geometry: re-proposing it here would republish a stale cursor over
    // the receiver (and bypass the law gate). Ordinary self-walk keeps its landing.
    // (id:being-facets-p4-sequence)
    if (value.position && destination === ctx) {
        ctx.transform.swap(() => ({ rotation: value.rotation, position: [...value.position] }))
        putSync(ctx, lensOutput(ctx, projectHead({
            type: "head",
            position: value.position,
            rotation: value.rotation,
            color: value.color,
            headSize: value.headSize
        }, frameTarget, frameTransform)))
    }
    // On RESUMPTION the continuation refreshes its geometric cursor from the receiver's
    // accepted local pose — a COPY, never a publication. Shared participation keeps one
    // geometric reality: the installation owns the sequence, not a private pose it
    // reinstalls. (id:being-facets-p4-sequence)
    if (ctx.installation) ctx.refreshOnResume = true
    return { verdict: 'paused', produced: true }
}

// Language yield: voluntary give-up-turn (cooperative multitasking). Not a park —
// instant is complete; siblings may advance. No sim-time cost.
function yieldEffect(ctx, value) {
    closeInstant(ctx)
    if (value.position) {
        ctx.transform.swap(() => ({
            rotation: value.rotation,
            position: [...value.position]
        }))
    }
    // A yield is an explicit cooperation point: it republishes the pose, so the
    // synchronous-cycle baseline advances with it (mice converge on it). (D011)
    metaRootFrame(ctx)._obsEpoch++
    return { verdict: 'paused', produced: true }
}

function limitMailbox(ctx, value) {
    ctx.maxMailbox = value.limit
    return { verdict: 'continue' }
}

const isThenable = (v) =>
    v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function'

// The one membrane between a responder and the scheduler: a raw reply becomes
// exactly one verdict — accept | refuse | fault — so no half-formed reply exists
// downstream. (id:laws-build-solve-seam)
function interpretReply(raw, refusalStroke) {
    if (raw === null || typeof raw !== 'object') {
        return { kind: 'fault', message: `motion responder returned ${raw === null ? 'null' : typeof raw}; expected a verdict object` }
    }
    if (raw.accepted === false) {
        return { kind: 'refuse', ink: refusalStroke === 'continue' ? 'continue' : 'break' }
    }
    if (raw.accepted !== true) {
        return { kind: 'fault', message: 'motion responder returned no boolean accepted verdict' }
    }
    if (!raw.transform || !Array.isArray(raw.transform.position)) {
        return { kind: 'fault', message: 'accepted motion reply has no transform.position' }
    }
    const component = raw.component === undefined ? [] : raw.component
    if (!Array.isArray(component)) {
        return { kind: 'fault', message: 'motion reply component is not a list' }
    }
    const members = []
    for (const member of component) {
        if (!member?.frame || !member.transform || !Array.isArray(member.transform.position)) {
            return { kind: 'fault', message: 'component member needs a frame and a transform.position' }
        }
        members.push({ frame: member.frame, pose: member.transform })
    }
    return { kind: 'accept', pose: raw.transform, component: members }
}

// Wound and end: the frame cannot honestly continue the command it asked about.
function woundMotion(ctx, message) {
    foldBatch(ctx)
    ctx.observation = null
    ctx.done = true
    ctx.generator = null
    closeInstant(ctx)
    clearSuspension(ctx)
    ctx.error = report({ kind: 'motion', message })
    ctx.channel.put({ type: 'error', ...ctx.error, ambientId: ctx.id })
    return { verdict: 'ended', produced: true }
}

// Accepted geometry lives on the frame after its executor finishes. Running
// members also receive a rebase to adopt before their next command.
// One publication boundary: install every pose, notify the fan once, bump the
// revision once, seed a running member's rebase. Truths and requests share it, so
// no accepted change has a private door. (id:laws-build-solve-seam)

// The publication boundary builds the install from the candidate: a producer hands back a
// candidate law, never an installation closure. (D058)
const installOf = (outcome, pump) => outcome.install ?? (outcome.law ? () => pump.laws.apply(outcome.law) : null)
// Accepted values include reached declarations, not just geometry. Delivery
// cannot reopen admission; cancellation retires a listener immediately.
function notifyAccepted(root) {
    const watchers = root._acceptedWatchers
    if (!watchers?.size) return
    const wasNotifying = root.notifyingCommit === true
    root.notifyingCommit = true
    try {
        for (const listen of [...watchers]) {
            if (!watchers.has(listen)) continue
            try { listen() } catch { /* notification is not acceptance */ }
        }
    } finally {
        root.notifyingCommit = wasNotifying
    }
}

function publish(writer, entries, registry, install = null, project = null, obligations) {
    // An installation's publication rights are checked at the BOUNDARY: exact occupant
    // identity and source membership — not merely target liveness. A retired writer cannot
    // publish, even when its targets stay live. (id:being-facets-p4-sequence)
    if (writer.installation === true) {
        const record = writer.installationRecord
        if (!record || !liveIn(registry, record.source) || record.source.installations?.get(record.site) !== record) {
            return { kind: 'conflict', message: 'the installation no longer holds publication rights' }
        }
    }
    const seen = new Set()
    // Running-member correction is a gated capability, off by default: this slice
    // solves settled configurations only. (id:laws-activation-order)
    const settledOnly = metaRootFrame(writer)._settledOnly !== false
    const prepared = []
    for (const { frame, pose, stated, ref } of entries) {
        if (!mayAddressParticipant(writer, frame, registry)) {
            return { kind: 'conflict', message: 'a closed construction cannot publish outside its region' }
        }
        if (!frame || seen.has(frame) || !liveIn(registry, frame)) {
            return { kind: 'conflict', message: 'a publication target is duplicated or no longer in this world' }
        }
        seen.add(frame)
        // The writer's own instant is the one being committed. Every other target
        // must be settled: a mid-instant member breaks atomicity, and (unless the
        // running-member capability is on) any running member is unsupported.
        // (id:laws-activation-order)
        if (frame !== writer && !frame.done) {
            if (ownsInstant(frame)) {
                return { kind: 'conflict', message: `publication target '${frame.name}' is mid-instant; the transaction cannot be atomic` }
            }
            // An owner may place its private value at a cut, never mid-instant.
            // This does not authorize correction of an open process. (id:laws-figure-protocol-kinds)
            const ownedValue = stated && frame.closed && frame.profile === 'derived' && frame.parent === writer
            if (settledOnly && !ownedValue) {
                return { kind: 'unsupported', message: `publication target '${frame.name}' is a running member; settled configurations only` }
            }
        }
        if (!pose || !Array.isArray(pose.position)) return { kind: 'conflict', message: 'a publication entry needs a pose' }
        // THE EFFECTIVE INSTALLATION, computed and validated HERE — after every arithmetic
        // step that can invalidate it, before any mutation. What the gate checked and what
        // lands are then one configuration. No second store, repair pass or commit route.
        if (!stated) {
            // A non-stated pose is an EFFECTIVE INSTALLATION too: it is validated by the
            // SAME check a stated pose gets, before any mutation. What the gate checked and
            // what lands are then one configuration. (id:laws-activation-order)
            const world = expressPose(frame, 'own', pose)
            if (!SE3.isValid(world)) return { kind: 'unsupported', message: `'${frame.name}' would hold an invalid pose` }
            prepared.push({ frame, pose })
            continue
        }
        const world = expressPose(frame, ref ?? 'own', pose)
        if (!SE3.isValid(world)) return { kind: 'unsupported', message: `'${frame.name}' states a pose its frame cannot hold` }
        const motion = frame.transform.deref()
        const chainTarget = SE3.compose(world, SE3.invert(motion))
        const base = frame.parent ? worldTransform(frame.parent) : SE3.identity()
        const origin = SE3.compose(SE3.invert(base), chainTarget)
        if (!SE3.isValid(origin)) return { kind: 'unsupported', message: `'${frame.name}' states a pose whose origin is invalid` }
        prepared.push({ frame, stated: true, motion, origin })
    }
    if (!Array.isArray(obligations)) return { kind: 'unsupported', message: 'publication needs retained obligations' }
    if (prepared.some(entry => entry.stated)) {
        const check = lawViolation(obligations, null, registry, posedWorld(prepared))
        if (check.status !== 'valid') return {
            kind: check.status === 'violation' ? 'refuse' : 'unsupported',
            message: check.status === 'violation' ? `the placement conflicts with the ${check.law.feature} law` : check.reason,
        }
    }
    // A STATED pose is a POSITION, for EVERY frame — ambient or place, value or process. It
    // lands in the slot that means "where this thing is" (origin) and the frame's own motion
    // is KEPT so the whole show moves rigidly and nothing is redrawn. The source's re-reach,
    // hand's wish and a law's configuration are all statements; the newest one wins.
    // (id:laws-figures-phase34-invariants)
    // (id:laws-figures-phase34-hand-frame)
    const write = (entry) => {
        const { frame } = entry
        if (!entry.stated) {
            if (identicalPose(frame.transform.deref(), entry.pose)) return null
            return frame.transform.swapDeferred(() => entry.pose)
        }
        // A STATED pose TRANSLATES the cell: the motion is KEPT and the chain moves, so the
        // whole thing — head, ink, children — shifts rigidly. The world and origin were
        // computed and validated at the prepared boundary above.
        // (id:laws-figures-phase34-encounter)
        if (identicalPose(frame.origin, entry.origin)) return null
        frame.origin = entry.origin
        dirtyWorldSubtree(frame)
        return frame.transform.swapDeferred(() => entry.motion)
    }
    const notify = prepared.map(write)
    const changed = notify.some(Boolean)
    // An accepted effect belongs to EVERY declaration whose realization contains this
    // installation, not only its immediate source: advance each ancestor's receiver baseline
    // so a descendant's own motion is not mistaken for an external change.
    // (id:declared-behaviour-revision-contract)
    if (writer.installation === true && writer.receiver) {
        for (let node = writer; node; node = node.parent) {
            const entry = node.consumed?.get(receiverKey(writer.receiver))
            if (entry) entry.baseline = captureReceiver(writer.receiver)
        }
    }
    if (changed) {
        for (const { frame } of entries) if (!frame.done && frame.batch) frame.batch.rebase = SE3.clone(frame.transform.deref())
    }
    // Install laws, ownership and accepted geometry before any notification:
    // no watcher may see new geometry beside an old law. (id:laws-activation-order)
    if (install) install()
    // Nothing landed: do not name a commit or recompute from a configuration
    // that did not move. A law install without a pose write is still a commit.
    if (!changed && !install) return null
    const root = metaRootFrame(writer)
    // Establish the revision and close the gate BEFORE any subscriber runs. The
    // accepted state is already installed; the revision names the commit; a
    // readout recompute is a notification, not an install. A subscriber that
    // requests motion meets the gate open, never a half-named commit.
    // (id:laws-p0m-publication, id:laws-build-solve-seam)
    root._motionRevision = (root._motionRevision || 0) + 1
    const wasNotifying = root.notifyingCommit === true
    root.notifyingCommit = true
    // One failing subscriber never leaves the gate set nor the fan half-run: every
    // subscriber is invited, then the failures are re-raised together.
    const failures = []
    try {
        // Derived values recompute from THE committed configuration, once, with
        // early cutoff. No command is re-run and no subscription is created.
        // (id:laws-build-p3-slider)
        if (root._readouts?.size > 0) {
            try { root._readouts.recompute(committedSnapshot()) } catch (error) { failures.push(error) }
        }
        for (const send of notify) {
            if (!send) continue
            try { send() } catch (error) { failures.push(error) }
        }
        // The display projection is part of the accepted commit, not a later
        // courtesy: it runs before a subscriber failure is reported, so accepted
        // geometry and its head never disagree. A projection that throws is
        // collected like any other subscriber. (id:laws-p0m-publication)
        if (project) {
            try { project() } catch (error) { failures.push(error) }
        }
        notifyAccepted(root)
    } finally {
        root.notifyingCommit = wasNotifying
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'publication subscribers failed')
    return null
}

// A verdict as publication entries: the writer, then its component members.
// An installation's authored motion is a proposal on behalf of the RETAINED receiver: the
// writer keeps its rights/continuation, the destination is the receiver. A frame that is
// not an installation is its own destination. (id:being-facets-p4-sequence)
function motionDestination(frame, registry) {
    if (frame?.installation !== true) return frame
    // A lost participant is a REFUSAL, never a silent self-destination: the receiver was
    // admitted as the destination and must remain a live member. (id:being-facets-p4-sequence)
    const receiver = frame.receiver
    return receiver && liveIn(registry, receiver) ? receiver : null
}

// ONE motion attempt: created at the producer boundary, retained through synchronous or
// delayed admission, and crossing the publication boundary. Identity is retained
// (writer/destination); eligibility is rechecked there, never cached. `request.frame` is
// DERIVED from the destination — never a second, independently editable destination.
// (id:being-facets-p4-sequence)
function motionAttempt(writer, destination, request) {
    return { writer, destination, request: { ...request, frame: destination } }
}

// Which members one candidate would publish: destination first, then its component.
// What each boundary ASKS of them stays that boundary's own. (D063)
const candidateEntries = (verdict, attempt) =>
    [{ frame: attempt.destination, pose: verdict.pose }, ...verdict.component]

const verdictEntries = (attempt, verdict) =>
    // Poses arrive normalized to the frame's own chain, so an entry carries only which FIELD
    // the accepted pose belongs in and whether it was stated. (id:laws-figures-phase34-hand-frame)
    candidateEntries(verdict, attempt)
        .map(({ frame, pose }) => ({ frame, pose, stated: verdict.stated === true }))

function commitTransaction(verdict, attempt, pump, project = null) {
    return publish(attempt.writer, verdictEntries(attempt, verdict), pump.registry, null, project, pump.laws.active())
}

// Re-express a normalized candidate only for the declared-convention validator.
// This view never returns to normalization or publication. (id:laws-figures-phase34-hand-frame)
function declaredCandidate(verdict, writer) {
    if (!verdict.stated || verdict.ref === 'own' || verdict.ref == null) return verdict
    const stated = (frame, own) => statePose(frame, verdict.ref, toWorldPose(worldTransform(frame), own))
    return { ...verdict, pose: stated(writer, verdict.pose),
        component: verdict.component.map((m) => ({ ...m, pose: stated(m.frame, m.pose) })) }
}

// Structural checks apply to the FINAL edit, whatever produced it. This is the ONE validity
// authority: a declared pose that overflows on the way into the frame's own chain is caught
// here, over the computed installation, not over the request that preceded it.
// (id:laws-free-relations-n-node-review)
function certifyEdits(verdict, attempt, registry) {
    const seen = new Set()
    for (const { frame, pose } of candidateEntries(verdict, attempt)) {
        // ONE pose-validity authority (SE3.isValid): duplication, retirement and malformed
        // geometry are one fault. (id:laws-free-relations-n-node-review)
        if (seen.has(frame) || !liveIn(registry, frame) || !SE3.isValid(pose)) {
            return { kind: 'fault', message: 'accepted motion has a duplicate, stale or invalid pose' }
        }
        seen.add(frame)
    }
    return verdict
}

// The host's INDEPENDENT ceiling over EVERY member that will publish, once per candidate, in
// the request's declared convention (`entriesRef`) — never a world request beside local poses.
// (id:laws-free-relations-n-node-review, id:laws-figures-phase34-hand-frame)
function certifyRights(verdict, attempt, validate) {
    if (!validate) return verdict
    const entries = candidateEntries(verdict, attempt)
    try {
        if (validate({ request: attempt.request, writer: attempt.writer, entries, entriesRef: attempt.request.ref ?? 'own' }) !== true) {
            return { kind: 'fault', message: 'motion responder proposed geometry that fails independent validation' }
        }
    } catch (error) {
        return { kind: 'fault', message: `motion validation failed: ${error.message}` }
    }
    return verdict
}

// ONE datum decides both: a caller that names a frame is stating a position, one that names
// nothing is making its own motion. Normalized here, so the checker, the continuation and the
// write all see one meaning. (id:laws-figures-phase34-hand-frame)
function normalizeDeclared(verdict, attempt) {
    if (verdict.kind !== 'accept') return verdict
    verdict.ref = attempt.request?.ref ?? null
    verdict.stated = verdict.ref !== null
    if (verdict.stated && verdict.ref !== 'own') {
        // A name that resolves to nothing, or a resolution that blocks, is a fact about the
        // world — an unresolved wish, never a crash and never a silent zero.
        // (id:laws-figures-phase34-ref)
        let toOwn = null
        try {
            toOwn = (frame, pose) => {
                const world = expressPose(frame, verdict.ref, pose)
                if (!world) throw new Error(`no frame named '${verdict.ref}' to state a position against`)
                return toLocalPose(worldTransform(frame), world)
            }
            verdict.pose = toOwn(attempt.destination, verdict.pose)
            verdict.component = verdict.component.map((m) => ({ ...m, pose: toOwn(m.frame, m.pose) }))
        } catch (error) {
            return { kind: 'unresolved', message: error.message }
        }
    }
    return verdict
}

// ONE certification, after the LAST producer, over the members that will publish: identity and
// shape, then the host's ceiling in the request's declared convention. (D063)
function certifyFinal(verdict, attempt, registry, validate) {
    if (verdict.kind !== 'accept') return verdict
    const structural = certifyEdits(verdict, attempt, registry)
    if (structural.kind !== 'accept') return structural
    const rights = certifyRights(declaredCandidate(verdict, attempt.destination), attempt, validate)
    return rights.kind === 'accept' ? verdict : rights
}

// INPUT validity, nothing more: the proposed poses must be well formed before arithmetic
// touches them, or conversion would rebuild a four-coordinate position into a valid one and
// compose would throw on a missing rotation. Identity and ownership are not asked here. (D063)
function refuseMalformedProposal(verdict, attempt) {
    if (verdict.kind !== 'accept') return verdict
    for (const { pose } of candidateEntries(verdict, attempt)) {
        if (!SE3.isValid(pose)) return { kind: 'fault', message: 'the proposed motion has a malformed pose' }
    }
    return verdict
}

// An installed responder is the last producer of its own candidate.
function checkMotion(verdict, attempt, registry, validate) {
    const admitted = refuseMalformedProposal(verdict, attempt)
    if (admitted.kind !== 'accept') return admitted
    const normalized = normalizeDeclared(admitted, attempt)
    if (normalized.kind !== 'accept') return normalized
    return certifyFinal(normalized, attempt, registry, validate)
}

// The writer has a verdict: apply the transaction, record it, and park so the
// writer's instant owns the pass. (D027 instant law)
const motionBaseChanged = (ctx, request) => request.baseRevision !== undefined &&
    request.baseRevision !== metaRootFrame(ctx)._configurationRevision


// A nested realization needs its own question AND every enclosing question's authority.
// (id:declared-behaviour-revision-contract)
function questionMoved(frame) {
    const store = metaRootFrame(frame)._readouts
    for (let node = frame; node; node = node.parent) {
        const owner = node.questionView?.owner
        if (owner?.token && !store.accepts(owner.parent?.id, owner.name, owner.token)) return true
    }
    return false
}
// Hard laws outrank requests: does a proposed configuration break an active law?
// Continuation (moving the other endpoint) is Phase 3. (id:laws-activation-order)
// The one reading a relation measures from: the evaluator's live read, or a proposed
// configuration through overrides. Reads, legality and continuation share it, so a
// source read and a check cannot disagree. (id:eval-relational)
function worldReading(frame, observer, overrides) {
    const time = (frame.birthtime || 0) + (frame.elapsedTime || 0)
    if (overrides?.has(frame)) {
        const world = SE3.compose(worldTransform(frame), overrides.get(frame))
        return { position: world.position, rotation: world.rotation, time }
    }
    const world = readWorldTransform(frame, observer)
    return { position: world.position, rotation: world.rotation, time }
}

// The reading the law-verdict layer uses: a frame's committed world reading (with an
// optional override map) and its world transform. Injected so laws/verdict.js stays free
// of scheduler state. (id:laws-activation-order)
export const lawWorld = {
    read: (frame, overrides) => worldReading(frame, null, overrides),
    transform: (frame) => worldTransform(frame),
}

// The one committed configuration a readout recomputes from.
function committedSnapshot() {
    const read = (frame) => worldReading(frame, null, null)
    return {
        read,
        world: (frame) => read(frame).position,
        measure: (relation, a, b) => measure(relation, a, b, read),
    }
}

// A source is gone: every derived value it owned goes with it.
function releaseReadouts(root, ids) {
    if (!root?._readouts) return
    // A displayed object the source owned leaves with it: the retraction is written
    // before the nodes go, so the frame that declared it can still receive it.
    // (id:notation-coordinate-vector, id:laws-ordered-replacement)
    const released = new Set(ids)
    for (const id of released) {
        for (const drives of root._readouts.drivesForSource(id)) {
            if (drives.kind === 'vector') retractVector(drives.spec.frame, drives.spec.name)
        }
        // A target leaving the play takes the drivers that PRODUCE it: a driven target's
        // driver is owned by a declaring scope that may survive, so a source release
        // alone leaves it as an orphan. (id:laws-dependency-driven-place)
        root._readouts.releaseProducing(id)
        root._readouts.release(id)
    }
}

// A closed region's answer owns its subtree. A rebuild replaces that subtree, so a
// child the new answer never declares cannot survive it — whole-region replacement
// first; preserving selected descendants is a later policy, not a reason to keep
// obsolete children by accident. (id:laws-figures-phase34-review)
function releaseRegion(frame, pump) {
    // A closed region is replaced whole: its installations go with the answer.
    // (id:being-facets-p4-sequence)
    retireInstallationsUnder(frame, pump)
    if (frame.children.size === 0) return
    const root = metaRootFrame(frame)
    const ids = subtreeIds(frame)
    ids.delete(frame.id)
    releaseAttemptsFor(root, ids)
    releaseReadouts(root, ids)
    for (const child of [...frame.children.values()]) terminateAmbient(child)
    visitPostOrder(frame, (c) => {
        if (c === frame) return
        pump.registry.delete(c.id)
        if (pump.laws) pump.laws.retractIdentity(c.id)
        resetInk(c, pump.stock)
    })
    frame.children.clear()
}


// The last RECORDED decision, not a commit receipt; the revision samples the
// publication counter at capture. (id:scheduler-observation-ownership)
function recordAttempt(root, entry) {
    if (!root) return
    root._lastAttempt = snapshotFact({ ...entry, revision: root._motionRevision ?? 0 })
}


// --- Attempt lifetime ---
//
// A failed declaration is an *attempt*: it owns the set of frames it held,
// wherever they live. Proposal and validation return evidence; only the settlement
// boundary below acquires a hold, so no future branch can quietly skip one. An
// edit of any frame the attempt touched releases the whole attempt.
// (id:laws-activation-verdicts)


function subtreeIds(frame) {
    const ids = new Set()
    visitPostOrder(frame, (c) => ids.add(c.id))
    return ids
}

function registerAttempt(root, info) {
    if (!root._attempts) { root._attempts = new Map(); root._attemptSeq = 0 }
    const id = ++root._attemptSeq
    const record = { id, source: info.source ?? null, kind: info.kind, message: info.message,
        span: info.span ?? null, members: [] }
    for (const frame of info.members) {
        if (!frame) continue
        if (!frame.heldAttempts) frame.heldAttempts = new Set()
        frame.heldAttempts.add(id)
        frame.held = { attemptId: id, kind: record.kind, message: record.message,
            span: record.span, source: record.source }
        record.members.push(frame)
    }
    root._attempts.set(id, record)
    return id
}

function releaseAttempt(root, id) {
    const attempt = root?._attempts?.get(id)
    if (!attempt) return false
    root._attempts.delete(id)
    for (const frame of attempt.members) {
        frame.heldAttempts?.delete(id)
        if (!frame.heldAttempts || frame.heldAttempts.size === 0) {
            frame.heldAttempts = null
            frame.held = null
        } else {
            // Another attempt still holds it: keep THAT attempt's face, not this one's.
            const next = root._attempts.get([...frame.heldAttempts][0])
            frame.held = next
                ? { attemptId: next.id, kind: next.kind, message: next.message, span: next.span, source: next.source }
                : null
        }
    }
    return true
}

// Repair of one scope releases the attempt that scope authored. Removal releases
// every attempt whose source or member vanished. (id:laws-activation-verdicts)
function releaseSourceAttempts(root, ids) {
    if (!root?._attempts) return
    const set = ids instanceof Set ? ids : new Set(ids)
    for (const id of [...root._attempts.keys()]) {
        if (set.has(root._attempts.get(id).source)) releaseAttempt(root, id)
    }
}

// Removal of any frame in `ids` releases every attempt that named it as source or
// member — including sibling members outside the edit. (id:laws-activation-verdicts)
function releaseAttemptsFor(root, ids) {
    if (!root?._attempts) return
    const set = ids instanceof Set ? ids : new Set(ids)
    for (const id of [...root._attempts.keys()]) {
        const attempt = root._attempts.get(id)
        if (set.has(attempt.source) || attempt.members.some((f) => set.has(f.id))) releaseAttempt(root, id)
    }
}

// The complete affected set: the union of the old and proposed laws' connected
// component, not just the first conflicting pair. A hold that stops at the pair
// lets the rest of the component move as if the failure were not there.
// (id:laws-activation-verdicts)

// One settlement boundary. Proposal and validation return outcomes and never touch
// a frame; this is the only place that commits or takes a hold. Every outcome kind
// keeps its meaning. (id:laws-activation-order, id:laws-activation-verdicts)
function settleAttempt(ctx, pump, outcome) {
    // The record names the FINAL outcome: a proposal is not an acceptance until
    // publication has refused nothing. (id:codex-play-eyes)
    const record = (kind, message = outcome.message ?? null) => recordAttempt(metaRootFrame(ctx), {
        path: 'reach', owner: ctx.id, outcome: kind,
        span: outcome.span ?? null, message,
        candidate: plainPoses(outcome.candidate ?? outcome.poses), residual: outcome.residual ?? null,
    })
    if (outcome.kind === 'commit') {
        const conflict = publish(ctx, outcome.poses, pump.registry, installOf(outcome, pump), () => {
            if (outcome.head) emitHead(outcome.head.frame, outcome.head.pose)
            for (const h of outcome.heads ?? []) emitHead(h.frame, h.pose)
        }, outcome.laws ? constructionLaws(pump, outcome.laws) : publicationLaws(pump, outcome.law))
        if (conflict) {
            const kind = conflict.kind === 'unsupported' ? 'unsupported' : 'relation'
            record(kind, conflict.message)
            return woundRelation(ctx, conflict.message, kind, outcome.span ?? null)
        }
        record('commit')
        return null
    }
    record(outcome.kind)
    if (outcome.kind === 'contradiction' || outcome.kind === 'obstructed') {
        // A demonstrated impossibility and a policy obstruction both hold the
        // affected component, but they are not the same claim. Stale work cannot
        // restore a hold — the writer must still be this world's writer.
        // (id:laws-activation-verdicts)
        if (!liveIn(pump.registry, ctx) || ctx.done) return { verdict: 'continue', produced: true }
        registerAttempt(metaRootFrame(ctx), {
            source: ctx.id, kind: outcome.kind, message: outcome.message,
            span: outcome.span ?? null, members: outcome.members,
        })
        return woundRelation(ctx, outcome.message, outcome.kind, outcome.span ?? null)
    }
    if (outcome.kind === 'unresolved' || outcome.kind === 'stale' || outcome.kind === 'busy') {
        // Not proof of impossibility, and not a silent advance: end the governed
        // continuation unresolved, keeping the last accepted prefix.
        return endUnresolved(ctx, outcome.message ?? outcome.kind)
    }
    // Unsupported or malformed: a located wound, never a held component.
    return woundRelation(ctx, outcome.message, outcome.kind ?? 'relation', outcome.span ?? null)
}

function proposedOverrides(writer, verdict) {
    return new Map([[writer, verdict.pose], ...verdict.component.map((m) => [m.frame, m.pose])])
}



// Every admission reply enters through the same live execution permission.
// Deferred delivery lives in the existing suspension, never a second work queue.
// (id:execution-input-revisions)
function parkOnVerdict(ctx, verdict, pump, attempt) {
    let step
    if (pump.execution.run(ctx, () => { step = acceptVerdict(ctx, verdict, pump, attempt) })) return step
    openInstant(ctx)
    suspend(ctx, 'admission', { seq: ++ctx.motionSeq, verdict: null,
        deliver: () => parkOnVerdict(ctx, verdict, pump, attempt) })
    return { verdict: 'parked', produced: true }
}

function acceptVerdict(ctx, verdict, pump, attempt) {
    const offered = verdict
    // Identity is retained on the attempt; ELIGIBILITY is rechecked HERE, never cached.
    // (id:being-facets-p4-sequence)
    const { writer, destination, request } = attempt
    if (destination === null || !liveIn(pump.registry, destination)) {
        return woundMotion(ctx, 'the retained receiver has left the world')
    }
    if (motionBaseChanged(writer, request) || questionMoved(writer)) verdict = { kind: 'stale' }
    else {
        // Following uses destination geometry, not installation placement. The actual
        // writer retains its rights; an out-of-scope expansion declines WHOLE.
        // (id:laws-free-relations-f4-actor, id:being-facets-p4-sequence)
        if (usesDefaultMotion(pump) && request.command !== 'hand' &&
            isMotionDestination(destination, pump.registry)) {
            const produced = programFollowing(verdict, destination, pump.registry, pump.laws, lawWorld)
            if (produced && produced.component.every(({ frame }) =>
                mayAddressParticipant(writer, frame, pump.registry))) verdict = produced
        }
        verdict = checkMotion({ ...verdict }, attempt, pump.registry, pump.motionValidate)
    }
    // A proposed configuration that breaks an active law is refused, never shown
    // as accepted. (id:laws-activation-order)
    let gate = null
    if (verdict.kind === 'accept') {
        gate = brokenLaw(proposedOverrides(destination, verdict), pump.registry, pump.laws, lawWorld)
        if (gate.status === 'cannot-measure') verdict = { kind: 'unresolved', message: gate.reason }
        else if (heldFrame(ctx) || gate.status === 'violation') {
            verdict = { kind: 'refuse', ink: pump.execOpts.refusalStroke === 'continue' ? 'continue' : 'break' }
        }
    }
    if (!pump.execution.permits(ctx)) return parkOnVerdict(ctx, offered, pump, attempt)
    if (motionBaseChanged(writer, request) || questionMoved(writer)) verdict = { kind: 'stale' }
    recordAttempt(metaRootFrame(ctx), {
        path: 'program-motion', command: request?.command ?? null, owner: ctx.id,
        from: request?.from?.position ?? null, requested: request?.requested?.position ?? null,
        candidate: verdict.pose?.position ?? null, verdict: verdict.kind,
        gate: gate ? { status: gate.status, law: gate.law?.address ?? null, residual: gate.residual ?? null, reason: gate.reason ?? null } : null,
        baseRevision: request?.baseRevision ?? null,
    })
    if (verdict.kind === 'fault') return woundMotion(ctx, verdict.message)
    if (verdict.kind === 'accept' && (writer.installation === true || verdict.component.length > 0)) {
        const conflict = commitTransaction(verdict, attempt, pump)
        if (conflict) return woundMotion(ctx, conflict.message)
    }
    openInstant(ctx)
    suspend(ctx, 'admission', { seq: ++ctx.motionSeq, verdict })
    // A closed construction has no outside reader of these internal steps.
    // Consume a synchronous reply in this pump; breaths still yield on spent time.
    // (id:render-construction-cadence)
    if (ctx.closed) return { verdict: 'continue', produced: true }
    return { verdict: 'parked', produced: true }
}

function motion(ctx, value, _route, pump) {
    const destination = motionDestination(ctx, pump.registry)
    if (destination === null) return woundMotion(ctx, 'the retained receiver has left the world')
    if (pump.motionAdmissionAsync) return delayedMotion(ctx, value, pump)

    const attempt = motionAttempt(ctx, destination, {
        command: value.command, from: value.from, requested: value.requested, baseRevision: value.baseRevision })
    let raw
    try {
        raw = pump.motionAdmission ? pump.motionAdmission(attempt.request)
            : { accepted: true, transform: value.requested }
    } catch (error) {
        return woundMotion(ctx, `motion responder failed: ${error.message}`)
    }
    if (isThenable(raw)) {
        return woundMotion(ctx, 'motion responder returned a Promise; use motionAdmissionAsync for delayed replies')
    }
    return parkOnVerdict(ctx, interpretReply(raw, pump.execOpts.refusalStroke), pump, attempt)
}

// A pending reply owns a disposable subscription, not an immortal execution closure; the
// subscription severs THIS reaction but never cancels the underlying external promise or
// service, which its own owner must settle or abandon. (id:execution-input-revisions)
function subscribeReply(promise, receive) {
    const finish = (fulfilled, value) => {
        const reply = receive
        receive = null
        reply?.(fulfilled, value)
    }
    Promise.resolve(promise).then(value => finish(true, value), error => finish(false, error))
    return () => { receive = null }
}

// Controlled delayed admission: the responder may answer after the writer parks,
// which keeps its instant until the verdict lands. A reply applies only while the
// run that asked is still in the tree. (id:laws-build-solve-seam)
function delayedMotion(ctx, value, pump) {
    const run = ctx.run
    const seq = ++ctx.motionSeq

    // The attempt is fixed at admission and RETAINED through the delayed reply; eligibility
    // is rechecked at acceptance, never cached. (id:being-facets-p4-sequence)
    const destination = motionDestination(ctx, pump.registry)
    if (destination === null) return woundMotion(ctx, 'the retained receiver has left the world')
    const attempt = motionAttempt(ctx, destination, {
        command: value.command, from: value.from, requested: value.requested, baseRevision: value.baseRevision })
    let raw
    try {
        raw = pump.motionAdmissionAsync(attempt.request)
    } catch (error) {
        return woundMotion(ctx, `motion responder failed: ${error.message}`)
    }

    // A responder that answers now is applied now; only a thenable parks.
    if (!isThenable(raw)) return parkOnVerdict(ctx, interpretReply(raw, pump.execOpts.refusalStroke), pump, attempt)

    openInstant(ctx)
    suspend(ctx, 'admission', { seq, verdict: null })

    const stale = () => ctx.done || ctx.run !== run || ctx.suspension?.kind !== 'admission' || ctx.suspension.seq !== seq
    ctx.suspension.cancel = subscribeReply(raw, (fulfilled, value) => {
        if (stale()) return
        const verdict = !fulfilled
            ? { kind: 'fault', message: `motion responder failed: ${value?.message ?? value}` }
            : isThenable(value)
                ? { kind: 'fault', message: 'delayed motion responder resolved to another Promise' }
                : interpretReply(value, pump.execOpts.refusalStroke)
        parkOnVerdict(ctx, verdict, pump, attempt)
    })
    return { verdict: 'parked', produced: true }
}
function shout(ctx, value, route, pump) {
    interceptShout(ctx, value, pump.registry, route.deferredShouts, pump.onShout)
    return { verdict: 'continue', produced: true }
}

// A reached birth seats or revisits a named slot before its next read.
// Binding places a value; bare birth adopts the cursor. (id:laws-ordered-birth)
function birth(ctx, value, _route, pump) {
    // A declaration owns its name here: adopt the local child or establish — it never
    // reaches a visible namesake. The policy is shared with law(). (laws-decl-frame, D058)
    const resolution = resolveTarget('declare', { local: ctx.children.has(value.name) })
    if (resolution.kind === 'adopt') {
        const existing = ctx.children.get(value.name)
        // Bare birth adopts the cursor; binding places a figure with motion intact.
        // Origin, head and anchor commit together or remain unchanged.
        // (id:laws-generative-experiment-slot)
        const placesFigure = value.profile === 'derived' && existing.profile === 'derived'
        const motion = existing.transform.deref()
        const base = SE3.compose(worldTransform(ctx), value.origin)
        const here = placesFigure ? SE3.compose(base, motion) : base
        const next = SE3.compose(SE3.invert(worldTransform(existing)), here)
        const check = placesFigure ? checkPlacement(existing, value.origin, pump)
            : lawViolation(pump.laws.active(), new Map([[existing, next]]), pump.registry, lawWorld)
        const outcome = check.status === 'cannot-measure'
            ? { kind: 'unresolved', message: check.reason, span: value.owner }
            : check.status === 'violation'
                ? { kind: 'obstructed', span: value.owner,
                    message: conflictMessage(check.law, { feature: 'being act', owner: value.owner }),
                    members: affectedMembers(pump.registry, pump.laws.active(), check.law.endpoints, [existing, ctx]) }
                // The adopted pose is the being's new truth: its display projection
                // rides the same commit, so the point and its head never disagree.
                // (id:laws-p0m-publication)
                : { kind: 'commit', poses: [{ frame: existing, pose: next, stated: placesFigure }],
                    install: () => { existing.birthPose = SE3.clone(placesFigure ? value.origin : next) },
                    heads: [{ frame: existing, pose: placesFigure ? motion : next }], span: value.owner }
        const settled = settleAttempt(ctx, pump, outcome)
        if (settled) return settled
        ctx.reached?.add(value.name)
        return { verdict: 'continue', produced: true }
    }
    if (!pump?.createDeps) return { verdict: 'continue' }
    seatPlace(ctx, value.name, pump, value.origin)
    ctx.reached?.add(value.name)
    return { verdict: 'continue', produced: true }
}

// One noun: a law is an address, a predicate and an owner. One pipeline: the
// feature's propose row names the target's world pose under the active laws, the
// original predicate validates it independently, one publish installs it, and one
// store records it. A new form is a row, not a new effect. (id:laws-build-solve-seam)

// Refresh one member's display projection from its accepted pose. The published
// pose is the truth; the head event is how a parked or headed member shows it.
// (id:laws-transaction-d)
function emitHead(member, pose) {
    if (!member.done) return
    const head = headEventOf(member.actorState, pose)
    const target = member.targetFrame ? findReferenceFrame(member, member.targetFrame) : null
    putSync(member, target ? projectHead(head, target, relativeTransform(member, target)) : head)
}

// A bounded analytic realization for a connected set of distance laws with one
// held anchor: when moving the designated target alone would break a surviving
// law, realize the whole tree jointly, validate it, and publish it together.
// Outside that case it returns null and the attempt stays a located rejection.
// (id:laws-build-p3, id:laws-build-solve-seam)
// The analytic tree backend is deliberately narrow. When a component is outside it,
// that is a limitation of the solver, not a demonstrated impossibility: report it
// unresolved and let the settlement boundary keep the accepted prefix.
// (id:laws-contradiction, id:laws-activation-verdicts)
// A bounded analytic meet for one coordinate and one distance that share a point:
// the reach realizes the shared point onto their circle. (id:relationships-todo-plane-authored)



// A reached law, one form or another: resolve its target, then the one pipeline.
// A scalar declaration: one source-owned derived value bound to its name. A read of
// the name is still a snapshot; the value recomputes at the commit.
// (id:laws-build-p3-readout-built)
// A vector's line follows its value: the SAME key, so the materializer REPLACES the line
// rather than stacking another. The line is a display of the displacement, not a stroke.
// (id:notation-coordinate-vector)
// What a derived value's change DOES, by the kind of the datum its owner registered —
// one row per kind of redraw, never a branch at the watcher.
// (id:notation-coordinate-vector, id:laws-dependency-driven-place)
const REDRAWN = { vector: redrawVector, place: queueDerived }

// A driven law's readout changed: queue the re-application. A commit must not nest
// inside the publication that caused it, so the scheduler drains this at its next
// boundary. A value that cannot land leaves the target at its last accepted pose.
// The datum space is the row's declared capability, not a branch here.
// (id:laws-dependency-driven-place)
function queueDerived(spec, raw, node) {
    // The queue carries the RAW tower value; projection is the payload boundary's, done
    // once when the move is applied. (id:laws-payload-boundary)
    metaRootFrame(spec.observer)._derivedMoves.push({ spec, raw, node })
}

// The engine's projection into three: a point projects through toSpace; every other kind
// is already its payload. Projection is not the frame — the term's frame places the
// projected payload. (id:notation-coordinate-vector, id:laws-payload-boundary)
function projectPayload(feature, raw) {
    return kindOf(feature) === 'point' ? (toSpace(raw) ?? raw) : raw
}
function redrawVector(spec, raw) {
    const d = toSpace(raw)
    if (!d) return
    const frame = spec.frame
    if (!frame?.sync) return
    const [dx, dy, dz] = spec.rotation.rotateVec(d[0], d[1], d[2])
    const to = [spec.from[0] + dx, spec.from[1] + dy, spec.from[2] + dz]
    // ONE complete contract for birth and redraw: rotation rides with the event, so
    // the overlay can place the name without a partial pose. (id:notation-coordinate-vector)
    const event = { type: 'vector', name: spec.name, from: spec.from, rotation: spec.rotation,
        color: spec.color, thickness: spec.thickness, textSize: spec.textSize, to }
    putSync(frame, event, `vector:${spec.name}`)
}

// The owner's replacement or release transition retracts the WHOLE displayed object:
// the arrow and its name leave together, under one identity. (id:notation-coordinate-vector,
// id:laws-ordered-replacement)
function retractVector(frame, name) {
    if (!frame?.sync || !name) return
    putSync(frame, { type: 'vector', name, removed: true }, `vector:${name}`)
}

// A name re-declared as something that is NOT a vector retracts the vector's WHOLE
// displayed object, at the owner's transition — a parameter, a figure, a place.
// (id:notation-coordinate-vector, id:laws-ordered-replacement)
function retractIfVector(ctx, name, pump) {
    const prior = pump.readouts?.drivesOf(ctx.id, name)
    if (prior?.kind !== 'vector') return
    retractVector(prior.spec.frame, prior.spec.name)
    pump.readouts.retire(ctx.id, name)
}

function scalarReadout(ctx, value, _route, pump) {
    // A VECTOR is drawn. The readout carries WHAT its change means, so one registry
    // holds the node and its purpose together. (id:notation-coordinate-vector)
    // The name is the identity in its scope: a re-declaration REPLACES the node, so a
    // former display effect (a vector's arrow) cannot outlive the value that owned it.
    // A plain value re-registers with no `drives`, and the arrow stops being redrawn.
    // (id:notation-coordinate-vector, id:laws-ordered-replacement)
    const drives = value.vector
        ? { kind: 'vector', source: ctx.id, spec: { frame: ctx, ...value.vector } } : null
    const before = pump.readouts.drivesOf(ctx.id, value.name)
    // A replacement is WHOLE: if the name no longer names a vector, the arrow and its
    // name leave now, at the owner's transition. A refused replacement never reaches
    // this readout. (id:notation-coordinate-vector, id:laws-ordered-replacement)
    if (before?.kind === 'vector' && drives == null) retractVector(before.spec.frame, before.spec.name)
    const id = pump.readouts.register(ctx.id, value.name, value.read, drives)
    // The readout owns the arrow's WHOLE lifetime: it draws the value just read here,
    // redraws on change through the driver, and is retracted when the binding goes.
    // (id:notation-coordinate-vector)
    if (drives) redrawVector(drives.spec, value.initial)
    if (!ctx.scalars) ctx.scalars = new Map()
    ctx.scalars.set(value.name, id)
    return { verdict: 'continue', produced: true }
}

// A driven law's payload changed: re-run the ONE law pipeline and publish the move.
// A refusal is not a wound — there is no reach to tell — so the target keeps its last
// accepted pose. (id:laws-dependency-driven-place)
function redrawDerivedLaw(move, pump) {
    const { spec, raw, node } = move
    const { feature, observer, target, owner } = spec
    if (!target || target.error || !target.done) return
    if (!liveIn(pump.registry, observer)) return
    // A retired site's work must lose the right to publish: the accepted law at this
    // address must still be the one that queued the move. A newer fixed or live
    // declaration retires the older driver, and its already-queued move is dropped.
    // (id:laws-ordered-replacement)
    // The queued move belongs to a PARTICULAR accepted installation. A re-declaration at
    // the same site — a loop revisit — installs a fresh driver, and the older move must
    // not regain publication rights merely because its owner span still matches.
    // (id:laws-ordered-replacement, id:laws-dependency-driven-place)
    if (spec.key == null || pump.readouts.drivesOf(spec.source, spec.key)?.spec !== spec) return
    // FRESHNESS is raw against raw: the store's tower value must still be the one that
    // queued this move. It is NOT the acceptance test — a raw becomes an accepted payload
    // only through projection, and applyLaw's propose/validate decides acceptance. Two
    // comparisons, two spaces, one projection. (id:laws-payload-boundary, id:laws-reactive-randomness)
    if (node == null || !sameValue(pump.readouts.value(node), raw)) return
    // The accepted law is the authority; refresh ONLY its payload, keeping the term's
    // frame, references, axis and provenance. The scheduler never rebuilds a term from the
    // fields a driver saved. (id:laws-payload-boundary, D058)
    const accepted = pump.laws.lawAt(spec.address)
    const term = withPayload(accepted?.expression, projectPayload(feature, raw))
    if (term == null) return
    const outcome = applyLaw({ feature, target, observer, owner, term }, pump, lawWorld)
    if (outcome.kind !== 'commit') return
    publish(observer, outcome.poses, pump.registry, installOf(outcome, pump), () => {
        for (const h of outcome.heads ?? []) emitHead(h.frame, h.pose)
    }, publicationLaws(pump, outcome.law))
}


// A parameter: sampled once at its declaration, then a stable input. It is bound
// on the frame and read through `resolveBinding`; it owns no recomputation and no
// node, so an unrelated commit cannot resample it. (id:eval-relational)
function parameterReadout(ctx, value, _route, pump) {
    // A parameter is not a displayed object; if the name was a vector, it leaves.
    // (id:notation-coordinate-vector, id:laws-ordered-replacement)
    retractIfVector(ctx, value.name, pump)
    if (!ctx.params) ctx.params = new Map()
    ctx.params.set(value.name, value.value)
    return { verdict: 'continue', produced: true }
}

function law(ctx, value, _route, pump) {
    // A bound subject crosses as the being itself, not a name to re-resolve. (id:being-facets-p2-seam)
    const boundTarget = isBeing(value.target) ? value.target : null
    const targetName = boundTarget ? boundTarget.name : value.target
    const driven = driveOf(value.feature)
    // One name policy for reads and relations, shared with birth. The callers keep
    // every lookup and admission gate; the policy only selects. (laws/resolution.js, D058)
    const local = ctx.children.has(targetName)
    const found = boundTarget ?? findFrame(ctx, targetName, 'world')
    const declaredHere = ctx.declared?.has(targetName) === true
    const mayEstablish = mayEstablishOf(value.feature)
    // A declared-but-unreached name is a located use-before-introduction for a USE,
    // never for a definition. (id:laws-ordered-birth)
    for (const name of value.subjects ?? [targetName]) {
        if (!mayEstablish && reservedUnreached(ctx.declared?.has(name) === true, ctx.children.has(name))) {
            return woundRelation(ctx, `Use before introduction: ${name}`, 'relation', value.owner)
        }
    }
    const resolution = resolveTarget('condition', { local, found, bound: boundTarget, declaredHere, mayEstablish })
    if (resolution.kind === 'refuse') {
        return woundRelation(ctx, `Unknown target: ${targetName}`, 'relation', value.owner)
    }
    // The seat is provisional: a statement that does not commit withdraws it, so one
    // failed statement leaves no identity, no exposure and no hold behind.
    const born = resolution.kind === 'establish' ? seatPlace(ctx, targetName, pump, SE3.clone(ctx.transform.deref())) : null
    // Target selection is the caller's lookup, never the policy: a reserved name resolves
    // before a local child. (findFrame, D061)
    const target = boundTarget ?? findFrame(ctx, targetName, 'world')
    if (!target || target === ctx) {
        if (born) withdrawPlace(ctx, born, pump)
        return woundRelation(ctx, `Unknown target: ${targetName}`, 'relation', value.owner)
    }
    // A framed point descriptor is a validity input, never a participant: only live
    // names are resolved and admitted. (id:laws-distance-literal-address)
    const subjects = value.subjects ?? null
    // Resolve each selector ONCE: a bound being is the identity, a name reaches its frame
    // (a missing one stays a failure, never a filtered-away entry), and a framed point
    // descriptor is a VALUE, never a participant. (id:laws-distance-literal-address)
    const resolved = subjects ? subjects.map((s) => isBeing(s) ? { frame: s }
        : typeof s === 'string' ? { frame: findFrame(ctx, s, 'world') }
        : { reference: s.relative
            ? { frame: ctx.id, value: [...s.relative], relative: true }
            : { value: [...s.framed] } }) : null
    const participants = resolved ? resolved.filter((r) => r.frame !== undefined).map((r) => r.frame) : null
    const references = resolved ? resolved.map((r) => r.reference ?? (r.frame ? r.frame.id : null)) : null
    if (participants?.some((f) => !f || f === ctx)) {
        return woundRelation(ctx, 'a distance subject must name an introduced spatial point', 'relation', value.owner)
    }

    // A retired being is refused, never re-bound to a same-name namesake. (id:being-facets-p2-seam)
    const boundBeings = [target, ...(participants ?? [])].filter((f) => isBeing(f))
    if (boundBeings.some((f) => !isLiveBeing(f, pump.registry))) {
        if (born) withdrawPlace(ctx, born, pump)
        return woundRelation(ctx, 'a bound subject is retired', 'relation', value.owner)
    }
    const inaccessible = (participants ?? [target]).find(subject => !mayAddressParticipant(ctx, subject, pump.registry))
    if (inaccessible) {
        return woundRelation(ctx, `closed region has no outside law target: ${inaccessible.name}`, 'relation', value.owner)
    }
    // Subjects may be read without being movable. Only the operation's movers must
    // satisfy the bounded method's free-point domain. (id:laws-build-solve-seam)
    const movable = value.movers?.map((m) => isBeing(m) ? m.id : findFrame(ctx, m, 'world')?.id) ?? null
    if (movable?.some((id) => id == null || !(references ?? [target.id]).includes(id))) {
        if (born) withdrawPlace(ctx, born, pump)
        return woundRelation(ctx, 'a law mover must name a bound live subject', 'relation', value.owner)
    }
    const moves = (f) => !movable || movable.includes(f.id)
    // Supplied participants change the declaring owner, not the sibling/movement domain.
    // Reads do not grant motion; candidates still cross the original gate and publisher.
    // (id:laws-recipe-composition)
    const moving = participants?.filter(moves)
    if (moving?.some((f) => (f.parent !== ctx && !isSuppliedParticipant(ctx, f, pump.registry)) ||
        f.parent !== moving[0].parent || !freePoint(f) || heldFrame(f))) {
        return endUnresolved(ctx, 'explicit distance currently requires settled bodyless siblings admitted by its declaring scope')
    }
    if (participants?.some((f) => !moves(f) && !isWithinRegion(ctx, f) && !isSuppliedParticipant(ctx, f, pump.registry))) {
        return endUnresolved(ctx, 'a read-only subject must belong to or be supplied to the declaring scope')
    }
    // D054 refuses detected own-target reads as a definition policy, even if stable.
    // This is not a fixed-point test or a ban on cyclic relational obligations.
    // (id:tower-laws-cycle-contracts)
    if (driven && value.read &&
        pump.readouts.dependsOnFrame?.(value.read, target)) {
        if (born) withdrawPlace(ctx, born, pump)
        return woundRelation(ctx,
            `'${targetName}' cannot be defined by itself — a dependent place must stand on another`,
            'relation', value.owner)
    }
    const outcome = applyLaw({ feature: value.feature, target, participants, observer: ctx,
        value: value.value, expression: value.expression, axis: value.axis ?? null, owner: value.owner,
        references: references ?? undefined,
        ...(movable || value.reachPolicy !== undefined ? { operation: {
            policy: value.reachPolicy ?? 'target-only', ...(movable ? { movable } : {}),
        } } : {}) }, pump, lawWorld)
    // Install the law, geometry, driver and exposure only after publication accepts.
    // A refused replacement preserves the preceding driver and producer associations.
    // (id:laws-activation-order)
    if (outcome.kind === 'commit') {
        const install = installOf(outcome, pump)
        outcome.install = () => {
            if (install) install()
            // A point replaces a vector of the same name: the name now marks a point,
            // so the arrow and its name leave with the binding.
            // (id:notation-coordinate-vector, id:laws-ordered-replacement)
            if (value.feature === 'position') retractIfVector(ctx, targetName, pump)
            if (driven) {
                // The canonical law address is the retirement identity: same address
                // replaces, different addresses conjoin. A NAME would leave a producer
                // behind when an equivalent spelling of the same bound target is used.
                // (id:laws-ordered-replacement)
                const key = outcome.address
                if (value.read) {
                    const node = pump.readouts.register(ctx.id, key, value.read,
                        { kind: 'place', source: ctx.id,
                            spec: { feature: value.feature,
                                source: ctx.id, key,
                                observer: ctx, target, owner: value.owner,
                                address: outcome.address } })
                    // The target is PRODUCED by this node: the frame depends on it, so a
                    // reader of the frame can be detected standing on its own output.
                    // (id:laws-dependency-driven-place)
                    pump.readouts.produces(node, target)
                } else {
                    pump.readouts.retire(ctx.id, key)
                }
            }
            // Exposure is part of the commit: an installed identity is reachable before
            // any subscriber sees it. (id:laws-decl-exposure, id:laws-decl-ownership)
            if (born) ctx.reached?.add(targetName)
        }
    }
    const settled = settleAttempt(ctx, pump, outcome)
    if (settled) {
        if (born) withdrawPlace(ctx, born, pump)
        return settled
    }
    return { verdict: 'continue', produced: true }
}

function woundRelation(ctx, message, kind = 'relation', span = null) {
    foldBatch(ctx)
    ctx.observation = null
    ctx.done = true
    ctx.generator = null
    closeInstant(ctx)
    clearSuspension(ctx)
    ctx.error = report({ kind, message, span })
    ctx.channel.put({ type: 'error', ...ctx.error, ambientId: ctx.id })
    return { verdict: 'ended', produced: true }
}

// One live bound definition owns its captured questions and attached answers.
// Replacement retires publication rights, even for equal questions. (id:laws-figure-protocol)
// A question's retained interpretation: the declared participant inputs read once at the
// boundary. Serving answers from it; equality compares only what the run consumed.
// (id:being-facets-root-repair)
// A keyed figure's question: bindings plus the consumed meanings, marked so the store can
// expose the binding view. (id:being-facets-root-repair)
function questionToken(bindings, footprint) {
    const token = [bindings, footprint]
    token.deferredQuestion = true
    return token
}

function captureQuestionView(ctx, value, child) {
    // Capture inputs once; forwarded readings share their enclosing interpretation.
    // One identity-keyed map provides membership and state, not another world authority.
    // (id:being-facets-root-repair)
    const enclosing = questionViewOf(ctx)
    const readings = new Map()
    for (const input of value.question ?? []) {
        if (!isBeing(input)) continue
        if (enclosing && enclosing.readings.has(input)) {
            readings.set(input, enclosing.readings.get(input))
        } else {
            const birth = worldTransform(input)
            readings.set(input, {
                birth,
                world: SE3.compose(birth, readLocal(input)),
                elapsedTime: input.elapsedTime || 0,
                birthtime: input.birthtime || 0,
                done: input.done === true,
                commandCount: input.commandCount,
            })
        }
    }
    const view = { owner: child, readings }
    if (child) child.questionView = view
    return view
}

// Compare consumed meanings; discoveries refine the attached question's footprint.
// Their live comparison belongs to the next capture, not to discovery itself.
// (id:being-facets-root-repair)
function figureQuestion(ctx, value) {
    readingQuestion = true
    let bindings
    try { bindings = evaluateArgs(ctx, value.argExprs, declaredInputs(value), value.question) }
    finally { readingQuestion = false }
    const child = ctx.children.get(value.name)
    if (!child) return questionToken(bindings, [])
    if (!child.token) child.token = questionToken(bindings, [])
    if (!child.consumed) child.consumed = new Map()
    const bindingsChanged = !sameValue(bindings, child.token[0])
    const known = new Set(child.token[1].map(([key]) => key))
    let changed = false
    const baselines = []
    const live = []
    for (const [key, entry] of child.consumed) {
        // A pre-seat read retains its captured meaning; receiver freshness has one owner.
        // (id:declared-behaviour-revision-contract)
        let now = entry.baseline
        if (entry.receiver === true || !isLiveReceiver(child.questionView, entry.target)) {
            try { now = entry.live() } catch { /* retain an unavailable input's baseline */ }
        }
        baselines.push([key, entry.baseline])
        live.push([key, now])
        if ((known.has(key) || entry.receiver === true) && !sameValue(now, entry.baseline)) changed = true
    }
    // One bounded comparison is owed for a newly discovered meaning, cleared only when a
    // capture could see every consumed key. (id:being-facets-root-repair)
    // The retained receiver's accepted pose is an implicit input: an external change
    // revises the declaration; the run's own accepted motion advances the entry's baseline.
    // (id:declared-behaviour-revision-contract)
    if (child.compareOwed && [...child.consumed.keys()].every((key) => known.has(key))) child.compareOwed = false
    // A changed authored binding or consumed meaning replaces the run. The receiver's own
    // cursor is excluded at the read layer, never by a blanket effect witness.
    // (id:declared-behaviour-revision-contract)
    if (bindingsChanged || changed) {
        // The store owns requested demand; child.token describes the run ACTUALLY attached.
        // The new question is only adopted when supersedeFigure establishes it.
        // (id:being-facets-root-repair)
        return questionToken(bindings, changed ? live : baselines)
    }
    child.token[0] = bindings
    child.token[1] = baselines
    return child.token
}

// One live bound definition owns its captured questions and attached answers.
// Replacement retires publication rights, even for equal questions. (id:laws-figure-protocol)
function registerFigureCell(ctx, value, pump, reuse = false) {
    if (!pump.readouts) return
    retractIfVector(ctx, value.name, pump)   // a figure is not a vector; the arrow leaves
    const child = ctx.children.get(value.name)
    if (!child) return
    // The question is the arguments, re-read in the declaring frame. A live
    // name is a port (`let art = hello X.x`), not a free `let` in the body.
    // The membrane stays captureFor. (id:laws-figures-phase34-input)
    // Declaration/subscription is the current source; the question interpretation, footprint
    // and run rights transfer only across equal reuse. (id:being-facets-root-repair)
    // Same-definition reuse (sameSeed) already proves the question's identity, so the
    // retained interpretation, footprint and run rights transfer as-is; only a real
    // replacement rebuilds. (id:being-facets-root-repair)
    if (!reuse || !child.questionView) {
        child.consumed = new Map()
        child.compareOwed = false
        child.token = questionToken((value.question ?? []).slice(), [])
        captureQuestionView(ctx, value, child)
    }
    pump.readouts.register(ctx.id, value.name, {
        capture: () => figureQuestion(ctx, value),
        scope: child,
        // The body is attached with this question; seed only that actual attachment.
        // (id:laws-generative-experiments)
        seed: child.token,
        // This record is an invalidation subscription, NOT an answer: its build
        // requests a restart, and the run's outcome lives on the frame, where a wound
        // already carries provenance. Returning the name made a restart read as
        // completed construction — a refused figure settled as its own success.
        // (id:laws-figures-phase34-review)
        build: (q) => { supersedeFigure(ctx, value, pump, q) },
    })
}

// supersede: the newest question wins. A running build is abandoned, not left to
// finish — a value is preempted; an ordinary ambient process is not (D011/D028).
function supersedeFigure(ctx, value, pump, question) {
    const child = ctx.children.get(value.name)
    if (!child) return
    // Demand that returned to the actually attached question is not a new question: keep the
    // run, view, footprint and discovery debt. (id:being-facets-root-repair)
    if (question && child.token && sameValue(question, child.token)) return
    // The run reads the environment as it stood at this question, not live.
    // A rebuild is a new question, so it is a new snapshot. (id:laws-figures-phase34-review)
    value.capture = captureFor(ctx, value)
    // EXECUTION, refreshed: the same bound expressions read again for THIS question, so
    // the new run builds against current values rather than the first ones. Keeping the
    // expressions is exactly what separates this from baking a value once.
    if (value.argExprs) {
        try {
            value.question = evaluateArgs(ctx, value.argExprs, declaredInputs(value), value.question)
        } catch (error) {
            // Readiness belongs to the question boundary; a refusal belongs to
            // this figure, with its declaration's location, never to NOTHING.
            if (error.blocked) throw error
            woundRelation(child, error.message, 'evaluation', value.owner)
            return
        }
        const args = value.code?.ast?.[0]?.children ?? []
        // The rebind refreshes the answers as VALUES, never as source (a captured
        // string is not a name to re-resolve). (id:eval-relational)
        value.question.forEach((input, i) => { if (args[i]) args[i].value = input })
    }
    // A changed question is a new boundary: fresh footprint, view and debt. The node keeps
    // its identity — only the readout build path runs; authoring is not re-registered.
    // (id:being-facets-root-repair)
    child.consumed = new Map()
    child.compareOwed = false
    captureQuestionView(ctx, value, child)
    child.token = question ?? questionToken((value.question ?? []).slice(), [])
    rewireChild(child, value, pump)
    // A question-change rebuild joins the shared axis at the revision cut, never at frontier
    // zero: otherwise a continuously revised declaration starves already-scheduled work.
    // (id:declared-behaviour-revision-clock)
    child.resumeAt = pump.now ?? child.resumeAt
    pump.wake?.()
}

// Project the effective installation without mutating accepted geometry or storage caches.
// (id:world-coordinate-phase-3)
function posedWorld(entries) {
    const edits = new Map(entries.map(entry => [entry.frame, entry])), bases = new Map()
    const motion = f => {
        const edit = edits.get(f)
        return edit ? (edit.stated ? edit.motion : edit.pose) : f.transform.deref()
    }
    const basis = f => {
        if (bases.has(f)) return bases.get(f)
        const edit = edits.get(f)
        const pose = f.parent ? SE3.compose(basis(f.parent),
            edit?.stated ? edit.origin : (f.origin || motion(f.parent))) : SE3.identity()
        bases.set(f, pose)
        return pose
    }
    return { read: f => SE3.compose(basis(f), motion(f)), transform: basis }
}
function checkPlacement(frame, origin, pump) {
    return lawViolation(pump.laws.active(), null, pump.registry, posedWorld([
        { frame, stated: true, motion: frame.transform.deref(), origin },
    ]))
}
function publicationLaws(pump, candidate) {
    const active = pump.laws.active()
    return candidate ? [...active.filter(law => addressOf(law) !== addressOf(candidate)), candidate] : active
}

// The obligations a construction admits: the accepted prefix with EVERY requested
// obligation conjoined at its address. No member may be omitted. (D058)
function constructionLaws(pump, laws) {
    const addresses = new Set(laws.map((law) => addressOf(law)))
    return [...pump.laws.active().filter((law) => !addresses.has(addressOf(law))), ...laws]
}

// Prepare ONE candidate against the REQUESTED conjunction, before any obligation is
// accepted truth. Pure over the rows and the meet algebra: it solves and selects; it
// seats nothing, installs nothing, publishes nothing. (id:laws-first-two-pin-birth, D058)
function prepareConstruction(ctx, born, value, pump) {
    const obligations = value.obligations ?? []
    const laws = obligations.map((o) => bindLaw({
        feature: o.feature, endpoints: [born.id], axis: o.axis ?? null,
        scope: ctx.id, frame: ctx.id, owner: value.owner, predicate: null, expression: o.term(born.id, ctx.id),
    }))
    // The ADMITTED batch must be the INSTALLED batch. Duplicate addresses would collapse
    // at the store into fewer records than admission certified, so a repeated request is
    // refused rather than silently normalized. (D058)
    if (new Set(laws.map((law) => law.address)).size !== laws.length)
        return { ok: false, kind: 'request', message: 'a construction request repeats an obligation address' }
    const world = bindWorld((id) => pump.registry.get(id), {
        live: (f) => frameWorldTransform(f),
        placement: (f) => worldTransform(f),
    })
    // One uniform row context: `writerId` belongs to the row interface, never a
    // per-feature branch. (D058)
    const context = { writerId: born.id, ...world }
    const sets = laws.map((law) => AUTHORED[law.feature].set(law, context))
    const conjunction = meetAll(sets)
    // Preserve the CONJUNCTION's outcome — empty, uncertain or unresolved — never one
    // generic failure. An unnameable meet is an honest non-answer, not a relation error. (D058)
    if (!conjunction || ['empty', 'uncertain', 'unresolved'].includes(conjunction.kind))
        return { ok: false, kind: conjunction?.kind ?? 'unresolved',
            message: conjunction?.kind === 'empty' ? 'the construction has no point in common'
                : conjunction?.kind === 'uncertain' ? 'the construction meet is uncertain'
                    : 'the construction meet is not a named set' }
    const near = nearest(conjunction, value.seed ?? [0, 0, 0])
    if (!near?.ok) return { ok: false, kind: 'unresolved', message: near?.reason ?? 'the construction has no candidate' }
    return { ok: true, laws, candidate: near.at }
}

// An EXPLICIT construction: a fresh LOCAL identity whose requested obligations are
// prepared together and admitted by ONE publication. A condition never introduces on its
// own — this statement asks for the place. (id:laws-first-two-pin-birth, laws-ordered-birth)
function constructEffect(ctx, value, _route, pump) {
    const name = value.name
    // The experiment's explicit choice: an ABSENT LOCAL identity, and nothing adopted.
    if (ctx.children.has(name)) return woundRelation(ctx, `construct target '${name}' is already local`, 'relation', value.owner)
    // The seat is provisional: identity, no exposure, no obligation yet. (laws-names)
    const born = seatPlace(ctx, name, pump, SE3.clone(ctx.transform.deref()))
    const prepared = prepareConstruction(ctx, born, value, pump)
    if (!prepared.ok) {
        withdrawPlace(ctx, born, pump)
        // The outcome routes by KIND: a demonstrated impossibility is a contradiction, a
        // malformed request is a relation error, and an unnameable/uncertain meet is
        // UNRESOLVED — the honest non-answer, never a relation wound. (D058)
        if (prepared.kind === 'empty') return woundRelation(ctx, prepared.message, 'contradiction', value.owner)
        if (prepared.kind === 'request') return woundRelation(ctx, prepared.message, 'relation', value.owner)
        return endUnresolved(ctx, prepared.message)
    }
    // ONE publication: the accepted pose is composed through the placement by publish(),
    // so the birth anchor (birthPose) and the accepted world pose stay distinct.
    const outcome = {
        kind: 'commit', span: value.owner, laws: prepared.laws,
        poses: [{ frame: born, pose: SE3.translateLocal(SE3.identity(), prepared.candidate[0], prepared.candidate[1], prepared.candidate[2]), stated: true, ref: 'world' }],
        install: () => { for (const law of prepared.laws) pump.laws.apply(law); ctx.reached?.add(name) },
    }
    const settled = settleAttempt(ctx, pump, outcome)
    if (settled) { withdrawPlace(ctx, born, pump); return settled }
    return { verdict: 'continue', produced: true }
}

function spawn(ctx, value, route, pump) {
    // A bound receiver keeps its identity. Check liveness and scope before attachment;
    // neither permits replacing its source. (id:participation-language)
    const receiver = isBeing(value.receiver) ? value.receiver : null
    if (receiver) {
        if (!isLiveBeing(receiver, pump.registry)) return woundRelation(ctx, `retired receiver: ${receiver.name}`, 'relation')
        if (!mayAddressParticipant(ctx, receiver, pump.registry)) return woundRelation(ctx, `closed region has no outside receiver: ${receiver.name}`, 'relation')
        // CUTOVER: the declaring slot holds the current installation; the installation owns
        // its continuation; the receiver is RETAINED, never rewired. Eligibility is
        // admission, not permission to replace the receiver's source. (id:being-facets-p4-sequence)
        return spawnInstallation(ctx, value, route, pump, receiver)
    }
    // Keep parent transform atom current between head events.
    ctx.transform.swap(() => value.origin)
    // Freeze the environment before the question is registered, so the run and the
    // A figure is a construction; a child of a construction is inside it. Closure is
    // inherited down the subtree, so no descendant acquires an authority the owner
    // lacks. (id:laws-figures-phase34-review)
    const closed = value.profile === 'derived' || ctx.closed === true
    value.closed = closed
    // question that licenses it are one snapshot. (id:laws-figures-phase34-review)
    if (closed) value.capture = captureFor(ctx, value)
    const existing = ctx.children.get(value.name)
    const deferredShouts = route.deferredShouts

    if (existing) {
        if (value.profile === 'derived' && sameSeed(existing.seed, value)) {
            const check = checkPlacement(existing, value.origin, pump)
            if (check.status !== 'valid') return woundRelation(ctx,
                check.status === 'violation' ? `the placement conflicts with the ${check.law.feature} law` : check.reason,
                check.status === 'violation' ? 'relation' : 'unresolved')
        }
        // A declared place keeps its placement: starting a body there does not
        // move it. An ordinary ambient keeps the origin refresh, so the
        // compositor still tracks the parent's pose. (id:laws-decl-join-repair)
        if (existing.isPlace !== true) existing.origin = value.origin
        existing._worldDirty = true
        metaRootFrame(existing)._configurationRevision++

        if (value.profile === 'derived') {
            // The seed witnesses the body actually attached, never merely registered.
            // Same slot, new definition/question: replace its private answer in place.
            // (id:laws-generative-experiments)
            const reuse = sameSeed(existing.seed, value)
            if (!reuse) rewireChild(existing, value, pump)
            registerFigureCell(ctx, value, pump, reuse)
            if (reuse) return { verdict: 'continue' }
            if (deferredShouts) deliverDeferredToFrame(deferredShouts, existing)
            return { verdict: 'spawned', spawned: existing, produced: true }
        }

        if (existing.done && pump.createDeps) {
            // An open ambient settles before restarting; a value is not implicitly opened.
            // (id:laws-figure-protocol-kinds)
            if (existing.profile === 'derived' && existing.runIncarnation) return { verdict: 'continue' }
            rewireChild(existing, value, pump)
            if (deferredShouts) deliverDeferredToFrame(deferredShouts, existing)
            // Caller must drain — rewire alone does not advance.
            return { verdict: 'spawned', spawned: existing, produced: true }
        }
        // Running & not done → idempotent no-op (origin already refreshed).
        return { verdict: 'continue' }
    }

    if (pump.createDeps) {
        const child = seatChild(ctx, value, pump, route, deferredShouts)
        if (value.profile === 'derived') registerFigureCell(ctx, value, pump)
        return { verdict: 'spawned', spawned: child, produced: true }
    }
    return { verdict: 'continue', produced: true }
}

// Construct, register and wire a place under `ctx`. It does NOT advance the new
// frame: advancement belongs to the caller, so inline spawn ordering is exactly
// what it was. One door builds a place; realization will call it for identities
// the source declares. (id:host-beat)
function seatChild(ctx, value, pump, route, deferredShouts) {
    // The figure's key is its place in the tree — a derived answer is memoized by
    // this, so its entropy must live inside it. (id:cmp-become-seed)
    if (value.closed) {
        value.figureSeed = `${ctx.address ?? frameAddress(metaRootFrame(ctx), ctx)}/${value.name}`
    }
    const { generator, deps, mailbox, batch, relationshipBatch } =
        createChildGenerator(value, pump.createDeps, pump.execOpts)
    const child = attachMeta(
        createFrame(value.name, generator, {
            parent: ctx,
            origin: value.origin,
            ...pump.channelOpts,
            // Born at the parent's current logical instant: its `resumeAt` once it
            // has waited, else its own birth. A frame that only spawns never waits;
            // anchoring at its `resumeAt` of 0 sent children to the axis origin.
            logicalBirth: ctx.resumeAt > 0 ? ctx.resumeAt : (ctx.logicalBirth ?? route.now),
        }),
        value.frame,
        pump.stock
    )
    // The frame's clock is local (0 at birth); its birth on the shared
    // axis is inherited. One axis, two roots per ambient. (id:host-beat)
    child.birthtime = (value.env?.birthtime || 0) / 1000
    child.profile = value.profile ?? null
    child.closed = value.closed === true
    // Register under the name BEFORE wiring: wireChild stamps the
    // address, whose last segment is this children-map key.
    orderExecution(ctx, child)
    ctx.children.set(value.name, child)
    bumpTree(ctx)
    wireChild(child, deps, mailbox, pump.registry, value.code, batch, relationshipBatch, pump)
    child.seed = seedOf(value)
    if (deferredShouts) deliverDeferredToFrame(deferredShouts, child)
    return child
}

// CUTOVER — installation ownership (PRODUCTION). A declaring slot holds the current
// installation; the installation owns its continuation and run; the receiver is a
// retained participant, never rewired. The seat is NOT a child of the declaring frame,
// so findFrame and tree traversal cannot reach it: it cannot become a geometric
// participant by name. A FRESH record distinguishes a replacement from its predecessor
// (frame identity survives an in-place rewire). (id:being-facets-p4-sequence)
function retireInstallation(source, record, pump) {
    if (source.installations?.get(record.site) !== record) return false
    const root = metaRootFrame(source)
    // FOLLOW BOTH OWNERSHIP EDGES RECURSIVELY: an installation can own an ordinary ambient
    // child, and that child can own a nested installation. Retiring only this frame's
    // direct installations strands the nested continuation. (id:being-facets-p4-sequence)
    retireInstallationsUnder(record.frame, pump)
    terminateAmbient(record.frame)
    releaseAttemptsFor(root, subtreeIds(record.frame))
    releaseReadouts(root, subtreeIds(record.frame))
    visitPostOrder(record.frame, (c) => {
        resetInk(c, pump.stock)
        pump.registry.delete(c.id)
        pump.laws.retractIdentity(c.id)
    })
    source.installations.delete(record.site)
    return true
}

// Retire every installation seated by a frame and its descendants — the explicit
// counterpart to the tree teardown the non-child seat does not receive.
function retireInstallationsUnder(frame, pump) {
    for (const child of frame.children.values()) retireInstallationsUnder(child, pump)
    for (const record of [...(frame.installations?.values() ?? [])]) retireInstallation(frame, record, pump)
}

function spawnInstallation(ctx, value, route, pump, receiver) {
    const site = value.site ?? value.name
    const prior = ctx.installations?.get(site)
    if (prior) retireInstallation(ctx, prior, pump)
    // Inherit the declaring region's restriction; an installation is never silently
    // opened. A closed region keeps its closure (and its captured environment).
    // (id:being-facets-p4-sequence)
    value.closed = ctx.closed === true
    if (value.closed) {
        value.figureSeed = `${frameAddress(metaRootFrame(ctx), ctx)}/${value.name}@${site}`
        value.capture = captureFor(ctx, value)
    }
    // An installation's authored movement ALWAYS enters the attempt path. A responder or an
    // active law is not a prerequisite for production correctness, so the protocol is part
    // of the fresh actor state, not patched onto it. (id:being-facets-p4-sequence)
    const { generator, deps, mailbox, batch, relationshipBatch } =
        createChildGenerator(value, pump.createDeps, { ...pump.execOpts, motionProtocol: true })
    // The continuation starts from the receiver's ACCEPTED pose — copied, never aliased:
    // the writer and the destination stay distinct frames. (id:being-facets-p4-sequence)
    batch.transform = SE3.clone(receiver.transform.deref())
    const child = attachMeta(
        createFrame(value.name, generator, {
            parent: ctx,
            origin: value.origin,
            ...pump.channelOpts,
            logicalBirth: ctx.resumeAt > 0 ? ctx.resumeAt : (ctx.logicalBirth ?? route.now),
        }),
        value.frame,
        pump.stock,
    )
    child.birthtime = (value.env?.birthtime || 0) / 1000
    child.profile = null
    child.closed = value.closed
    child.receiver = receiver
    child.installation = true
    // The installation joins the shared axis at its declaring frame's current instant,
    // never at frontier zero. (id:declared-behaviour-revision-clock)
    child.resumeAt = ctx.resumeAt > 0 ? ctx.resumeAt : (ctx.logicalBirth ?? route.now)
    // Deliberately NOT ctx.children.set: the seat is not a discoverable child.
    orderExecution(ctx, child, prior?.frame)
    wireChild(child, deps, mailbox, pump.registry, value.code, batch, relationshipBatch, pump)
    child.seed = seedOf(value)
    const record = { site, source: ctx, frame: child, receiver, run: child.run }
    child.installationRecord = record
    ;(ctx.installations ??= new Map()).set(site, record)
    // The receiver's accepted pose is an implicit question input of the owning declaration:
    // an external change revises it, the run's own accepted motion advances the baseline.
    // (id:declared-behaviour-revision-contract)
    const questionOwner = questionViewOf(ctx)?.owner ?? ctx
    ;(questionOwner.consumed ??= new Map()).set(receiverKey(receiver), {
        receiver: true, target: receiver,
        baseline: captureReceiver(receiver),
        live: () => captureReceiver(receiver),
    })
    // No blanket effect witness: a read of the receiver's cursor is excluded at the read
    // layer, so reported owner-supersession is participant revision. (id:declared-behaviour-revision-contract)
    if (route.deferredShouts) deliverDeferredToFrame(route.deferredShouts, child)
    return { verdict: 'spawned', spawned: child, produced: true }
}

// Output event — one offered deposit (head pose-swap + run tagging inside).
// (spec id:ft-d7-deposit-runid)
function deposit(ctx, value, route, pump) {
    const { frameTarget, frameTransform, destination } = route
    // A lost destination has no channel or geometry: end the venture rather than crash the
    // delivery or silently present it on the installation. (id:being-facets-p4-sequence)
    if (destination === null) return endUnresolved(ctx, 'the retained receiver has left the world')
    const refusal = offerDeposit(ctx, value, frameTarget, frameTransform, pump.stock, destination)
    if (refusal === 'ceiling') return { verdict: 'ended', produced: true }
    if (refusal) {
        parkOwing(ctx, refusal, value)
        return { verdict: 'parked', produced: true }
    }
    return { verdict: 'continue', produced: true }
}

// Unresolved stops the governed continuation without inventing a conclusion.
function endUnresolved(ctx, reason) {
    ctx.observation = null
    ctx.unresolved = { reason }
    if (ctx.batch) {
        ctx.actorState = ctx.batch
        ctx.commandCount += ctx.batch.commandCount
        ctx.batch = null
    }
    ctx.done = true
    ctx.generator = null
    closeInstant(ctx)
    clearSuspension(ctx)
    return { verdict: 'ended' }
}

function motionUnresolved(ctx, value) {
    return endUnresolved(ctx, value.reason)
}

// A refused statement in an ordinary walk does not end the run and does not vanish:
// the report rides the frame's channel, located, beside the siblings that ran.
// (id:cmp-resilient, id:laws-figures-phase34-capabilities)
// A statement that did not run — a line that would not parse, or a measure the numerics
// door refused — is dropped, never the figure: it rides the frame's channel AND its
// standing notice list, located, beside the siblings that ran. One shape, one sink, so
// a reader asks ailments instead of learning a second pipe. (id:cmp-resilient)
// A refusal that STOPS the pass never reaches here: the frame's error carries it.
function noticeEffect(ctx, value) {
    const said = noticeWire({ kind: value.kind ?? 'walk', message: value.message, span: value.span, expr: value.expr })
    ctx.channel.put({ ...said, ambientId: ctx.id })
    const standing = (ctx.notices ??= [])
    if (!standing.some((n) => n.message === said.message && (n.span?.line ?? null) === (said.span?.line ?? null))) {
        standing.push(said)
    }
    return { verdict: 'continue', produced: true }
}
// WHAT THE SCHEDULER ROUTES — one row per kind it must ACT on. Everything else a walk
// yields is DEPOSITED: the ledger takes credit and the frame's channel carries it out.
// So this list, plus the deposit default, is the whole routing vocabulary.
export const EFFECTS = {
    breath, blocked, wait, yield: yieldEffect, shout, spawn, limitMailbox, motion, motionUnresolved, notice: noticeEffect, birth, law, construct: constructEffect, scalar: scalarReadout, parameter: parameterReadout,
}

// Verdict for one yield. Pumps act; this only means. (id:output-ledger-r2-instant)
function stepFrame(ctx, value, done, route, pump) {
    if (done) {
        // An answer that ended without ink still empties the show: discharge the held clear.
        // (id:laws-figures-phase34-inplace)
        if (ctx.pendingClear) { ctx.channel.put({ type: 'clear' }); ctx.pendingClear = false }
        closeInstant(ctx)
        const result = value || {}
        if (result.actorState) {
            ctx.actorState = result.actorState
            // Lifetime across rewires — rewireChild does not zero this.
            ctx.commandCount += result.actorState.commandCount
        } else {
            ctx.commandCount += (typeof result === 'number' ? result : (result.commandCount || 0))
        }
        // Folded — drop the live batch or commandsOf would count it twice.
        ctx.batch = null
        ctx.observation = null
        ctx.done = true
        ctx.generator = null
        // Said at the end, so a frame of reference may still arrive late.
        if (ctx.targetFrame && !route.frameTarget) woundMissingReference(ctx)
        return { verdict: 'ended' }
    }

    const handler = EFFECTS[value.type] ?? deposit
    return handler(ctx, value, route, pump)
}

// One generator step (owed deposit first). Both pumps share this path.
// (id:output-ledger-r2-credit)
function stepOnce(ctx, route, pump) {
    const { frameTarget, frameTransform, destination } = route
    if (destination === null) return endUnresolved(ctx, 'the retained receiver has left the world')
    if (!pump.execution.permits(ctx) || questionMoved(ctx)) return { verdict: 'paused' }
    ctx.suspension?.deliver?.()
    if (ctx.done) return { verdict: 'ended', produced: true }

    // Resume after a suspension: replay an owed deposit first (emission order).
    const sus = ctx.suspension
    if (sus?.owed) {
        const refusal = deliverDeposit(ctx, sus.owed, frameTarget, frameTransform, pump.stock, destination)
        if (refusal) {
            // Debt stays; only the kind may change (credit→residency resets the stall clock).
            if (sus.kind !== refusal) {
                sus.kind = refusal
                sus.since = null
            }
            return { verdict: 'parked' }
        }
        clearSuspension(ctx)
        return { verdict: 'continue', produced: true }
    }
    // Awaiting an async admission: hold the writer's instant and never advance it
    // with an undefined verdict (undefined would read as a refusal). (id:laws-build-solve-seam)
    const admission = sus?.kind === 'admission' ? sus : null
    if (admission && !admission.verdict) return { verdict: 'parked' }
    let value, done
    // Source-active laws must govern every motion path, including the ordinary
    // program walk with no laboratory responder. The executor asks for admission
    // whenever a law is live; with none, the unconstrained fast path stays.
    // (id:laws-activation-order)
    if (ctx.batch) ctx.batch.motionProtocol = ctx.installation === true ||
        pump.motionAdmission != null ||
        pump.motionAdmissionAsync != null || pump.laws.count() > 0
    try {
        const input = admission ? admission.verdict : undefined
        if (admission) clearSuspension(ctx)
        ;({ value, done } = ctx.generator.next(input))
    } catch (error) {
        foldBatch(ctx)
        ctx.observation = null
        ctx.done = true
        ctx.generator = null
        ctx.error = errorRecord(error)
        ctx.channel.put({ type: 'error', ...ctx.error, ambientId: ctx.id })
        return { verdict: 'ended', produced: true }
    }

    return stepFrame(ctx, value, done, route, pump)
}

// Drain a single child's generator until it pauses (wait/done/blocked/error)
// or spawns a new child. Returns the spawned child frame, or null if paused.
function drainUntilPause(child, now, pump, deferredShouts) {
    pump.now = now
    let frameTarget = null
    let frameTransform = null
    if (child.targetFrame) {
        frameTarget = findReferenceFrame(child, child.targetFrame)
        if (frameTarget) frameTransform = relativeTransform(child, frameTarget)
    }

    child.inlineAdvancing = true
    clearSpentPark(child)

    // now + deferredShouts ride route — pump stays config. (id:carving-todo-effects-table)
    const route = { frameTarget, frameTransform, destination: motionDestination(child, pump.registry), now, deferredShouts }

    while (true) {
        const step = stepOnce(child, route, pump)
        if (step.verdict === 'continue') continue
        if (step.verdict === 'spawned') return step.spawned
        return null  // paused | parked | ended
    }
}

// --- Scheduler ---

export function createScheduler(generator, opts = {}) {
    // Channel bag only; pump policy is separate. (D027 R2)
    const channelOpts = {
        channelCapacity: opts.channelCapacity || 4096,
        lossless: opts.lossless !== false,
    }
    const createDeps = opts.createDeps || null
    const execOpts = { ...(opts.execOpts || {}) }
    if (opts.motionAdmission || opts.motionAdmissionAsync) execOpts.motionProtocol = true
    if (opts.observePureGoto) execOpts.observePureGoto = true
    if (opts.refusalStroke !== undefined) execOpts.refusalStroke = opts.refusalStroke
    const onShout = opts.onShout || null

    // Null = unpaced. (id:output-ledger-r2-pacer)
    let deadline = null
    const clock = opts.clock || (() => performance.now())

    // One stage stock for the whole tree. (id:carving-todo-ledger-stock)
    const stock = createStock()
    // The play's active laws: one address → one predicate + owner. (id:laws-ordered-replacement)
    const laws = createLawStore()
    // Source-owned derived values, recomputed once per commit. (id:laws-build-p3-slider)
    const execution = createExecution({
        current: frame => liveIn(registry, frame),
        depends: executionDepends,
        onRelease() {
            pump.wake()
            if (root.notifyingCommit) return
            readouts.recompute(committedSnapshot())
            readouts.drain()
        },
    })
    const readouts = createReadouts({ permits: owner => !root.notifyingCommit && execution.permits(owner) })

    const root = attachMeta(
        createFrame(ROOT_NAME, generator, channelOpts),
        null,
        stock
    )
    root.address = ROOT_NAME
    // The logical instant reads resolve against; cycle snapshots are keyed to it.
    root._frontier = 0
    root._obsEpoch = 0
    root._motionRevision = 0   // accepted motion commits in this play
    // Capability gate: running-member correction is off by default. Enabling it is
    // an explicit act, not an accident. (id:laws-activation-order)
    root._settledOnly = opts.settledOnly !== false
    // Failed declaration attempts own their holds; repair releases across scopes.
    root._attempts = new Map()
    root._attemptSeq = 0
    root._readouts = readouts
    root._derivedMoves = []
    root._configurationRevision = 0
    root.transform.watch('configurationRevision', () => { root._configurationRevision++ })
    // Stage root has no when; rootHears opts in. (id:mailbox-listens-for)
    if (opts.rootHears !== undefined) root.listensFor = opts.rootHears
    // Wire shared mailbox — same array the root executor reads from
    if (opts.rootMailbox) root.mailbox = opts.rootMailbox
    // Wire root observation — root can read children via dotted access
    if (opts.rootDeps) {
        root.deps = opts.rootDeps
        bindResolve(opts.rootDeps, root)
    }
    const registry = new Map([[root.id, root]])
    root._registry = registry

    // Shared pump bag for tick/hotSwap/advanceChild. Config only — now rides route.
    // (id:output-ledger-r2-pacer, id:carving-todo-effects-table)
    const pump = {
        createDeps,
        execOpts,
        motionAdmission: opts.motionAdmission || null,
        motionAdmissionAsync: opts.motionAdmissionAsync || null,
        motionValidate: opts.motionValidate || null,
        execution,
        channelOpts,
        registry,
        laws,
        readouts,
        onShout,
        stock,
        // Inline drain asks too — unpaced hang is real.
        outOfTime: () => deadline !== null && clock() > deadline,
    }
    // A drain can re-seat a derived figure after a pass was marked done; the
    // pump's wake clears the cached flag so the next tick advances it.
    // (id:laws-figure-eidos-cell)
    pump.wake = () => { root._done = false }
    // A derived value changed. What that MEANS depends on its kind: a place re-applies
    // its law (a commit, which must not nest inside the publication that caused it, so
    // it is queued for the scheduler to drain), a vector re-places its arrow (a display
    // put, which may happen at once). A fixed value's readout never changes, so it never
    // fires — "fixed" is a derived value that simply does not move.
    // (id:notation-coordinate-vector, id:laws-dependency-driven-place)
    readouts.watch((change) => {
        // A derived value standing on itself, indirectly — through a scalar or through a
        // frame it drives. Refuse the definition, as the direct case does (D054).
        // (id:laws-dependency-driven-place)
        if (change.cycle) {
            // A cycle is attributed to the SOURCE that declared it, never to display
            // metadata. A non-destructive diagnostic: the walk in flight is not torn down.
            const frame = registry.get(change.source)
            const spec = change.drives?.spec
            const name = spec?.target?.name
            if (frame && !frame.error) {
                frame.error = report({ kind: 'relation', span: spec?.owner ?? null,
                    message: name
                        ? `'${name}' cannot be defined by itself — a dependent value stands on it`
                        : 'a derived value cannot be defined by itself — it stands on its own answer' })
                frame.channel.put({ type: 'error', ...frame.error, ambientId: frame.id })
            }
            return
        }
        const redraw = change.drives
        if (change.pending || change.refused) return
        if (redraw) REDRAWN[redraw.kind](redraw.spec, change.value, change.id)
    })

    return {
        root,
        channel: root.channel,   // backward compat — root frame's channel
        registry,
        // The caller owns the scope; releasing it services final demand before old work.
        // (id:execution-input-revisions)
        defer: input => execution.defer(input),
        stock,

        get resumeAt() { return root.resumeAt },
        set resumeAt(v) { root.resumeAt = v },

        // Backed by the root so a drain-time re-seat can wake the scheduler.
        get done() { return root._done === true && root._derivedMoves.length === 0 },
        set done(v) { root._done = v },
        commandCount: 0,
        lastTickTime: 0,

        // Arm a timeslice (OS quantum). Prefer withSlice — open deadline is a test seam.
        // (id:output-ledger-r2-pacer)
        sliceFor(ms) { deadline = ms == null ? null : clock() + ms },

        // Run the pump inside a timeslice, then close it.
        // Slice spans many ticks (driver loop, not one tick). Must close: an expired
        // deadline reads as "no time", so every breath parks — silent freeze if forgotten.
        // Outside a slice the pump is unpaced (batch/headless complete in one call).
        withSlice(ms, drive) {
            deadline = ms == null ? null : clock() + ms
            try { return drive(pump.outOfTime) } finally { deadline = null }
        },

        // Mid-build: last tick let go with work left.
        get building() { return this._building === true },
        // Is the world at a logical display cut? The display driver's one boundary
        // question. Where a `wait` is a cut, a breath, a debt or a block is not.
        get atCut() { return atCut(root) },
        // Settlement through H is a fact, not a retry or publication instruction.
        // It does not certify complete display geometry or ready visual resources.
        // (id:live-rendering-reveal)
        isSettledThrough(H) { return settledThrough(registry, root, H, pump) },
        // A finished drawing may accept a settled, pen-up hand request without
        // reviving its coroutine. The same responder, check and component commit
        // serve program motion. The caller supplies the last seen motion revision.
        get motionRevision() { return root._motionRevision },
        // The play's active laws (address → predicate, owner). Read-only seam.
        get laws() { return laws },
        readPlace(name, property, ownerKey = 'host') {
            const owner = root.children.get(ownerKey)
            const frame = owner?.children.get(name)
            if (!owner || !frame) return { kind: 'missing' }
            try { return { kind: 'value', value: resolveProperty(frame, property, null, owner, true) } }
            catch (error) { return { kind: 'unsupported', message: error.message } }
        },
        readScalar(name, ownerKey = 'host') {
            const owner = root.children.get(ownerKey)
            const id = owner?.scalars?.get(name)
            if (id === undefined) return { kind: 'missing' }
            try {
                const value = readouts.value(id)
                if (value === undefined) return { kind: 'unsupported', message: 'value is not ready' }
                return { kind: 'value', value }
            } catch (error) { return { kind: 'unsupported', message: error.message } }
        },
        proposePlace(name, position, revision, ownerKey = 'host') {
            const owner = root.children.get(ownerKey)
            const frame = owner?.children.get(name)
            if (!owner || !frame) return { kind: 'missing' }
            if (!Array.isArray(position) || position.length !== 3 || !Array.from(position).every(Number.isFinite))
                return { kind: 'unsupported', message: 'position must contain three finite numbers' }
            if (!freePoint(frame)) return { kind: 'unsupported', message: 'only a free authored place can be proposed' }
            const current = frameWorldTransform(frame)
            return this.requestMotion(frame, { ...current, position: [...position] }, revision, 'world')
        },
        onAcceptedChange(fn) {
            root._acceptedWatchers ??= new Set()
            root._acceptedWatchers.add(fn)
            return () => root._acceptedWatchers.delete(fn)
        },
        // Source-owned derived values (id:laws-build-p3-slider). Read-only seam.
        get readouts() { return readouts },
        // `ref` names the frame `requested` is expressed in — 'world', 'parent', or a named
        // frame. Naming one makes this a STATEMENT (a position); naming none is a motion.
        // (id:laws-figures-phase34-hand-frame)
        requestMotion(frame, requested, revision, ref = null) {
            if (!liveIn(registry, frame) || frame === root) return { kind: 'stale' }
            // A publication's notifications are on the stack; a request raised from one
            // is refused for retry, never interleaved — the watcher's commit is later
            // (laws-transaction-d), and an outer publication must not overwrite it.
            if (root.notifyingCommit) return { kind: 'busy', message: 'publication in flight' }
            if (!frame.done || subtreeUnsettled(frame)) return { kind: 'busy' }
            // A settled actor may live inside a hosted play. Keep the transaction
            // inside one seating: a sibling's birth frame is not the root's frame.
            // The shared geometry fact, asked AFTER settlement: a hand is a settled actor's move,
            // so an unsettled frame is `busy` above and never a geometry refusal here. An
            // installation is not a being and is refused as unresolved, not moved as an actor.
            if (!isMotionDestination(frame, registry)) return { kind: 'unresolved' }
            // A failed attempt holds its component until an edit releases it.
            if (heldFrame(frame)) return { kind: 'refuse', ink: execOpts.refusalStroke === 'continue' ? 'continue' : 'break' }
            if (revision !== root._motionRevision) return { kind: 'stale' }
            const request = { command: 'hand', from: frame.transform.deref(), requested, frame, ref }
            // The hand path is its own destination (self-motion), carried as one attempt.
            // (id:being-facets-p4-sequence)
            const attempt = motionAttempt(frame, frame, request)

            // Who decides the verdict? An installed responder, always. Failing that,
            // an existence-only declaration decides nothing, so its own admission is
            // the identity: the point moves where it is asked. That is source-backed,
            // not a default for a missing responder — a frame the source does not
            // expose is still unresolved, and an installed responder is never
            // bypassed. (id:laws-decl-ownership)
            let raw
            if (pump.motionAdmission) {
                try { raw = pump.motionAdmission(request) }
                catch (error) { return { kind: 'fault', message: `motion responder failed: ${error.message}` } }
                if (isThenable(raw)) {
                    return { kind: 'unresolved', message: 'hand admission must settle synchronously' }
                }
            } else if (pump.motionAdmissionAsync) {
                return { kind: 'unresolved' }
            } else if (exposed(frame)) {
                raw = { accepted: true, transform: requested }
            } else {
                return { kind: 'unresolved' }
            }
            const offered = normalizeDeclared(
                refuseMalformedProposal(interpretReply(raw, execOpts.refusalStroke), attempt), attempt)
            if (offered.kind !== 'accept') return offered
            // One candidate producer. An installed responder owns the component it
            // returns; only when none is installed does the built-in continuation
            // policy choose geometry. The two never run in series.
            // (id:laws-build-solve-seam)
            if (usesDefaultMotion(pump)) continueLaws(offered, frame, registry, laws, lawWorld)
            // ONE certification, and it is the LAST step before the gate: whatever produced
            // this candidate — a responder or the continuation — the host reads it once, whole.
            // (id:laws-free-relations-n-node-review)
            const verdict = certifyFinal(offered, attempt, registry, pump.motionValidate)
            if (verdict.kind !== 'accept') return verdict
            const check = brokenLaw(proposedOverrides(attempt.destination, verdict), registry, laws, lawWorld)
            recordAttempt(root, {
                path: 'hand-settled', owner: frame.id,
                from: frame.transform.deref().position, requested: verdict.pose?.position ?? null,
                candidate: verdict.pose?.position ?? null,
                gate: { status: check.status, law: check.law?.address ?? null, residual: check.residual ?? null, reason: check.reason ?? null },
                baseRevision: revision,
            })
            if (check.status === 'cannot-measure') return { kind: 'unresolved', message: check.reason }
            if (check.status === 'violation') return { kind: 'refuse', ink: execOpts.refusalStroke === 'continue' ? 'continue' : 'break' }
            const members = [{ frame, pose: verdict.pose }, ...verdict.component]
            const targets = new Map()
            for (const { frame: member } of members) {
                if (member.parent !== frame.parent || member.isLens || member.error)
                    return { kind: 'unresolved' }
                const target = member.targetFrame ? findReferenceFrame(member, member.targetFrame) : null
                if (member.targetFrame && target !== member.parent && target?.parent !== member.parent)
                    return { kind: 'unresolved' }
                targets.set(member, target)
            }
            const conflict = commitTransaction(verdict, attempt, pump, () => {
                // A hand never repaints deposited ink. Its head uses the same
                // declaring-frame projection as a program head (id:ft-d5-head).
                for (const { frame: member, pose } of members) {
                    if (!member.done) continue
                    const head = headEventOf(member.actorState, pose)
                    const target = targets.get(member)
                    putSync(member, target ? projectHead(head, target, relativeTransform(member, target)) : head)
                }
            })
            if (conflict) return {
                kind: conflict.kind === 'unsupported' ? 'unresolved' : conflict.kind === 'refuse' ? 'refuse' : 'busy',
                message: conflict.message,
            }
            return verdict
        },


        // Same seed → skip; name may update in place. (id:cmp-become-seed)
        // Caller sees hold by identity: returned frame === the one already seated.
        // A prepared batch can seat all identities before any executor runs.
        // The caller must finish seating the batch before calling tick().
        hotSwapChild(key, forkSpec, { fresh = false, deferStart = false } = {}) {
            const existing = root.children.get(key)
            if (existing && !fresh && sameSeed(existing.seed, forkSpec)) {
                const heldName = forkSpec.name || key
                // A rename is a resolution change even though the tree's shape held.
                if (existing.name !== heldName) { existing.name = heldName; bumpTree(root) }
                return existing
            }
            if (existing) {
                // A changed seed is a fresh play: a relationship-only edit does not
                // yet carry statement ownership across a reparse. (id:laws-build-p2-recut)
                terminateAmbient(existing)
                // A replaced source retires its installations, not only explicit removal.
                // (id:being-facets-p4-sequence)
                retireInstallationsUnder(existing, pump)
                // Leaving the tree frees its share of the stage stock.
                releaseAttemptsFor(root, subtreeIds(existing))
                releaseReadouts(root, subtreeIds(existing))
                visitPostOrder(existing, (c) => { resetInk(c, stock); registry.delete(c.id); laws.retractIdentity(c.id) })
                root.children.delete(key)
                bumpTree(root)
            }

            const displayName = forkSpec.name || key
            const { generator, deps, mailbox, batch, relationshipBatch } = createChildGenerator(forkSpec, createDeps, execOpts)
            const child = attachMeta(
                createFrame(displayName, generator, {
                    parent: root,
                    origin: forkSpec.origin || SE3.identity(),
                    ...channelOpts,
                    // Two seating doors, two clocks (D011, id:host-beat): `fresh` is a NEW
                    // PLAY at the axis origin; an EDIT re-seats in the same play, joining at
                    // its current reveal instant so its first wait lands in the future.
                    logicalBirth: fresh ? 0 : (this.lastTickTime || 0),
                }),
                null,
                stock
            )
            // Register under the key BEFORE wiring: wireChild stamps the frame's
            // address, whose top segment is this registration key.
            orderExecution(root, child)
            root.children.set(key, child)
            bumpTree(root)
            wireChild(child, deps, mailbox, registry, forkSpec.code, batch, relationshipBatch, pump)
            child.seed = seedOf(forkSpec)

            // The seat drain is a pump too. Its shouts must reach the tree, not
            // die in a throwaway buffer. (id:mailbox-listens-for)
            const deferredShouts = []
            if (!deferStart) advanceChild(child, this.lastTickTime, pump, deferredShouts)
            if (deferredShouts.length > 0) flushDeferredShouts(deferredShouts, registry)
            this.done = false
            return child
        },

        // Remove a child of root by key and clean up its subtree.
        removeChild(key) {
            const child = root.children.get(key)
            if (!child) return
            terminateAmbient(child)
            retireInstallationsUnder(child, pump)
            releaseAttemptsFor(root, subtreeIds(child))
            releaseReadouts(root, subtreeIds(child))
            visitPostOrder(child, (c) => { resetInk(c, stock); registry.delete(c.id); laws.retractIdentity(c.id) })
            root.children.delete(key)
            bumpTree(root)
            this.done = allDone(root)
        },

        // The current installations seated by a declaring frame, keyed internally by
        // statement site. The lookup surface, never a children-map layout.
        // (id:being-facets-p4-sequence)
        installationsOf(frame) {
            return [...(frame?.installations?.values() ?? [])]
                .filter((record) => registry.get(record.frame.id) === record.frame)
        },

        // Selective retirement of one installation among siblings in one source. A stale
        // record is refused: only the CURRENT occupant of the site may be retired.
        // (id:being-facets-p4-sequence)
        // OWNER COMMAND: retire whatever currently occupies this slot.
        // (id:being-facets-p4-sequence)
        retireInstallation(frame, site) {
            const record = frame?.installations?.get(site)
            return record ? retireInstallation(frame, record, pump) : false
        },

        // HANDLE COMMAND: retire only this captured occupant; refuse if it was replaced.
        // An old address must not acquire authority over the new occupant.
        // (id:being-facets-p4-sequence)
        retireOccupant(handle) {
            if (!handle?.source || !handle?.frame) return false
            return retireInstallation(handle.source, handle, pump)
        },

        get errors() {
            const errs = []
            for (const [id, ctx] of registry) {
                if (ctx.error) errs.push({ ambientId: id, name: ctx.name, address: addrOf(ctx), ...ctx.error })
                // A standing NOTICE is an ailment too: the figure drew, and lost something
                // on the way. One list, so a reader asks one question. (id:cmp-resilient)
                for (const said of ctx.notices ?? []) {
                    errs.push({ ambientId: id, name: ctx.name, address: addrOf(ctx), ...said })
                }
            }
            return errs
        },

        // Earliest resumeAt only; post-order within an instant. (D011 #3)
        tick(now) {
            if (root.notifyingCommit) return false
            this.lastTickTime = now
            pump.now = now
            readouts.drain()
            // A derived place whose coordinate changed commits its move here, OUTSIDE
            // any publication and before any early return: a queued move is not work
            // the frontier knows about. A move that cannot land keeps the last pose.
            // (id:laws-dependency-driven-place)
            if (root._derivedMoves.length > 0) {
                const moves = root._derivedMoves
                root._derivedMoves = []
                for (const move of moves) {
                    try { redrawDerivedLaw(move, pump) } catch { /* keep the last pose */ }
                }
            }
            // A drain may re-seat a derived figure after the pass was marked done
            // (rewireChild resets the child, not this cache). Recompute before
            // trusting it, so a re-seated figure is advanced. (id:laws-figure-eidos-cell)
            if (this.done) {
                this.done = allDone(root)
                if (this.done) return false
            }

            let produced = false

            // The earliest logical instant with a ready frame (resumeAt ≤ now).
            let frontier = Infinity
            visitPostOrderMotionFirst(root, (ctx) => {
                if (!ctx.done && pump.execution.permits(ctx) && ctx.resumeAt <= now && ctx.resumeAt < frontier) {
                    frontier = ctx.resumeAt
                }
            })
            if (frontier === Infinity) {        // nothing ready at this `now`
                // Discharge a discovered meaning's one bounded comparison before idle.
                // (id:being-facets-root-repair)
                if (owesComparison(root) && root._readouts?.size > 0) root._readouts.recompute(committedSnapshot())
                this.done = allDone(root)
                if (this.done) this.commandCount = sumCounts(root)
                return false
            }
            // A new frontier is a new observation baseline for synchronous cycles.
            if (frontier !== root._frontier) { root._frontier = frontier; root._obsEpoch++ }

            // Park mid-instant: stop the pass; resume first next tick. (id:output-ledger-r2-instant)
            let parked = false

            visitPostOrderMotionFirst(root, (ctx) => {
                if (parked || ctx.done || !pump.execution.permits(ctx) || ctx.resumeAt > frontier) return

                // Defer shouts until all siblings exist.
                const deferredShouts = []

                let frameTarget = null
                let frameTransform = null
                if (ctx.targetFrame) {
                    frameTarget = findReferenceFrame(ctx, ctx.targetFrame)
                    if (frameTarget) {
                        frameTransform = relativeTransform(ctx, frameTarget)
                    }
                }

                clearSpentPark(ctx)

                // Same stepFrame as the trampoline. now on route, not pump. (id:output-ledger-r2-instant)
                const route = { frameTarget, frameTransform, destination: motionDestination(ctx, pump.registry), now, deferredShouts }
                // A WAIT JOINT refreshes the retained cursor from the receiver's accepted
                // local pose before the next command — pose only: no publication, no
                // binding/style import, placement composition untouched.
                // (id:being-facets-p4-sequence)
                if (ctx.refreshOnResume) {
                    ctx.refreshOnResume = false
                    const receiver = route.destination ?? ctx.receiver
                    if (receiver) ctx.batch.rebase = SE3.clone(receiver.transform.deref())
                }

                while (!ctx.done) {
                    const step = stepOnce(ctx, route, pump)
                    if (step.produced) produced = true

                    if (step.verdict === 'continue') continue

                    if (step.verdict === 'spawned') {
                        parked = advanceChild(step.spawned, now, pump, deferredShouts)
                        if (parked) break
                        continue
                    }

                    // paused | parked | ended
                    if (step.verdict === 'parked') parked = true
                    break
                }

                // Deliver any remaining deferred shouts
                if (deferredShouts.length > 0) {
                    flushDeferredShouts(deferredShouts, registry)
                    produced = true
                }
            })

            // Stall wound only; full is stock.full. (id:output-ledger-r2-residency, id:carving-todo-ledger-stock)
            // Derived values settle once per instant, whatever caused it: a
            // program declaration, a law, a wait or a hand. `publish` covers
            // motion commits; this covers ordinary program instants, where a
            // `let s = ...` (or a figure cell) gets its first value.
            // (id:laws-build-p3-readout-built, id:laws-figure-eidos-cell)
            if (root._readouts?.size > 0) root._readouts.recompute(committedSnapshot())
            enforceResidency(registry, clock, stock)
            // Let go with work outstanding = the world is still building.
            this._building = parked

            this.done = allDone(root)
            if (this.done) {
                this.commandCount = sumCounts(root)
            }

            // A completed slice exposes declarations and ordinary motion together,
            // after dependent readings agree; it is not a motion-law revision.
            notifyAccepted(root)
            return produced
        }
    }
}

// Synthetic root generator for unified scheduler tree.
// Completes immediately — visitPostOrder still walks children.
export function* metaRoot() { return 0 }

export { createFrame, visitPostOrder, terminateAmbient, allDone, worldTransform, frameWorldTransform, findReferenceFrame, resolveBinding }
// frameAddress is exported at its definition (stable cross-re-eval frame key).
