// Executor — generator-based AST walker.
// Walks parsed AST, calls pure command functions, yields TurtleEvents.
// No side effects beyond yielded events. Math context injected as dependency.

import { COMMANDS, DEFAULT_PEN_STATE } from "./commands.js"
import { SE3 } from "./se3.js"

// Execute a parsed AST, yielding TurtleEvents.
// Caller drains the generator (synchronously for batch, per-tick for coroutines).
//
// deps = { mathParser, mathEvaluator }
// opts = { maxRecurseDepth, maxRecurses, maxCommands, color }
export function* execute(ast, deps, opts = {}) {
    const state = {
        transform: SE3.identity(),
        penState: {
            ...DEFAULT_PEN_STATE,
            color: opts.color || DEFAULT_PEN_STATE.color
        },
        currentPath: null,
        functions: {},
        commandCount: 0,
        recurseCount: 0,
        maxRecurseDepth: opts.maxRecurseDepth || 360,
        maxRecurses: opts.maxRecurses || 888888,
        maxCommands: opts.maxCommands || 88888888,
        lastPosition: [0, 0, 0],
        elapsedTime: 0,
        deps
    }

    const roundVec = (v, eps = 1e-10, decimals = 8) => Math.abs(v) < 1e-10 ? 0 : Math.round(v * 1e9) / 1e9

    // Bind runtime state into evaluator — thunks are lazy,
    // only invoked when an expression actually references the name
    const ec = deps.mathEvaluator.constants
    ec['time'] = () => state.elapsedTime / 1000
    ec['x'] = () => roundVec(state.transform.position[0])
    ec['y'] = () => roundVec(state.transform.position[1])
    ec['z'] = () => roundVec(state.transform.position[2])

    yield* walkBody(ast, {}, state)

    // Flush any open path at the end
    if (state.currentPath) {
        yield { type: "path", ...state.currentPath }
    }

    // Final head event — tells materializer where the turtle ended up
    yield {
        type: "head",
        position: [...state.transform.position],
        rotation: state.transform.rotation,
        headSize: state.penState.showTurtle,
        color: state.penState.color
    }

    return state.commandCount
}

function* walkBody(body, scope, state) {
    let matched = false

    for (const node of body) {
        switch (node.type) {

        case 'Loop': {
            const times = evaluateExpr(node.value, scope, state)
            for (let i = 0; i < times; i++) {
                yield* walkBody(node.children, scope, state)
            }
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
            // Yield spawn event — the scheduler creates and manages the child
            yield {
                type: 'spawn',
                name: node.value,
                ast: node.children,
                transform: SE3.clone(state.transform),
                penState: { ...state.penState }
            }
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
