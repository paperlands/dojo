// Executor — generator-based AST walker.
// Walks parsed AST, calls pure command functions, yields TurtleEvents.
// No side effects beyond yielded events. Math context injected as dependency.

import { COMMANDS, DEFAULT_STYLE } from "./commands.js"
import { SE3 } from "./se3.js"
import { createStroke, extend as strokeExtend, flush as strokeFlush, fill as strokeFill } from "./stroke.js"
import { matchPattern } from "./match.js"

const roundVec = (v) => Math.abs(v) < 1e-10 ? 0 : Math.round(v * 1e9) / 1e9

// Dataflow suspension helper — wraps evaluateExpr in a retry loop.
// When a cross-ambient read fails during inline advance (blocked error),
// yields { type: 'blocked' } to suspend the generator, then retries on resume.
// Used with yield* from walkBody so the suspension propagates up the chain.
function* evalOrBlock(expr, scope, state) {
    while (true) {
        try {
            return evaluateExpr(expr, scope, state)
        } catch (e) {
            if (e.blocked) {
                yield { type: 'blocked' }
                continue
            }
            throw e
        }
    }
}

// Execute a parsed AST, yielding TurtleEvents.
// Caller drains the generator (synchronously for batch, per-tick for coroutines).
//
// deps = { mathParser, mathEvaluator }
// opts = { maxRecurseDepth, maxRecurses, maxCommands, color, actorState }
export function* execute(ast, deps, opts = {}) {
    // Actor state: if provided, this is a continuation — same ambient, new command batch.
    // The state object is shared and mutated in-place across all batches.
    const state = opts.actorState || {
        transform: SE3.identity(),
        style: { ...DEFAULT_STYLE, color: opts.color || DEFAULT_STYLE.color },
        functions: opts.functions ? { ...opts.functions } : {},
        commandCount: 0,
        recurseCount: 0,
        maxRecurseDepth: opts.maxRecurseDepth || 360,
        maxRecurses: opts.maxRecurses || 888888,
        maxCommands: opts.maxCommands || 88888888,
        elapsedTime: 0,
        loopCounter: opts.loopCounter || 0,
        mailbox: opts.mailbox || null,
    }

    // Stroke accumulator — local to this execution pass, not persisted in actorState.
    // Path is always flushed before execution ends.
    const stroke = createStroke()

    // Rebind deps for this execution pass (fresh math context per batch)
    state.deps = deps
    if (opts.actorState) state.loopCounter = opts.loopCounter ?? state.loopCounter

    // Link evaluator to parser's userspace for call-by-value function dispatch
    deps.mathEvaluator.userFunctions = deps.mathParser.userspace

    // Bind runtime state into evaluator — thunks are lazy,
    // only invoked when an expression actually references the name.
    // Closures capture `state` (shared actorState), so they read live values.
    const ec = deps.mathEvaluator.constants
    ec['time'] = () => state.elapsedTime / 1000
    ec['x'] = () => roundVec(state.transform.position[0])
    ec['y'] = () => roundVec(state.transform.position[1])
    ec['z'] = () => roundVec(state.transform.position[2])
    ec['count'] = () => state.loopCounter

    try {
        yield* walkBody(ast, {}, state, stroke)
    } catch (error) {
        // Flush accumulated path before crash propagates — valid geometry survives
        const pathEvent = strokeFlush(stroke)
        if (pathEvent) yield pathEvent
        yield {
            type: "head",
            position: [...state.transform.position],
            rotation: state.transform.rotation,
            headSize: state.style.showTurtle,
            color: state.style.color
        }
        throw error
    }

    // Flush any open path at the end
    const pathEvent = strokeFlush(stroke)
    if (pathEvent) yield pathEvent

    // Final head event — tells materializer where the turtle ended up
    yield {
        type: "head",
        position: [...state.transform.position],
        rotation: state.transform.rotation,
        headSize: state.style.showTurtle,
        color: state.style.color
    }

    return { commandCount: state.commandCount, actorState: state }
}

function* walkBody(body, scope, state, stroke) {
    let matched = false

    for (const node of body) {
        switch (node.type) {

        case 'Loop': {
            const times = yield* evalOrBlock(node.value, scope, state)
            const prevCount = state.loopCounter
            for (let i = 0; i < times; i++) {
                // Auto-yield: if previous iteration observed a sibling, yield
                // before next step so all ambients advance in lockstep.
                if (i > 0 && state.deps.mathEvaluator._observedSibling) {
                    state.deps.mathEvaluator._observedSibling = false
                    yield {
                        type: 'yield',
                        position: [...state.transform.position],
                        rotation: state.transform.rotation
                    }
                }
                state.loopCounter = i
                yield* walkBody(node.children, scope, state, stroke)
            }
            state.loopCounter = prevCount
            break
        }

        case 'Call': {
            // fn/func: math function definition — delegate to math parser.
            // Capture evaluator constants (count, x, y, z, time) at definition time
            // so fn bodies are frozen snapshots, not re-evaluated lazily.
            if (node.value === "fn" || node.value === "func") {
                const rawArgs = node.children.map(arg => arg.value)
                const fnScope = { ...scope }
                const ec = state.deps.mathEvaluator.constants
                for (const key of Object.keys(ec)) {
                    if (!(key in fnScope)) fnScope[key] = ec[key]()
                }
                state.deps.mathParser.defineFunction(rawArgs[0], rawArgs[1] || 0, fnScope)
                break
            }

            // shout: emit event directive — evaluated args, scheduler intercepts
            if (node.value === "shout") {
                const name = yield* evalOrBlock(node.children[0]?.value, scope, state)
                const payload = node.children[1] ? yield* evalOrBlock(node.children[1].value, scope, state) : undefined
                yield { type: 'shout', name, payload }
                break
            }

            const args = []
            for (const arg of node.children) {
                args.push(yield* evalOrBlock(arg.value, scope, state))
            }

            // Check user-defined function first, then built-in command
            const userFn = state.functions[scope[node.value] || node.value]
            if (userFn) {
                const currDepth = scope['__depth__'] || 0
                if (currDepth > 1) state.recurseCount++
                if (state.recurseCount >= state.maxRecurses) {
                    throw new Error(`Maximum recurse limit of ${state.maxRecurses} reached`)
                }
                if (currDepth + 1 > state.maxRecurseDepth) break

                // Build child scope with parameter bindings
                const childScope = {}
                userFn.parameters.forEach((param, i) => {
                    childScope[param] = args[i] || 0
                })
                childScope['__depth__'] = currDepth + 1

                yield* walkBody(userFn.body, childScope, state, stroke)
            } else {
                yield* callCommand(node.value, args, state, stroke)
            }
            break
        }

        case 'Define': {
            const params = node.meta?.args?.map(n => n.value) || []
            state.functions[node.value] = {
                parameters: params,
                body: node.children
            }
            break
        }

        case 'When': {
            if (node.meta?.event) {
                // Event mode: check mailbox, independent of matched flag.
                // Pattern uses brackets as captures (not interpolation).
                const mailbox = state.mailbox
                if (mailbox) {
                    const pattern = node.value.slice(1, -1) // strip quotes
                    let matchIdx = -1
                    let captures = null
                    for (let i = 0; i < mailbox.length; i++) {
                        const result = matchPattern(pattern, mailbox[i].name)
                        if (result !== null) {
                            matchIdx = i
                            captures = result
                            break
                        }
                    }
                    if (matchIdx !== -1) {
                        const event = mailbox.splice(matchIdx, 1)[0]
                        const childScope = { ...scope, ...captures }
                        if (node.meta.binding) {
                            childScope[node.meta.binding] = event.payload
                        }
                        yield* walkBody(node.children, childScope, state, stroke)
                    }
                }
            } else {
                // Conditional mode: first-match-wins via matched flag
                if (!matched && (yield* evalOrBlock(node.value, scope, state)) !== 0) {
                    matched = true
                    yield* walkBody(node.children, scope, state, stroke)
                }
            }
            break
        }

        case 'Ambient': {
            const ambientName = String(yield* evalOrBlock(node.value, scope, state))
            yield {
                type: 'spawn',
                name: ambientName,
                frame: node.meta?.frame || null,
                // Fork spec — three groups: spatial, code, environment
                origin: SE3.clone(state.transform),
                style: { ...state.style },
                code: { ast: node.children, functions: { ...state.functions } },
                env: { userspace: new Map(state.deps.mathParser.userspace), loopCounter: state.loopCounter }
            }
            break
        }

        case 'Record': {
            const title = node.value ? String(yield* evalOrBlock(node.value, scope, state)) : null
            yield { type: 'record', action: 'start', title }
            yield* walkBody(node.children, scope, state, stroke)
            yield { type: 'record', action: 'stop', title }
            break
        }

        case 'Empty':
            break
        }
    }
}

function* callCommand(name, args, state, stroke) {
    const cmd = COMMANDS.get(name)
    if (!cmd) {
        throw new Error(`Function ${name} not defined`)
    }

    if (state.commandCount >= state.maxCommands) {
        throw new Error(`Maximum command limit of ${state.maxCommands} reached`)
    }
    state.commandCount++

    // World position for global-coordinate commands (goto, faceto, jmpto).
    // Per-tick cache set by scheduler avoids repeated tree walks.
    // Falls back to worldOriginFn for inline-advanced frames.
    const worldOrigin = state.deps._cachedWorldOrigin
        ?? (state.deps.worldOriginFn ? state.deps.worldOriginFn() : null)
    const worldPosition = worldOrigin
        ? SE3.apply(worldOrigin, state.transform.position)
        : [...state.transform.position]

    const ctx = {
        transform: state.transform,
        style: state.style,
        worldPosition
    }

    // Snapshot position before command mutates transform
    stroke.lastPos = [...state.transform.position]

    const result = cmd(ctx, ...args)

    // Resolve world-space delta to local transform.
    // Commands that operate in global coordinates return { world: { position, rotation } }.
    // This is the single conversion point — commands declare intent, executor resolves.
    if (result.world) {
        if (result.world.position) {
            const localPos = worldOrigin
                ? SE3.unapply(worldOrigin, result.world.position)
                : result.world.position
            result.transform = {
                rotation: state.transform.rotation,
                position: localPos
            }
            if (result.stroke === "extend") result.point = localPos
        }
        if (result.world.rotation) {
            const localRot = worldOrigin
                ? SE3.localRotation(worldOrigin, result.world.rotation)
                : result.world.rotation
            result.transform = {
                rotation: localRot,
                position: result.transform?.position || state.transform.position
            }
        }
    }

    // Apply transform changes
    if (result.transform) {
        state.transform = result.transform
    }

    // Apply style changes (merge)
    if (result.style) {
        state.style = { ...state.style, ...result.style }
    }

    // Apply limit changes
    if (result.limits) {
        if (result.limits.maxRecurseDepth !== undefined) {
            state.maxRecurseDepth = result.limits.maxRecurseDepth
        }
        if (result.limits.maxCommands !== undefined) {
            state.maxCommands = result.limits.maxCommands
        }
    }

    // Apply stroke action (extend/break/fill)
    if (result.stroke) {
        if (result.stroke === "extend") {
            strokeExtend(stroke, result.point, state.style)
        } else if (result.stroke === "fill") {
            const event = strokeFill(stroke)
            if (event) yield event
        } else {
            // "break"
            const event = strokeFlush(stroke)
            if (event) yield event
        }
    }

    // Yield any effects (label, grid, clear, wait)
    if (result.effects) {
        for (const event of result.effects) {
            if (event.type === "wait") {
                state.elapsedTime += event.duration
            }
            yield event
        }
    }
}

// --- Expression evaluation ---
// Delegates to the injected math parser/evaluator.
// Mirrors turtle.js evaluateExpression exactly.

function evaluateExpr(expr, scope, state) {
    const { mathParser, mathEvaluator } = state.deps

    // String literal support
    const quoteRegex = /^(['"])(.*?)\1$/
    const quoteMatch = expr.match(quoteRegex)
    if (quoteMatch) {
        const stringContent = quoteMatch[2]
        let processed = stringContent
        let previous
        do {
            previous = processed
            processed = processed.replace(
                /\[([^[\]](?:[^[\]]|\[(?:\\.|[^[\]])*\])*)\]/g,
                (match, innerExpr) => {
                    if (innerExpr.trim().match(/^`.*`$/)) {
                        return match
                    }
                    const value = evaluateExpr(innerExpr.trim(), scope, state)
                    return value !== undefined ? String(value) : match
                }
            )
        } while (processed !== previous)
        return processed
    }

    // Computed dotted access: 'interp'.rest — interpolate the quoted name, then access property.
    // e.g. 'mice[follow]'.x → interpolate → mice1.x → dotted access
    const computedDot = expr.match(/^(['"])(.*?)\1\.(.+)$/)
    if (computedDot) {
        const name = evaluateExpr(computedDot[1] + computedDot[2] + computedDot[1], scope, state)
        return evaluateExpr(name + '.' + computedDot[3], scope, state)
    }

    if (mathParser.isNumeric(expr)) return parseFloat(expr)
    if (scope[expr] != null) return scope[expr]
    const tree = mathParser.parse(expr)

    // Expression or known namespace — always evaluate
    if (tree.children.length > 0 || mathEvaluator.namespace_check(tree.value)) {
        return mathEvaluator.run(tree, scope)
    }

    // Bare identifier — try evaluator (handles dotted + unqualified via resolveExternal).
    // Fall back to raw string for labels/colors when identifier is truly unknown.
    if (typeof tree.value === 'string' && /^[a-zA-Z]/.test(tree.value)) {
        if (mathEvaluator.resolveExternal) {
            const resolved = mathEvaluator.resolveExternal(tree.value)
            if (resolved !== undefined) return resolved
        }
    }
    return tree.value
}

// Convenience: drain a generator into an array of events (batch mode)
export function drainEvents(ast, deps, opts = {}) {
    const events = []
    for (const event of execute(ast, deps, opts)) {
        events.push(event)
    }
    return events
}
