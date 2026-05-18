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

                while (!ctx.done) {
                    let value, done
                    try {
                        ({ value, done } = ctx.generator.next())
                    } catch (error) {
                        ctx.done = true
                        ctx.error = error.message
                        ctx.channel.put({ type: 'error', message: error.message, ambientId: ctx.id })
                        produced = true
                        break
                    }

                    if (done) {
                        ctx.done = true
                        ctx.commandCount = value || 0
                        // Channel stays open — frame-targeted descendants may
                        // still imprint events here after this ambient finishes.
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

                        // Frame-targeted spawns are sketches — each invocation
                        // draws independently at the target frame. No idempotency.
                        // Non-frame spawns are actors — fully idempotent by name.
                        // Once created, subsequent spawns are no-ops.
                        let childName = value.name
                        if (value.frame) {
                            let suffix = 0
                            while (ctx.children.has(childName)) {
                                childName = `${value.name}#${++suffix}`
                            }
                        } else {
                            if (ctx.children.has(value.name)) {
                                produced = true
                                continue
                            }
                        }

                        if (createDeps) {
                            const childDeps = createDeps()
                            if (value.userspace) {
                                for (const [k, v] of value.userspace) {
                                    childDeps.mathParser.userspace.set(k, v)
                                }
                            }
                            const childGen = execute(value.ast, childDeps, {
                                color: value.penState?.color || execOpts.color,
                                maxRecurseDepth: execOpts.maxRecurseDepth,
                                maxRecurses: execOpts.maxRecurses,
                                maxCommands: execOpts.maxCommands,
                                functions: value.functions,
                                loopCounter: value.loopCounter
                            })
                            const child = createAmbientCtx(
                                childName,
                                childGen,
                                SE3.identity(),
                                channelCapacity,
                                ctx               // direct parent reference
                            )
                            child.frame = value.frame || null
                            if (value.frame) child.spawnOrigin = value.transform
                            ctx.children.set(childName, child)
                            registry.set(child.id, child)
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

                    // Frame targeting: route events to named ancestor frame
                    // Sketches use spawn-time origin (frozen at creation);
                    // fallback to live relativeTransform for nested actors.
                    if (ctx.frame) {
                        if (value.type === "head") {
                            ctx.channel.put(value)
                        } else {
                            const target = findAncestorByName(ctx, ctx.frame)
                            if (target) {
                                const t = ctx.spawnOrigin || relativeTransform(ctx, target)
                                target.channel.put(transformEvent(value, t))
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

export { createAmbientCtx, visitPostOrder, terminateAmbient, allDone, worldTransform, findAncestorByName }
