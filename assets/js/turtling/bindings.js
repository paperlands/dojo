// Per-binding provenance for a lexical scope object. A name DECLARED in this scope is
// marked here; a formal argument or a captured value is not. The mark rides the scope
// object as a non-enumerable symbol.
//
// Two operations are the ONLY supported scope transfers outside this module:
//   extend(scope, shadow)  a nearer block: inherited marks are carried (minus the names
//                          bound here), so inherited names keep their meaning and the new
//                          names genuinely shadow.
//   project(scope)         capture: names shadowed by a mark are OMITTED, so a child never
//                          resurrects a stale value. Marks are not carried.
// An unrestricted spread (`{ ...scope }`) is NOT a supported transfer: it retains exactly
// the stale properties that project() exists to omit. Readers ask isLocal() instead of
// guessing from context identity or depth. (id:being-facets-centers-review)

export const LOCAL = Symbol.for('dojo.localBindings')

const localsOf = (scope) => scope?.[LOCAL]

export function markLocal(scope, name) {
    if (scope == null) return
    let set = localsOf(scope)
    if (!set) {
        set = new Set()
        Object.defineProperty(scope, LOCAL, { value: set, enumerable: false, configurable: true })
    }
    set.add(name)
}

export function isLocal(scope, name) {
    return localsOf(scope)?.has(name) === true
}

// EXTEND an environment for a nearer lexical block (a call body, an event `when`).
// Inherited declarations keep their marks, so an inherited name still resolves to what it
// meant outside; `shadow` names are newly bound here and are removed from the copied mark
// set so they genuinely shadow. A FRESH Set — the parent's marks are never mutated.
// (id:being-facets-centers-review)
export function extend(scope, shadow = []) {
    const child = { ...scope }
    const marks = localsOf(scope)
    if (marks?.size) {
        const carried = new Set(marks)
        for (const name of shadow) carried.delete(name)
        if (carried.size) {
            Object.defineProperty(child, LOCAL, { value: carried, enumerable: false, configurable: true })
        }
    }
    return child
}

// PROJECT an environment for capture: the effective bindings only. A name shadowed by a
// mark is OMITTED — the child must not resurrect the stale value it shadowed, and resolves
// the effective binding through the frame chain. Marks are not carried. (id:...)
export function project(scope) {
    const out = {}
    const marks = localsOf(scope)
    for (const [name, value] of Object.entries(scope ?? {})) {
        if (marks?.has(name)) continue
        out[name] = value
    }
    return out
}
