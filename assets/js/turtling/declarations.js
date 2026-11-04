import { ASTNode } from './ast.js'
import { COMMANDS } from './commands.js'
import { readArguments } from './parse.js'
import { SE3 } from './se3.js'
import { isBeing } from './frame.js'
import { markLocal, project } from './bindings.js'
import { toSpace } from './space.js'
import { spellingOf } from './numerics.js'
import { notice } from './report.js'
import { kindOf } from './mafs/tower.js'
import { parseMemo } from './mafs/parse_memo.js'
import { driveOf } from './laws/authored.js'
import { reactiveReading } from './laws/reactive.js'
import { acquireArgument } from './arguments.js'
import { evalOrBlock, evaluateExpr, readExpr, readOrBlock, readsDeferred } from './expressions.js'

// A source carries its initial reading and the operations it permits.
// (id:notation-coordinate-vector, id:eval-relational)
function readingSource(node, scope, deps, initial, revisable) {
    const expr = node.meta.expr
    return {
        initial,
        read: revisable ? (() => evaluateExpr(expr, scope, deps, 'measure', node)) : null,
        observe: revisable ? ((sample, bind) => readExpr(expr, scope, deps, 'measure', sample, bind, node)) : null,
    }
}

function declarationSource(node, scope, deps) {
    const expr = node.meta.expr, deferred = deps.mathEvaluator.deferred
    const tree = parseMemo(deps.mathParser, expr, node)
    const sampled = deferred != null && readsDeferred(tree, deferred)
    const initial = sampled
        ? { value: evaluateExpr(expr, scope, deps, 'measure', node), reads: null }
        : readExpr(expr, scope, deps, 'measure', null, null, node)
    if (['TowerRefusal', 'DomainRefusal'].includes(initial.error?.name)) throw initial.error
    return readingSource(node, scope, deps, initial, !sampled)
}

// Every position spelling uses this law effect; the reading retains its raw tower value.
// (id:notation-coordinate-vector, id:laws-dependency-driven-place)
function lawEffect(feature, target, source, { axis = null, owner = null, ...details }) {
    const { initial, observe } = source
    return {
        type: 'law', feature, target,
        value: feature === 'position' ? (toSpace(initial.value) ?? initial.value) : initial.value,
        ...details, axis, owner,
        read: initial.reads?.live ? reactiveReading(initial, observe) : null,
    }
}

function pointEffect(name, source, owner) {
    return lawEffect('position', name, source, { owner })
}

function vectorEffect(name, source, owner, state) {
    const value = source.initial.value, displacement = toSpace(value)
    if (!displacement) {
        return notice({ kind: 'vector',
            message: `a displacement needs at least one finite component, not ${spellingOf(value)}`, span: owner })
    }
    const pose = state.transform, style = state.style
    return { type: 'scalar', name, owner, initial: displacement,
        vector: { name, from: [...pose.position], rotation: pose.rotation, color: style.color,
            thickness: style.thickness, textSize: style.label ?? 5 },
        read: source.read ?? (() => value) }
}

function valueEffect(name, source, owner) {
    return source.read
        ? { type: 'scalar', name, owner, read: source.read }
        : { type: 'parameter', name, owner, value: source.initial.value }
}

const VALUE_EFFECTS = new Map([['point', pointEffect], ['vector', vectorEffect]])

function birthEvent(name, state, owner, profile = null) {
    return { type: 'birth', name, origin: SE3.clone(state.transform),
        ...(profile ? { profile } : {}), owner }
}

export function* declareExistence(node, scope, state) {
    const name = String(yield* evalOrBlock(node.value, scope, state.deps, 'word'))
    yield birthEvent(name, state, node.span ?? null)
}

export function* declareValue(node, scope, state) {
    const owner = node.span ?? null
    const name = node.value.startsWith('"') || node.value.startsWith("'")
        ? String(yield* evalOrBlock(node.value, scope, state.deps, 'word')) : node.value
    const call = figureCallOf(node.meta.expr, state.functions)
    if (call) {
        yield* declareFigure(name, call, owner, scope, state)
        return
    }
    const source = declarationSource(node, scope, state.deps)
    const kind = source.initial.error ? null : kindOf(source.initial.value)
    const effect = (VALUE_EFFECTS.get(kind) ?? valueEffect)(name, source, owner, state)
    yield effect
    if (effect.type === 'scalar' || effect.type === 'parameter') markLocal(scope, name)
}

// Names keep their spelling until bound; bound beings keep their identity.
// Framed point literals are data, not names. (id:being-facets-centers-review)
function* lawSubjects(meta, scope, deps) {
    const selectors = meta.subjects ?? [meta.target], subjects = []
    for (const selector of selectors) {
        if (selector != null && typeof selector === 'object') { subjects.push(selector); continue }
        const bound = selector.startsWith('"') || Object.hasOwn(scope, selector) || deps.mathEvaluator.owns?.(selector) === true
        const subject = bound ? (yield* evalOrBlock(selector, scope, deps, 'word')) : selector
        if (!isBeing(subject) && (typeof subject !== 'string' || !subject)) throw new Error('a law subject must name a thing')
        subjects.push(subject)
    }
    if (meta.movers != null && !Array.isArray(meta.movers)) throw new Error('law movers must be selectors')
    const movers = meta.movers?.map(selector => {
        const index = selectors.indexOf(selector), subject = subjects[index]
        if (index < 0 || (typeof subject !== 'string' && !isBeing(subject))) throw new Error('a law mover must name a live subject')
        return subject
    })
    return { target: subjects.find(subject => typeof subject === 'string' || isBeing(subject)) ?? subjects[0], subjects, movers }
}

export function* declareLaw(node, scope, state) {
    const meta = node.meta, feature = node.value, position = feature === 'position'
    const { target, subjects, movers } = yield* lawSubjects(meta, scope, state.deps)
    const revisable = !!driveOf(feature)
    const initial = revisable ? (yield* readOrBlock(meta.expr, scope, state.deps, node))
        : { value: yield* evalOrBlock(meta.expr, scope, state.deps), reads: null }
    const source = readingSource(node, scope, state.deps, initial, revisable)
    yield lawEffect(feature, target, source, {
        owner: node.span ?? null,
        ...(!position ? {
            ...(meta.subjects ? { subjects } : {}),
            ...(movers ? { movers } : {}),
            ...(meta.reachPolicy !== undefined ? { reachPolicy: meta.reachPolicy } : {}),
            expression: meta.expr, axis: meta.axis ?? null,
        } : {}),
    })
}

function* declareFigure(name, figure, owner, scope, state) {
    const arity = state.functions?.[figure.recipe]?.parameters?.length ?? 0
    const inputs = []
    for (const arg of figure.args) inputs.push(yield* acquireArgument(arg, scope, state, 'measure', false))
    while (inputs.length < arity) inputs.push(0)
    const call = new ASTNode('Call', figure.recipe, inputs.map(input => new ASTNode('Value', input)))
    call.span = owner
    yield birthEvent(name, state, owner, 'derived')
    yield spawnEvent(state, scope, name, [call], state.functions, {
        profile: 'derived', question: inputs, recipe: figure.recipe, argExprs: figure.args, owner,
    })
}

// A child inherits one snapshot of pose, style, vocabulary, bindings and logical birth.
// Ambient bodies and figure declarations share this door. (id:turtle-ambient-calculus)
export function spawnEvent(state, scope, name, body, functions, extra = {}) {
    return {
        type: 'spawn', name, ...extra,
        frame: extra.frame ?? null, profile: extra.profile ?? null, question: extra.question ?? null,
        receiver: extra.receiver ?? null, site: extra.site ?? null,
        origin: SE3.clone(state.transform), style: { ...state.style },
        code: { ast: body, functions: { ...(functions ?? state.functions) } },
        env: { userspace: new Map(state.deps.mathParser.userspace), loopCounter: state.loopCounter,
            scope: project(scope), birthtime: state.birthtime + state.elapsedTime },
    }
}

// Recipe calls use the command argument boundary; brackets supply an explicit list.
// (id:gw-grammar, id:laws-figures-phase34-review)
function figureCallOf(expr, functions) {
    if (typeof expr !== 'string') return null
    const head = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(expr)
    if (!head) return null
    const name = head[1]
    if (!functions?.[name] && !COMMANDS.get(name)) return null
    const rest = expr.slice(head[0].length).trim()
    if (rest.startsWith('[') && rest.endsWith(']')) {
        const inner = rest.slice(1, -1).trim()
        return { recipe: name, args: inner === '' ? [] : splitTopLevel(inner).map(arg => arg.trim()) }
    }
    return { recipe: name, args: readArguments(rest) }
}

function splitTopLevel(source) {
    const parts = []
    let depth = 0, start = 0
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '[' || source[i] === '(') depth++
        else if (source[i] === ']' || source[i] === ')') depth--
        else if (source[i] === ',' && depth === 0) { parts.push(source.slice(start, i)); start = i + 1 }
    }
    parts.push(source.slice(start))
    return parts
}
