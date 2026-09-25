// AST walker as a generator coroutine — yields effects; scheduler is the OS.
// Math deps injected.

import { COMMANDS, DEFAULT_STYLE } from "./commands.js"
import { SE3 } from "./se3.js"
import { recenterPose } from "./view.js"
import { createStroke, extend as strokeExtend, flush as strokeFlush, fill as strokeFill } from "./stroke.js"
import { matchPattern } from "./match.js"

const roundVec = (v) => Math.abs(v) < 1e-10 ? 0 : Math.round(v * 1e9) / 1e9

// typeof guard: bare process?.env throws on undeclared process in the browser.
const envNum = (name) => {
    if (typeof process === "undefined") return 0
    return Number(process.env?.[name] ?? 0) || 0
}

// Breath quantum: node visits between preemption offers (BEAM reductions prior).
// Charge work, not talkativeness. Bench: command_cost_bench.mjs. (id:output-ledger-r3-meter)
const DEFAULT_BREATH_EVERY = envNum("DOJO_BREATH") || 512
// Self-break long strokes so the meter can see them (rate, not truth).
const DEFAULT_STROKE_MAX = envNum("DOJO_STROKE_MAX") || 512

// Per-hole residual domain {word, measure}. Missing verb → all measure.
// Word = name costume (ink, label text, shout name). Default measure is
// strict: bare unknown idents wound — never silent strings that NaN SE(3).
const ARG_DOMAINS = {
    beColour: ["word"],
    label: ["word", "measure"],
    shout: ["word", "measure"],
}

const holeDomain = (domains, i) => (domains?.[i] === "word" ? "word" : "measure")

// Retry evaluateExpr; yield blocked on cross-ambient read failure only.
// domain: "measure" (default) | "word"
function* evalOrBlock(expr, scope, state, domain = "measure") {
    while (true) {
        try {
            return evaluateExpr(expr, scope, state, domain)
        } catch (e) {
            if (e.blocked) {
                // The frame (or null when missing) the read waits on — the scheduler
                // needs it to tell a dataflow suspension from a cycle. (D011)
                yield { type: 'blocked', target: e.blockedFrame ?? null }
                continue
            }
            throw e
        }
    }
}

// Actor state for execute. Mutated in place so a throw keeps registered defs. (D020, id:cmp-t-healthy-parts)
export function createActorState(opts = {}) {
    return {
        // Empty eye seeds to recenterPose. (id:eye-view-pipeline)
        transform: opts.lens ? recenterPose() : SE3.identity(),
        // Lens is pen-up: Output is the viewport. (id:eye-lens-primitive)
        style: { ...DEFAULT_STYLE, color: opts.color || DEFAULT_STYLE.color, ...(opts.lens ? { down: false } : {}) },
        functions: opts.functions ? { ...opts.functions } : {},
        commandCount: 0,
        recurseCount: 0,
        maxRecurseDepth: opts.maxRecurseDepth || 360,
        maxRecurses: opts.maxRecurses || 888888,
        maxCommands: opts.maxCommands || 88888888,
        // Reductions: preemption meter (not language-visible commandCount). (D027 R3)
        reductions: 0,
        breathEvery: opts.breathEvery ?? DEFAULT_BREATH_EVERY,
        strokeMax: opts.strokeMax ?? DEFAULT_STROKE_MAX,  // 0 = off
        // LOCAL clock: this ambient's own waits, 0 at birth. Stable under
        // re-parenting — the compositional coordinate. (id:host-beat)
        elapsedTime: 0,
        // Birth on the shared axis: the parent's `birthtime + time` at spawn.
        // Root: 0. `birthtime + time` is where this ambient stands on the
        // axis, so timelines align without anyone reading a global now. (id:host-beat)
        birthtime: opts.birthtime || 0,
        // The beat ledger: source lines walked since the last temporal joint.
        // One `beat` event per wait, not one per node. (id:host-beat)
        beatLines: new Set(),
        loopCounter: opts.loopCounter || 0,
        mailbox: opts.mailbox || null,
        motionProtocol: opts.motionProtocol === true,
        observePureGoto: opts.observePureGoto === true,
        // Rebase inbox: a component transaction posts a pose here; this worker adopts
        // it at its next step. The scheduler never writes `transform` directly.
        rebase: undefined,
    }
}

export function* execute(ast, deps, opts = {}) {
    // actorState = continuation of same ambient; mutated in place across batches.
    const state = opts.actorState || createActorState(opts)

    // Pass-local stroke; always flushed before execute ends.
    const stroke = createStroke()

    state.deps = deps
    if (opts.actorState) state.loopCounter = opts.loopCounter ?? state.loopCounter

    deps.mathEvaluator.userFunctions = deps.mathParser.userspace

    // Lazy thunks — live values when read.
    const ec = deps.mathEvaluator.constants
    // `time` is your own clock (0 at birth); `birthtime` is your birth on the
    // shared axis. Two roots, one relation: `birthtime + time` is your place on
    // the axis, and the difference a user wants is just `time`. (id:host-beat)
    ec['time'] = () => state.elapsedTime / 1000
    ec['birthtime'] = () => state.birthtime / 1000
    ec['x'] = () => roundVec(state.transform.position[0])
    ec['y'] = () => roundVec(state.transform.position[1])
    ec['z'] = () => roundVec(state.transform.position[2])
    ec['count'] = () => state.loopCounter

    try {
        yield* walkBody(ast, opts.scope || {}, state, stroke)
    } catch (error) {
        adoptRebase(state)
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

    // A rebase that landed while the worker was between nodes is adopted before
    // the final head, so publication never disagrees with the worker's pose.
    adoptRebase(state)
    // Flush any open path at the end
    const pathEvent = strokeFlush(stroke)
    if (pathEvent) yield pathEvent

    // Flush the last beat — commands walked after the final wait. (id:host-beat)
    if (state.beatLines.size) {
        const lines = [...state.beatLines]
        yield { type: "beat", time: state.elapsedTime / 1000, birthtime: state.birthtime / 1000, line: lines[lines.length - 1], lines }
        state.beatLines.clear()
    }

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

// A component transaction posts a pose to this worker's inbox; the worker adopts
// it before the next command reads pose. The supervisor never writes `transform`.
// (id:laws-build-solve-seam — communicate, do not share memory)
function adoptRebase(state) {
    if (state.rebase === undefined) return
    state.transform = state.rebase
    state.rebase = undefined
}

const PURE_POINT_READ = /^[A-Za-z_][A-Za-z0-9_]*\.(?:x|y|z)$/

function* readGotoArgs(nodes, scope, state) {
    while (true) {
        const baseRevision = state.deps.mathEvaluator.beginObservation()
        let blocked
        try {
            const args = nodes.map(node => evaluateExpr(node.value, scope, state))
            return { args, baseRevision }
        } catch (error) {
            if (!error.blocked) throw error
            blocked = error
        } finally {
            state.deps.mathEvaluator.endObservation()
        }
        // D011 owns the wait; no partial argument or capture survives it.
        yield { type: 'blocked', target: blocked.blockedFrame ?? null }
    }
}

function* walkBody(body, scope, state, stroke) {
    let matched = false

    for (const node of body) {
        adoptRebase(state)   // a component rebase lands before this node reads pose
        // Offer preemption every breathEvery visits — work meter, not emits.
        state.reductions++
        if (state.breathEvery !== 0 && state.reductions % state.breathEvery === 0) {
            yield { type: "breath" }
        }
        // Record the line this node is walking. A Set, not an event: a loop
        // may visit the same line many times between waits. The wait is the
        // joint, not the ink: it stays out, so the beat's last line is the line
        // that drew or turned. (id:host-beat)
        if (node.span?.line != null && !(node.type === "Call" && node.value === "wait")) {
            state.beatLines.add(node.span.line)
        }
        try {
        switch (node.type) {

        case 'Loop': {
            const times = yield* evalOrBlock(node.value, scope, state)
            const prevCount = state.loopCounter
            for (let i = 0; i < times; i++) {
                // Observed a sibling → voluntary yield so ambients lockstep (coop MT).
                if (i > 0 && state.deps.mathEvaluator._observedSibling) {
                    state.deps.mathEvaluator._observedSibling = false
                    yield {
                        type: 'yield',
                        position: [...state.transform.position],
                        rotation: state.transform.rotation
                    }
                }
                // Empty body still burns a reduction (when-loop freeze fence).
                state.reductions++
                if (state.breathEvery !== 0 && state.reductions % state.breathEvery === 0) {
                    yield { type: "breath" }
                }
                state.loopCounter = i
                yield* walkBody(node.children, scope, state, stroke)
            }
            state.loopCounter = prevCount
            break
        }

        case 'Call': {
            // Capture foldable constants at def; deferred (random) stay symbolic.
            if (node.value === "fn" || node.value === "func") {
                const rawArgs = node.children.map(arg => arg.value)
                const fnScope = { ...scope }
                const ec = state.deps.mathEvaluator.constants
                const deferred = state.deps.mathEvaluator.deferred
                for (const key of Object.keys(ec)) {
                    if (deferred?.has(key)) continue   // late-evaluated: keep symbolic
                    if (!(key in fnScope)) fnScope[key] = ec[key]()
                }
                state.deps.mathParser.defineFunction(rawArgs[0], rawArgs[1] || 0, fnScope)
                break
            }

            // Only two pure ambient-coordinate arguments may retry as one read.
            if (state.observePureGoto && state.motionProtocol && node.value === 'goto' &&
                !state.functions[scope.goto || 'goto']) {
                if (node.children.length !== 2 ||
                    !node.children.every(arg => PURE_POINT_READ.test(arg.value))) {
                    yield { type: 'motionUnresolved', reason: 'unsupported goto arguments' }
                    break
                }
                let settled = false
                for (let retry = 0; retry < 2 && !settled; retry++) {
                    const { args, baseRevision } = yield* readGotoArgs(node.children, scope, state)
                    settled = (yield* callCommand('goto', args, state, stroke, baseRevision)) !== 'stale'
                }
                if (!settled) yield { type: 'motionUnresolved', reason: 'stale motion base' }
                break
            }

            // Zip each arg with its hole domain (default measure).
            const domains = ARG_DOMAINS[node.value]
            const args = []
            for (let i = 0; i < node.children.length; i++) {
                args.push(yield* evalOrBlock(node.children[i].value, scope, state, holeDomain(domains, i)))
            }

            // shout is a directive, not a COMMANDS entry — domain still from ARG_DOMAINS.
            if (node.value === "shout") {
                yield { type: 'shout', name: args[0], payload: args[1] }
                break
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
            // Grammar hole: ambient name is word (seeker, mice[count] after interp).
            const ambientName = String(yield* evalOrBlock(node.value, scope, state, "word"))
            yield {
                type: 'spawn',
                name: ambientName,
                frame: node.meta?.frame || null,
                // Fork spec — three groups: spatial, code, environment
                origin: SE3.clone(state.transform),
                style: { ...state.style },
                code: { ast: node.children, functions: { ...state.functions } },
                env: {
                    userspace: new Map(state.deps.mathParser.userspace),
                    loopCounter: state.loopCounter,
                    scope: { ...scope },
                    // The child's birth on the shared axis = `birthtime + time`
                    // of this ambient now. The child's own clock starts at 0. (id:host-beat)
                    birthtime: state.birthtime + state.elapsedTime,
                }
            }
            break
        }

        case 'Existence': {
            // A reached declaration is the birth site. It carries the executor's
            // post-command pose and source span; the scheduler seats or adopts the
            // identity before the next statement reads it. (id:laws-ordered-birth)
            yield {
                type: 'birth',
                name: node.value,
                origin: SE3.clone(state.transform),
                owner: node.span ?? null,
            }
            break
        }

        case 'Law': {
            // A reached law: one feature, one evaluated value. The declaring
            // frame is the observer. (id:laws-ordered-replacement)
            const feature = node.value
            const value = feature === 'distance'
                ? yield* evalOrBlock(node.meta.expr, scope, state)
                : node.meta.coords
            yield { type: 'law', feature, target: node.meta.target, value, owner: node.span ?? null }
            break
        }

        case 'Scalar': {
            // A scalar derived value: `let s = A.x`. The value is source-owned and
            // recomputed at the commit; a read of `s` is still a snapshot.
            // (id:laws-build-p3-readout-built)
            yield {
                type: 'scalar', name: node.value, owner: node.span ?? null,
                read: () => evaluateExpr(node.meta.expr, scope, state, 'measure'),
            }
            break
        }

        case 'Empty':
            break

        // Error node inert at walk; crash path still kills. (D020, id:cmp-resilient)
        case 'Error':
            break
        }
        } catch (error) {
            // Innermost span wins; do not overwrite. (id:cmp-runtime-provenance)
            if (error instanceof Error && !error.span && node.span) {
                error.span = node.span
                error.kind = 'walk'
            }
            throw error
        }
    }
}

// Headless walk; return registered namespace. Events discarded. (D019)
export function drainNamespace(ast, deps, opts = {}) {
    // Fault mid-phase keeps earlier defs. (D020)
    const actorState = opts.actorState ?? createActorState({ maxCommands: 200_000, ...opts })
    try {
        const gen = execute(ast, deps, { maxCommands: 200_000, ...opts, actorState })
        while (!gen.next().done) { /* events discarded */ }
        return { functions: actorState.functions, userspace: deps.mathParser.userspace, error: null }
    } catch (error) {
        return { functions: actorState.functions, userspace: deps.mathParser.userspace, error }
    }
}

function* callCommand(name, args, state, stroke, baseRevision) {
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
        style: state.style
    }

    // Snapshot position before command mutates transform
    stroke.lastPos = [...state.transform.position]

    const result = cmd(ctx, ...args)
    // Opt-in protocol: scheduler admits the proposed pose before state or stroke changes.
    if (result.transform && state.motionProtocol) {
        const admission = yield {
            type: "motion",
            command: name,
            from: state.transform,
            requested: result.transform,
            baseRevision,
        }
        // The scheduler hands back a normalized verdict: accept | refuse. A fault
        // never reaches here — the scheduler ends the frame instead.
        if (admission.kind === 'stale') { state.commandCount--; return 'stale' }
        if (admission.kind === "refuse") {
            result.transform = state.transform
            // Refusal is an interaction boundary: the verdict's ink says whether the
            // figure breaks or the trail joins through the held point.
            if (admission.ink === "continue" && result.stroke === "extend") {
                result.point = [...state.transform.position]
            } else if (result.stroke) {
                result.stroke = "break"
            }
        } else {
            result.transform = admission.pose
            if (result.stroke === "extend") result.point = admission.pose.position
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
            // Bound stroke so credit and ceiling stay real. (id:output-ledger-r3-meter)
            if (state.strokeMax !== 0 && stroke.path.points.length >= state.strokeMax) {
                const event = strokeFlush(stroke)
                if (event) yield event
            }
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
                // One beat per joint: the lines walked since the last wait, at
                // the program time the joint closed. (id:host-beat)
                if (state.beatLines.size) {
                    const lines = [...state.beatLines]
                    yield { type: "beat", time: state.elapsedTime / 1000, birthtime: state.birthtime / 1000, line: lines[lines.length - 1], lines }
                    state.beatLines.clear()
                }
                state.elapsedTime += event.duration
            }
            yield event
        }
    }
}

// --- Expression evaluation ---
// Delegates to the injected math parser/evaluator.
// The one owner of PaperLang expression evaluation.

// Memo parse by expression; WeakMap on injected parser. (id:output-ledger-r3-meter)
// Entry is { epoch, map }: parse() expands 0-arity userspace names into the
// tree, so a hit is only safe while mathParser.epoch is unchanged. defineFunction
// / reset bump epoch — without that, `label 'mice[out]'` then `fn out …` left
// the old expansion of `out` stuck in the memo (every later square renamed to
// the first; multi-index follow "worked" only when the label ran first).
const PARSE_MEMO = new WeakMap()
const MAX_MEMO = 512   // interpolated names ('mice[i]'.x) mint fresh strings

function parseMemo(mathParser, expr) {
    const epoch = mathParser.epoch ?? 0
    let entry = PARSE_MEMO.get(mathParser)
    if (entry === undefined || entry.epoch !== epoch) {
        entry = { epoch, map: new Map() }
        PARSE_MEMO.set(mathParser, entry)
    }
    const hit = entry.map.get(expr)
    if (hit !== undefined) return hit
    const tree = mathParser.parse(expr)
    if (entry.map.size >= MAX_MEMO) entry.map.clear()
    entry.map.set(expr, tree)
    return tree
}

// Residual after shared resolve: measure → wound; word → string costume.
// Math ops / quote interpolation stay measure. Not a numerical tower.
function evaluateExpr(expr, scope, state, domain = "measure") {
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
                    // Interpolation slots are always measure (count, x, …).
                    const value = evaluateExpr(innerExpr.trim(), scope, state, "measure")
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
        const name = evaluateExpr(computedDot[1] + computedDot[2] + computedDot[1], scope, state, domain)
        return evaluateExpr(name + '.' + computedDot[3], scope, state, domain)
    }

    if (mathParser.isNumeric(expr)) return parseFloat(expr)
    if (scope[expr] != null) return scope[expr]
    const tree = parseMemo(mathParser, expr)

    // Expression or known namespace — always evaluate (ops already strict on leaves).
    if (tree.children.length > 0 || mathEvaluator.namespace_check(tree.value)) {
        return mathEvaluator.run(tree, scope)
    }

    // Bare identifier — resolveExternal, then hole residual domain.
    if (typeof tree.value === 'string' && /^[a-zA-Z]/.test(tree.value)) {
        if (mathEvaluator.resolveExternal) {
            const resolved = mathEvaluator.resolveExternal(tree.value)
            if (resolved !== undefined) return resolved
        }
        if (domain === "word") return tree.value
        // A DOTTED NAME IS A CROSS-AMBIENT READ. Landing here means there is no
        // ambient tree to read against — the rehearsal is headless and does not
        // negotiate with siblings (D019). An absent sibling is NOTHING, not a
        // wound: words past it must still register. A live walk never lands
        // here for a dotted name — `namespace_check` routes it through
        // resolveExternal (`Undefined assistant` or blocks).
        if (tree.value.includes('.')) return null
        throw new Error(`Undefined variable: ${tree.value}`)
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
