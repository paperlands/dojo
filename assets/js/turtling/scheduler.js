// Scheduler — cooperative tree walker for ambient coroutines.
// Phase 5b: tree of AmbientCtx nodes, post-order walk per tick.
//
// Each AmbientCtx wraps an executor generator with its own channel
// (RingBuffer) and transform Atom<SE3>. The scheduler walks the tree
// post-order (children before parents) each tick, advancing each
// ready generator until it yields a wait or exhausts.
//
// Transform atoms are updated from head events — this enables
// worldTransform composition for inertial frame rendering.
//
// Spawn events from the executor create child ambients. Structured
// concurrency: when a parent completes, children continue naturally.

import { createRingBuffer } from "./ring-buffer.js"
import { execute } from "./executor.js"
import { SE3 } from "./se3.js"
import { createAtom } from "./atom.js"

// --- AmbientCtx: the unified node ---

function createAmbientCtx(id, generator, transform, channelCapacity, parentId) {
    return {
        id,
        parentId: parentId || null,
        generator,
        channel: createRingBuffer(channelCapacity || 4096),
        transform: createAtom(transform || SE3.identity()),
        resumeAt: 0,
        done: false,
        commandCount: 0,
        children: new Map(),
        frame: null       // target frame name for `in <frame>` — null = own frame
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

// --- World transform: inertial frame composition ---

// Compute the world origin for an ambient by composing all ancestor transforms.
// Returns the SE3 that maps this ambient's local (0,0,0) to world coordinates.
// Root returns identity (root draws in world coords).
function worldTransform(ctx, registry) {
    if (!ctx.parentId) return SE3.identity()

    const chain = []
    let id = ctx.parentId
    while (id) {
        const parent = registry.get(id)
        if (!parent) break
        chain.unshift(parent.transform.deref())
        id = parent.parentId
    }
    if (chain.length === 0) return SE3.identity()
    return chain.reduce((a, b) => SE3.compose(a, b))
}

// --- Inertial frame targeting ---

// Compose the transform chain from a child ambient up to (and including)
// the target frame. Maps child-local coordinates into target-local coords.
// E.g. for `as stick in cycle do`, composes epicycle.t ∘ cycle.t so that
// stick-local points land in cycle's coordinate space.
function relativeTransform(ctx, targetId, registry) {
    const chain = []
    let id = ctx.parentId
    while (id) {
        const ancestor = registry.get(id)
        if (!ancestor) break
        chain.unshift(ancestor.transform.deref())
        if (id === targetId) break
        id = ancestor.parentId
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

// --- Scheduler ---

export function createScheduler(generator, opts = {}) {
    const channelCapacity = opts.channelCapacity || 4096
    const createDeps = opts.createDeps || null
    const execOpts = opts.execOpts || {}

    const root = createAmbientCtx('root', generator, SE3.identity(), channelCapacity, null)
    const registry = new Map([['root', root]])

    return {
        root,
        channel: root.channel,   // backward compat — root ambient's channel
        registry,

        get resumeAt() { return root.resumeAt },
        set resumeAt(v) { root.resumeAt = v },

        done: false,
        commandCount: 0,

        // Advance all ready ambients. Post-order: children before parents.
        // Returns true if any ambient produced events this tick.
        tick(now) {
            if (this.done) return false

            let produced = false

            visitPostOrder(root, (ctx) => {
                if (ctx.done || ctx.resumeAt > now) return

                while (!ctx.done) {
                    const { value, done } = ctx.generator.next()

                    if (done) {
                        ctx.done = true
                        ctx.commandCount = value || 0
                        // Channel stays open — frame-targeted descendants may
                        // still imprint events here after this ambient finishes.
                        // terminateAmbient closes channels on crash/abort.
                        break
                    }

                    if (value.type === "wait") {
                        ctx.resumeAt = now + value.duration
                        if (value.position) {
                            // Update transform atom from wait position
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
                        // Update parent transform from spawn snapshot — keeps
                        // the atom current between head events so child ambients
                        // spawned later get a valid worldTransform immediately.
                        ctx.transform.swap(() => value.transform)

                        // Idempotent spawn: if child with this name is still
                        // running, skip. Makes `as name do` inside loops
                        // spawn-once. Completed children can be re-spawned.
                        const existing = ctx.children.get(value.name)
                        if (existing && !existing.done) {
                            produced = true
                            continue
                        }

                        if (createDeps) {
                            const childDeps = createDeps()
                            const childGen = execute(value.ast, childDeps, {
                                color: value.penState?.color || execOpts.color,
                                maxRecurseDepth: execOpts.maxRecurseDepth,
                                maxRecurses: execOpts.maxRecurses,
                                maxCommands: execOpts.maxCommands
                            })
                            const child = createAmbientCtx(
                                value.name,
                                childGen,
                                SE3.identity(),   // child draws in local coords
                                channelCapacity,
                                ctx.id            // parentId for worldTransform chain
                            )
                            child.frame = value.frame || null
                            // Carry undrained events from completed predecessor —
                            // without this, ambients that complete without a wait
                            // lose their channel contents when re-spawned in the
                            // same tick (drain hasn't run yet).
                            if (existing && existing.channel.length > 0) {
                                const orphaned = existing.channel.drain()
                                for (const event of orphaned) {
                                    child.channel.put(event)
                                }
                            }
                            ctx.children.set(value.name, child)
                            registry.set(value.name, child)
                        }
                        // spawn events are consumed by scheduler, not channeled
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

                    // Frame targeting: route events to named ancestor frame
                    if (ctx.frame) {
                        if (value.type === "head") {
                            // Head stays in own channel — compositor renders it
                            // at this ambient's worldTransform position
                            ctx.channel.put(value)
                        } else {
                            const target = registry.get(ctx.frame)
                            if (target) {
                                const rel = relativeTransform(ctx, ctx.frame, registry)
                                target.channel.put(transformEvent(value, rel))
                            }
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

export { createAmbientCtx, visitPostOrder, terminateAmbient, allDone, worldTransform }
