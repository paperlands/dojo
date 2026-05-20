// Executor — generator-based AST walker.
// Walks parsed AST, calls pure command functions, yields TurtleEvents.
// No side effects beyond yielded events. Math context injected as dependency.

import { COMMANDS, DEFAULT_PEN_STATE } from "./commands.js"
import { SE3 } from "./se3.js"

const roundVec = (v) => Math.abs(v) < 1e-10 ? 0 : Math.round(v * 1e9) / 1e9

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
        penState: { ...DEFAULT_PEN_STATE, color: opts.color || DEFAULT_PEN_STATE.color },
        currentPath: null,
        functions: opts.functions ? { ...opts.functions } : {},
        commandCount: 0,
        recurseCount: 0,
        maxRecurseDepth: opts.maxRecurseDepth || 360,
        maxRecurses: opts.maxRecurses || 888888,
        maxCommands: opts.maxCommands || 88888888,
        lastPosition: [0, 0, 0],
        elapsedTime: 0,
        loopCounter: opts.loopCounter || 0,
    }

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
        yield* walkBody(ast, {}, state)
    } catch (error) {
        // Flush accumulated path before crash propagates — valid geometry survives
        if (state.currentPath) {
            yield { type: "path", ...state.currentPath }
            state.currentPath = null
        }
        yield {
            type: "head",
            position: [...state.transform.position],
            rotation: state.transform.rotation,
            headSize: state.penState.showTurtle,
            color: state.penState.color
        }
        throw error
    }

    // Flush any open path at the end — must null to prevent cross-batch
    // corruption (spread shares the points array reference)
    if (state.currentPath) {
        yield { type: "path", ...state.currentPath }
        state.currentPath = null
    }

    // Final head event — tells materializer where the turtle ended up
    yield {
        type: "head",
        position: [...state.transform.position],
        rotation: state.transform.rotation,
        headSize: state.penState.showTurtle,
        color: state.penState.color
    }

    return { commandCount: state.commandCount, actorState: state }
}

function* walkBody(body, scope, state) {
    let matched = false

    for (const node of body) {
        switch (node.type) {

        case 'Loop': {
            const times = evaluateExpr(node.value, scope, state)
            const prevCount = state.loopCounter
            for (let i = 0; i < times; i++) {
                state.loopCounter = i
                yield* walkBody(node.children, scope, state)
            }
            state.loopCounter = prevCount
            break
        }

        case 'Call': {
            // fn/func: math function definition — delegate to math parser
            if (node.value === "fn" || node.value === "func") {
                const rawArgs = node.children.map(arg => arg.value)
                state.deps.mathParser.defineFunction(rawArgs[0], rawArgs[1] || 0, scope)
                break
            }

            const args = node.children.map(arg =>
                evaluateExpr(arg.value, scope, state)
            )

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

                yield* walkBody(userFn.body, childScope, state)
            } else {
                yield* callCommand(node.value, args, state)
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
            if (!matched && evaluateExpr(node.value, scope, state) !== 0) {
                matched = true
                yield* walkBody(node.children, scope, state)
            }
            break
        }

        case 'Ambient': {
            const ambientName = String(evaluateExpr(node.value, scope, state))
            yield {
                type: 'spawn',
                name: ambientName,
                ast: node.children,
                transform: SE3.clone(state.transform),
                penState: { ...state.penState },
                frame: node.meta?.frame || null,
                functions: { ...state.functions },
                userspace: new Map(state.deps.mathParser.userspace),
                loopCounter: state.loopCounter
            }
            break
        }

        case 'Record': {
            const title = node.value ? String(evaluateExpr(node.value, scope, state)) : null
            yield { type: 'record', action: 'start', title }
            yield* walkBody(node.children, scope, state)
            yield { type: 'record', action: 'stop', title }
            break
        }

        case 'Empty':
            break
        }
    }
}

function* callCommand(name, args, state) {
    const cmd = COMMANDS.get(name)
    if (!cmd) {
        throw new Error(`Function ${name} not defined`)
    }

    if (state.commandCount >= state.maxCommands) {
        throw new Error(`Maximum command limit of ${state.maxCommands} reached`)
    }
    state.commandCount++

    const ctx = {
        transform: state.transform,
        penState: state.penState
    }

    // Snapshot position before command mutates transform
    state.lastPosition = [...state.transform.position]

    const result = cmd(ctx, ...args)

    // Apply transform changes
    if (result.transform) {
        state.transform = result.transform
    }

    // Apply pen state changes (merge)
    if (result.penState) {
        state.penState = { ...state.penState, ...result.penState }
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

    // Handle path actions (extend/break/fill)
    if (result.pathAction) {
        yield* handlePathAction(result.pathAction, state)
    }

    // Yield any events (label, grid, clear, wait)
    if (result.events) {
        for (const event of result.events) {
            if (event.type === "wait") {
                state.elapsedTime += event.duration
            }
            yield event
        }
    }
}

function* handlePathAction(action, state) {
    switch (action.type) {
    case "extend": {
        if (!state.currentPath) {
            // Start new path from where we were before the move
            state.currentPath = {
                color: state.penState.color,
                thickness: state.penState.thickness,
                points: [state.lastPosition],
                filled: false
            }
        }
        state.currentPath.points.push(action.point)
        break
    }
    case "break": {
        if (state.currentPath) {
            yield { type: "path", ...state.currentPath }
            state.currentPath = null
        }
        break
    }
    case "fill": {
        if (state.currentPath) {
            state.currentPath.filled = true
            yield { type: "path", ...state.currentPath }
            state.currentPath = null
        }
        break
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

    if (mathParser.isNumeric(expr)) return parseFloat(expr)
    if (scope[expr] != null) return scope[expr]
    const tree = mathParser.parse(expr)
    if (tree.children.length > 0 || mathEvaluator.namespace_check(tree.value)) {
        return mathEvaluator.run(tree, scope)
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
