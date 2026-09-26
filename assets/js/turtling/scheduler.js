// Cooperative scheduler for frame coroutines — green threads, not OS threads.
// Pump + park: preemptive slice (time) and backpressure (credit/residency) share one park.
// Instant law: no sibling advances past a parked mid-instant. (id:output-ledger-r2-instant)

import { createFrame } from "./frame.js"
import { matchPattern } from "./match.js"
import { execute, createActorState } from "./executor.js"
import { deriveBatch, exposed, freePoint } from "./laws/batch.js"
import { createLawStore, addressOf, bindLaw } from "./laws/replacement.js"
import { componentOf, realizeDistanceTree } from "./laws/component.js"
import { predicateOk } from "./laws/expression.js"
import { measure, headingOf } from "./laws/relations.js"
import { createReadouts } from "./laws/readout.js"
import { realizeDistance, validateDistance, ACCEPT_TOL } from "./laws/realize.js"
import { SE3 } from "./se3.js"
import { chargeInk, woundInk, enforceResidency, resetInk, createStock } from "./ledger.js"

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

function visitPostOrder(ctx, fn) {
    for (const child of ctx.children.values()) {
        visitPostOrder(child, fn)
    }
    fn(ctx)
}

// An admitted writer owns the rest of its logical instant regardless of sibling
// registration order. Other park causes keep the scheduler's original traversal.
function visitPostOrderMotionFirst(ctx, fn) {
    const children = [...ctx.children.values()].sort((a, b) =>
        Number(!!b.midInstant) - Number(!!a.midInstant))
    for (const child of children) visitPostOrderMotionFirst(child, fn)
    fn(ctx)
}

function terminateAmbient(ctx) {
    for (const child of ctx.children.values()) {
        if (!child.done) terminateAmbient(child)
    }
    unwireWorldCache(ctx)
    ctx.observation = null
    ctx.done = true
    ctx.channel.close()
}

function allDone(ctx) {
    if (!ctx.done) return false
    for (const child of ctx.children.values()) {
        if (!allDone(child)) return false
    }
    return true
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

// Stroke-run id from source geometry+width; colour does not break. (id:child-ink, id:ft-d7-deposit-runid)
function tagRun(ctx, value) {
    if (value.type !== 'path' || !value.points || !value.points.length) return
    // Thickness only: LineMaterial.linewidth is uniform per mesh. Colour is data.
    const style = `${value.thickness}`
    const continues = style === ctx._strokeStyle && _samePt(value.points[0], ctx._strokeEnd)
    if (!continues) ctx._strokeRun = (ctx._strokeRun || 0) + 1
    value.runId = ctx._strokeRun
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
function putSync(ctx, event) {
    ctx.sync[event.type] = event
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
function deliverDeposit(ctx, value, frameTarget, frameTransform, stock) {
    if (value.type === "head") {
        ctx.transform.swap(() => ({ rotation: value.rotation, position: [...value.position] }))
        putSync(ctx, lensOutput(ctx, projectHead(value, frameTarget, frameTransform)))
        return null
    }

    // Residency = working set full (stage stock). One cell, not N flags.
    // (id:output-ledger-r3-addressee, id:carving-todo-ledger-stock)
    if (stock?.full && value.type === 'path') return 'residency'

    // Credit = flow control: sink queue full (classic credit-based backpressure).
    const sink = frameTarget ? frameTarget.channel : ctx.channel
    if (sink.full) return 'credit'

    tagRun(ctx, value)
    if (frameTarget) {
        sink.put(transformEvent(value, frameTransform, ctx.id))
    } else {
        sink.put(lensOutput(ctx, value))
    }
    return null
}

// Charge once, deliver maybe later. Park holds a charged deposit — replaying
// must not charge again. (id:output-ledger-r3-stock-flow)
// null | 'ceiling' (wounded) | refusal cause to parkOwing
function offerDeposit(ctx, value, frameTarget, frameTransform, stock) {
    if (!chargeInk(ctx, value, stock)) return 'ceiling'
    return deliverDeposit(ctx, value, frameTarget, frameTransform, stock)
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
    frame.suspension = { kind, owed: null, ...parts }   // owed stays null unless a debt is held
}

function clearSuspension(frame) {
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
    let node = frame
    while (node.parent) node = node.parent
    return node
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
        if (!target) {
            // A missing name is a dataflow suspension while its parent can still
            // spawn it; only a finished parent makes it a wound. (D011)
            if (frame.inlineAdvancing || (frame.parent && !frame.parent.done)) {
                // Dataflow suspension: dependency may arrive later
                const err = new Error(`Blocked on assistant: ${targetName}`)
                err.blocked = true
                throw err
            }
            throw new Error(`Undefined assistant: ${targetName}`)
        }

        // An observation is a synchronization point, not a peek at whatever
        // committed pose is lying there. If the target's subtree is still inside
        // an instant and the reader is outside it, suspend and retry.
        // Settled target is the common case: the O(1) subtree check short-circuits
        // before the O(depth) ancestor walk. Both operands are pure, so order is free.
        if (subtreeUnsettled(target) && !isAncestorOf(target, frame)) {
            // A wait-for cycle is synchronous: pin every member to its pre-instant
            // pose (Jacobi) so no edge reads another's same-instant commit. A plain
            // suspension propagates as a park.
            if (waitsOn(target, frame)) {
                markCycle(frame, target)
            } else {
                const err = new Error(`Blocked on assistant: ${targetName} (mid-instant)`)
                err.blocked = true
                err.blockedFrame = target
                throw err
            }
        }

        if (frame.suspension?.kind === 'dataflow') clearSuspension(frame)
        // A sibling reads in the room's frame so faceto/goto compose; a containing
        // ancestor reads world-space. `world` is always world-space (prim-world);
        // `origin` stays observer-relative so `goto origin.x` composes. (prim-position)
        const isWorld = targetName === 'world'
        const isOrigin = targetName === 'origin'
        const contains = target !== frame && isAncestorOf(target, frame)
        const ground = isWorld ? false : (isOrigin ? true : !contains)
        return resolveProperty(target, property, args, frame, ground)
    } else {
        // Unqualified: walk ancestor chain for fn binding
        // A scalar introduced by `let s = expr` is a value, not a frame. Its
        // declaring frame and its ancestors own the binding; between commits it
        // computes on demand. (id:laws-build-p3-readout-built)
        for (let node = frame; node; node = node.parent) {
            const id = node.scalars?.get(name)
            if (id === undefined) continue
            const value = metaRootFrame(frame)._readouts?.value(id)
            if (value !== undefined) return value
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

const roundVec = (v) => Math.abs(v) < 1e-10 ? 0 : Math.round(v * 1e9) / 1e9

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

function readWorldTransform(frame, observer) {
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

// Target pose in the observer's birth frame — same numbers goto/faceto drink.
// Root / missing observer → identity birth → world numbers (the tab floor).
function poseInObserverBirth(target, observer) {
    const world = readWorldTransform(target, observer)
    if (!observer) return world
    const birth = observer.observation?.poses.get(observer)?.birth || worldTransform(observer)
    return SE3.compose(SE3.invert(birth), world)
}

// Spatial properties — projections of a pose, world-space unless ground is set.
const SPATIAL = {
    x: (t) => roundVec(t.position[0]),
    y: (t) => roundVec(t.position[1]),
    z: (t) => roundVec(t.position[2]),
    heading: (t) => roundVec(headingFromQuaternion(t.rotation)),
}

// Temporal properties — lifecycle projections. `time` is local; `birthtime`
// is birth on the shared axis, so `birthtime + time` is an axis position. (id:host-beat)
const TEMPORAL = {
    time:     (frame) => roundVec(frame.elapsedTime || 0),
    birthtime: (frame) => roundVec(frame.birthtime || 0),
    done:     (frame) => frame.done ? 1 : 0,
    commands: (frame) => frame.commandCount,
}

// Relational properties — computed from observer + target in world space.
const RELATIONAL = {
    distance: (target, observer) => roundVec(measure("distance", target, observer, (f) => worldReading(f, observer, null))),
    bearing: (target, observer) => roundVec(measure("bearing", target, observer, (f) => worldReading(f, observer, null))),
    sync: (target, observer) => roundVec(measure("sync", target, observer, (f) => worldReading(f, observer, null))),
}

// Resolve a property on a target frame — spatial, temporal, relational, or fn.
// `ground` = read in the observer's own frame, not shared world space: only a
// sibling/stranger and `origin` (so goto composes). `world` and containing
// ancestors answer world-space (prim-world, prim-position).
function resolveProperty(target, property, args, observer, ground = false) {
    // A free spatial point is a position, not a walker: it was seated with no
    // body, so reading a heading would invent a yaw nobody stated. Bearing to
    // it is a real reading; its own heading is not. (id:laws-affordance)
    if (!args && property === 'heading' && freePoint(target)) {
        throw new Error(`No heading: ${target.name} is a free point`)
    }
    if (!args && SPATIAL[property]) {
        return SPATIAL[property](ground ? poseInObserverBirth(target, observer) : readWorldTransform(target, observer))
    }
    if (!args && TEMPORAL[property]) {
        return TEMPORAL[property](target)
    }
    if (!args && observer && RELATIONAL[property]) {
        return RELATIONAL[property](target, observer)
    }

    // fn binding — any arity
    const arity = args ? args.length : 0
    const result = lookupFn(target, property, arity, args)
    if (result !== undefined) return result

    throw new Error(`Undefined property: ${property} on assistant ${target.name}`)
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
    ctx.error = {
        message: `there is no '${ctx.targetFrame}' to draw in — this one drew in its own frame`,
        span: null,
        kind: 'walk',
    }
    ctx.channel.put({ type: 'error', ...ctx.error, ambientId: ctx.id })
}

// Walk error is a record: message, span, kind. (id:cmp-runtime-provenance)
const errorRecord = (error) => ({
    message: error.message,
    span: error.span ?? null,
    kind: error.kind ?? 'walk',
})

// Deliver once per address; never back to the emitter.
export function deliverShout(shout, target) {
    const addr = addrOf(target)
    const fromAddr = shout.from ? addrOf(shout.from) : null
    if (target === shout.from || addr === fromAddr) return
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

// Shout at push: self now; others deferred (or registry if no buffer).
function interceptShout(frame, value, registry, deferredShouts, onShout) {
    pushMailbox(frame, { name: value.name, payload: value.payload })
    if (deferredShouts) {
        deferredShouts.push({ from: frame, name: value.name, payload: value.payload })
    } else {
        for (const [id, t] of registry) {
            if (t === frame) continue  // already delivered to self
            pushMailbox(t, { name: value.name, payload: value.payload })
        }
    }
    if (onShout) onShout(frame.name, value.name, value.payload)
}

// Mark dotted cross-ambient reads so loops auto-yield.
function bindResolve(deps, frame) {
    deps.mathEvaluator.beginObservation = () => {
        const root = metaRootFrame(frame)
        const poses = new Map()
        visitPostOrder(root, member => {
            const birth = worldTransform(member)
            poses.set(member, { birth, world: SE3.compose(birth, member.transform.deref()) })
        })
        frame.observation = { poses, revision: root._configurationRevision }
        return frame.observation.revision
    }
    deps.mathEvaluator.endObservation = () => { frame.observation = null }
    deps.mathEvaluator.resolveExternal = (v, a) => {
        const result = resolveBinding(frame, v, a)
        if (typeof v === 'string' && v.includes('.')) deps.mathEvaluator._observedSibling = true
        return result
    }
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
    // One actor mailbox: scheduler pushes, executor drains (same array).
    const mailbox = []
    const opts = {
        color: value.style?.color || execOpts.color,
        maxRecurseDepth: execOpts.maxRecurseDepth,
        maxRecurses: execOpts.maxRecurses,
        maxCommands: execOpts.maxCommands,
        breathEvery: execOpts.breathEvery,
        strokeMax: execOpts.strokeMax,
        motionProtocol: execOpts.motionProtocol,
        observePureGoto: execOpts.observePureGoto,
        functions: value.code.functions,
        loopCounter: value.env?.loopCounter,
        birthtime: value.env?.birthtime,
        scope: value.env?.scope,
        lens: isLensName(value.name),
        mailbox,
    }
    // The batch's state is BORN HERE, not on the generator's first next(), so a
    // frame can be asked what it has done while it is still doing it (commandsOf).
    const batch = createActorState(opts)
    // One parse, two meanings: the relationship batch is what the body declares,
    // the executable body is what it does. Derived ONCE, carried through wiring —
    // never re-interpreted downstream. (id:laws-decl-two-meanings)
    const relationshipBatch = deriveBatch(value.code.ast)
    return {
        generator: execute(relationshipBatch.body, childDeps, { ...opts, actorState: batch }),
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
function resetRunState(frame, stock) {
    clearSuspension(frame)
    frame.observation = null
    frame.error = null
    frame.unresolved = null
    frame.sync = {}
    frame.run = ++RUNS
    // A delayed admission reply belongs to the run that asked. Rewire reborns the
    // run, so a stale resolver must be dropped, not applied. (id:laws-build-solve-seam)
    frame.midInstant = false
    // Stroke joining is per run: BOTH halves of the join test must go, or the
    // next run's first path could continue the last one's. (id:ft-d7-deposit-runid)
    frame._strokeEnd = null
    frame._strokeStyle = null
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

// Same seed = element identity on green tree. (id:cmp-become-seed)
function seedOf(spec) {
    return {
        ast: [...(spec.code?.ast ?? [])],
        functions: spec.code?.functions ?? null,
        userspace: spec.env?.userspace ?? null,
        color: spec.style?.color ?? null,
    }
}

function sameSeed(seed, spec) {
    if (!seed) return false
    const next = spec.code?.ast ?? []
    if (seed.ast.length !== next.length) return false
    for (let i = 0; i < next.length; i++) {
        if (seed.ast[i] !== next[i]) return false
    }
    return seed.functions === (spec.code?.functions ?? null)
        && seed.userspace === (spec.env?.userspace ?? null)
        && seed.color === (spec.style?.color ?? null)
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

// What a fresh generator needs to be driven. ONE place, because both births use
// it — first (wireChild) and re-run (rewireChild) — and a field wired in only
// one of them is a bug that shows up a whole run later.
// A declaration whose place was never reached is an unfulfilled requirement: a
// clean end seats every declared name through its birth effect, so a missing one
// is reported rather than counted as success. (id:laws-decl-join-repair)
function reportUnrealizedPlaces(ctx) {
    if (!ctx.declared || ctx.declared.size === 0) return
    const missing = [...ctx.declared].filter((name) => !ctx.children.has(name))
    if (missing.length > 0) {
        ctx.unresolved = { reason: `existence not realized: ${missing.join(', ')}` }
    }
}

// A declared place with no body yet: the walk's reached pose, facing forward.
// That is the birth site, not a hidden pin and not a parse-time seat.
// (id:laws-ordered-birth, id:laws-decl-anchor)
function seatPlace(parent, name, pump, pose = null) {
    const place = attachMeta(
        createFrame(name, null, {
            parent,
            origin: SE3.identity(),
            ...(pose ? { transform: SE3.clone(pose) } : {}),
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
    parent.children.set(name, place)
    bumpTree(parent)
    wireChild(place, pump.createDeps(), [], pump.registry, { ast: [], functions: {} }, null, null)
    return place
}

function wireRun(child, deps, mailbox, executionState, code, relationshipBatch, pump = null) {
    child.deps = deps
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
    bindResolve(deps, child)
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
    // A rewired scope is a new source: its old statement sites are gone, so their
    // laws are retracted before the new body states its own. (id:laws-build-p2c)
    if (pump.laws) pump.laws.retractFrame(child.id)
    // An edit repairs the attempt: release the component its failure held.
    // (id:laws-activation-verdicts)
    releaseSourceAttempts(metaRootFrame(child), subtreeIds(child))
    metaRootFrame(child)._readouts?.release(child.id)
    const re = createChildGenerator(value, pump.createDeps, pump.execOpts)
    // A declared place keeps its accepted geometry: the new run begins where the
    // place stands, orientation included, and its first segment starts there
    // because the stroke takes its origin from the pose. (id:laws-decl-join-repair)
    if (child.parent?.declared?.has(child.name)) {
        const accepted = child.transform.deref()
        re.batch.transform = { rotation: accepted.rotation, position: [...accepted.position] }
    }
    child.generator = re.generator
    child.done = false
    wireRun(child, re.deps, re.mailbox, re.batch, value.code, re.relationshipBatch, pump)
    resetRunState(child, pump.stock)      // ink per RUN; park/sync/error never ride the new one
    // A NEW RUN IS A NEW CLOCK (D011), anchored at the parent's current instant:
    // resumeAt once it has waited, else its own birth. The old run's resumeAt is
    // past, so waiting would fast-forward the animation into one tick.
    child.resumeAt = 0
    child.logicalBirth = child.parent
        ? (child.parent.resumeAt > 0 ? child.parent.resumeAt : child.parent.logicalBirth)
        : null
    child.channel.drain()
    child.channel.put({ type: 'clear' })
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

function wait(ctx, value, route) {
    // Logical sleep: first wait anchors to logicalBirth, not wall clock (D011).
    closeInstant(ctx)
    const { now, frameTarget, frameTransform } = route
    ctx.resumeAt = (ctx.resumeAt > 0 ? ctx.resumeAt : (ctx.logicalBirth ?? now)) + value.duration
    ctx.elapsedTime += value.duration / 1000
    if (value.position) {
        ctx.transform.swap(() => ({
            rotation: value.rotation,
            position: [...value.position]
        }))
        putSync(ctx, lensOutput(ctx, projectHead({
            type: "head",
            position: value.position,
            rotation: value.rotation,
            color: value.color,
            headSize: value.headSize
        }, frameTarget, frameTransform)))
    }
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
    ctx.observation = null
    ctx.done = true
    ctx.generator = null
    closeInstant(ctx)
    clearSuspension(ctx)
    ctx.error = { message, span: null, kind: 'motion' }
    ctx.channel.put({ type: 'error', ...ctx.error, ambientId: ctx.id })
    return { verdict: 'ended', produced: true }
}

// Accepted geometry lives on the frame after its executor finishes. Running
// members also receive a rebase to adopt before their next command.
// One publication boundary: install every pose, notify the fan once, bump the
// revision once, seed a running member's rebase. Truths and requests share it, so
// no accepted change has a private door. (id:laws-build-solve-seam)
function publish(writer, entries, registry, install = null) {
    const seen = new Set()
    // Running-member correction is a gated capability, off by default: this slice
    // solves settled configurations only. (id:laws-activation-order)
    const settledOnly = metaRootFrame(writer)._settledOnly !== false
    for (const { frame, pose } of entries) {
        if (!frame || seen.has(frame) || registry.get(frame.id) !== frame) {
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
            if (settledOnly) {
                return { kind: 'unsupported', message: `publication target '${frame.name}' is a running member; settled configurations only` }
            }
        }
        if (!pose || !Array.isArray(pose.position)) return { kind: 'conflict', message: 'a publication entry needs a pose' }
    }
    const notify = entries.map(({ frame, pose }) => frame.transform.swapDeferred(() => pose))
    for (const { frame, pose } of entries) if (!frame.done && frame.batch) frame.batch.rebase = pose
    // Install laws, ownership and accepted geometry before any notification:
    // no watcher may see new geometry beside an old law. (id:laws-activation-order)
    if (install) install()
    const root = metaRootFrame(writer)
    // Derived values recompute from THE committed configuration, once, with early
    // cutoff. No command is re-run and no subscription is created.
    // (id:laws-build-p3-slider)
    if (root._readouts?.size > 0) root._readouts.recompute(committedSnapshot())
    root._motionRevision = (root._motionRevision || 0) + 1
    // Notifying a commit: installs are done, the notification fan is open. This
    // guards that fan, not every runtime mutation — a request raised from a
    // notifier must not interleave with it. (id:laws-p0m-publication)
    const wasNotifying = root.notifyingCommit === true
    root.notifyingCommit = true
    try {
        for (const send of notify) send()
    } finally {
        root.notifyingCommit = wasNotifying
    }
    return null
}

// A verdict as publication entries: the writer, then its component members.
const verdictEntries = (writer, verdict) =>
    [{ frame: writer, pose: verdict.pose }, ...verdict.component.map((m) => ({ frame: m.frame, pose: m.pose }))]

function commitTransaction(verdict, writer, registry) {
    return publish(writer, verdictEntries(writer, verdict), registry)
}

// The responder proposes; a separate check decides whether it is publishable.
// This opt-in check is synchronous: no guesses, partial component or async work
// escapes while it runs. A failed check is a broken responder, not impossibility.
function checkMotion(verdict, writer, registry, validate, request) {
    if (verdict.kind !== 'accept') return verdict
    const entries = [{ frame: writer, pose: verdict.pose }, ...verdict.component]
    const seen = new Set()
    for (const { frame, pose } of entries) {
        if (seen.has(frame) || registry.get(frame?.id) !== frame ||
            !Array.isArray(pose.position) || pose.position.length !== 3 ||
            !pose.position.every(Number.isFinite) ||
            !['x', 'y', 'z', 'w'].every(key => Number.isFinite(pose.rotation?.[key]))) {
            return { kind: 'fault', message: 'accepted motion has a duplicate, stale or non-finite pose' }
        }
        seen.add(frame)
    }
    if (validate) {
        try {
            if (validate({ request, writer, entries }) !== true) {
                return { kind: 'fault', message: 'motion responder proposed geometry that fails independent validation' }
            }
        } catch (error) {
            return { kind: 'fault', message: `motion validation failed: ${error.message}` }
        }
    }
    return verdict
}

// The writer has a verdict: apply the transaction, record it, and park so the
// writer's instant owns the pass. (D027 instant law)
const motionBaseChanged = (ctx, request) => request.baseRevision !== undefined &&
    request.baseRevision !== metaRootFrame(ctx)._configurationRevision

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
    for (const id of ids) root._readouts.release(id)
}

// Hard laws outrank requests: does a proposed configuration break an active law?
// ONE validator for every path — birth, revision, program motion, hand motion and
// delayed replies — so no path grows its own legality rule. (id:laws-activation-order)
function lawViolation(activeLaws, overrides, registry) {
    if (!activeLaws || activeLaws.length === 0) return null
    const world = (frame) => worldReading(frame, null, overrides).position
    for (const law of activeLaws) {
        if (law.feature === 'position') {
            const f = registry.get(law.endpoints[0])
            // The predicate was authored in the declaring scope's stable
            // birth/placement frame, never its live head. (id:laws-decl-frame)
            const frame = registry.get(law.frame)
            if (!f || !frame) continue
            const w = world(f)
            const p = SE3.apply(worldTransform(frame), law.predicate)
            if (Math.hypot(w[0] - p[0], w[1] - p[1], w[2] - p[2]) > ACCEPT_TOL) return law
            continue
        }
        if (law.feature !== 'distance') continue
        const a = registry.get(law.endpoints[0])
        const b = registry.get(law.endpoints[1])
        if (!a || !b) continue
        const d = measure("distance", a, b, (f) => worldReading(f, null, overrides))
        if (Math.abs(d - law.predicate) > ACCEPT_TOL) return law
    }
    return null
}

function brokenLaw(overrides, registry, laws) {
    return lawViolation(laws?.active(), overrides, registry)
}

const ownerLabel = (law) => law?.owner?.line != null ? `line ${law.owner.line}` : 'source'

// A located conflict: which two owners disagree, never just "a conflict".
function conflictMessage(violation, candidate) {
    return `the ${violation.feature} at ${ownerLabel(violation)} conflicts with the ${candidate.feature} at ${ownerLabel(candidate)}`
}

// --- Attempt lifetime ---
//
// A failed declaration is an *attempt*: it owns the set of frames it held,
// wherever they live. Proposal and validation return evidence; only the settlement
// boundary below acquires a hold, so no future branch can quietly skip one. An
// edit of any frame the attempt touched releases the whole attempt.
// (id:laws-activation-verdicts)

const heldFrame = (frame) => (frame?.heldAttempts?.size ?? 0) > 0

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
function affectedMembers(registry, laws, seeds, extra = []) {
    const ids = new Set(componentOf(laws, seeds).frames)
    for (const frame of extra) if (frame?.id !== undefined) ids.add(frame.id)
    const frames = []
    for (const id of ids) {
        const frame = registry.get(id)
        if (frame) frames.push(frame)
    }
    return frames
}

// One settlement boundary. Proposal and validation return outcomes and never touch
// a frame; this is the only place that commits or takes a hold. Every outcome kind
// keeps its meaning. (id:laws-activation-order, id:laws-activation-verdicts)
function settleAttempt(ctx, pump, outcome) {
    if (outcome.kind === 'commit') {
        const conflict = publish(ctx, outcome.poses, pump.registry, outcome.install ?? null)
        if (conflict) return woundRelation(ctx, conflict.message, conflict.kind === 'unsupported' ? 'unsupported' : 'relation', outcome.span ?? null)
        if (outcome.head) emitHead(outcome.head.frame, outcome.head.pose)
        for (const h of outcome.heads ?? []) emitHead(h.frame, h.pose)
        return null
    }
    if (outcome.kind === 'contradiction' || outcome.kind === 'obstructed') {
        // A demonstrated impossibility and a policy obstruction both hold the
        // affected component, but they are not the same claim. Stale work cannot
        // restore a hold — the writer must still be this world's writer.
        // (id:laws-activation-verdicts)
        if (pump.registry.get(ctx.id) !== ctx || ctx.done) return { verdict: 'continue', produced: true }
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

// The hand's continuation: keep every untouched coordinate still and move the
// touched endpoint to the nearest admissible position under the active laws.
// Hand-first, conserving untouched points. (id:laws-build-p2d, id:laws-activation-order)
function continueLaws(verdict, writer, registry, laws) {
    if (!laws || verdict.kind !== 'accept') return verdict
    const active = laws.active()
    if (active.length === 0) return verdict
    const poses = new Map([[writer, verdict.pose], ...verdict.component.map((m) => [m.frame, m.pose])])
    const commit = (frame, pose) => {
        poses.set(frame, pose)
        if (frame !== writer && !verdict.component.some((m) => m.frame === frame)) {
            verdict.component.push({ frame, pose })
        }
    }
    for (const law of active) {
        if (law.feature !== 'distance') continue
        // One address has a direction: the observer is the reference, the target
        // is the dependent. Dragging the target projects it (hand-first); dragging
        // the observer moves the target to keep the law (the follower).
        // (id:laws-build-p2d, id:laws-build-p3-slider)
        const target = registry.get(law.endpoints[0])
        const observer = registry.get(law.endpoints[1])
        if (!target || !observer) continue
        const targetMoved = poses.has(target)
        const observerMoved = poses.has(observer)
        if (!targetMoved && !observerMoved) continue
        if (observerMoved && !targetMoved) {
            const oWorld = worldReading(observer, null, poses).position
            const r = realizeDistance(worldReading(target, null, poses).position, oWorld, law.predicate)
            if (!r.ok) continue
            commit(target, { rotation: target.transform.deref().rotation,
                position: SE3.unapply(worldTransform(target), r.pose) })
            continue
        }
        const moved = targetMoved ? target : observer
        const other = moved === target ? observer : target
        const proposed = poses.get(moved)
        const r = realizeDistance(worldReading(moved, null, poses).position,
            worldReading(other, null, null).position, law.predicate)
        if (!r.ok) continue
        poses.set(moved, { rotation: proposed.rotation, position: SE3.unapply(worldTransform(moved), r.pose) })
    }
    verdict.pose = poses.get(writer)
    for (const member of verdict.component) member.pose = poses.get(member.frame)
    return verdict
}

// Is `target` at `worldPos` consistent with every active distance on it?
function conflictAt(target, worldPos, laws, registry) {
    for (const law of laws.active()) {
        if (law.feature !== 'distance') continue
        const a = registry.get(law.endpoints[0])
        const b = registry.get(law.endpoints[1])
        if (!a || !b) continue
        const other = a === target ? b : (b === target ? a : null)
        if (!other) continue
        // One measurement: the proposed target position against the other's live read.
        const d = measure("distance", target, other, (f) => f === target
            ? { position: worldPos }
            : { position: worldReading(f, null, null).position })
        if (Math.abs(d - law.predicate) > ACCEPT_TOL) return law
    }
    return null
}

// The position law that fixes a frame, or null. Its predicate is authored in
// the law's own frame, so the caller must interpret it there. (id:laws-decl-frame)
function pinnedLaw(laws, frameId) {
    for (const law of laws.active()) {
        if (law.feature === 'position' && law.endpoints[0] === frameId) return law
    }
    return null
}

function parkOnVerdict(ctx, verdict, pump, request) {
    if (motionBaseChanged(ctx, request)) verdict = { kind: 'stale' }
    else verdict = checkMotion(verdict, ctx, pump.registry, pump.motionValidate, request)
    // A proposed configuration that breaks an active law is refused, never shown
    // as accepted. (id:laws-activation-order)
    if (verdict.kind === 'accept' && (heldFrame(ctx) || brokenLaw(proposedOverrides(ctx, verdict), pump.registry, pump.laws))) {
        verdict = { kind: 'refuse', ink: pump.execOpts.refusalStroke === 'continue' ? 'continue' : 'break' }
    }
    if (verdict.kind === 'fault') return woundMotion(ctx, verdict.message)
    if (verdict.kind === 'accept' && verdict.component.length > 0) {
        const conflict = commitTransaction(verdict, ctx, pump.registry)
        if (conflict) return woundMotion(ctx, conflict.message)
    }
    openInstant(ctx)
    suspend(ctx, 'admission', { seq: ++ctx.motionSeq, verdict })
    return { verdict: 'parked', produced: true }
}

function motion(ctx, value, _route, pump) {
    if (pump.motionAdmissionAsync) return delayedMotion(ctx, value, pump)

    const request = { command: value.command, from: value.from, requested: value.requested,
        frame: ctx, baseRevision: value.baseRevision }
    let raw
    try {
        raw = pump.motionAdmission ? pump.motionAdmission(request)
            : { accepted: true, transform: value.requested }
    } catch (error) {
        return woundMotion(ctx, `motion responder failed: ${error.message}`)
    }
    if (isThenable(raw)) {
        return woundMotion(ctx, 'motion responder returned a Promise; use motionAdmissionAsync for delayed replies')
    }
    return parkOnVerdict(ctx, interpretReply(raw, pump.execOpts.refusalStroke), pump, request)
}

// Controlled delayed admission: the responder may answer after the writer parks,
// which keeps its instant until the verdict lands. A reply applies only while the
// run that asked is still in the tree. (id:laws-build-solve-seam)
function delayedMotion(ctx, value, pump) {
    const run = ctx.run
    const seq = ++ctx.motionSeq

    const request = { command: value.command, from: value.from, requested: value.requested,
        frame: ctx, baseRevision: value.baseRevision }
    let raw
    try {
        raw = pump.motionAdmissionAsync(request)
    } catch (error) {
        return woundMotion(ctx, `motion responder failed: ${error.message}`)
    }

    // A responder that answers now is applied now; only a thenable parks.
    if (!isThenable(raw)) return parkOnVerdict(ctx, interpretReply(raw, pump.execOpts.refusalStroke), pump, request)

    openInstant(ctx)
    suspend(ctx, 'admission', { seq, verdict: null })

    const stale = () => ctx.done || ctx.run !== run || ctx.suspension?.kind !== 'admission' || ctx.suspension.seq !== seq
    Promise.resolve(raw).then((resolved) => {
        if (stale()) return
        if (isThenable(resolved)) return void woundMotion(ctx, 'delayed motion responder resolved to another Promise')
        // The delayed reply is still a motion path: active laws govern it, exactly
        // as they govern a synchronous reply. (id:laws-activation-order)
        const checked = motionBaseChanged(ctx, request) ? { kind: 'stale' } :
            checkMotion(interpretReply(resolved, pump.execOpts.refusalStroke),
                ctx, pump.registry, pump.motionValidate, request)
        let ruling = checked
        if (ruling.kind === 'accept' && brokenLaw(proposedOverrides(ctx, ruling), pump.registry, pump.laws)) {
            ruling = { kind: 'refuse', ink: pump.execOpts.refusalStroke === 'continue' ? 'continue' : 'break' }
        }
        if (ruling.kind === 'fault') return void woundMotion(ctx, ruling.message)
        if (ruling.kind === 'accept' && ruling.component.length > 0) {
            const conflict = commitTransaction(ruling, ctx, pump.registry)
            if (conflict) return void woundMotion(ctx, conflict.message)
        }
        suspend(ctx, 'admission', { seq, verdict: ruling })
    }, (error) => {
        if (!stale()) woundMotion(ctx, `motion responder failed: ${error.message}`)
    })
    return { verdict: 'parked', produced: true }
}
function shout(ctx, value, route, pump) {
    interceptShout(ctx, value, pump.registry, route.deferredShouts, pump.onShout)
    return { verdict: 'continue', produced: true }
}

// A reached `let` is a being act: a new identity seats at the walk's state, and
// an existing one adopts that state without resetting its body or its laws.
// Synchronous — the executor reads it on its next step. (id:laws-ordered-birth)
function birth(ctx, value, _route, pump) {
    const existing = ctx.children.get(value.name)
    if (existing) {
        // The being adopts the current head's state; identity and body stay.
        // Bind the pose once: express the declaring frame's world in the child's
        // own coordinate frame, so a child born through `as` is not double-counted.
        // The being act is a proposal and may not break an active law.
        // (id:laws-ordered-birth, id:laws-build-p2c, id:laws-decl-frame)
        // The cursor world is the declaring frame's chain times the executor's
        // here; express it once in the child's own frame. (id:laws-decl-frame)
        const here = SE3.compose(worldTransform(ctx), value.origin)
        const next = SE3.compose(SE3.invert(worldTransform(existing)), here)
        const violation = lawViolation(pump.laws.active(), new Map([[existing, next]]), pump.registry)
        const outcome = violation
            ? { kind: 'obstructed', span: value.owner,
                message: conflictMessage(violation, { feature: 'being act', owner: value.owner }),
                members: affectedMembers(pump.registry, pump.laws.active(), violation.endpoints, [existing, ctx]) }
            : { kind: 'commit', poses: [{ frame: existing, pose: next }], span: value.owner }
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
const ENDPOINTS = {
    distance: ({ target, observer }) => [target.id, observer.id],
    position: ({ target }) => [target.id],
}

const PROPOSE = {
    distance({ target, observer, value, laws, registry }) {
        const o = worldReading(observer, observer, null).position
        const pin = pinnedLaw(laws, target.id)
        const pinFrame = pin ? registry.get(pin.frame) : null
        if (pinFrame) {
            const p = SE3.apply(worldTransform(pinFrame), pin.predicate)
            return validateDistance(p, o, value).ok
                ? { ok: true, world: p }
                : { ok: false, reason: 'the pinned position conflicts with the distance', kind: 'obstructed' }
        }
        const r = realizeDistance(worldReading(target, observer, null).position, o, value)
        return r.ok ? { ok: true, world: r.pose } : { ok: false, reason: r.reason }
    },
    position({ target, observer, value, laws, registry }) {
        if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
            return { ok: false, reason: 'a position needs three finite coordinates' }
        }
        // The pin names a point in the declaring frame's stable placement frame,
        // never its live head. (id:laws-decl-frame)
        const world = SE3.apply(worldTransform(observer), value)
        const conflict = conflictAt(target, world, laws, registry)
        return conflict
            ? { ok: false, reason: `the pin conflicts with the ${conflict.feature} at ${ownerLabel(conflict)}`, kind: 'obstructed', conflict }
            : { ok: true, world }
    },
}

const VALIDATE = {
    distance({ target, observer, value, world }) {
        return validateDistance(world, worldReading(observer, observer, null).position, value)
    },
    position({ world }) {
        return Array.isArray(world) && world.every(Number.isFinite)
            ? { ok: true }
            : { ok: false, reason: 'non-finite position' }
    },
}

// Refresh one member's display projection from its accepted pose. The published
// pose is the truth; the head event is how a parked or headed member shows it.
// (id:laws-transaction-d)
function emitHead(member, pose) {
    if (!member.done) return
    const head = {
        type: 'head', position: pose.position, rotation: pose.rotation,
        color: member.actorState?.style?.color,
        headSize: member.actorState?.style?.showTurtle,
    }
    const target = member.targetFrame ? findReferenceFrame(member, member.targetFrame) : null
    putSync(member, target ? projectHead(head, target, relativeTransform(member, target)) : head)
}

// A bounded analytic realization for a connected set of distance laws with one
// held anchor: when moving the designated target alone would break a surviving
// law, realize the whole tree jointly, validate it, and publish it together.
// Outside that case it returns null and the attempt stays a located rejection.
// (id:laws-build-p3, id:laws-build-solve-seam)
function componentCandidate(spec, candidate, pump) {
    const active = [...pump.laws.active().filter((law) => addressOf(law) !== addressOf(candidate)), candidate]
    const comp = componentOf(active, candidate.endpoints)
    if (comp.laws.length < 2) return null
    if (comp.laws.some((law) => law.feature !== 'distance')) return null
    if (!comp.frames.has(spec.observer.id)) return null
    for (const id of comp.frames) {
        if (id === spec.observer.id) continue   // the declaring frame is the held anchor
        const frame = pump.registry.get(id)
        // Only settled, unpinned, unheld frames may be reconfigured.
        if (!frame || !frame.done || heldFrame(frame) || pinnedLaw(pump.laws, id)) return null
    }
    const world = (id) => {
        const frame = pump.registry.get(id)
        return frame ? worldReading(frame, null, null).position : null
    }
    const positions = realizeDistanceTree(comp.laws, spec.observer.id, world, (law) => law.predicate)
    if (!positions) return null
    const poses = []
    const heads = []
    for (const id of comp.frames) {
        if (id === spec.observer.id) continue
        const frame = pump.registry.get(id)
        const target = positions.get(id)
        if (!frame || !target) return null
        const pose = { rotation: frame.transform.deref().rotation, position: SE3.unapply(worldTransform(frame), target) }
        poses.push({ frame, pose })
        heads.push({ frame, pose })
    }
    const overrides = new Map(poses.map(({ frame, pose }) => [frame, pose]))
    if (lawViolation(comp.laws, overrides, pump.registry)) return null
    return { kind: 'commit', poses, install: () => pump.laws.apply(candidate), heads, span: spec.owner }
}

// A proposal returns an outcome; it never mutates a frame's lifetime. The caller
// hands that outcome to the one settlement boundary. (id:laws-activation-order)
function applyLaw(spec, pump) {
    const propose = PROPOSE[spec.feature]
    const validate = VALIDATE[spec.feature]
    if (!propose || !validate) return { kind: 'unsupported', message: `Unsupported law: ${spec.feature}`, span: spec.owner }
    const candidate = bindLaw({
        feature: spec.feature,
        endpoints: ENDPOINTS[spec.feature](spec),
        scope: spec.observer.id,
        frame: spec.observer.id,
        predicate: spec.value,
        owner: spec.owner,
    })
    // The bound domain guard, preserved through lowering: a negative length is a
    // domain error, never permission to drop a positive law. (id:laws-build-p3a)
    if (!predicateOk(candidate.feature, candidate.predicate)) {
        return { kind: 'relation', span: spec.owner,
            message: `a ${candidate.feature} payload must be finite${candidate.guards?.nonNegative ? ' and non-negative' : ''}` }
    }
    const placed = propose({ ...spec, laws: pump.laws, registry: pump.registry })
    if (!placed.ok) {
        if (placed.kind === 'obstructed' || placed.kind === 'contradiction') {
            return { kind: placed.kind, message: placed.reason, span: spec.owner,
                members: affectedMembers(pump.registry,
                    [...pump.laws.active().filter((law) => addressOf(law) !== addressOf(candidate)), candidate],
                    candidate.endpoints, [spec.target, spec.observer]) }
        }
        return { kind: placed.kind ?? 'relation', message: placed.reason, span: spec.owner }
    }
    const check = validate({ ...spec, world: placed.world })
    if (!check.ok) return { kind: check.kind ?? 'relation', message: check.reason, span: spec.owner }

    const local = SE3.unapply(worldTransform(spec.target), placed.world)
    const pose = { rotation: spec.target.transform.deref().rotation, position: local }
    // Validate every surviving predicate, not only the proposed one. A new
    // declaration may not publish a law its geometry violates.
    const surviving = pump.laws.active().filter((law) => addressOf(law) !== addressOf(candidate))
    const violation = lawViolation([...surviving, candidate], new Map([[spec.target, pose]]), pump.registry)
    if (violation) {
        // Two lawful distances can move together: a connected distance tree
        // responds jointly before the candidate is called a failure.
        // (id:laws-build-p3)
        const joint = componentCandidate(spec, candidate, pump)
        if (joint) return joint
        return { kind: 'obstructed', message: conflictMessage(violation, candidate), span: spec.owner,
            members: affectedMembers(pump.registry, [...surviving, candidate], candidate.endpoints,
                [spec.target, spec.observer]) }
    }
    // Laws, owner and accepted geometry commit in one publication, before notify.
    return { kind: 'commit', poses: [{ frame: spec.target, pose }],
        install: () => pump.laws.apply(candidate), heads: [{ frame: spec.target, pose }], span: spec.owner }
}

// A reached law, one form or another: resolve its target, then the one pipeline.
// A scalar declaration: one source-owned derived value bound to its name. A read of
// the name is still a snapshot; the value recomputes at the commit.
// (id:laws-build-p3-readout-built)
function scalarReadout(ctx, value, _route, pump) {
    const id = pump.readouts.register(ctx.id, value.owner ?? value.name, value.read)
    if (!ctx.scalars) ctx.scalars = new Map()
    ctx.scalars.set(value.name, id)
    return { verdict: 'continue', produced: true }
}

function law(ctx, value, _route, pump) {
    const targetName = value.target
    // One binding rule for reads and laws: a name this scope declares but has
    // not reached is a located use-before-introduction, never an outer namesake.
    // (id:laws-ordered-birth)
    if (ctx.declared?.has(targetName) && !ctx.children.has(targetName)) {
        return woundRelation(ctx, `Use before introduction: ${targetName}`, 'relation', value.owner)
    }
    const target = findFrame(ctx, targetName, 'world')
    if (!target || target === ctx) {
        return woundRelation(ctx, `Unknown target: ${targetName}`, 'relation', value.owner)
    }
    const outcome = applyLaw({ feature: value.feature, target, observer: ctx,
        value: value.value, owner: value.owner }, pump)
    return settleAttempt(ctx, pump, outcome) ?? { verdict: 'continue', produced: true }
}

function woundRelation(ctx, message, kind = 'relation', span = null) {
    ctx.observation = null
    ctx.done = true
    ctx.generator = null
    closeInstant(ctx)
    clearSuspension(ctx)
    ctx.error = { message, span, kind }
    ctx.channel.put({ type: 'error', ...ctx.error, ambientId: ctx.id })
    return { verdict: 'ended', produced: true }
}

function spawn(ctx, value, route, pump) {
    // Keep parent transform atom current between head events.
    ctx.transform.swap(() => value.origin)
    const existing = ctx.children.get(value.name)
    const deferredShouts = route.deferredShouts

    if (existing) {
        // A declared place keeps its placement: starting a body there does not
        // move it. An ordinary ambient keeps the origin refresh, so the
        // compositor still tracks the parent's pose. (id:laws-decl-join-repair)
        if (ctx.declared?.has(value.name) !== true) existing.origin = value.origin
        existing._worldDirty = true
        metaRootFrame(existing)._configurationRevision++

        if (existing.done && pump.createDeps) {
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
        return { verdict: 'spawned', spawned: child, produced: true }
    }
    return { verdict: 'continue', produced: true }
}

// Construct, register and wire a place under `ctx`. It does NOT advance the new
// frame: advancement belongs to the caller, so inline spawn ordering is exactly
// what it was. One door builds a place; realization will call it for identities
// the source declares. (id:host-beat)
function seatChild(ctx, value, pump, route, deferredShouts) {
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
    // Register under the name BEFORE wiring: wireChild stamps the
    // address, whose last segment is this children-map key.
    ctx.children.set(value.name, child)
    bumpTree(ctx)
    wireChild(child, deps, mailbox, pump.registry, value.code, batch, relationshipBatch, pump)
    if (deferredShouts) deliverDeferredToFrame(deferredShouts, child)
    return child
}

// Output event — one offered deposit (head pose-swap + run tagging inside).
// (spec id:ft-d7-deposit-runid)
function deposit(ctx, value, route, pump) {
    const { frameTarget, frameTransform } = route
    const refusal = offerDeposit(ctx, value, frameTarget, frameTransform, pump.stock)
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

const EFFECTS = {
    breath, blocked, wait, yield: yieldEffect, shout, spawn, limitMailbox, motion, motionUnresolved, birth, law, scalar: scalarReadout,
}

// Verdict for one yield. Pumps act; this only means. (id:output-ledger-r2-instant)
function stepFrame(ctx, value, done, route, pump) {
    if (done) {
        closeInstant(ctx)
        const result = value || {}
        if (result.actorState) {
            ctx.actorState = result.actorState
            // Lifetime across rewires — rewireChild does not zero this.
            ctx.commandCount += result.actorState.commandCount
        } else {
            ctx.commandCount += (typeof result === 'number' ? result : (result.commandCount || 0))
        }
        reportUnrealizedPlaces(ctx)
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
    const { frameTarget, frameTransform } = route

    // Resume after a suspension: replay an owed deposit first (emission order).
    const sus = ctx.suspension
    if (sus?.owed) {
        const refusal = deliverDeposit(ctx, sus.owed, frameTarget, frameTransform, pump.stock)
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
    if (ctx.batch) ctx.batch.motionProtocol = pump.motionAdmission != null ||
        pump.motionAdmissionAsync != null || pump.laws.count() > 0
    try {
        const input = admission ? admission.verdict : undefined
        if (admission) clearSuspension(ctx)
        ;({ value, done } = ctx.generator.next(input))
    } catch (error) {
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
    let frameTarget = null
    let frameTransform = null
    if (child.targetFrame) {
        frameTarget = findReferenceFrame(child, child.targetFrame)
        if (frameTarget) frameTransform = relativeTransform(child, frameTarget)
    }

    child.inlineAdvancing = true
    clearSpentPark(child)

    // now + deferredShouts ride route — pump stays config. (id:carving-todo-effects-table)
    const route = { frameTarget, frameTransform, now, deferredShouts }

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
    const readouts = createReadouts()

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

    // Shared pump bag for tick/hotSwap/advanceChild. Config only — now rides route.
    // (id:output-ledger-r2-pacer, id:carving-todo-effects-table)
    const pump = {
        createDeps,
        execOpts,
        motionAdmission: opts.motionAdmission || null,
        motionAdmissionAsync: opts.motionAdmissionAsync || null,
        motionValidate: opts.motionValidate || null,
        channelOpts,
        registry,
        laws,
        readouts,
        onShout,
        stock,
        // Inline drain asks too — unpaced hang is real.
        outOfTime: () => deadline !== null && clock() > deadline,
    }

    return {
        root,
        channel: root.channel,   // backward compat — root frame's channel
        registry,
        stock,

        get resumeAt() { return root.resumeAt },
        set resumeAt(v) { root.resumeAt = v },

        done: false,
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
            try { return drive() } finally { deadline = null }
        },

        // Mid-build: last tick let go with work left.
        get building() { return this._building === true },
        // A finished drawing may accept a settled, pen-up hand request without
        // reviving its coroutine. The same responder, check and component commit
        // serve program motion. The caller supplies the last seen motion revision.
        get motionRevision() { return root._motionRevision },
        // The play's active laws (address → predicate, owner). Read-only seam.
        get laws() { return laws },
        // Source-owned derived values (id:laws-build-p3-slider). Read-only seam.
        get readouts() { return readouts },
        requestMotion(frame, requested, revision) {
            if (registry.get(frame?.id) !== frame || frame === root) return { kind: 'stale' }
            // A publication's notifications are on the stack; a request raised from one
            // is refused for retry, never interleaved — the watcher's commit is later
            // (laws-transaction-d), and an outer publication must not overwrite it.
            if (root.notifyingCommit) return { kind: 'busy', message: 'publication in flight' }
            if (!frame.done || subtreeUnsettled(frame)) return { kind: 'busy' }
            // A settled actor may live inside a hosted play. Keep the transaction
            // inside one seating: a sibling's birth frame is not the root's frame.
            if (!frame.parent || frame.isLens || frame.error) return { kind: 'unresolved' }
            // A failed attempt holds its component until an edit releases it.
            if (heldFrame(frame)) return { kind: 'refuse', ink: execOpts.refusalStroke === 'continue' ? 'continue' : 'break' }
            if (revision !== root._motionRevision) return { kind: 'stale' }
            const request = { command: 'hand', from: frame.transform.deref(), requested, frame }

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
            const verdict = checkMotion(interpretReply(raw, execOpts.refusalStroke),
                frame, registry, pump.motionValidate, request)
            if (verdict.kind !== 'accept') return verdict
            // Continue along the active laws: the touched endpoint moves to the
            // nearest admissible position, every other coordinate stays.
            // (id:laws-build-p2d)
            // One candidate producer. An installed responder owns the component it
            // returns; only when none is installed does the built-in continuation
            // policy choose geometry. The two never run in series.
            // (id:laws-build-solve-seam)
            if (!pump.motionAdmission && !pump.motionAdmissionAsync) {
                continueLaws(verdict, frame, registry, laws)
            }
            if (brokenLaw(proposedOverrides(frame, verdict), registry, laws)) {
                return { kind: 'refuse', ink: execOpts.refusalStroke === 'continue' ? 'continue' : 'break' }
            }
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
            const conflict = commitTransaction(verdict, frame, registry)
            if (conflict) return { kind: conflict.kind === 'unsupported' ? 'unresolved' : 'busy', message: conflict.message }
            // A hand never repaints deposited ink. Its head uses the same
            // declaring-frame projection as a program head (id:ft-d5-head).
            for (const { frame: member, pose } of members) {
                if (!member.done) continue
                const head = {
                    type: 'head', position: pose.position, rotation: pose.rotation,
                    color: member.actorState?.style?.color,
                    headSize: member.actorState?.style?.showTurtle,
                }
                const target = targets.get(member)
                putSync(member, target ? projectHead(head, target, relativeTransform(member, target)) : head)
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
                // Leaving the tree frees its share of the stage stock.
                releaseAttemptsFor(root, subtreeIds(existing))
                releaseReadouts(root, subtreeIds(existing))
                visitPostOrder(existing, (c) => { resetInk(c, stock); registry.delete(c.id); laws.retractFrame(c.id) })
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
            releaseAttemptsFor(root, subtreeIds(child))
            releaseReadouts(root, subtreeIds(child))
            visitPostOrder(child, (c) => { resetInk(c, stock); registry.delete(c.id); laws.retractFrame(c.id) })
            root.children.delete(key)
            bumpTree(root)
            this.done = allDone(root)
        },

        get errors() {
            const errs = []
            for (const [id, ctx] of registry) {
                if (ctx.error) errs.push({ ambientId: id, name: ctx.name, address: addrOf(ctx), ...ctx.error })
            }
            return errs
        },

        // Earliest resumeAt only; post-order within an instant. (D011 #3)
        tick(now) {
            this.lastTickTime = now
            if (this.done) return false

            let produced = false

            // The earliest logical instant with a ready frame (resumeAt ≤ now).
            let frontier = Infinity
            visitPostOrder(root, (ctx) => {
                if (!ctx.done && ctx.resumeAt <= now && ctx.resumeAt < frontier) {
                    frontier = ctx.resumeAt
                }
            })
            if (frontier === Infinity) {        // nothing ready at this `now`
                this.done = allDone(root)
                if (this.done) this.commandCount = sumCounts(root)
                return false
            }
            // A new frontier is a new observation baseline for synchronous cycles.
            if (frontier !== root._frontier) { root._frontier = frontier; root._obsEpoch++ }

            // Park mid-instant: stop the pass; resume first next tick. (id:output-ledger-r2-instant)
            let parked = false

            visitPostOrderMotionFirst(root, (ctx) => {
                if (parked || ctx.done || ctx.resumeAt > frontier) return

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
                const route = { frameTarget, frameTransform, now, deferredShouts }

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
            enforceResidency(registry, clock, stock)
            // Let go with work outstanding = the world is still building.
            this._building = parked

            this.done = allDone(root)
            if (this.done) {
                this.commandCount = sumCounts(root)
            }

            return produced
        }
    }
}

// Synthetic root generator for unified scheduler tree.
// Completes immediately — visitPostOrder still walks children.
export function* metaRoot() { return 0 }

export { createFrame, visitPostOrder, terminateAmbient, allDone, worldTransform, frameWorldTransform, findReferenceFrame, resolveBinding }
// frameAddress is exported at its definition (stable cross-re-eval frame key).
