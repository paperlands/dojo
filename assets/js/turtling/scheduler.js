// Scheduler — cooperative tree walker for frame coroutines.
//
// Each Frame wraps an executor generator with its own channel
// (RingBuffer) and transform Atom<SE3>. The scheduler walks the tree
// post-order (children before parents) each tick, advancing each
// ready generator until it yields a wait or exhausts.
//
// Tree relationships are direct references: frame.parent points to the
// parent Frame (null for root), frame.children maps name → child.
// The registry is a flat iteration index for the compositor — it plays
// no role in tree traversal.

import { createFrame } from "./frame.js"
import { execute } from "./executor.js"
import { SE3 } from "./se3.js"

// --- Lens (camera-as-ambient) ---
//
// A Lens is an ambient whose Output codomain is the viewport, not the scene.
// PAPERLANG's Output centre bifurcates: geometry-output (a pen) vs view-output
// (an eye). A Lens carries the same SE(3) body as a turtle — the only
// differences are that its pen is forced up (executor) and its head pose is
// emitted as a `view` event the materializer writes to the camera (here). See
// specs/eye-ambient.org (id:eye-lens-primitive). v1 reserves the name `eye`.
const LENS_NAMES = new Set(["eye"])
export function isLensName(name) {
    return LENS_NAMES.has(name)
}

// A Lens frame's head pose lands on the camera, not in the scene: rewrite its
// `head` events to `view`. Same pose payload (position/rotation), plus the lens
// param `fov` (added in E2 — undefined until then). Non-lens / non-head events
// pass through untouched. (id:eye-output-bifurcation)
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

function sumCounts(ctx) {
    let total = ctx.commandCount || 0
    for (const child of ctx.children.values()) {
        total += sumCounts(child)
    }
    return total
}

// --- Ancestor lookup by user-facing name ---

// Walk up the parent chain to find the nearest ancestor with the given name.
// Used by frame targeting (`as child in parent do`) where `parent` is a name.
function findAncestorByName(ctx, name) {
    const reserved = resolveReserved(ctx, name)
    if (reserved) return reserved

    let ancestor = ctx.parent
    while (ancestor) {
        if (ancestor.name === name) return ancestor
        ancestor = ancestor.parent
    }
    return null
}

// `origin` is the synthetic root — the fixed identity datum at the top of every
// tree. It never moves and never ticks (it runs no commands), so it is the stable
// absolute frame: ink targeted at `origin` lands in absolute world coordinates
// (the root layer renders at identity).
//
// `world`, by contrast, is the observer's OWN top-level program (see resolveReserved):
// a live ambient with a moving transform and a running clock, resolved per-observer
// and tab-local, so sibling tabs never couple through it.
// (spec id:ft-d4-world-root — absolute-frame targeting moved from `world` to `origin`)
const ROOT_NAME = "origin"

// Stable, unique address of a frame across re-eval. Re-eval (hotSwapChild)
// RECREATES frames — a frame's identity (id) does NOT survive it, nor does any
// state stored on the frame. What IS stable is the path from root: the top tab's
// registration KEY (root.children key, the buffer addr — unique per tab) plus the
// chain of names down to the frame. Used to key cross-lifetime state (an eye's
// running view pose) so it persists across re-eval (idempotency) yet never
// collides across sibling tabs that share a reserved name like `eye`.
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

// Compose all ancestor transforms to map local (0,0,0) to world coordinates.
// Root returns identity. Walks direct parent refs — no registry, no cycles.
// Cached on frame._worldCache, invalidated via Atom.watch on ancestor transforms.
// Only uses cache when watches are wired (_worldWatched flag set by wireWorldCacheInvalidation).
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

// Child-local → target-local change of basis, pivoting through world space:
// M = worldTransform(target)⁻¹ ∘ worldTransform(ctx)  ( = unapply_target ∘ apply_ctx ).
// The one shared coordinate mechanism — same pivot as observation/goto. Provably
// a no-op when target = parent; the projection only manifests once the target
// moves independently. (spec id:ft-d1-world-pivot)
function relativeTransform(ctx, target) {
    return SE3.compose(SE3.invert(worldTransform(target)), worldTransform(ctx))
}

// Rewrite an event's coordinates from child-local to target-local, tagging the
// source frame so the target layer can consolidate each depositor's ink into its
// own trail run without corrupting the target's own pen. (spec id:ft-d2-per-source-trails)
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

// Assign a stroke-run id to a path event from the SOURCE frame's own (pre-projection)
// geometry + style. Stable across one continuous pen-down stroke (even when `wait`
// splits it into per-tick events), bumped on a geometric break (jmp / pen-up) or a
// style change; reset on re-exec (via `_strokeEnd = null`). The renderer groups runs
// by this id alone — identical for the source's own pen and for projected ink whose
// re-baked world points would otherwise look discontinuous. (spec id:ft-d7-deposit-runid)
function tagRun(ctx, value) {
    if (value.type !== 'path' || !value.points || !value.points.length) return
    const style = `${value.color}:${value.thickness}`
    const continues = style === ctx._strokeStyle && _samePt(value.points[0], ctx._strokeEnd)
    if (!continues) ctx._strokeRun = (ctx._strokeRun || 0) + 1
    value.runId = ctx._strokeRun
    ctx._strokeEnd = value.points[value.points.length - 1]
    ctx._strokeStyle = style
}

// A frame-targeted child deposits its ink into the target frame, where the moving
// projection continuously re-bakes it (the path keeps deforming as the target moves).
// Its head must ride that SAME projection or it detaches — drifting on its own layer
// while the ink it's "drawing" lives in the target frame. Bake the head's position
// into the target frame (the compositor seats a frame-targeted head's group at the
// target's worldTransform, mirroring where the path is deposited); rotation is left
// alone — materializeHead orients frame-targeted heads by world velocity. Identity
// when not frame-targeted. (spec id:ft-d5-head)
function projectHead(headEvent, frameTarget, frameTransform) {
    if (!frameTarget) return headEvent
    return { ...headEvent, position: SE3.apply(frameTransform, headEvent.position) }
}

// The single output path for both the tick loop and the inline drain. Head events
// update the pose and (for frame-targeted children) ride the deposit projection.
// Geometry is tagged with its stroke-run id, then either baked into the target frame
// (frame targeting) or emitted on the frame's own channel. (spec id:ft-d7-deposit-runid)
function routeOutput(ctx, value, frameTarget, frameTransform) {
    if (value.type === "head") {
        // Local pose drives the executor's own coordinate continuity — keep it local.
        ctx.transform.swap(() => ({ rotation: value.rotation, position: [...value.position] }))
        ctx.channel.put(lensOutput(ctx, projectHead(value, frameTarget, frameTransform)))
        return
    }
    tagRun(ctx, value)
    if (frameTarget) {
        frameTarget.channel.put(transformEvent(value, frameTransform, ctx.id))
    } else {
        ctx.channel.put(lensOutput(ctx, value))
    }
}

// --- Binding resolution: observation + inheritance ---

// Resolve a variable from the ambient tree. Dispatches dotted paths
// (sibling observation) vs unqualified names (ancestor fn inheritance).
// Find a named frame: check siblings first, then walk ancestors.
// Searches by frame.name (display name), not by children map key,
// so cross-ambient references use tab names (e.g., spiral.x).
// The synthetic root: walk to the parentless top of the tree. This is `origin` —
// the fixed identity datum (absolute coordinates, timeless).
function metaRootFrame(frame) {
    let node = frame
    while (node.parent) node = node.parent
    return node
}

// The observer's top-level program: the direct child of the synthetic root on the
// observer's own ancestor chain. This is `world` — a real ambient with a live clock
// and moving transform, scoped to the observer's tab (sibling tabs never couple).
// In production the root is synthetic plumbing, so this lands on the program; if the
// observer IS the root (test harness runs a program as root), it resolves to itself.
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

function findFrame(frame, name) {
    const reserved = resolveReserved(frame, name)
    if (reserved) return reserved

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
    return null
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

// Bounded mailbox push — drops oldest messages when full.
function pushMailbox(frame, msg) {
    frame.mailbox.push(msg)
    while (frame.mailbox.length > frame.maxMailbox) {
        frame.mailbox.shift()
    }
}

// Deliver a single shout to a frame, tracking delivery to prevent duplicates.
// De-dup keys on the frame's ADDRESS (stable across re-eval), not its id —
// a re-eval'd receiver (new frame, same address) is never re-delivered, and a
// shout never returns to its emitter's address even if the emitter was reborn.
// (specs/groundwork.org Phase 1; id fallback for bare createFrame harnesses.)
export function deliverShout(shout, target) {
    const addr = target.address ?? target.id
    const fromAddr = shout.from ? (shout.from.address ?? shout.from.id) : null
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

// --- Cross-ambient observation flag ---
// Wraps resolveBinding so the evaluator records when a dotted (cross-ambient)
// name is read. The executor checks this flag at loop iteration boundaries
// to auto-yield, giving sibling ambients a chance to advance.
function bindResolve(deps, frame) {
    deps.mathEvaluator.resolveExternal = (v, a) => {
        const result = resolveBinding(frame, v, a)
        if (v.includes('.')) deps.mathEvaluator._observedSibling = true
        return result
    }
}

// --- Child generator factory ---

// Creates a child executor from a fork spec (spawn event).
// Fork spec groups: origin + style (spatial), code (ast + functions), env (userspace + loopCounter).
// Returns { generator, deps } so the scheduler can store deps on the frame
// and wire resolveExternal after frame creation.
function createChildGenerator(value, createDeps, execOpts) {
    const childDeps = createDeps()
    if (value.env?.userspace) {
        for (const [k, v] of value.env.userspace) {
            childDeps.mathParser.userspace.set(k, v)
        }
    }
    // Shared mailbox — same array passed to executor AND set on the frame.
    // Scheduler pushes to frame.mailbox; executor reads from state.mailbox.
    const mailbox = []
    return {
        generator: execute(value.code.ast, childDeps, {
            color: value.style?.color || execOpts.color,
            maxRecurseDepth: execOpts.maxRecurseDepth,
            maxRecurses: execOpts.maxRecurses,
            maxCommands: execOpts.maxCommands,
            functions: value.code.functions,
            loopCounter: value.env?.loopCounter,
            scope: value.env?.scope,
            lens: isLensName(value.name),
            mailbox,
        }),
        deps: childDeps,
        mailbox,
    }
}

// --- Scheduler metadata ---

// Attach lifecycle bookkeeping to a frame. These fields are scheduler concerns,
// not part of the Frame primitive contract.
function attachMeta(frame, targetFrame) {
    frame.targetFrame = targetFrame || null
    frame.isLens = isLensName(frame.name)
    // A Lens needs no captured baseline: its camera effect is a pure function of
    // its LIVE world pose, read each frame by the compositor's model-layer reframe
    // (world ← E⁻¹·world). Idempotency is algebraic, not stored. (id:eye-view-pipeline)
    frame.error = null
    frame.commandCount = 0
    frame.elapsedTime = 0
    frame.actorState = null
    frame.maxMailbox = 8192
    return frame
}

// Wire Atom.watch for worldTransform cache invalidation.
// When a child's own transform or any ancestor's transform changes,
// the child's cached worldTransform is invalidated.
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

// Wire a freshly created child frame: attach deps, mailbox, resolve binding,
// world origin, cache invalidation, and register in the flat index.
// Stamps the frame's stable ADDRESS — the one cross-eval identity register
// (shout de-dup, focus, navigation). Requires top-level frames to already sit
// in root.children so frameAddress finds their registration key. The id stays
// per-LIFETIME plumbing: registry/layers/deposit-GC key on it so a re-eval
// (new id) clears the old life's ink while the address keeps its identity.
function wireChild(child, deps, mailbox, registry) {
    child.address = frameAddress(metaRootFrame(child), child)
    child.deps = deps
    child.mailbox = mailbox
    bindResolve(deps, child)
    deps.worldOriginFn = () => worldTransform(child)
    wireWorldCacheInvalidation(child)
    registry.set(child.id, child)
}

// Re-execute a completed child with a fresh fork spec.
// Reuses the existing frame (preserving id, parent, children, origin)
// but replaces the generator, deps, and mailbox.
function rewireChild(child, value, createDeps, execOpts) {
    const re = createChildGenerator(value, createDeps, execOpts)
    child.generator = re.generator
    child.deps = re.deps
    child.mailbox = re.mailbox
    bindResolve(re.deps, child)
    re.deps.worldOriginFn = () => worldTransform(child)
    child.done = false
    child.error = null
    child._strokeEnd = null   // fresh stroke run on re-exec (spec id:ft-d7-deposit-runid)
    child.channel.drain()
    child.channel.put({ type: 'clear' })
}

// --- Inline child drain ---

// Advance a child's generator inline until it hits a wait or completes.
// Called at spawn time so the child's state is observable immediately
// by subsequent parent code (no wait-before-observe needed).
//
// For frame-targeted children, events are projected to the target frame.
// For normal children, events go to the child's own channel.
//
// Uses an explicit stack (trampoline) so deeply nested spawn chains
// don't overflow the JS call stack.
function advanceChild(initialChild, now, createDeps, execOpts, channelCapacity, registry, deferredShouts, onShout) {
    const stack = [initialChild]

    while (stack.length > 0) {
        const child = stack[stack.length - 1]
        const spawned = drainUntilPause(child, now, createDeps, execOpts, channelCapacity, registry, deferredShouts, onShout)
        if (spawned) {
            stack.push(spawned)
        } else {
            child.inlineAdvancing = false
            stack.pop()
        }
    }
}

// Drain a single child's generator until it pauses (wait/done/blocked/error)
// or spawns a new child. Returns the spawned child frame, or null if paused.
function drainUntilPause(child, now, createDeps, execOpts, channelCapacity, registry, deferredShouts, onShout) {
    // Frame-targeted: route non-head events to ancestor frame
    let frameTarget = null
    let frameTransform = null
    if (child.targetFrame) {
        frameTarget = findAncestorByName(child, child.targetFrame)
        if (frameTarget) frameTransform = relativeTransform(child, frameTarget)
    }

    child.inlineAdvancing = true

    while (true) {
        let value, done
        try {
            ({ value, done } = child.generator.next())
        } catch (error) {
            child.done = true
            child.generator = null
            child.error = error.message
            child.channel.put({ type: 'error', message: error.message, ambientId: child.id })
            return null
        }

        if (done) {
            const result = value || {}
            if (result.actorState) {
                child.actorState = result.actorState
                child.commandCount += result.actorState.commandCount
            } else {
                child.commandCount += (typeof result === 'number' ? result : (result.commandCount || 0))
            }
            child.done = true
            child.generator = null
            return null
        }

        if (value.type === "wait") {
            // Anchor to the child's LOGICAL birth (shares parent's grid); a null
            // birth (top-level) falls back to the live `now` — self-correcting
            // across resets/reruns. (Fix A)
            child.resumeAt = (child.resumeAt > 0 ? child.resumeAt : (child.logicalBirth ?? now)) + value.duration
            child.elapsedTime += value.duration / 1000
            if (value.position) {
                child.transform.swap(() => ({
                    rotation: value.rotation,
                    position: [...value.position]
                }))
                child.channel.put(lensOutput(child, projectHead({
                    type: "head",
                    position: value.position,
                    rotation: value.rotation,
                    color: value.color,
                    headSize: value.headSize
                }, frameTarget, frameTransform)))
            }
            return null
        }

        // Cooperative yield: give other frames a turn, no temporal effect.
        if (value.type === "yield") {
            if (value.position) {
                child.transform.swap(() => ({
                    rotation: value.rotation,
                    position: [...value.position]
                }))
            }
            return null
        }

        // Dataflow suspension: child blocked on unresolvable cross-ambient read.
        // Generator is paused at yield point — resumes on next tick via visitPostOrder.
        if (value.type === "blocked") {
            return null
        }

        if (value.type === "limitMailbox") {
            child.maxMailbox = value.limit
            continue
        }

        if (value.type === "shout") {
            // Deliver to self immediately so own when-handlers see it
            pushMailbox(child, { name: value.name, payload: value.payload })
            if (deferredShouts) {
                deferredShouts.push({ from: child, name: value.name, payload: value.payload })
            } else {
                for (const [id, t] of registry) {
                    if (t === child) continue  // already delivered to self
                    pushMailbox(t, { name: value.name, payload: value.payload })
                }
            }
            if (onShout) onShout(child.name, value.name, value.payload)
            continue
        }

        if (value.type === "spawn") {
            child.transform.swap(() => value.origin)
            const nestedExisting = child.children.get(value.name)
            if (nestedExisting) {
                nestedExisting._worldDirty = true
                if (nestedExisting.done && createDeps) {
                    nestedExisting.origin = value.origin
                    rewireChild(nestedExisting, value, createDeps, execOpts)
                    if (deferredShouts) deliverDeferredToFrame(deferredShouts, nestedExisting)
                }
            } else if (createDeps) {
                const { generator: nestedGen, deps: nestedDeps, mailbox: nestedMailbox } = createChildGenerator(value, createDeps, execOpts)
                const nested = attachMeta(
                    createFrame(value.name, nestedGen, {
                        parent: child,
                        origin: value.origin,
                        channelCapacity,
                        // Nested child born on its parent's logical clock. (Fix A)
                        // 0 (parent hasn't waited) → null → live now.
                        logicalBirth: child.resumeAt || null,
                    }),
                    value.frame
                )
                wireChild(nested, nestedDeps, nestedMailbox, registry)
                child.children.set(value.name, nested)
                if (deferredShouts) deliverDeferredToFrame(deferredShouts, nested)
                return nested
            }
            continue
        }

        // Output event — single routed path (head pose-swap + run tagging inside).
        routeOutput(child, value, frameTarget, frameTransform)
    }
}

// --- Scheduler ---

export function createScheduler(generator, opts = {}) {
    const channelCapacity = opts.channelCapacity || 4096
    const createDeps = opts.createDeps || null
    const execOpts = opts.execOpts || {}
    const onShout = opts.onShout || null

    const root = attachMeta(
        createFrame(ROOT_NAME, generator, { channelCapacity }),
        null
    )
    root.address = ROOT_NAME
    // Wire shared mailbox — same array the root executor reads from
    if (opts.rootMailbox) root.mailbox = opts.rootMailbox
    // Wire root observation — root can read children via dotted access
    if (opts.rootDeps) {
        root.deps = opts.rootDeps
        bindResolve(opts.rootDeps, root)
    }
    const registry = new Map([[root.id, root]])

    return {
        root,
        channel: root.channel,   // backward compat — root frame's channel
        registry,

        get resumeAt() { return root.resumeAt },
        set resumeAt(v) { root.resumeAt = v },

        done: false,
        commandCount: 0,
        lastTickTime: 0,

        // Hot-swap a child of root by key: terminate existing (if any),
        // create fresh child from fork spec, advance inline.
        // key = stable identity (buffer ID); forkSpec.name = display name (tab name).
        // Uses lastTickTime so the new child's waits are relative to the
        // current timeline, not time 0 (which would cause fast catch-up).
        hotSwapChild(key, forkSpec) {
            const existing = root.children.get(key)
            if (existing) {
                terminateAmbient(existing)
                visitPostOrder(existing, (c) => registry.delete(c.id))
                root.children.delete(key)
            }

            const displayName = forkSpec.name || key
            const { generator, deps, mailbox } = createChildGenerator(forkSpec, createDeps, execOpts)
            const child = attachMeta(
                createFrame(displayName, generator, {
                    parent: root,
                    origin: forkSpec.origin || SE3.identity(),
                    channelCapacity,
                    // Top-level: logicalBirth stays NULL so the first wait anchors to
                    // the live `now` (= lastTickTime, passed to the inline advanceChild
                    // below). Self-correcting across resets/reruns — no stale freeze.
                }),
                null
            )
            // Register under the key BEFORE wiring: wireChild stamps the frame's
            // address, whose top segment is this registration key.
            root.children.set(key, child)
            wireChild(child, deps, mailbox, registry)

            advanceChild(child, this.lastTickTime, createDeps, execOpts, channelCapacity, registry, [], onShout)
            this.done = false
            return child
        },

        // Remove a child of root by key and clean up its subtree.
        removeChild(key) {
            const child = root.children.get(key)
            if (!child) return
            terminateAmbient(child)
            visitPostOrder(child, (c) => registry.delete(c.id))
            root.children.delete(key)
            this.done = allDone(root)
        },

        get errors() {
            const errs = []
            for (const [id, ctx] of registry) {
                if (ctx.error) errs.push({ ambientId: id, name: ctx.name, message: ctx.error })
            }
            return errs
        },

        // Advance the earliest logical instant. Post-order: children before parents.
        // Returns true if any frame produced events this tick.
        //
        // Decision 011 bullet 3 — logical-`resumeAt`-ordered drain. Rather than
        // advancing EVERY ready frame each tick (round-robin by tree position, which
        // lets a wall-clock `now` jump collapse many logical instants into one pass so
        // a frame reads a logically-LATER frame's state), advance only the frames at
        // the smallest ready `resumeAt` — the earliest logical instant — one step.
        // The compositor's catch-up loop then walks instants in increasing order up to
        // the reveal frontier `now`. A frame never advances ahead of a logically-earlier
        // one, so cross-ambient reads (`leader.heading`) and re-encounter (`existing.done`)
        // tests always observe logically-prior state, regardless of how `now` was sampled.
        // Within one instant, post-order tree position is the deterministic tiebreak and
        // `yield` interleaves same-instant siblings across successive ticks (unchanged).
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

            visitPostOrder(root, (ctx) => {
                if (ctx.done || ctx.resumeAt > frontier) return

                // Shouts from inline-advanced children are deferred until
                // the parent finishes spawning all siblings, so every
                // sibling's mailbox exists at delivery time.
                const deferredShouts = []

                // Cache frame projection for synchronous batches —
                // parent transforms are constant within a tick pass.
                // Recomputed on re-entry after a wait breaks the loop.
                let frameTarget = null
                let frameTransform = null
                if (ctx.targetFrame) {
                    frameTarget = findAncestorByName(ctx, ctx.targetFrame)
                    if (frameTarget) {
                        frameTransform = relativeTransform(ctx, frameTarget)
                    }
                }

                // Cache worldOrigin for this tick — avoids repeated tree walks
                // in executor's callCommand (goto/faceto/jmpto).
                if (ctx.deps?.worldOriginFn) {
                    ctx.deps._cachedWorldOrigin = ctx.deps.worldOriginFn()
                }

                while (!ctx.done) {
                    let value, done
                    try {
                        ({ value, done } = ctx.generator.next())
                    } catch (error) {
                        ctx.done = true
                        ctx.generator = null
                        ctx.error = error.message
                        ctx.channel.put({ type: 'error', message: error.message, ambientId: ctx.id })
                        produced = true
                        break
                    }

                    if (done) {
                        const result = value || {}
                        if (result.actorState) {
                            ctx.actorState = result.actorState
                            ctx.commandCount = result.actorState.commandCount
                        } else {
                            ctx.commandCount += (typeof result === 'number' ? result : (result.commandCount || 0))
                        }
                        ctx.done = true
                        ctx.generator = null
                        break
                    }

                    // --- Directive: blocked (dataflow suspension) ---
                    if (value.type === "blocked") {
                        // Generator paused on unresolvable dependency — retry next tick
                        break
                    }

                    // --- Directive: wait ---
                    if (value.type === "wait") {
                        // Anchor the first wait to the frame's LOGICAL birth (shares
                        // the parent's grid); a null birth (top-level) falls back to
                        // the live `now`, self-correcting across resets. (Fix A)
                        ctx.resumeAt = (ctx.resumeAt > 0 ? ctx.resumeAt : (ctx.logicalBirth ?? now)) + value.duration
                        ctx.elapsedTime += value.duration / 1000
                        if (value.position) {
                            ctx.transform.swap(() => ({
                                rotation: value.rotation,
                                position: [...value.position]
                            }))
                            ctx.channel.put(lensOutput(ctx, projectHead({
                                type: "head",
                                position: value.position,
                                rotation: value.rotation,
                                color: value.color,
                                headSize: value.headSize
                            }, frameTarget, frameTransform)))
                        }
                        produced = true
                        break
                    }

                    // --- Directive: yield (cooperative scheduling) ---
                    if (value.type === "yield") {
                        if (value.position) {
                            ctx.transform.swap(() => ({
                                rotation: value.rotation,
                                position: [...value.position]
                            }))
                        }
                        produced = true
                        break
                    }

                    // --- Directive: limitMailbox ---
                    if (value.type === "limitMailbox") {
                        ctx.maxMailbox = value.limit
                        continue
                    }

                    // --- Directive: shout ---
                    if (value.type === "shout") {
                        // Deliver to self immediately so own when-handlers see it
                        pushMailbox(ctx, { name: value.name, payload: value.payload })
                        // Defer for others — children may not exist yet
                        deferredShouts.push({ from: ctx, name: value.name, payload: value.payload })
                        if (onShout) onShout(ctx.name, value.name, value.payload)
                        produced = true
                        continue
                    }

                    // --- Directive: spawn ---
                    if (value.type === "spawn") {
                        // Keep parent transform atom current between head events
                        ctx.transform.swap(() => value.origin)

                        const existing = ctx.children.get(value.name)

                        if (existing) {
                            // Always update origin to track parent's evolving position.
                            // worldTransform reads origin → compositor repositions the group.
                            existing.origin = value.origin
                            existing._worldDirty = true

                            if (existing.done && createDeps) {
                                rewireChild(existing, value, createDeps, execOpts)
                                deliverDeferredToFrame(deferredShouts, existing)
                                advanceChild(existing, now, createDeps, execOpts, channelCapacity, registry, deferredShouts, onShout)
                                produced = true
                            }
                            // Running and not done → idempotent no-op
                            continue
                        }

                        // First encounter: create child frame
                        if (createDeps) {
                            const { generator: childGen, deps: childDeps, mailbox: childMailbox } = createChildGenerator(value, createDeps, execOpts)
                            const child = attachMeta(
                                createFrame(value.name, childGen, {
                                    parent: ctx,
                                    origin: value.origin,
                                    channelCapacity,
                                    // Child born on the parent's LOGICAL clock (its
                                    // resumeAt at spawn), not wall-clock now. (Fix A)
                                    // 0 (parent hasn't waited) → null → live now.
                                    logicalBirth: ctx.resumeAt || null,
                                }),
                                value.frame
                            )
                            wireChild(child, childDeps, childMailbox, registry)
                            ctx.children.set(value.name, child)

                            deliverDeferredToFrame(deferredShouts, child)
                            advanceChild(child, now, createDeps, execOpts, channelCapacity, registry, deferredShouts, onShout)
                        }
                        produced = true
                        continue
                    }

                    // --- Output: single routed path (head pose-swap + run tagging,
                    // projection / own-channel routing). (spec id:ft-d7-deposit-runid)
                    routeOutput(ctx, value, frameTarget, frameTransform)
                    produced = true
                }

                // Deliver any remaining deferred shouts
                if (deferredShouts.length > 0) {
                    flushDeferredShouts(deferredShouts, registry)
                    produced = true
                }
            })

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

export { createFrame, visitPostOrder, terminateAmbient, allDone, worldTransform, frameWorldTransform, findAncestorByName, resolveBinding }
// frameAddress is exported at its definition (stable cross-re-eval frame key).
