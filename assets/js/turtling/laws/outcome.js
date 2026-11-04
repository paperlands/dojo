// The verb a request answers with: one outcome, decided in one place.
// (id:laws-decl-interface)
//
// Pure vocabulary — no geometry, no frames. Any request producer speaks it, and a
// refusal's only trace is text that fades.

import { VERDICT_DECAY_MS } from "./feel.js"

// The smallest readout that can tell the three apart: busy is "another hand has
// it", unresolved is "the toy cannot do this yet", rejected is a truth verdict.
export const OUTCOME = {
    accepted: 'accepted',
    rejected: 'rejected',
    busy: 'busy',
    unresolved: 'unresolved',
    obsolete: 'obsolete',      // the identity is no longer in this play
    cancelled: 'cancelled',    // the gesture ended without a verdict
    fault: 'fault',
    // A pose that cannot anchor the drag plane — missing or malformed geometry,
    // never a planar domain. Distinct from busy (another hand has it) and from
    // rejected (a truth verdict).
    unsupported: 'unsupported',
}

// A verdict becomes an outcome in exactly one place, so no line can describe two
// contradictory answers. (id:laws-decl-handle)
export const OUTCOME_OF = {
    accept: OUTCOME.accepted,
    refuse: OUTCOME.rejected,
    busy: OUTCOME.busy,
    unresolved: OUTCOME.unresolved,
    stale: OUTCOME.obsolete,
    fault: OUTCOME.fault,
}

export function outcomeOf(verdict) {
    return OUTCOME_OF[verdict?.kind] ?? 'unknown'
}

// One outcome, supplied by the caller — it has already decided between a verdict,
// an unanchorable pose and a cancelled gesture.
export function readout({ point, accepted, requested, outcome }) {
    return {
        point,
        accepted: accepted ? [...accepted] : null,
        requested: requested ? [...requested] : null,
        outcome,
    }
}

export function verdictFade(age, span = VERDICT_DECAY_MS) {
    if (!(age >= 0) || age >= span) return 0
    return 1 - age / span
}
