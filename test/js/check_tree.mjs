// checkTree — the seam lint (GHC Core Lint shrunk to dojo's alphabet;
// specs/compiler/compiler.org id:cmp-become-order, id:pa-enlargements).
// One invariant walker, run in tests after parse, after reuse, after
// become — a part that emits an ill-formed primitive is caught at its own
// boundary, not three parts downstream.
//
// The invariants it holds:
//   - every node speaks the alphabet: a non-empty string type
//   - every non-Argument node carries span { line, endLine } in true
//     buffer lines (Arguments ride their statement's line — the one
//     spanless citizen, ast.js)
//   - every meta key is in the LEDGER (id:cmp-vet wound 4: an unlisted
//     meta key is the new unnamed primitive)
//   - an Error node holds her text verbatim in value (the round-trip law)
//
// treeKey is the walk-immutability probe: content minus position, taken
// before and after an operation that must not rewrite the tree (a walk, a
// skip). Sanctioned span adoption passes; any node mutation fails.

export const META_LEDGER = new Set([
    // Trivia — the uniform `#` comment (collapse-trivia pass): meta.comment on
    // a node's own/opening line, meta.endComment on a block's `end`.
    'comment', 'endComment',
    // meta.lit is now ONLY meadow prose (content), never a comment.
    'lit', 'meadow', 'meadowOpen', 'meadowClose', 'cellFence', 'args',
    'event', 'binding', 'frame', 'expected', 'found', 'phase',
])

function checkNode(node, path) {
    if (!node || typeof node.type !== 'string' || !node.type) {
        throw new Error(`checkTree: missing type at ${path}`)
    }
    if (node.type !== 'Argument') {
        const s = node.span
        if (!s || !(s.line >= 1) || !(s.endLine >= s.line)) {
            throw new Error(
                `checkTree: bad span at ${path} (${node.type}): ${JSON.stringify(node.span)}`)
        }
    }
    for (const key of Object.keys(node.meta ?? {})) {
        if (!META_LEDGER.has(key)) {
            throw new Error(`checkTree: unledgered meta key '${key}' at ${path}`)
        }
    }
    if (node.type === 'Error' && typeof node.value !== 'string') {
        throw new Error(`checkTree: Error node without verbatim text at ${path}`)
    }
    ;(node.children ?? []).forEach((c, i) => checkNode(c, `${path}.${node.type}[${i}]`))
}

export function checkTree(ast) {
    ;(ast ?? []).forEach((node, i) => checkNode(node, `root[${i}]`))
}

// Content minus position — the same exclusion adoption's content key makes
// (parse.js contentKey). Equal keys across an operation prove the
// operation never rewrote what the tree MEANS.
export const treeKey = (ast) =>
    JSON.stringify(ast, (k, v) => (k === 'span' ? undefined : v))
