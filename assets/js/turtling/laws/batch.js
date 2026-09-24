// One source body, two meanings. (id:laws-decl-two-meanings)
//
//   source body → relationship batch  — what it declares
//               → executable body     — what it does, node identity preserved
//
// A declaration is stripped from the executable body: it states a truth, it is
// not an action, and the executor never meets one. The batch is rebuilt from the
// current parse at every seat and rewire, so participation is *current source
// participation* — never a flag that outlives the declaration that granted it.
// (id:laws-decl-ownership)

export const isDeclaration = (node) => node?.type === 'Existence'

export function deriveBatch(body = []) {
    const declared = new Set()
    const executable = []
    for (const node of body) {
        if (isDeclaration(node)) {
            declared.add(node.value)
            continue
        }
        executable.push(node)
    }
    return { declared, body: executable }
}

// Whether a frame is *exposed* for manipulation is a query about the current
// batch, not a stored fact. A frame outlives the declaration that named it, so
// `isPlace` (an empty place was seated here) and "currently exposed" are two
// different statements. Scoped: the declaring body is the frame's own parent.
// (id:laws-decl-exposure)
export function exposed(frame) {
    return frame?.parent?.declared?.has(frame.name) === true
}
