// One law address, one source owner. (id:laws-ordered-replacement)
//
// Pure bookkeeping for the replacement contract: which requirement currently
// holds at an address, and which source site supplies it. No parser, no geometry,
// no solver — the transition fixture the runtime will stand on. (id:laws-build-p2a)
//
// Two identities must not be confused:
//   - the *address* says what can be replaced: feature + canonical endpoint
//     identities + scope (+ frame where the feature names one);
//   - the *owner* says which statement currently supplies it.
// Only the declared symmetries are canonicalized. Nothing algebraic.

import { kindOf, guardsOf, boundsOf } from "./expression.js"
const FEATURES = {
    // distance and coincidence read their endpoints as an unordered pair.
    distance: (endpoints) => [...endpoints],
    coincidence: (endpoints) => [...endpoints],
    // a position pin is addressed by its one identity.
    position: (endpoints) => [endpoints[0]],
}

// The canonical address key for a law. Endpoints are identity tokens, never
// display names: a reversed distance pair reaches the same address, a different
// scope or frame does not. (id:laws-ordered-replacement)
export function addressOf(law) {
    if (law?.address) return law.address   // bound once; consumers do not rebuild it
    const { feature, endpoints = [], scope = null, frame = null } = law
    const shape = FEATURES[feature]
    if (!shape) throw new Error(`Unknown law feature: ${feature}`)
    const ids = shape(endpoints).map(String).sort()
    return [feature, ...ids, String(scope), frame == null ? '-' : String(frame)].join('|')
}

// One bound law: identities, coordinate frame, authored predicate, payload kind
// and domain guard fixed once. The address is derived here and reused; proposal,
// validation and display read the record rather than rebuilding it.
// (id:laws-build-p3, id:laws-build-p3a)
export function bindLaw({ feature, endpoints, scope, frame, predicate, owner = null, guards = null, bounds = null, sourceIds = [] }) {
    const law = { feature, relation: feature, endpoints: [...endpoints], scope, frame, predicate, owner,
        kind: kindOf(feature),
        guards: guards ?? guardsOf(feature),
        bounds: bounds ?? boundsOf(feature),
        sourceIds: [...new Set([...endpoints, ...sourceIds])] }
    law.address = addressOf(law)
    return law
}

// The active laws of one play: address → { predicate, owner }. A later reach at
// an address replaces its predicate and owner; a different address conjoins.
export function createLawStore() {
    const byAddress = new Map()

    const addressOwnedBy = (owner) => {
        for (const [key, law] of byAddress) if (law.owner === owner) return key
        return null
    }

    return {
        // A reached statement: installs or replaces the law at its address.
        apply(law) {
            const key = addressOf(law)
            byAddress.set(key, { ...law })
            return key
        },

        // A source edit of one statement site.
        //   revised     — the owner is current at this address
        //   future      — superseded or not yet reached: future execution only
        //   fresh-play  — the bindings/address changed
        edit(owner, law) {
            const owned = addressOwnedBy(owner)
            if (owned === null) return 'future'
            if (owned !== addressOf(law)) return 'fresh-play'
            byAddress.set(owned, { ...law, owner })
            return 'revised'
        },

        // Delete a statement site. Only the addresses it currently owns go; a
        // superseded owner owns nothing, so its delete is a no-op. Lowered
        // helpers share the owner, so one delete retracts them together.
        retract(owner) {
            let hit = false
            for (const [key, law] of byAddress) {
                if (law.owner === owner) { byAddress.delete(key); hit = true }
            }
            return hit ? 'retracted' : 'noop'
        },

        // Remove a whole scope/frame's laws (identity removal, fresh seat).
        retractFrame(frameId) {
            let hit = false
            for (const [key, law] of byAddress) {
                if (law.frame === frameId) { byAddress.delete(key); hit = true }
            }
            return hit ? 'retracted' : 'noop'
        },

        ownerOf(address) { return byAddress.get(address)?.owner ?? null },
        lawAt(address) { return byAddress.get(address) ?? null },
        // A cheap emptiness probe: motion admission asks on every step.
        count() { return byAddress.size },
        active() { return [...byAddress.entries()].map(([address, law]) => ({ address, ...law })) },
        clear() { byAddress.clear() },
    }
}
