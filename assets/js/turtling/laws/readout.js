// Source-owned derived values, recomputed from one committed configuration.
// (id:laws-build-p3-slider, id:cmp-green-tree, id:eval-relational)
//
// No reactive runtime and no command replay. A derived node is a pure function of
// the accepted snapshot; it is recomputed once at the publication boundary, and only
// a *changed* value is announced — equality of the derived value, not dirtiness of
// the source, decides propagation. The source site owns the node's lifetime, so an
// edit cannot multiply subscriptions: re-registering the same source replaces it.
//
// A node has two kinds. The *scalar* kind computes its value directly at the commit.
// The *keyed* kind separates the cheap question from the expensive answer: `capture`
// reads only the named inputs (the question), `build` turns them into the answer.
// The question is captured inside publication; the answer is built outside it, in
// `drain`, so construction never runs inside a commit. (id:laws-figure-eidos-cell,
// id:laws-figure-composition)
//
// Two distinct equalities, and one right:
//   - same question  -> skip the build;
//   - same answer    -> skip propagation, even when the questions differed;
//   - a source's life -> the right to publish at all. Equality never confers it.
// A question is settled with its outcome atomically: a refused question never
// wears the preceding answer as current. (id:laws-figure-composition-equality)

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

export function createReadouts() {
    const nodes = new Map()        // node id -> node record
    const bySource = new Map()     // source -> Map(key -> node id)
    const watchers = new Set()
    // Source-lifetime subscribers: a figure binding learns that its run ended,
    // not merely that its ambient died. (id:laws-living-figures-review-next)
    const releaseWatchers = new Set()
    let seq = 0
    let recomputes = 0
    let drains = 0
    let builds = 0

    // Every watcher is invited before any failure is re-raised: one throwing
    // subscriber must not silence its siblings or leave a commit half-announced.
    // A change is announced WITH the opaque datum its owner registered it under. The
    // store owns the node; the subscriber owns what the node's value MEANS — so the
    // meaning rides the node instead of living in a parallel table keyed by its id.
    // (id:notation-coordinate-vector, id:laws-dependency-driven-place)
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

    return {
        // One derived value per (source, site). A loop re-reaching the same
        // statement updates the node; it does not multiply subscriptions.
        // `spec` is either a pure function (scalar kind) or { capture, build }.
        // `spec` is either a pure function (scalar kind) or { capture, build }. `drives`
        // is the registrant's own datum, relayed back on every announced change.
        register(source, key, spec, drives = null) {
            let keys = bySource.get(source)
            if (!keys) { keys = new Map(); bySource.set(source, keys) }
            const owned = keys.get(key)
            if (owned !== undefined) {
                const node = nodes.get(owned)
                // A replaced computation makes the cache stale: the value was not
                // computed by this function. Nothing is announced here — the next
                // commit recomputes and announces. The WHOLE definition is replaced,
                // meaning included: a new computation must not wear the previous
                // purpose or display effect. (id:laws-build-p3-readout-built, id:laws-ordered-replacement)
                if (node) { resetNode(node, spec); node.drives = drives }
                return owned
            }
            const id = ++seq
            nodes.set(id, makeNode(id, source, key, spec, drives))
            keys.set(key, id)
            return id
        },

        // The source is gone (rewire, removal, fresh play): every node it owned goes.
        release(source) {
            const keys = bySource.get(source)
            if (!keys) return false
            for (const id of keys.values()) nodes.delete(id)
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
            nodes.delete(id)
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
            bySource.clear()
            for (const source of sources) {
                for (const fn of [...releaseWatchers]) {
                    try { fn(source) } catch { /* a release never throws */ }
                }
            }
        },

        // Capture every scalar value and every keyed *question* from the accepted
        // snapshot. A scalar recomputes its value here; a keyed node only records
        // the question and marks work pending — construction is not a commit.
        recompute(snapshot) {
            recomputes++
            const changed = []
            for (const node of nodes.values()) {
                if (node.build) { captureQuestion(node, snapshot, changed); continue }
                recomputeScalar(node, snapshot, changed)
            }
            const failures = []
            for (const change of changed) failures.push(...announce(change))
            raise(failures)
            return changed
        },

        // Build every pending answer outside the publication boundary, then settle
        // it only while its owner and its question remain current. An obsolete
        // answer is discarded; a refused question is settled as a refusal, never
        // wearing the previous value as current. (id:laws-figure-composition)
        drain() {
            drains++
            const changed = []
            for (const node of [...nodes.values()]) {
                if (!node.build || !node.pending) continue
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
        // the moment it is declared. A keyed node answers only with a settled,
        // current value; a pending or refused question is NOTHING.
        value(id) {
            const node = nodes.get(id)
            if (!node) return undefined
            if (node.build) {
                if (node.pending || node.refused || !node.hasValue) return undefined
                return node.value
            }
            if (!node.hasValue) {
                // On demand a failed compute is a wound, not a missing name.
                // Commit-time recompute still treats unreadiness as nothing.
                const value = node.compute()
                if (value === undefined) return undefined
                node.value = value
                node.hasValue = true
            }
            return node.value
        },


        stats() { return { size: nodes.size, recomputes, drains, builds } },
        list() {
            return [...nodes.values()].map((n) => ({
                id: n.id, keyed: !!n.build, hasValue: !!n.hasValue,
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
    const base = { id, source, key, drives, value: undefined, hasValue: false }
    return resetNode(base, spec)
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
        node.answered = false
        node.hasAnnounced = false
        node.announcedValue = undefined
        node.announcedRefused = undefined
        node.failure = undefined
    } else {
        node.compute = spec
        node.capture = undefined
        node.build = undefined
        node.pending = false
    }
    node.value = undefined
    node.hasValue = false
    return node
}

function recomputeScalar(node, snapshot, changed) {
    let value, answered = true
    try {
        value = node.compute(snapshot)
    } catch {
        answered = false
    }
    // A read that cannot answer is NOTHING, never the old answer: a cached 7
    // behind a failed read is a number the source no longer holds, and keeping
    // it would draw a stale figure. A change to nothing still reaches
    // subscribers, so no watcher is left believing the previous value.
    // (id:eval-relational)
    if (!answered || value === undefined) {
        if (node.hasValue) {
            node.value = undefined
            node.hasValue = false
            changed.push({ id: node.id, source: node.source, value: undefined })
        }
        return
    }
    const fresh = !node.hasValue || !same(node.value, value)
    node.value = value
    node.hasValue = true
    if (fresh) changed.push({ id: node.id, source: node.source, value })
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
    node.answered = false
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
    node.settledQuestion = question
    node.answered = !refused
    node.refused = refused
    if (!refused) { node.value = value; node.hasValue = true }

    // Propagation is decided by the ANSWER, not the question: a different question
    // with an equal answer announces nothing. (id:laws-figure-composition-equality)
    const fresh = !node.hasAnnounced
        || node.announcedRefused !== refused
        || (!refused && !same(node.announcedValue, value))
    node.hasAnnounced = true
    node.announcedRefused = refused
    node.announcedValue = refused ? undefined : value
    if (!fresh) return

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
