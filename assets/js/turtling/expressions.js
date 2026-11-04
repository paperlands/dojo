import { isNumericLiteral } from './mafs/number.js'
import { parseMemo } from './mafs/parse_memo.js'

const IDENT_HEAD_RE = /^[a-zA-Z]/

// Retry the whole attempt, never a partial answer. The scheduler owns the wait.
// (id:laws-ordered-birth, id:laws-dependency-driven-place)
export function* retryBlocked(attempt) {
    while (true) {
        try { return attempt() }
        catch (error) {
            if (!error.blocked) throw error
            yield { type: 'blocked', target: error.blockedFrame ?? null }
        }
    }
}

export function evalOrBlock(expr, scope, deps, domain = 'measure') {
    return retryBlocked(() => evaluateExpr(expr, scope, deps, domain))
}

export function readOrBlock(expr, scope, deps, term = null) {
    return retryBlocked(() => {
        const reading = readExpr(expr, scope, deps, 'measure', null, null, term)
        if (reading.error) throw reading.error
        return reading
    })
}

export function readsDeferred(tree, names) {
    if (!tree) return false
    if (tree.type === 'operand' && names.has(tree.value)) return true
    return (tree.children ?? []).some(child => readsDeferred(child, names))
}

// A reading owns its result and observations, including a failed attempt's evidence.
// (id:laws-dependency-driven-place)
export function readExpr(expr, scope, deps, domain = 'measure', sample = null, bind = null, term = null) {
    const evaluator = deps.mathEvaluator, parent = evaluator.reads
    const reads = evaluator.beginReads()
    reads.sample = sample
    reads.bind = bind
    try { return { value: evaluateExprBody(expr, scope, deps, domain, term), reads } }
    catch (error) { return { value: undefined, reads, error } }
    finally {
        reads.sample = null
        reads.bind = null
        evaluator.reads = parent
    }
}

// Nested value cells own their sampling; a parent's replay must not enter them.
// (id:laws-reactive-randomness)
export function evaluateExpr(expr, scope, deps, domain = 'measure', term = null) {
    const evaluator = deps.mathEvaluator, parent = evaluator.reads
    evaluator.reads = null
    try { return evaluateExprBody(expr, scope, deps, domain, term) }
    finally { evaluator.reads = parent }
}

function evaluateExprBody(expr, scope, { mathParser, mathEvaluator }, domain, term) {
    if (isNumericLiteral(expr)) return parseFloat(expr)
    if (scope[expr] !== undefined) return mathEvaluator.readContext
        ? mathEvaluator.readContext(expr, scope) : scope[expr]
    const tree = domain === 'word' && /^[A-Za-z_]\w*-[\w-]*$/.test(expr)
        ? { type: 'operand', value: expr, children: [] } : parseMemo(mathParser, expr, term)

    if (tree.type === 'string') return mathEvaluator.run(tree, scope)
    if (tree.type === 'literal') return tree.value
    if (tree.children.length > 0 || mathEvaluator.namespace_check(tree.value)) {
        return mathEvaluator.run(tree, scope)
    }
    if (typeof tree.value === 'string' && IDENT_HEAD_RE.test(tree.value)) {
        if (mathEvaluator.resolveExternal) {
            const resolved = mathEvaluator.readExternal
                ? mathEvaluator.readExternal(tree.value) : mathEvaluator.resolveExternal(tree.value)
            if (resolved !== undefined) return resolved
        }
        if (domain === 'word') return tree.value
        // A headless rehearsal has no ambient tree to negotiate with. (D019)
        if (tree.value.includes('.')) return null
        throw new Error(`Undefined variable: ${tree.value}`)
    }
    return tree.value
}
