// Source-owned derived values, recomputed from one committed configuration.
// (id:laws-build-p3-slider, id:cmp-green-tree, id:eval-relational)
//
// No reactive runtime and no command replay. A derived node is a pure function of
// the accepted snapshot; it is recomputed once at the publication boundary, and only
// a *changed* value is announced — equality of the derived value, not dirtiness of
// the source, decides propagation. The source site owns the node's lifetime, so an
// edit cannot multiply subscriptions: re-registering the same source replaces it.

const same = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => same(v, b[i]))
    }
    return Object.is(a, b)
}

export function createReadouts() {
    const nodes = new Map()        // node id -> { id, source, key, compute, value, hasValue }
    const bySource = new Map()     // source -> Map(key -> node id)
    const watchers = new Set()
    let seq = 0

    const announce = (change) => {
        for (const fn of [...watchers]) fn(change)
    }

    return {
        // One derived value per (source, site). A loop re-reaching the same
        // statement updates the node; it does not multiply subscriptions.
        register(source, key, compute) {
            let keys = bySource.get(source)
            if (!keys) { keys = new Map(); bySource.set(source, keys) }
            const owned = keys.get(key)
            if (owned !== undefined) {
                const node = nodes.get(owned)
                if (node) node.compute = compute
                return owned
            }
            const id = ++seq
            nodes.set(id, { id, source, key, compute, value: undefined, hasValue: false })
            keys.set(key, id)
            return id
        },

        // The source is gone (rewire, removal, fresh play): every node it owned goes.
        release(source) {
            const keys = bySource.get(source)
            if (!keys) return false
            for (const id of keys.values()) nodes.delete(id)
            bySource.delete(source)
            return true
        },

        releaseAll() {
            nodes.clear()
            bySource.clear()
        },

        // Recompute every node from the committed snapshot. Announce only changes,
        // so an unrelated commit costs a comparison, not a redraw.
        recompute(snapshot) {
            const changed = []
            for (const node of nodes.values()) {
                let value
                try {
                    value = node.compute(snapshot)
                } catch {
                    continue   // a read that cannot answer yet is not a value
                }
                const fresh = !node.hasValue || !same(node.value, value)
                node.value = value
                node.hasValue = true
                if (fresh) changed.push({ id: node.id, source: node.source, value })
            }
            for (const change of changed) announce(change)
            return changed
        },

        // A read between commits computes on demand, so `let s = A.x` is usable
        // the moment it is declared.
        value(id) {
            const node = nodes.get(id)
            if (!node) return undefined
            if (!node.hasValue) {
                try {
                    node.value = node.compute()
                    node.hasValue = true
                } catch {
                    return undefined   // not ready is not a value
                }
            }
            return node.value
        },

        watch(fn) {
            watchers.add(fn)
            return () => watchers.delete(fn)
        },

        get size() {
            return nodes.size
        },
    }
}
