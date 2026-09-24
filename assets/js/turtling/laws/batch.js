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
