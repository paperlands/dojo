import { isBeing } from './frame.js'
import { conditionOf, FINITE, measure, spellingOf } from './numerics.js'
import { evalOrBlock, evaluateExpr, retryBlocked } from './expressions.js'

export const consumerOf = state => state.strict ? 'construction' : state.rehearsal ? 'vocabulary' : 'walk'
export const holeDomain = (holes, i) => holes?.[i] ?? 'measure'
export const isTargetCall = spec => spec?.holes?.length === 1 && spec.holes[0] === 'target'

// A scalar consumer selects a singleton's finite component; all other arrays stay arrays.
// (id:notation-array-growth)
const unwrapSingleton = value => Array.isArray(value) && value.length === 1 && (0 in value)
    && !Array.isArray(value[0]) && conditionOf(value[0]) === FINITE ? value[0] : value

function admit(value, expr, domain, state) {
    if (domain !== 'finite') return value
    const scalar = unwrapSingleton(value)
    return conditionOf(scalar) === FINITE ? scalar : measure(scalar, { as: consumerOf(state), expr })
}

// Bare names retain beings; quoted spellings and local values take the expression door.
// Calls and figure declarations share this acquisition. (id:being-facets-p2-seam)
export function* acquireArgument(child, scope, state, domain, target) {
    if (child?.type === 'Value') {
        return target ? child.value : admit(child.value, spellingOf(child.value), domain, state)
    }
    const source = typeof child === 'string' ? child : child?.value
    if (typeof source === 'string' && /^[A-Za-z_][\w-]*$/.test(source) && !Object.hasOwn(scope ?? {}, source)) {
        const being = state.deps.mathEvaluator.resolveSubject?.(source)
        if (being) return being
    }
    const value = yield* evalOrBlock(source, scope, state.deps, domain)
    return admit(value, source, domain, state)
}

function projectPosition(subject, deps) {
    return retryBlocked(() => {
        const evaluator = deps.mathEvaluator
        const at = isBeing(subject)
            ? evaluator?.resolveSubjectFacet?.(subject, 'position')
            : evaluator?.resolveExternal?.(`${subject}.position`)
        return Array.isArray(at) && at.length === 3 ? [...at] : at
    })
}

const refusePoint = (value, state) => measure(value, { as: consumerOf(state), expr: 'coordinate target' })

function validateVector(value, state) {
    if (value.length === 0) return refusePoint(value, state)
    for (let i = 0; i < Math.min(value.length, 3); i++) {
        if (!(i in value) || value[i] == null || conditionOf(value[i]) !== FINITE) return refusePoint(value, state)
    }
    return value
}

// Complete permitted omissions only; z comes from the sampled world height.
// (id:world-coordinate-phase-3)
function completePoint(components, cursorHeight, state) {
    const point = [components[0] ?? 0, components[1] ?? 0, components[2] ?? cursorHeight]
    const bad = point.find(component => conditionOf(component) !== FINITE)
    return bad === undefined ? point : refusePoint(bad, state)
}

export function* bindTarget(raw, state, cursorHeight) {
    const parts = raw.map(unwrapSingleton)
    if (parts.length === 1 && (isBeing(parts[0]) || typeof parts[0] === 'string')) {
        return yield* projectPosition(parts[0], state.deps)
    }
    if (parts.length === 1 && Array.isArray(parts[0])) {
        return completePoint(validateVector(parts[0], state), cursorHeight, state)
    }
    if (parts.some(value => isBeing(value) || Array.isArray(value))) {
        throw new Error('a coordinate target takes one point or its components, not both')
    }
    return completePoint(parts, cursorHeight, state)
}

// A display reads a being's location; a word hole alone does not. (id:world-coordinate-phase-3)
export function* bindDisplay(value, hole, display, state) {
    if (!display || hole !== 'word' || !isBeing(value)) return value
    return (yield* projectPosition(value, state.deps)) ?? value
}

// Retry the whole observation, closing its scope before offering the wait.
// (id:being-facets-p4-sequence, D011)
export function readPointArgs(nodes, scope, state, command) {
    return retryBlocked(() => {
        const evaluator = state.deps.mathEvaluator
        const baseRevision = evaluator.beginObservation(command)
        if (baseRevision === undefined) return null
        try {
            return { args: nodes.map(node => evaluateExpr(node.value, scope, state.deps)), baseRevision }
        } finally {
            evaluator.endObservation()
        }
    })
}
