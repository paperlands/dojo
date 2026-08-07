// Cooperative scheduler for frame coroutines — green threads, not OS threads.
// Pump + park: preemptive slice (time) and backpressure (credit/residency) share one park.
// Instant law: no sibling advances past a parked mid-instant. (id:output-ledger-r2-instant)

import { createFrame } from "./frame.js"
import { matchPattern } from "./match.js"
import { execute, createActorState } from "./executor.js"
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

function terminateAmbient(ctx) {
    for (const child of ctx.children.values()) {
        if (!child.done) terminateAmbient(child)
    }
    unwireWorldCache(ctx)
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

// Head rides the same projection as its ink. (id:ft-d5-head)
function projectHead(headEvent, frameTarget, frameTransform) {
    if (!frameTarget) return headEvent
    return { ...headEvent, position: SE3.apply(frameTransform, headEvent.position) }
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

// PARK — two doors, debt answers "does this park owe?" (id:output-ledger-r2-instant)
// Prior: OS parks a thread mid-quantum; resume continues the same instant.
// time/credit/residency are ONE park event; cause only names why.

// Breath = preemption: slice spent, generator stays put, owes nothing.
// Like a timeslice interrupt with no I/O wait — spent next pass start.
export function parkBreath(ctx) {
    if (ctx.park?.cause !== 'time') ctx.park = { cause: 'time', owed: null, since: null }
}

// Owing = blocked on a full queue / full stage. Deposit held and replayed FIRST
// so emission order survives (credit-based flow control + park). Fresh deposit only;
// stepOnce reparks a standing debt in place.
export function parkOwing(ctx, cause, deposit) {
    ctx.park = { cause, owed: deposit, since: null }
}

// Breath dies at pass start; a debt outlives the pass that made it.
function clearSpentPark(ctx) {
    if (ctx.park && ctx.park.owed === null) ctx.park = null
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
//   'near'   siblings, then ancestors — a reader's lexical neighbourhood.
//   'world'  anywhere in the tree. A FRAME OF REFERENCE need not be kin: any
//            frame can be one, so an ancestors-only walk made `as b a do`
//            silently draw in b's own frame whenever a was a sibling.
//
// Nearest wins before the wide search, so locality still decides between two
// frames of the same name.
function findFrame(frame, name, reach = 'near') {
    const reserved = resolveReserved(frame, name)
    if (reserved) return reserved

    // Own children come first for a frame of reference: nearest means nearest by
    // TREE DISTANCE, so kin outrank a stranger's frame of the same name — names
    // collide across tabs, and the wide search below is only ordered by walk.
    if (reach === 'world') {
        for (const child of frame.children.values()) {
            if (child.name === name) return child
        }
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

// Resolve a name against the ambient tree — unified for 0-arity (variables) and n-arity (functions).
// Called from evaluator's resolveContext (args=undefined) and applyFunction (args=[...]).
function resolveBinding(frame, name, args) {
    if (name.includes('.')) {
        // Dotted: target.property or target.fn[args]
        const dot = name.indexOf('.')
        const targetName = name.slice(0, dot)
        const property = name.slice(dot + 1)

        const target = findFrame(frame, targetName)
        if (!target) {
            if (frame.inlineAdvancing) {
                // Dataflow suspension: dependency may arrive later
                const err = new Error(`Blocked on assistant: ${targetName}`)
                err.blocked = true
                throw err
            }
            throw new Error(`Undefined assistant: ${targetName}`)
        }

        return resolveProperty(target, property, args, frame)
    } else {
        // Unqualified: walk ancestor chain for fn binding
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

function headingFromQuaternion(q) {
    return Math.atan2(
        2 * (q.w * q.y - q.x * q.z),
        1 - 2 * (q.y * q.y + q.z * q.z)
    ) * (180 / Math.PI)
}

// World-space transform: compose ancestor origins with local transform.
// Gives the frame's position/rotation in the global coordinate system.
function frameWorldTransform(frame) {
    const world = worldTransform(frame)
    const local = frame.transform.deref()
    return SE3.compose(world, local)
}

// Spatial properties — world-space projections of a frame's transform.
// Cross-ambient reads see global coordinates, not local ones.
const SPATIAL = {
    x: (t) => roundVec(t.position[0]),
    y: (t) => roundVec(t.position[1]),
    z: (t) => roundVec(t.position[2]),
    heading: (t) => roundVec(headingFromQuaternion(t.rotation)),
}

// Temporal properties — absolute projections of a frame's lifecycle state.
const TEMPORAL = {
    time:     (frame) => roundVec(frame.elapsedTime || 0),
    done:     (frame) => frame.done ? 1 : 0,
    commands: (frame) => frame.commandCount,
}

// Relational properties — computed from observer + target in world space.
const RELATIONAL = {
    distance: (target, observer) => {
        const tp = frameWorldTransform(target).position
        const op = frameWorldTransform(observer).position
        const dx = tp[0] - op[0], dy = tp[1] - op[1], dz = tp[2] - op[2]
        return roundVec(Math.sqrt(dx * dx + dy * dy + dz * dz))
    },
    bearing: (target, observer) => {
        const tp = frameWorldTransform(target).position
        const ow = frameWorldTransform(observer)
        const op = ow.position
        const dx = tp[0] - op[0], dy = tp[1] - op[1]
        const toTarget = Math.atan2(dx, dy) * (180 / Math.PI)
        const myHeading = headingFromQuaternion(ow.rotation)
        return roundVec(toTarget - myHeading)
    },
    sync: (target, observer) => {
        const dt = (target.elapsedTime || 0) - (observer.elapsedTime || 0)
        return roundVec(Math.max(0, dt))
    },
}

// Resolve a property on a target frame — spatial, temporal, relational, or fn.
function resolveProperty(target, property, args, observer) {
    if (!args && SPATIAL[property]) {
        return SPATIAL[property](frameWorldTransform(target))
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
    deps.mathEvaluator.resolveExternal = (v, a) => {
        const result = resolveBinding(frame, v, a)
        if (v.includes('.')) deps.mathEvaluator._observedSibling = true
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
        functions: value.code.functions,
        loopCounter: value.env?.loopCounter,
        scope: value.env?.scope,
        lens: isLensName(value.name),
        mailbox,
    }
    // The batch's state is BORN HERE, not on the generator's first next(), so a
    // frame can be asked what it has done while it is still doing it (commandsOf).
    const batch = createActorState(opts)
    return {
        generator: execute(value.code.ast, childDeps, { ...opts, actorState: batch }),
        deps: childDeps,
        mailbox,
        batch,
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
    frame.park = null
    frame.error = null
    frame.sync = {}
    frame.run = ++RUNS
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
    frame.actorState = null
    frame.maxMailbox = 8192
    frame.seed = null
    // Run state, but wireRun is a beat away; hold a safe value until it lands.
    frame.batch = null        // the running batch's state; null when nothing runs
    frame.listensFor = null   // null = deliver everything (unknown tree)
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
    if (child.parent) {
        child.parent.transform.unwatch(`child:${child.id}`)
    }
}

// --- Shared child wiring ---

// What a fresh generator needs to be driven. ONE place, because both births use
// it — first (wireChild) and re-run (rewireChild) — and a field wired in only
// one of them is a bug that shows up a whole run later.
function wireRun(child, deps, mailbox, batch, code) {
    child.deps = deps
    child.mailbox = mailbox
    child.batch = batch
    bindResolve(deps, child)
    deps.worldOriginFn = () => worldTransform(child)
    setListensFor(child, code)
}

// Wire child: run wiring, plus the things that belong to its place in the tree.
// Frame must already be in the tree — the address reads its parent chain.
function wireChild(child, deps, mailbox, registry, code, batch = null) {
    child.address = frameAddress(metaRootFrame(child), child)
    wireRun(child, deps, mailbox, batch, code)
    wireWorldCacheInvalidation(child)
    registry.set(child.id, child)
}

// Fresh fork on an existing frame (keep id/tree/origin/address).
function rewireChild(child, value, pump) {
    const re = createChildGenerator(value, pump.createDeps, pump.execOpts)
    child.generator = re.generator
    child.done = false
    wireRun(child, re.deps, re.mailbox, re.batch, value.code)
    resetRunState(child, pump.stock)      // ink per RUN; park/sync/error never ride the new one
    // A NEW RUN IS A NEW CLOCK, anchored where a first birth would be (D011).
    // The old run's resumeAt lies in the past, so every wait of the new run
    // would already be over: a half-second animation replayed in one tick.
    child.resumeAt = 0
    child.logicalBirth = child.parent ? (child.parent.resumeAt || null) : null
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
            if (child.park) {
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

function blocked() {
    // Cross-ambient read not ready — sleep, retry next tick (not a mid-instant park).
    return { verdict: 'paused' }
}

function wait(ctx, value, route) {
    // Logical sleep: first wait anchors to logicalBirth, not wall clock (D011).
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
    if (value.position) {
        ctx.transform.swap(() => ({
            rotation: value.rotation,
            position: [...value.position]
        }))
    }
    return { verdict: 'paused', produced: true }
}

function limitMailbox(ctx, value) {
    ctx.maxMailbox = value.limit
    return { verdict: 'continue' }
}

function shout(ctx, value, route, pump) {
    interceptShout(ctx, value, pump.registry, route.deferredShouts, pump.onShout)
    return { verdict: 'continue', produced: true }
}

function spawn(ctx, value, route, pump) {
    // Keep parent transform atom current between head events.
    ctx.transform.swap(() => value.origin)
    const existing = ctx.children.get(value.name)
    const deferredShouts = route.deferredShouts

    if (existing) {
        // Always update origin so the compositor tracks the parent's pose;
        // worldTransform reads origin → group repositions.
        existing.origin = value.origin
        existing._worldDirty = true

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
        const { generator: childGen, deps: childDeps, mailbox: childMailbox,
                batch: childBatch } =
            createChildGenerator(value, pump.createDeps, pump.execOpts)
        const child = attachMeta(
            createFrame(value.name, childGen, {
                parent: ctx,
                origin: value.origin,
                ...pump.channelOpts,
                // Born on the parent's logical clock, not now — see frame.js. (Fix A)
                // 0 (parent hasn't waited) → null → live now.
                logicalBirth: ctx.resumeAt || null,
            }),
            value.frame,
            pump.stock
        )
        // Register under the name BEFORE wiring: wireChild stamps the
        // address, whose last segment is this children-map key.
        ctx.children.set(value.name, child)
        bumpTree(ctx)
        wireChild(child, childDeps, childMailbox, pump.registry, value.code, childBatch)
        if (deferredShouts) deliverDeferredToFrame(deferredShouts, child)
        return { verdict: 'spawned', spawned: child, produced: true }
    }
    return { verdict: 'continue', produced: true }
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

const EFFECTS = {
    breath, blocked, wait, yield: yieldEffect, shout, spawn, limitMailbox,
}

// Verdict for one yield. Pumps act; this only means. (id:output-ledger-r2-instant)
function stepFrame(ctx, value, done, route, pump) {
    if (done) {
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

    // Resume after park: replay owed deposit first (preserve emission order).
    if (ctx.park?.owed) {
        const refusal = deliverDeposit(ctx, ctx.park.owed, frameTarget, frameTransform, pump.stock)
        if (refusal) {
            // Debt stays; only cause may change (credit→residency resets stall clock).
            if (ctx.park.cause !== refusal) {
                ctx.park.cause = refusal
                ctx.park.since = null
            }
            return { verdict: 'parked' }
        }
        ctx.park = null
        return { verdict: 'continue', produced: true }
    }

    let value, done
    try {
        ({ value, done } = ctx.generator.next())
    } catch (error) {
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
    const execOpts = opts.execOpts || {}
    const onShout = opts.onShout || null

    // Null = unpaced. (id:output-ledger-r2-pacer)
    let deadline = null
    const clock = opts.clock || (() => performance.now())

    // One stage stock for the whole tree. (id:carving-todo-ledger-stock)
    const stock = createStock()

    const root = attachMeta(
        createFrame(ROOT_NAME, generator, channelOpts),
        null,
        stock
    )
    root.address = ROOT_NAME
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
        channelOpts,
        registry,
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

        // Same seed → skip; name may update in place. (id:cmp-become-seed)
        hotSwapChild(key, forkSpec, { fresh = false } = {}) {
            const existing = root.children.get(key)
            if (existing && !fresh && sameSeed(existing.seed, forkSpec)) {
                const heldName = forkSpec.name || key
                // A rename is a resolution change even though the tree's shape held.
                if (existing.name !== heldName) { existing.name = heldName; bumpTree(root) }
                return existing
            }
            if (existing) {
                terminateAmbient(existing)
                // Leaving the tree frees its share of the stage stock.
                visitPostOrder(existing, (c) => { resetInk(c, stock); registry.delete(c.id) })
                root.children.delete(key)
                bumpTree(root)
            }

            const displayName = forkSpec.name || key
            const { generator, deps, mailbox, batch } = createChildGenerator(forkSpec, createDeps, execOpts)
            const child = attachMeta(
                createFrame(displayName, generator, {
                    parent: root,
                    origin: forkSpec.origin || SE3.identity(),
                    ...channelOpts,
                    // null birth → first wait anchors to live now (D011).
                }),
                null,
                stock
            )
            // Register under the key BEFORE wiring: wireChild stamps the frame's
            // address, whose top segment is this registration key.
            root.children.set(key, child)
            bumpTree(root)
            wireChild(child, deps, mailbox, registry, forkSpec.code, batch)
            child.seed = seedOf(forkSpec)

            advanceChild(child, this.lastTickTime, pump, [])
            this.done = false
            return child
        },

        // Remove a child of root by key and clean up its subtree.
        removeChild(key) {
            const child = root.children.get(key)
            if (!child) return
            terminateAmbient(child)
            visitPostOrder(child, (c) => { resetInk(c, stock); registry.delete(c.id) })
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

            // Park mid-instant: stop the pass; resume first next tick. (id:output-ledger-r2-instant)
            let parked = false

            visitPostOrder(root, (ctx) => {
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

                if (ctx.deps?.worldOriginFn) {
                    ctx.deps._cachedWorldOrigin = ctx.deps.worldOriginFn()
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
