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
import { AUTHORED, addressShape, symmetricOf, normalizeExpression, isLiveInput, inputFrames, payloadOf } from "./authored.js"
const FEATURES = {
    // coincidence is not an authored runtime law; its address is still an unordered pair.
    coincidence: { address: (endpoints) => [...endpoints], symmetric: true },
}

// The canonical address key for a law. Endpoints are identity tokens, never
// display names: a reversed distance pair reaches the same address, a different
// scope or frame does not. (id:laws-ordered-replacement)
// A type-tagged, injective serialization: a number and its string, a live identity and
// a framed value, or two delimiter-bearing tokens can never share an address.
// (id:laws-distance-literal-address)
const tagged = (x) => {
    if (x === null || x === undefined) return ["nil"]
    if (typeof x === 'number') return ["num", Object.is(x, -0) ? 0 : x]
    if (typeof x === 'string') return ["str", x]
    if (x.frame !== undefined) return [x.relative ? "relative" : "framed", tagged(x.frame), (x.value ?? []).map((c) => (Object.is(c, -0) ? 0 : c))]
    if (Array.isArray(x.value)) return ["point", x.value.map((c) => (Object.is(c, -0) ? 0 : c))]
    return ["json", JSON.stringify(x)]
}

export function addressOf(law) {
    if (law?.address) return law.address   // bound once; consumers do not rebuild it
    const { feature, endpoints = [], scope = null, frame = null } = law
    const shape = addressShape(feature) ?? FEATURES[feature]?.address
    if (!shape) throw new Error(`Unknown law feature: ${feature}`)
    // Roles are preserved: parts stay in the row's declared order. Only a DECLARED
    // symmetry is canonicalized — a reversed distance pair shares an address, but
    // (target, axis) never collides with (axis, target). (id:laws-ordered-replacement, D058)
    const parts = shape(endpoints, law).map(tagged)
    const canonical = symmetricOf(feature) || FEATURES[feature]?.symmetric === true
        ? [...parts].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
        : parts
    return JSON.stringify([feature, canonical, tagged(scope), tagged(frame)])
}

// One bound law: identities, coordinate frame, authored predicate, payload kind
// and domain guard fixed once. The address is derived here and reused; proposal,
// validation and display read the record rather than rebuilding it.
// (id:laws-build-p3, id:laws-build-p3a)
export function bindLaw({ feature, endpoints, scope, frame, predicate, owner = null, axis = null, guards = null, bounds = null, sourceIds = [], source = null, expression = null }) {
    // Bind once: a supplied term is frozen; a legacy caller without one is normalized
    // through the same constructor. An explicitly malformed term is kept and fails
    // closed at the accessor. (id:laws-distance-term-normalization, D058)
    const raw = expression ?? normalizeExpression(feature, { endpoints, frame, axis, predicate, source })
    const freezeRef = (r) => (r != null && typeof r === 'object' && !Array.isArray(r))
        ? Object.freeze({ ...r, ...(Array.isArray(r.value) ? { value: Object.freeze([...r.value]) } : {}) })
        : r
    const term = raw == null ? null : Object.freeze({ ...raw,
        ...(Array.isArray(raw.references) ? { references: Object.freeze(raw.references.map(freezeRef)) } : {}),
        ...(Array.isArray(raw.value) ? { value: Object.freeze([...raw.value]) } : {}),
    })
    // The term is the authority; the compatibility fields derive from it. `endpoints`
    // is the live solve mirror — a framed centre is never a solve participant — and the
    // framed frames are retraction deps, not endpoints. (id:laws-distance-literal-address)
    const references = Array.isArray(term?.references) ? term.references : endpoints
    const liveEnds = references.filter(isLiveInput)
    const boundFrame = AUTHORED[feature]?.reference ? (term?.frame ?? frame) : frame
    const boundAxis = term?.axis ?? axis
    const boundPredicate = term == null ? predicate : (payloadOf(feature, term) ?? predicate)
    const law = { feature, relation: feature, endpoints: Object.freeze([...liveEnds]), scope,
        frame: boundFrame, predicate: boundPredicate, owner,
        ...(boundAxis == null ? {} : { axis: boundAxis }),
        ...(term == null ? {} : { expression: term }),
        kind: kindOf(feature),
        guards: guards ?? guardsOf(feature),
        bounds: bounds ?? boundsOf(feature),
        sourceIds: [...new Set([...liveEnds, ...inputFrames({ expression: term }), ...sourceIds])] }
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

        // A source edit of a scope (a rewire) retracts the laws that scope DECLARED. Ownership
        // is the law's `scope`; the expression `frame` only places the term, so a law whose term
        // stands in this frame answers to whoever declared it. (id:laws-build-p2c, D059)
        retractScope(scopeId) {
            let hit = false
            for (const [key, law] of byAddress) {
                if (law.scope === scopeId) { byAddress.delete(key); hit = true }
            }
            return hit ? 'retracted' : 'noop'
        },

        // An identity leaving the play retracts every law that names it, wherever
        // that law was declared: a law survives only while both participants exist.
        // (id:laws-activation.org "Remove a scope/identity")
        retractIdentity(frameId) {
            let hit = false
            for (const [key, law] of byAddress) {
                if (law.frame === frameId || law.endpoints?.includes(frameId) ||
                    inputFrames(law).includes(frameId)) { byAddress.delete(key); hit = true }
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
