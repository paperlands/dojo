// Scheduler — cooperative tree walker for ambient coroutines.
//
// Each AmbientCtx wraps an executor generator with its own channel
// (RingBuffer) and transform Atom<SE3>. The scheduler walks the tree
// post-order (children before parents) each tick, advancing each
// ready generator until it yields a wait or exhausts.
//
// Tree relationships are direct references: ctx.parent points to the
// parent AmbientCtx (null for root), ctx.children maps name → child.
// The registry is a flat iteration index for the compositor — it plays
// no role in tree traversal.

import { createRingBuffer } from "./ring-buffer.js"
import { execute } from "./executor.js"
import { SE3 } from "./se3.js"
import { createAtom } from "./atom.js"

// --- AmbientCtx: the unified node ---

let _nextId = 0

function createAmbientCtx(name, generator, transform, channelCapacity, parent) {
    return {
        id: ++_nextId,        // unique, opaque — for compositor layer keying
        name,                 // user-facing — for frame targeting and display
        parent: parent || null,
        generator,
        channel: createRingBuffer(channelCapacity || 4096),
        transform: createAtom(transform || SE3.identity()),
        resumeAt: 0,
        done: false,
        error: null,
        commandCount: 0,
        children: new Map(),  // name → AmbientCtx
        frame: null,          // target frame name for `in <frame>` — null = own frame
        actorState: null,     // executor state — captured on completion
    }
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
    let total = ctx.commandCount
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
    let ancestor = ctx.parent
    while (ancestor) {
        chain.unshift(ancestor.transform.deref())
        ancestor = ancestor.parent
    }
    if (chain.length === 0) return SE3.identity()
    return chain.reduce((a, b) => SE3.compose(a, b))
}

// --- Inertial frame targeting ---

// Compose the transform chain from a child ambient up to (and including)
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

// --- Child generator factory ---

function createChildGenerator(value, createDeps, execOpts) {
    const childDeps = createDeps()
    if (value.userspace) {
        for (const [k, v] of value.userspace) {
            childDeps.mathParser.userspace.set(k, v)
        }
    }
    return execute(value.ast, childDeps, {
        color: value.penState?.color || execOpts.color,
        maxRecurseDepth: execOpts.maxRecurseDepth,
        maxRecurses: execOpts.maxRecurses,
        maxCommands: execOpts.maxCommands,
        functions: value.functions,
        loopCounter: value.loopCounter,
    })
}

// --- Synchronous frame stamp ---

// Drain a frame-targeted child's generator inline within the parent's tick.
// Events are projected to the target frame at the parent's current position.
// If a wait is encountered, the child transitions to normal async scheduling.
function stampInline(child, now, createDeps, execOpts, channelCapacity, registry) {
    const target = findAncestorByName(child, child.frame)
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

        if (value.type === "spawn") {
            child.transform.swap(() => value.transform)
            if (!child.children.has(value.name) && createDeps) {
                const nestedGen = createChildGenerator(value, createDeps, execOpts)
                const nested = createAmbientCtx(
                    value.name, nestedGen, SE3.identity(),
                    channelCapacity, child
                )
                nested.frame = value.frame || null
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

    const root = createAmbientCtx('root', generator, SE3.identity(), channelCapacity, null)
    const registry = new Map([[root.id, root]])

    return {
        root,
        channel: root.channel,   // backward compat — root ambient's channel
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

        // Advance all ready ambients. Post-order: children before parents.
        // Returns true if any ambient produced events this tick.
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
                if (ctx.frame) {
                    frameTarget = findAncestorByName(ctx, ctx.frame)
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

                    if (value.type === "wait") {
                        ctx.resumeAt = now + value.duration
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

                    if (value.type === "spawn") {
                        // Keep parent transform atom current between head events
                        ctx.transform.swap(() => value.transform)

                        const existing = ctx.children.get(value.name)

                        if (existing) {
                            // Frame-targeted stamp: re-project at current parent position.
                            // Child completed synchronously (batch) → re-execute inline.
                            if (existing.done && existing.frame && createDeps) {
                                existing.generator = createChildGenerator(value, createDeps, execOpts)
                                existing.done = false
                                existing.error = null
                                stampInline(existing, now, createDeps, execOpts, channelCapacity, registry)
                                produced = true
                            }
                            // Running or non-frame → idempotent no-op
                            continue
                        }

                        // First encounter: create child ambient
                        if (createDeps) {
                            const childGen = createChildGenerator(value, createDeps, execOpts)
                            const child = createAmbientCtx(
                                value.name,
                                childGen,
                                SE3.identity(),
                                channelCapacity,
                                ctx
                            )
                            child.frame = value.frame || null
                            ctx.children.set(value.name, child)
                            registry.set(child.id, child)

                            // Frame-targeted: drain inline for synchronous projection
                            if (child.frame) {
                                stampInline(child, now, createDeps, execOpts, channelCapacity, registry)
                            }
                        }
                        produced = true
                        continue
                    }

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

export { createAmbientCtx, visitPostOrder, terminateAmbient, allDone, worldTransform, findAncestorByName }
