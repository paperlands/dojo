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
    let ancestor = ctx.parent
    while (ancestor) {
        if (ancestor.name === name) return ancestor
        ancestor = ancestor.parent
    }
    return null
}

// --- World transform: inertial frame composition ---

// Compose all ancestor transforms to map local (0,0,0) to world coordinates.
// Root returns identity. Walks direct parent refs — no registry, no cycles.
function worldTransform(ctx) {
    const chain = []
    let current = ctx
    while (current.parent) {
        // Use this child's birth origin (parent's transform at spawn time)
        // so siblings each keep their own inherited position/orientation.
        chain.unshift(current.origin || current.parent.transform.deref())
        current = current.parent
    }
    if (chain.length === 0) return SE3.identity()
    return chain.reduce((a, b) => SE3.compose(a, b))
}

// Group transform: the correct transform for positioning a child's THREE.Group.
// Frame-targeted children use relativeTransform (live parent atoms, matching
// their path projection). Normal children use worldTransform (birth origin,
// preserving sibling isolation).
function groupTransform(ctx) {
    if (ctx.targetFrame) {
        const target = findAncestorByName(ctx, ctx.targetFrame)
        if (target) return relativeTransform(ctx, target)
    }
    return worldTransform(ctx)
}

// --- Inertial frame targeting ---

// Compose the transform chain from a child frame up to (and including)
// the target ancestor. Maps child-local coordinates into target-local coords.
function relativeTransform(ctx, target) {
    const chain = []
    let ancestor = ctx.parent
    while (ancestor) {
        chain.unshift(ancestor.transform.deref())
        if (ancestor === target) break
        ancestor = ancestor.parent
    }
    if (chain.length === 0) return SE3.identity()
    return chain.reduce((a, b) => SE3.compose(a, b))
}

// Rewrite an event's coordinates from child-local to target-local.
function transformEvent(event, t) {
    switch (event.type) {
        case 'path':
            return { ...event, points: event.points.map(p => SE3.apply(t, p)) }
        case 'label':
            return { ...event, position: SE3.apply(t, event.position) }
        case 'grid':
            return { ...event, position: SE3.apply(t, event.position), rotation: t.rotation }
        default:
            return event
    }
}

// --- Binding resolution: observation + inheritance ---

// Resolve a variable from the ambient tree. Dispatches dotted paths
// (sibling observation) vs unqualified names (ancestor fn inheritance).
// Find a named frame: check siblings first, then walk ancestors.
function findFrame(frame, name) {
    // Siblings (parent's children, or own children if root)
    const parent = frame.parent || frame
    const sibling = parent.children.get(name)
    if (sibling) return sibling

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
        if (!target) throw new Error(`Undefined ambient: ${targetName}`)

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

// Spatial properties — absolute projections of a frame's transform atom.
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

// Relational properties — computed from observer + target.
const RELATIONAL = {
    distance: (target, observer) => {
        const tp = target.transform.deref().position
        const op = observer.transform.deref().position
        const dx = tp[0] - op[0], dy = tp[1] - op[1], dz = tp[2] - op[2]
        return roundVec(Math.sqrt(dx * dx + dy * dy + dz * dz))
    },
    bearing: (target, observer) => {
        const tp = target.transform.deref().position
        const op = observer.transform.deref().position
        const ot = observer.transform.deref()
        const dx = tp[0] - op[0], dy = tp[1] - op[1]
        const toTarget = Math.atan2(dx, dy) * (180 / Math.PI)
        const myHeading = headingFromQuaternion(ot.rotation)
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
        return SPATIAL[property](target.transform.deref())
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

    throw new Error(`Undefined property: ${property} on ambient ${target.name}`)
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
    frame.error = null
    frame.commandCount = 0
    frame.elapsedTime = 0
    frame.actorState = null
    return frame
}

// --- Synchronous frame stamp ---

// Drain a frame-targeted child's generator inline within the parent's tick.
// Events are projected to the target frame at the parent's current position.
// If a wait is encountered, the child transitions to normal async scheduling.
function stampInline(child, now, createDeps, execOpts, channelCapacity, registry) {
    const target = findAncestorByName(child, child.targetFrame)
    if (!target) return
    const t = relativeTransform(child, target)

    while (true) {
        let value, done
        try {
            ({ value, done } = child.generator.next())
        } catch (error) {
            child.done = true
            child.generator = null
            child.error = error.message
            child.channel.put({ type: 'error', message: error.message, ambientId: child.id })
            return
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
            return
        }

        if (value.type === "wait") {
            child.resumeAt = now + value.duration
            child.elapsedTime += value.duration / 1000
            if (value.position) {
                child.transform.swap(() => ({
                    rotation: value.rotation,
                    position: [...value.position]
                }))
                child.channel.put({
                    type: "head",
                    position: value.position,
                    rotation: value.rotation,
                    color: value.color,
                    headSize: value.headSize
                })
            }
            return
        }

        if (value.type === "shout") {
            for (const [id, target] of registry) {
                if (target === child) continue
                target.mailbox.push({ name: value.name, payload: value.payload })
            }
            continue
        }

        if (value.type === "spawn") {
            child.transform.swap(() => value.origin)
            const nestedExisting = child.children.get(value.name)
            if (nestedExisting) {
                if (nestedExisting.done && createDeps) {
                    nestedExisting.origin = value.origin
                    const re = createChildGenerator(value, createDeps, execOpts)
                    nestedExisting.generator = re.generator
                    nestedExisting.deps = re.deps
                    nestedExisting.mailbox = re.mailbox
                    re.deps.mathEvaluator.resolveExternal = (v, a) => resolveBinding(nestedExisting, v, a)
                    nestedExisting.done = false
                    nestedExisting.error = null
                    nestedExisting.channel.drain()
                    nestedExisting.channel.put({ type: 'clear' })
                }
            } else if (createDeps) {
                const { generator: nestedGen, deps: nestedDeps, mailbox: nestedMailbox } = createChildGenerator(value, createDeps, execOpts)
                const nested = attachMeta(
                    createFrame(value.name, nestedGen, {
                        parent: child,
                        origin: value.origin,
                        channelCapacity
                    }),
                    value.frame
                )
                nested.deps = nestedDeps
                nested.mailbox = nestedMailbox
                nestedDeps.mathEvaluator.resolveExternal = (v, a) => resolveBinding(nested, v, a)
                child.children.set(value.name, nested)
                registry.set(nested.id, nested)
            }
            continue
        }

        if (value.type === "head") {
            child.transform.swap(() => ({
                rotation: value.rotation,
                position: [...value.position]
            }))
            child.channel.put(value)
        } else {
            target.channel.put(transformEvent(value, t))
        }
    }
}

// --- Scheduler ---

export function createScheduler(generator, opts = {}) {
    const channelCapacity = opts.channelCapacity || 4096
    const createDeps = opts.createDeps || null
    const execOpts = opts.execOpts || {}

    const root = attachMeta(
        createFrame('root', generator, { channelCapacity }),
        null
    )
    // Wire root observation — root can read children via dotted access
    if (opts.rootDeps) {
        root.deps = opts.rootDeps
        opts.rootDeps.mathEvaluator.resolveExternal = (v, a) => resolveBinding(root, v, a)
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

        get errors() {
            const errs = []
            for (const [id, ctx] of registry) {
                if (ctx.error) errs.push({ ambientId: id, name: ctx.name, message: ctx.error })
            }
            return errs
        },

        // Advance all ready frames. Post-order: children before parents.
        // Returns true if any frame produced events this tick.
        tick(now) {
            if (this.done) return false

            let produced = false

            visitPostOrder(root, (ctx) => {
                if (ctx.done || ctx.resumeAt > now) return

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

                    // --- Directive: wait ---
                    if (value.type === "wait") {
                        ctx.resumeAt = now + value.duration
                        ctx.elapsedTime += value.duration / 1000
                        if (value.position) {
                            ctx.transform.swap(() => ({
                                rotation: value.rotation,
                                position: [...value.position]
                            }))
                            ctx.channel.put({
                                type: "head",
                                position: value.position,
                                rotation: value.rotation,
                                color: value.color,
                                headSize: value.headSize
                            })
                        }
                        produced = true
                        break
                    }

                    // --- Directive: shout ---
                    if (value.type === "shout") {
                        // Global broadcast: deposit into every other ambient's mailbox
                        for (const [id, target] of registry) {
                            if (target === ctx) continue  // don't shout to self
                            target.mailbox.push({ name: value.name, payload: value.payload })
                        }
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

                            if (existing.done && createDeps) {
                                // Re-execute completed child with fresh fork spec.
                                const re = createChildGenerator(value, createDeps, execOpts)
                                existing.generator = re.generator
                                existing.deps = re.deps
                                existing.mailbox = re.mailbox
                                re.deps.mathEvaluator.resolveExternal = (v, a) => resolveBinding(existing, v, a)
                                existing.done = false
                                existing.error = null
                                if (existing.targetFrame) {
                                    // Frame-targeted: re-stamp inline into ancestor
                                    stampInline(existing, now, createDeps, execOpts, channelCapacity, registry)
                                } else {
                                    // Non-frame: clear old output, child advances next tick
                                    existing.channel.drain()
                                    existing.channel.put({ type: 'clear' })
                                }
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
                                    channelCapacity
                                }),
                                value.frame
                            )
                            child.deps = childDeps
                            child.mailbox = childMailbox
                            childDeps.mathEvaluator.resolveExternal = (v, a) => resolveBinding(child, v, a)
                            ctx.children.set(value.name, child)
                            registry.set(child.id, child)

                            // Frame-targeted: drain inline for synchronous projection
                            if (child.targetFrame) {
                                stampInline(child, now, createDeps, execOpts, channelCapacity, registry)
                            }
                        }
                        produced = true
                        continue
                    }

                    // --- Output: all other events pass through to channel ---

                    // Intercept head events to update transform atom
                    if (value.type === "head") {
                        ctx.transform.swap(() => ({
                            rotation: value.rotation,
                            position: [...value.position]
                        }))
                    }

                    // Frame targeting: route events to ancestor frame
                    // using cached projection (constant within a tick pass).
                    if (frameTarget) {
                        if (value.type === "head") {
                            ctx.channel.put(value)
                        } else {
                            const transformed = transformEvent(value, frameTransform)
                            frameTarget.channel.put(transformed)
                        }
                    } else {
                        ctx.channel.put(value)
                    }
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

export { createFrame, visitPostOrder, terminateAmbient, allDone, worldTransform, groupTransform, findAncestorByName, resolveBinding }
