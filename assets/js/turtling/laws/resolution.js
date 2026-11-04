// laws/resolution.js — the NAME POLICY shared by birth and law. It decides whether a
// statement ESTABLISHES a missing subject. It never looks a name up, never seats, never
// publishes, and never selects the target frame: lookup precedence (reserved names,
// own children, namesakes) belongs to the caller's findFrame. (D058, laws-decl-frame)
//
// Two authored intents carry today's behaviour:
//
//   declare   — a bare/plain declaration OWNS its name here: adopt its local child or
//               establish. A visible namesake never redirects it.
//   condition — a relation conditions an existing subject, or — when the operator
//               permits establishment — establishes a missing one.
//
// Establishment permission is operator semantics (mayEstablishOf). It PERMITS; ownership
// and the environment decide. (laws-ordered-birth, laws-first-two-pin-birth)

// A declared-but-unreached name is a located use-before-introduction for a USE, never
// for a definition. The caller applies it to every subject it guards. (id:laws-ordered-birth)
export const reservedUnreached = (declaredHere, reached) => declaredHere && !reached

// Does a condition establish a missing subject? The original conjunction, without
// ranking candidates:
//
//   mayEstablish && !local && (declaredHere || !visible),   visible = bound ?? found
//
// `found` is the caller's own lookup; `bound` a resolved being (D061). Neither is
// re-found here.
export function establishesSubject({ local = false, found = null, bound = null, declaredHere = false, mayEstablish = false } = {}) {
    if (!mayEstablish || local) return false
    if (bound) return declaredHere
    return declaredHere || !found
}

// The named-target outcome. It carries NO frame: target selection stays with the
// caller's lookup, so reserved-name precedence cannot be overridden here.
//
//   declare   → adopt (local child) | establish
//   condition → reference (the caller's lookup) | establish | refuse(unknown)
export function resolveTarget(intent, { local = false, found = null, bound = null, declaredHere = false, mayEstablish = false } = {}) {
    if (intent === 'declare') return local ? { kind: 'adopt' } : { kind: 'establish' }
    if (establishesSubject({ local, found, bound, declaredHere, mayEstablish })) return { kind: 'establish' }
    return found ? { kind: 'reference' } : { kind: 'refuse', reason: 'unknown' }
}
