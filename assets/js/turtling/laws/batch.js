// One source body, two meanings. (id:laws-decl-two-meanings)
//
//   source body → relationship batch  — what it declares
//               → executable body     — what it does, node identity preserved
//
// A declaration stays in the executable stream: the executor reaches it in order
// and emits a birth effect; the batch records what the body declares. The batch is
// rebuilt from the current parse at every seat and rewire, so participation is
// *current source participation* — never a flag that outlives the declaration that
// granted it. (id:laws-decl-ownership, id:laws-ordered-birth)

export const isDeclaration = (node) => node?.type === 'Existence'

export function deriveBatch(body = []) {
    const declared = new Set()
    for (const node of body) {
        if (isDeclaration(node)) declared.add(node.value)
    }
    // Declarations stay in the executable stream: a reached `let` is the birth
    // site, not a parse-time index. The set is the current source participation.
    return { declared, body: [...body] }
}

// Exposure is a query about the current batch, not a stored fact. A frame
// survives the declaration that named it; exposure alone does not say whether
// its position can be moved independently of a walking head.
// (id:laws-decl-exposure)
export function exposed(frame) {
    // Reached participation, not the parse-time declaration index. A `let` the
    // walk has not run yet must not expose its point; a manually built fixture
    // with no runtime set falls back to the declaration it names.
    if (frame?.parent?.reached) return frame.parent.reached.has(frame.name) === true
    return frame?.parent?.declared?.has(frame.name) === true
}

// A free point was seated by `let` and has never acquired a walking body.
// Once `as A` starts, A's position belongs to its head, even after it rests.
// Current exposure and liveness are still checked by the gesture at use time.
export function freePoint(frame) {
    return exposed(frame) && frame.isPlace === true && frame.done === true
        && frame.generator == null && frame.actorState == null
        && frame.error == null && frame.unresolved == null
}

// A touch selects the topmost free point: the most recently introduced identity
// wins an overlap, so dragging it away exposes the ones beneath. (id:laws-build-p1d)
export function pointCandidates(frames = [], touchable = freePoint) {
    return [...frames].filter(touchable).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
}
