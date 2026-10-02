// Source-owned derived values: fresh scalar dependencies, deferred keyed builds, observational preflight.
// Refusal cannot publish; replacement/release govern lifetime. Geometry acceptance stays in the law pipeline.
// (id:tower-laws-readout-outcomes, id:laws-figure-composition-equality)

import { kindOf } from "../mafs/tower.js"

// Kind is part of the value (D051): equal components of different kinds are different
// values. An untagged array reads as a vector, so a copy that forgot its tag degrades
// to a vector rather than becoming a lie. (id:notation-coordinate-vector)
const same = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b)) {
        return kindOf(a) === kindOf(b) && a.length === b.length && a.every((v, i) => same(v, b[i]))
    }
    return Object.is(a, b)
}

const isKeyed = (spec) => typeof spec === "function" ? false : (spec != null && typeof spec === "object" && typeof spec.capture === "function" && typeof spec.build === "function")

// A definition stands on itself: no order can compute it, and no fixed point is chosen
// here. One error for the whole store, so every boundary throws the same refusal.
const cycleError = () => {
    const error = new Error("a definition stands on itself — its answer depends on its own value")
    error.cycle = true
    return error
}

export function createReadouts() {
    const nodes = new Map()        // node id -> node record
    const bySource = new Map()     // source -> Map(key -> node id)
    const watchers = new Set()
    // Source-lifetime subscribers: a figure binding learns that its run ended,
    // not merely that its ambient died. (id:laws-living-figures-review-next)
    const releaseWatchers = new Set()
    // frame -> the node ids that PRODUCE it (a derived place's driver). The store does
    // not interpret why: it uses the association only to close the dependency graph.
    const producers = new Map()
    let seq = 0
    let recomputes = 0
    let drains = 0
    let builds = 0
    // One evaluation at a time. `epoch` marks a node computed for it; `active` is the
    // evaluation in progress — `path` is the compute stack, `changed` what to announce,
    // `cycle` the entities found standing on themselves, `probe` the root edges of a
    // dependency probe, `collect` whether failures are NOTHING (a commit) or a wound.
    let epoch = 0
    let active = null
    let anyRefused = false        // a refusal flag stands somewhere; skip the recovery sweep otherwise
    let structureGen = 0          // bumped when the producer map changes (a derived place's driver)
    let prevStructureGen = -1
    let prevSize = -1
    let cachedCycle = null        // the last SCC result and closure, reused while topology holds
    let cachedInvalid = null

    // Every watcher is invited before any failure is re-raised: one throwing
    // subscriber must not silence its siblings or leave a commit half-announced.
    // A change is announced WITH the opaque datum its owner registered it under. The
    // store owns the node; the subscriber owns what the node's value MEANS — so the
    // meaning rides the node instead of living in a parallel table keyed by its id.
    const announce = (change) => {
        const drives = nodes.get(change.id)?.drives
        const event = drives ? { ...change, drives } : change
        const failures = []
        for (const fn of [...watchers]) {
            try { fn(event) } catch (error) { failures.push(error) }
        }
        return failures
    }

    const raise = (failures) => {
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'readout subscribers failed')
    }

    // Reads belong to the computing node or the preflight root, never to a second edge table.
    // (id:laws-dependency-driven-place)
    const reading = () => active && (active.path.length
        ? nodes.get(active.path[active.path.length - 1]) : active.probe)

    // A fresh, empty evaluation. `collect:false` — a read between publications computes
    // on demand, where a failed compute is a WOUND and a cycle is a WOUND.
    const evaluation = () => ({ snapshot: undefined, changed: [], path: [], stack: new Set(), cycle: new Set(), collect: false })

    // Evaluate one scalar node on demand, so it is computed AFTER everything it reads.
    // (id:laws-dependency-driven-place)
    const ensureScalar = (node) => {
        if (node.computedEpoch === epoch) return
        // A preflight restores the cache and references it touched. (id:laws-dependency-driven-place)
        if (active.saved && !active.saved.has(node)) {
            active.saved.set(node, { value: node.value, computedEpoch: node.computedEpoch,
                deps: node.deps, frames: node.frames })
        }
        node.deps = new Set()
        node.frames = new Set()
        active.path.push(node.id)
        active.stack.add(node.id)
        let value
        try { value = node.compute(active.snapshot) }
        catch (error) { if (!active.collect) throw error }
        finally { active.path.pop(); active.stack.delete(node.id) }
        // At a commit failure is nothing; on demand it throws before touching the cache.
        // (id:eval-relational)
        const previous = node.value
        node.computedEpoch = epoch
        node.value = value
        if (!same(previous, value)) active.changed.push({ id: node.id, source: node.source, value })
    }

    // One edge view: a node reads nodes/frames; a frame depends on its producers. The
    // search advances a frame in place, so no per-node cursor object is allocated.
    // (id:laws-priors-ir, id:tower-laws-readout-outcomes)
    const empty = new Set()
    const done = { done: true, value: undefined }
    const nextEdge = (frame) => {
        while (true) {
            if (frame.it === null) {
                if (frame.phase === 0) { frame.it = frame.s0.values(); frame.phase = 1 }
                else if (frame.phase === 1 && frame.s1 !== null) { frame.it = frame.s1.values(); frame.phase = 2 }
                else return done
            }
            const step = frame.it.next()
            if (!step.done) return step
            frame.it = null
        }
    }

    // Every member of every cycle, by strongly-connected component: a loop with a tail
    // must not hide its other members behind one back edge. (id:tower-laws-cycle-contracts)
    const findCycles = (ctx) => {
        const index = new Map(), low = new Map(), onStack = new Set(), scc = []
        let counter = 0
        // One explicit frame per unfinished node: a deep graph must not overflow the
        // call stack. (id:tower-laws-cycle-contracts)
        const open = (v, call) => {
            index.set(v, counter); low.set(v, counter); counter++
            scc.push(v); onStack.add(v)
            const node = nodes.get(v)
            call.push({ v, self: false, phase: 0, it: null,
                s0: node ? node.deps : (producers.get(v) ?? empty), s1: node ? node.frames : null })
        }
        for (const id of nodes.keys()) {
            if (index.has(id)) continue
            const call = []
            open(id, call)
            while (call.length) {
                const frame = call[call.length - 1]
                const { value: w, done } = nextEdge(frame)
                if (!done) {
                    if (w === frame.v) frame.self = true
                    if (!index.has(w)) open(w, call)
                    else if (onStack.has(w)) low.set(frame.v, Math.min(low.get(frame.v), index.get(w)))
                    continue
                }
                call.pop()
                if (low.get(frame.v) === index.get(frame.v)) {
                    const component = []
                    let x
                    do { x = scc.pop(); onStack.delete(x); component.push(x) } while (x !== frame.v)
                    if (component.length > 1 || frame.self) {
                        for (const entity of component) ctx.cycle.add(entity)
                    }
                }
                if (call.length) {
                    const parent = call[call.length - 1]
                    low.set(parent.v, Math.min(low.get(parent.v), low.get(frame.v)))
                }
            }
        }
    }

    // A refused node answers NOTHING and is announced on the transition; everything that
    // reads it is refused too, so invalidity never leaks downstream. Recovery is the
    // reverse transition, recomputed each publication. (id:tower-laws-cycle-contracts)
    // The invalidity closure: every numeric cycle member and everything reading one,
    // transitively. Built from the readers index only when a cycle exists.
    // (id:tower-laws-cycle-contracts)
    const closureOf = (ctx) => {
        const invalid = new Set()
        if (ctx.cycle.size === 0) return invalid
        const readers = new Map()
        for (const node of nodes.values()) {
            for (const dep of node.deps ?? []) {
                let set = readers.get(dep)
                if (!set) { set = new Set(); readers.set(dep, set) }
                set.add(node.id)
            }
        }
        const queue = []
        for (const entity of ctx.cycle) if (typeof entity === "number") { invalid.add(entity); queue.push(entity) }
        while (queue.length) {
            for (const reader of readers.get(queue.pop()) ?? []) {
                if (!invalid.has(reader)) { invalid.add(reader); queue.push(reader) }
            }
        }
        return invalid
    }

    // Did the edge structure move since the last discovery? Compared exactly, node by
    // node, so a value change that re-routes a read still counts. (id:tower-laws-cycle-contracts)
    const topologyMoved = () => {
        if (nodes.size !== prevSize || structureGen !== prevStructureGen) return true
        for (const node of nodes.values()) {
            const pd = node.prevDeps, pf = node.prevFrames
            if (pd === null || pd.size !== node.deps.size || pf.size !== node.frames.size) return true
            for (const dep of node.deps) if (!pd.has(dep)) return true
            for (const dep of node.frames) if (!pf.has(dep)) return true
        }
        return false
    }

    // `invalid` is meaningful state, not duplicated presence: refusal cancelled work here, and
    // recovery restores it only when the node leaves invalidity — a cancelled keyed answer is
    // re-requested (its unchanged question would otherwise read as settled). (id:laws-figure-composition-equality)
    const recover = (node) => {
        if (node.cycled) node.cycled = false
        if (!node.invalid) return
        node.invalid = false
        if (node.build && node.hasRequested && !node.pending && node.value === undefined) node.pending = true
    }

    // A refused node answers NOTHING and is announced on the transition; everything that
    // reads it is refused too, so invalidity never leaks downstream. Recovery is the
    // reverse transition. (id:tower-laws-cycle-contracts)
    const settleValidity = (ctx, invalid) => {
        // Nothing stands on itself: no node is invalid, so only a stale refusal flag must
        // be cleared (recovery). (id:tower-laws-cycle-contracts)
        if (ctx.cycle.size === 0) {
            if (anyRefused) {
                for (const node of nodes.values()) recover(node)
                anyRefused = false
            }
            return
        }
        // Filter tentative changes once; only valid answers may reach subscribers.
        // (id:tower-laws-readout-outcomes)
        ctx.changed = ctx.changed.filter((change) => !invalid.has(change.id))
        for (const node of nodes.values()) {
            if (!invalid.has(node.id)) { recover(node); continue }
            node.invalid = true
            anyRefused = true
            const had = node.value !== undefined
            node.value = undefined
            if (node.build) node.pending = false
            const cyclic = ctx.cycle.has(node.id)
            if (cyclic && !node.cycled) {
                ctx.changed.push({ id: node.id, source: node.source, value: undefined, cycle: true })
            } else if (!cyclic && had) {
                ctx.changed.push({ id: node.id, source: node.source, value: undefined })
            }
            node.cycled = cyclic
        }
    }

    // Forget a node and every frame it was the producer of.
    const clearProduces = (node) => {
        if (node.produces?.size) structureGen++
        for (const frame of node.produces ?? []) {
            const set = producers.get(frame)
            if (set) { set.delete(node.id); if (set.size === 0) producers.delete(frame) }
        }
        node.produces = new Set()
    }
    const dropNode = (id) => {
        const node = nodes.get(id)
        if (node) clearProduces(node)
        nodes.delete(id)
    }

    // Does `compute` (transitively) stand on `frame`? The scheduler asks this BEFORE
    // committing a definition, so a refusal is atomic. The probe records the edges a
    // read discovers — resolved references, never a spelling. (id:laws-dependency-driven-place)
    const dependsOnFrame = (compute, frame) => {
        const probe = { snapshot: undefined, changed: [], path: [], stack: new Set(), cycle: new Set(), collect: true,
            probe: { deps: new Set(), frames: new Set() }, saved: new Map() }
        const outer = active
        active = probe
        try {
            try { compute() } catch { /* an unready read proves nothing; let the caller commit */ }
            const seen = new Set()
            const reachable = (start) => {
                const work = [start]
                while (work.length) {
                    const entity = work.pop()
                    if (entity === frame) return true
                    if (seen.has(entity)) continue
                    seen.add(entity)
                    const node = nodes.get(entity)
                    if (node) {
                        for (const dep of node.deps) work.push(dep)
                        for (const dep of node.frames) work.push(dep)
                    } else {
                        const set = producers.get(entity)
                        if (set) for (const dep of set) work.push(dep)
                    }
                }
                return false
            }
            return [...probe.probe.deps, ...probe.probe.frames].some(reachable)
        } finally {
            // Preflight is observational, even if the graph walk fails.
            // (id:tower-laws-readout-outcomes)
            active = outer
            for (const [node, state] of probe.saved) Object.assign(node, state)
        }
    }

    return {
        // One derived value per (source, site). A loop re-reaching the same
        // statement updates the node; it does not multiply subscriptions.
        // `spec` is either a pure function (scalar kind) or { capture, build }. `drives`
        // is the registrant's own datum, relayed back on every announced change.
        register(source, key, spec, drives = null) {
            let keys = bySource.get(source)
            if (!keys) { keys = new Map(); bySource.set(source, keys) }
            const owned = keys.get(key)
            if (owned !== undefined) {
                const node = nodes.get(owned)
                // A replaced computation makes the cache stale, and its producer
                // association is gone with it: the new definition stands where it does,
                // not where the old one did. (id:laws-build-p3-readout-built, id:laws-ordered-replacement)
                if (node) { clearProduces(node); resetNode(node, spec); node.drives = drives }
                return owned
            }
            const id = ++seq
            nodes.set(id, makeNode(id, source, key, spec, drives))
            keys.set(key, id)
            return id
        },

        // The resolver reports a frame it RESOLVED while a node computes: a derived
        // value's frame dependency is a reference, never a spelling. A no-op outside
        // a compute; at a probe root it is the probe's own edge.
        // (id:laws-dependency-driven-place)
        readsink(frame) {
            reading()?.frames.add(frame)
        },

        // A node PRODUCES a frame (a derived place's output): the frame depends on it.
        // The scheduler states the fact; the store only closes the graph with it.
        produces(id, frame) {
            const node = nodes.get(id)
            if (!node) return
            node.produces.add(frame)
            let set = producers.get(frame)
            if (!set) { set = new Set(); producers.set(frame, set) }
            set.add(id)
            structureGen++
        },

        // Would replacing a definition with `compute` make it stand on `frame`? The
        // scheduler asks before it commits, so a refusal preserves what came before.
        // (id:laws-dependency-driven-place)
        dependsOnFrame,

        // The source is gone (rewire, removal, fresh play): every node it owned goes.
        release(source) {
            const keys = bySource.get(source)
            if (!keys) return false
            for (const id of keys.values()) dropNode(id)
            bySource.delete(source)
            for (const fn of [...releaseWatchers]) {
                try { fn(source) } catch { /* a release never throws */ }
            }
            return true
        },

        // One node retires when its site replaces a live law with a fixed one: the
        // retired driver loses the right to publish. A refused replacement never
        // reaches here, so it keeps the old accepted driver. (id:laws-ordered-replacement)
        retire(source, key) {
            const keys = bySource.get(source)
            if (!keys) return false
            const id = keys.get(key)
            if (id === undefined) return false
            keys.delete(key)
            dropNode(id)
            return true
        },

        // The opaque datum a site registered under, read back so an OWNER can compare
        // its own meaning across a replacement. The store hands it back uninterpreted.
        // (id:laws-ordered-replacement)
        drivesOf(source, key) {
            const id = bySource.get(source)?.get(key)
            return id === undefined ? undefined : nodes.get(id)?.drives
        },
        drivesForSource(source) {
            const keys = bySource.get(source)
            if (!keys) return []
            const out = []
            for (const id of keys.values()) {
                const drives = nodes.get(id)?.drives
                if (drives) out.push(drives)
            }
            return out
        },

        // Bulk release carries the same per-source lifetime meaning as release:
        // capture the sources before clearing, then notify once each.
        releaseAll() {
            const sources = [...bySource.keys()]
            nodes.clear()
            producers.clear()
            bySource.clear()
            for (const source of sources) {
                for (const fn of [...releaseWatchers]) {
                    try { fn(source) } catch { /* a release never throws */ }
                }
            }
        },

        // One publication. Every keyed question is captured FIRST, so a scalar that
        // reads a keyed answer sees the new question's state; then every scalar is
        // computed in dependency order (a read of a node is answered by its fresh
        // value); then the graph is checked for a definition standing on itself.
        // (id:tower-laws-cycle-contracts)
        recompute(snapshot) {
            recomputes++
            epoch++
            const ctx = { snapshot, changed: [], path: [], stack: new Set(), cycle: new Set(), collect: true }
            const outer = active
            active = ctx
            try {
                for (const node of nodes.values()) {
                    if (!node.build) continue
                    node.deps = new Set()
                    node.frames = new Set()
                    ctx.path.push(node.id)
                    ctx.stack.add(node.id)
                    captureQuestion(node, snapshot, ctx.changed)
                    ctx.path.pop()
                    ctx.stack.delete(node.id)
                }
                for (const node of nodes.values()) {
                    if (node.build) continue
                    ensureScalar(node)
                }
                let invalid
                if (topologyMoved()) {
                    findCycles(ctx)
                    invalid = closureOf(ctx)
                    cachedCycle = ctx.cycle
                    cachedInvalid = invalid
                } else {
                    ctx.cycle = cachedCycle
                    invalid = cachedInvalid
                }
                settleValidity(ctx, invalid)
                prevSize = nodes.size
                prevStructureGen = structureGen
                for (const node of nodes.values()) { node.prevDeps = node.deps; node.prevFrames = node.frames }
            } finally {
                active = outer
            }
            const failures = []
            for (const change of ctx.changed) failures.push(...announce(change))
            raise(failures)
            return ctx.changed
        },

        // Build every pending answer outside the publication boundary, then settle
        // it only while its owner and its question remain current. A refused node
        // never builds. (id:laws-figure-composition)
        drain() {
            drains++
            const changed = []
            for (const node of [...nodes.values()]) {
                if (!node.build || !node.pending || node.cycled) continue
                const question = node.requested
                let value, refused = false
                try {
                    builds++
                    value = node.build(question)
                    if (value === undefined) refused = true
                } catch (error) {
                    refused = true
                    value = undefined
                    node.failure = error
                }
                // Obsolete: the source retracted, or a later capture replaced the
                // question this answer was for.
                if (nodes.get(node.id) !== node || !node.pending || !same(node.requested, question)) continue
                settle(node, question, value, refused, changed)
            }
            const failures = []
            for (const change of changed) failures.push(...announce(change))
            raise(failures)
            return changed
        },

        // A read between commits computes on demand, so `let s = A.x` is usable
        // the moment it is declared. Inside a publication it computes in dependency
        // order. A keyed node answers only with a settled, current value.
        value(id) {
            const node = nodes.get(id)
            if (!node) return undefined
            // This read is an edge from the reader — the node computing above it, or the
            // probe root. Record it BEFORE any cycle short-circuit, so a back edge is in
            // the graph the cycle search walks.
            reading()?.deps.add(node.id)
            // A read of a node currently computing is a definition standing on itself.
            if (active && active.stack.has(node.id)) {
                active.cycle.add(node.id)
                if (!active.collect) throw cycleError()
                return undefined
            }
            if (node.build) {
                if (node.pending) return undefined
                return node.value
            }
            if (node.computedEpoch !== epoch) {
                const outer = active
                if (!outer) active = evaluation()
                try { ensureScalar(node) } finally { if (!outer) active = null }
            }
            return node.value
        },


        stats() { return { size: nodes.size, recomputes, drains, builds } },
        list() {
            return [...nodes.values()].map((n) => ({
                id: n.id, keyed: !!n.build, hasValue: n.value !== undefined,
                pending: !!n.pending, hasRequested: !!n.hasRequested,
                question: n.requested ?? null,
                failure: n.failure ? String(n.failure.message ?? n.failure) : null,
            }))
        },

        watch(fn) {
            watchers.add(fn)
            return () => watchers.delete(fn)
        },

        // Subscribe to a source's release (rewire, removal, fresh play).
        onRelease(fn) {
            releaseWatchers.add(fn)
            return () => releaseWatchers.delete(fn)
        },

        get size() {
            return nodes.size
        },
    }
}

// --- node lifecycle ----------------------------------------------------------

function makeNode(id, source, key, spec, drives = null) {
    return resetNode({ id, source, key, drives, produces: new Set() }, spec)
}

function resetNode(node, spec) {
    if (isKeyed(spec)) {
        node.compute = undefined
        node.capture = spec.capture
        node.build = spec.build
        // A replaced definition invalidates its memo: the same question no longer
        // authorizes reuse of the old answer. (id:laws-figure-composition-equality)
        node.hasRequested = false
        node.requested = undefined
        // A caller that already ran the question at registration seeds it, so the
        // first capture compares rather than always looking new. (id:laws-figure-eidos-cell)
        if (spec.seed !== undefined) { node.hasRequested = true; node.requested = spec.seed }
        node.pending = false
        node.refused = false
        node.failure = undefined
    } else {
        node.compute = spec
        node.capture = undefined
        node.build = undefined
        node.pending = false
    }
    node.value = undefined
    // A replacement makes the node's place in the graph unknown again: recompute it.
    node.deps = new Set()
    node.frames = new Set()
    node.prevDeps = null
    node.prevFrames = null
    node.computedEpoch = -1
    node.cycled = false
    node.invalid = false
    return node
}

function captureQuestion(node, snapshot, changed) {
    let question, captured = true
    try {
        question = node.capture(snapshot)
    } catch {
        captured = false
    }
    // The live question is unchanged: settled means nothing to do, pending means
    // already queued. Either way no build is authorized by this commit.
    if (captured && node.hasRequested && same(node.requested, question)) return
    node.hasRequested = true
    node.requested = captured ? question : undefined
    node.pending = true
    // Tell observers the question moved and the standing answer is now *previous*.
    changed.push({
        id: node.id, source: node.source,
        question: node.requested, pending: true, refused: node.refused,
        value: node.value, previous: node.value,
    })
}

function settle(node, question, value, refused, changed) {
    const previous = node.value
    const wasRefused = node.refused
    node.pending = false
    node.refused = refused
    // A refused answer never wears the preceding value as current. (id:laws-figure-composition-equality)
    node.value = refused ? undefined : value

    // Propagation is decided by the ANSWER, not the question: a different question with
    // an equal answer announces nothing; a refusal or a recovery always announces.
    // (id:laws-figure-composition-equality)
    if (wasRefused === refused && same(previous, value)) return

    changed.push({
        id: node.id,
        source: node.source,
        question,
        pending: false,
        refused,
        value: refused ? undefined : value,
        previous,
        wasRefused,
        failure: refused ? node.failure : undefined,
    })
}
