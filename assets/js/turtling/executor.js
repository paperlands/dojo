// AST walker as a generator coroutine — yields effects; scheduler is the OS.
// Math deps injected.

import { COMMANDS, DEFAULT_STYLE, contractOf } from "./commands.js"
import { readArguments } from "./parse.js"
import { ASTNode } from "./ast.js"
import { SE3 } from "./se3.js"
import { recenterPose } from "./view.js"
import { createStroke, extend as strokeExtend, flush as strokeFlush, fill as strokeFill } from "./stroke.js"
import { matchPattern } from "./match.js"
import { payloadOf } from "./laws/authored.js"
import { isNumericLiteral } from "./mafs/number.js"
import { demand, measure, spellingOf, conditionOf, FINITE } from "./numerics.js"
import { notice } from "./report.js"
// A HOLE DEMANDS A MEASURE, and the answer belongs to the numerics surface: what the
// value IS (a fact, `conditionOf`) apart from what this consumer may DO about it (a
// verdict, `POLICY`). This file holds no epsilon and no rule of its own — only the
// name of the consumer asking. (id:tower-center-approximation, ruling: absent-is-zero)
//
// The two passes that judge VOCABULARY rather than ink — the headless rehearsal (where
// a seat's diagnostics come from) and a closed construction — refuse a value of the
// wrong kind outright. A live walk is told and carries on: a refusal drops the ONE
// statement, never the figure (D020).
const consumerOf = (state) => state.strict ? "construction" : state.rehearsal ? "vocabulary" : "walk"

// The door, and a PLAIN call. `yield*` on every argument costs more than the check it
// wraps — measured 162 ns of delegation per argument, and no profile can see it, because
// the cost lands in the CALLER's self time. So: the value comes back, or a refusal is
// thrown and the walk's own catch yields what the author is owed, where the statement is.
// The common path returns before any verdict object exists.
function admit(value, expr, domain, state) {
    if (domain !== "finite") return value
    if (conditionOf(value) === FINITE) return value
    return measure(value, { as: consumerOf(state), expr })
}

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
// Charge one reduction. A construction budget refuses exhaustion rather than
// returning a shortened answer. (id:laws-living-figures-review-next)
function chargeReductions(state) {
    state.reductions++
    if (state.maxReductions && state.reductions > state.maxReductions) {
        const error = new Error(`Maximum reductions of ${state.maxReductions} reached`)
        error.kind = 'budget'
        throw error
    }
}

// Hole kinds and arity live WITH the command (commands.js `COMMANDS`), so the
// contract follows the resolved callable and cannot disagree with itself. (id:gw-grammar)

const holeDomain = (holes, i) => holes?.[i] ?? "measure"

// Hoisted: building a RegExp per evaluation is churn, and only a quoted spelling can
// begin a string literal or a computed dotted access. (profile: evaluateExpr)
const QUOTE_RE = /^(['"])(.*?)\1$/
const COMPUTED_DOT_RE = /^(['"])(.*?)\1\.(.+)$/
const IDENT_HEAD_RE = /^[a-zA-Z]/
// Retry evaluateExpr; yield blocked on cross-ambient read failure only.
// domain: "measure" (default) | "word"
function* evalOrBlock(expr, scope, state, domain = "measure") {
    while (true) {
        try {
            return admit(evaluateExpr(expr, scope, state, domain), expr, domain, state)
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
        style: { ...DEFAULT_STYLE, ...(opts.style || {}), ...(opts.color ? { color: opts.color } : {}), ...(opts.lens ? { down: false } : {}) },
        functions: opts.functions ? { ...opts.functions } : {},
        // The actor's randomness capability. A construction installs a refusing
        // source so a command cannot reach the process RNG. (id:laws-living-figures-capability-review)
        random: opts.random || Math.random,
        // A headless rehearsal publishes nothing, so a nothing pose there is not a
        // wound; `drainNamespace` sets this. (phase 1: rehearsal behavior)
        rehearsal: opts.rehearsal === true,
        commandCount: 0,
        recurseCount: 0,
        maxRecurseDepth: opts.maxRecurseDepth || 360,
        maxRecurses: opts.maxRecurses || 888888,
        // A recursion cap that stopped the walk: construction refuses rather than
        // passing off a shortened drawing under the requested depth's name.
        truncated: false,
        // Strict construction: an inert Error node is refused, so a recipe reached
        // through dynamic dispatch cannot execute a parse-error body silently.
        strict: opts.strict === true,
        maxCommands: opts.maxCommands || 88888888,
        // Reductions: preemption meter (not language-visible commandCount). (D027 R3)
        reductions: 0,
        maxReductions: opts.maxReductions ?? 0,   // 0 = unbounded (ordinary walks)
        breathEvery: opts.breathEvery ?? DEFAULT_BREATH_EVERY,
        strokeMax: opts.strokeMax ?? DEFAULT_STROKE_MAX,  // 0 = off
        // LOCAL clock: this ambient's own waits, 0 at birth. Stable under
        // re-parenting — the compositional coordinate. (id:host-beat)
        // A construction inherits the declaring frame's logical clock; ordinary
        // frames start at 0 and advance on `wait`. (id:host-beat)
        elapsedTime: opts.elapsedTime || 0,
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
    // A place reads its own coordinate, exactly. No floor, no decimal snapping: a
    // figure must be able to see the ink it just laid down. What the eye sees is the
    // display's business, and it never feeds back. (ruling 3)
    ec['x'] = () => state.transform.position[0]
    ec['y'] = () => state.transform.position[1]
    ec['z'] = () => state.transform.position[2]
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
        chargeReductions(state)
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
            // A count is a decision too: a count that is not a finite number is not a
            // count, so the loop is not taken — and the author is told why.
            const asked = demand(yield* evalOrBlock(node.value, scope, state),
                { as: "count", expr: node.value, span: node.span ?? null })
            if (asked.notice) yield asked.notice
            if (asked.verdict !== "take") continue
            const times = asked.value
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
                chargeReductions(state)
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
            // 0-arity is a value set down, not a window. Looks (X.x) bottle
            // like time; recipes keep their holes; deferred (random) stay
            // symbolic. (id:prim-fn)
            if (node.value === "fn" || node.value === "func") {
                const rawArgs = node.children.map(arg => arg.value)
                // A recipe is a signature and ONE body expression. A third piece
                // of ink would be dropped silently — refuse it. (id:gw-grammar)
                if (rawArgs.length > 2) {
                    throw new Error(`fn takes a signature and a body, but ${rawArgs.length} arguments were given`)
                }
                const signature = rawArgs[0]
                let expression = rawArgs[1] || 0
                const fnScope = { ...scope }
                const ec = state.deps.mathEvaluator.constants
                const deferred = state.deps.mathEvaluator.deferred
                for (const key of Object.keys(ec)) {
                    if (deferred?.has(key)) continue   // late-evaluated: keep symbolic
                    if (!(key in fnScope)) fnScope[key] = ec[key]()
                }
                const parser = state.deps.mathParser
                if (typeof parser.parseSignature === "function") {
                    const { params } = parser.extractSignature(parser.parseSignature(signature))
                    if (params.length === 0) {
                        const tree = parseMemo(parser, String(expression))
                        if (!readsDeferred(tree, deferred ?? new Set())) {
                            const value = yield* evalOrBlock(String(expression), scope, state)
                            if (typeof value === "number" && Number.isFinite(value)) {
                                expression = String(value)
                            }
                        }
                    }
                }
                parser.defineFunction(signature, expression, fnScope)
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

            // Resolve the recipient FIRST: a user definition brings its own contract.
            // The holes (arity + kinds) follow the resolved callable, not the spelling.
            const userFn = state.functions[scope[node.value] || node.value]
            const holes = userFn
                ? userFn.parameters.map(() => "measure")
                : (contractOf(node.value)?.holes ?? [])
            // The callable's own contract. Extra arguments were authored, so dropping
            // them silently would answer a different question — refuse instead.
            // (id:gw-grammar)
            if (node.children.length > holes.length) {
                throw new Error(`${node.value} takes ${holes.length} argument${holes.length === 1 ? "" : "s"}, but ${node.children.length} were given`)
            }
            const args = []
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i]
                // A computed argument is already EVALUATED, but not thereby ADMITTED:
                // it crosses the SAME admission as a source argument. Source or value,
                // one authority decides whether the callable can use it.
                // Already evaluated ≠ already admitted. (id:eval-relational)
                if (child.type === 'Value') {
                    args.push(admit(child.value, spellingOf(child.value), holeDomain(holes, i), state))
                    continue
                }
                args.push(yield* evalOrBlock(child.value, scope, state, holeDomain(holes, i)))
            }

            // shout is a directive, not a COMMANDS entry — and not a user fn.
            if (node.value === "shout" && !userFn) {
                yield { type: 'shout', name: args[0], payload: args[1] }
                break
            }
            if (userFn) {
                const currDepth = scope['__depth__'] || 0
                if (currDepth > 1) state.recurseCount++
                if (state.recurseCount >= state.maxRecurses) {
                    throw new Error(`Maximum recurse limit of ${state.maxRecurses} reached`)
                }
                if (currDepth + 1 > state.maxRecurseDepth) { state.truncated = true; break }

                // Build child scope with parameter bindings. These do NOT go on the frame:
                // a frame-scoped binding would leak past the call (measured: `fw size` after
                // two calls read the second call's argument). They cross to a child through
                // the payload's captured scope instead, which is a snapshot per declaration.
                // (id:turtle-ambient-calculus)
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
                // Conditional mode: first-match-wins via matched flag — the guard wraps
                // EVALUATION itself, so an unconsidered branch is never asked and cannot
                // throw, notice, or suspend. Admission must not reorder evaluation.
                if (!matched) {
                    // A branch is a DECISION. A condition that has no answer takes no branch,
                    // and says so: ordering a figure by a non-answer is how it goes wrong with
                    // no ink to show for it. (numerics: conditionOf, POLICY.condition)
                    const asked = demand(yield* evalOrBlock(node.value, scope, state),
                        { as: "condition", expr: node.value, span: node.span ?? null })
                    if (asked.notice) yield asked.notice
                    if (asked.verdict === "take" && asked.value !== 0) {
                        matched = true
                        yield* walkBody(node.children, scope, state, stroke)
                    }
                }
            }
            break
        }

        case 'Ambient': {
            // Grammar hole: ambient name is word (seeker, mice[count] after interp).
            const ambientName = String(yield* evalOrBlock(node.value, scope, state, "word"))
            yield spawnEvent(state, scope, ambientName, node.children, state.functions, { frame: node.meta?.frame || null })
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
            // The distance payload is sampled when reached. Later changes to its source
            // value do not revise this law.
            // A dependency-driven law revision (externally determined r) and a
            // relational unknown (r chosen jointly with positions) are different
            // capabilities; the former does not require the latter.
            // (id:eval-relational)
            const feature = node.value
            const value = payloadOf(feature) === 'expr'
                ? yield* evalOrBlock(node.meta.expr, scope, state)
                : node.meta.coords
            yield { type: 'law', feature, target: node.meta.target, value, axis: node.meta.axis ?? null, owner: node.span ?? null }
            break
        }

        case 'Scalar': {
            // A `let s = <expr>` names one of three things, and the spelling must
            // not decide which by accident. A deferred (stochastic) primitive is a
            // PARAMETER: sampled once here, then a stable input — an unrelated commit
            // must not resample it. Everything else is a DERIVED value: a pure
            // reading of accepted state, recomputed at the commit. A value chosen
            // subject to relationships (an UNKNOWN) has no spelling yet and is not
            // this case. (id:eval-relational, id:laws-build-p3-readout-built)
            const expr = node.meta.expr
            // A recipe call is a figure, not a number: emit the construction
            // intent; the scheduler owns the cell and its lifetime.
            const figureCall = figureCallOf(expr, state)
            if (figureCall) {
                const arity = state.functions?.[figureCall.recipe]?.parameters?.length ?? 0
                // A missing hole is the command's own default, or 0 for a def.
                // Not a wound. (id:eval-relational)
                const inputs = []
                for (const arg of figureCall.args) {
                    inputs.push(yield* evalOrBlock(arg, scope, state, 'reading'))
                }
                while (inputs.length < arity) inputs.push(0)
                const call = new ASTNode('Call', figureCall.recipe,
                    inputs.map((input) => new ASTNode('Value', input)))
                call.span = node.span ?? null
                // A proper `let`: a place (identity and name) whose body is the
                // recipe. A rebuild restarts the walk at this birth pose, not at the
                // last head — see rewireChild's derived branch. (id:laws-figure-protocol)
                yield { type: 'birth', name: node.value, origin: SE3.clone(state.transform), owner: node.span ?? null }
                yield spawnEvent(state, scope, node.value, [call], state.functions, { profile: 'derived', question: inputs, recipe: figureCall.recipe, argExprs: figureCall.args })
                break
            }
            const deferred = state.deps?.mathEvaluator?.deferred
            let stochastic = false
            if (deferred && typeof expr === 'string') {
                try { stochastic = readsDeferred(parseMemo(state.deps.mathParser, expr), deferred) } catch { stochastic = false }
            }
            if (stochastic) {
                // Sampled here, once. `random` is an input, not a reading.
                yield {
                    type: 'parameter', name: node.value, owner: node.span ?? null,
                    value: evaluateExpr(expr, scope, state, 'measure'),
                }
                break
            }
            yield {
                type: 'scalar', name: node.value, owner: node.span ?? null,
                read: () => evaluateExpr(expr, scope, state, 'measure'),
            }
            break
        }

        case 'Empty':
            break

        // A malformed statement is inert at the walk — the healthy siblings still run
        // (D020) — but inert is not silent: the incompleteness rides the SAME notice shape
        // as a refused measure, so the author reads one kind of report. A construction is
        // strict: there it refuses instead.
        // (id:cmp-resilient, id:laws-figures-phase34-capabilities)
        case 'Error':
            if (state.strict) {
                const strict = new Error(`construction refused: '${node.value}' did not parse`)
                strict.kind = 'strict'
                strict.span = node.span
                throw strict
            }
            yield notice({
                kind: 'parse',   // the house's own kind for a tree that would not build
                message: `this line did not parse — expected ${node.meta?.expected ?? 'a statement'}, found ${node.meta?.found ?? `'${node.value}'`}`,
                span: node.span ?? null,
            })
            break
        }
        } catch (error) {
            // Innermost span wins; do not overwrite. (id:cmp-runtime-provenance)
            if (error instanceof Error && !error.span && node.span) {
                error.span = node.span
                // A deliberate kind (a work budget) outranks the walk label.
                if (!error.kind) error.kind = 'walk'
            }
            // A refusal carries the numerics verdict: what the author is owed is YIELDED
            // where it is located, and only a pass that judges vocabulary stops for it.
            // A refused statement drops the ONE statement, never the figure (D020).
            if (error.refusal) {
                // A refusal that STOPS the pass is carried by the frame's error alone: the
                // same fact said twice is a reader's problem, not a richer record.
                if (error.refusal.stops) throw error
                if (error.refusal.notice) {
                    error.refusal.notice.span ??= error.span ?? null
                    yield error.refusal.notice
                }
                continue
            }
            throw error
        }
    }
}

// Headless walk; return registered namespace. Events discarded. (D019)
export function drainNamespace(ast, deps, opts = {}) {
    // Fault mid-phase keeps earlier defs. (D020)
    const actorState = opts.actorState ?? createActorState({ maxCommands: 200_000, ...opts })
    actorState.rehearsal = true   // headless: nothing publishes, so a nothing pose is not a wound
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
        style: state.style,
        random: state.random,
        as: consumerOf(state)
    }

    // Snapshot position before command mutates transform
    stroke.lastPos = [...state.transform.position]

    const result = cmd(ctx, ...args)
    // Admit the accumulated clock before a wait flushes ink or changes run state.
    if (result.effects) {
        for (const event of result.effects) {
            if (event.type === "wait") {
                measure(state.elapsedTime + event.duration, { as: consumerOf(state), expr: "elapsed time" })
            }
        }
    }
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

// Does an expression name a deferred (stochastic) primitive? Used to keep a
// sampled input a parameter, not a value recomputed by an unrelated commit.
// (id:eval-relational)
// A figure-valued binding: `let flake = recipe[args]` where `recipe` is a turtle
// procedure (a `def`), not a math function. Recognized at walk so the math
// evaluator never sees it. The captured args are the question; construction is
// the answer, and runs outside publication. (id:laws-figure-eidos-naming)
// One argument list, however the call is written: top-level commas and brackets
// group, nesting is respected. (id:laws-figures-phase34-review)
function splitTopLevel(s) {
    const out = []
    let depth = 0, start = 0
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (c === '[' || c === '(') depth++
        else if (c === ']' || c === ')') depth--
        else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1 }
    }
    out.push(s.slice(start))
    return out
}


// The spawn payload — the ONE door a child inherits through: space (origin),
// colour (style), vocabulary (code + userspace), captured scope, and logical
// birth on the shared axis. `as … do` and a figure binding share it, so a figure
// IS a child ambient, not a parallel construction. (id:turtle-ambient-calculus)
function spawnEvent(state, scope, name, body, functions, extra = {}) {
    return {
        type: 'spawn',
        name,
        // What the caller BOUND crosses with the child: a whitelist here silently
        // dropped a field once, and the child's question went empty. The named
        // fields below neutralise only the undefineds.
        ...extra,
        frame: extra.frame ?? null,
        profile: extra.profile ?? null,
        question: extra.question ?? null,
        origin: SE3.clone(state.transform),
        style: { ...state.style },
        code: { ast: body, functions: { ...(functions ?? state.functions) } },
        env: {
            userspace: new Map(state.deps.mathParser.userspace),
            loopCounter: state.loopCounter,
            scope: { ...scope },
            birthtime: state.birthtime + state.elapsedTime,
        },
    }
}

// A recipe call is ONE call, however it is written: `recipe a b` and
// `recipe[a, b]` reach the same argument list, and `recipe` alone is a call with
// no inputs. The recipe's OWN signature decides where an input ends — never a
// splitter, because no splitter can know that `r 2 + 3` is one input to a
// one-input recipe and three tokens to nothing else.
// (id:laws-figure-eidos-naming, id:laws-figures-phase34-review)
function figureCallOf(expr, state) {
    if (typeof expr !== 'string') return null
    const head = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(expr)
    if (!head) return null
    const name = head[1]
    const signature = state.functions?.[name]
    const cmd = signature ? null : COMMANDS.get(name)
    if (!signature && !cmd) return null
    const rest = expr.slice(head[0].length).trim()
    // The invocation reads its arguments with the SAME boundary contract as a command
    // line — holding a figure must not re-read its arguments. A bracketed `[a, b]`
    // spelling is its own explicit list. (id:gw-grammar)
    if (rest.startsWith('[') && rest.endsWith(']')) {
        const inner = rest.slice(1, -1).trim()
        return { recipe: name, args: inner === '' ? [] : splitTopLevel(inner).map((a) => a.trim()) }
    }
    return { recipe: name, args: readArguments(rest) }
}


function readsDeferred(tree, names) {
    if (!tree) return false
    if (tree.type === 'operand' && names.has(tree.value)) return true
    for (const child of tree.children ?? []) if (readsDeferred(child, names)) return true
    return false
}

// Residual after shared resolve: measure → wound; word → string costume.
// Math ops / quote interpolation stay measure. Not a numerical tower.
// A quoted run is ONE primitive: a literal whose `[…]` slots are interpolation.
// Interpolation happens wherever the run is evaluated — as argument text or as a
// lowered string value — so a literal and a template never disagree by route.
// (phase 1: coherent meaning)
function interpolate(text, scope, state) {
    let processed = text
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
                // A lowered value is SEMANTIC: it may mint a name, address a sibling,
                // or store a string — so it keeps every bit. Rounding for the eye is the
                // display gate at the consumer (numerics:format), never here. (id:tower-center-approximation-ruling)
                return value !== undefined ? String(value) : match
            }
        )
    } while (processed !== previous)
    return processed
}

function evaluateExpr(expr, scope, state, domain = "measure") {
    const { mathParser, mathEvaluator } = state.deps

    // Only a quoted spelling can be a string literal or a computed dotted access
    // ('interp'.rest). Every other expression — numbers, names, operators — skips
    // both matches. (profile: this ran two regexes on every evaluation.)
    const head = expr[0]
    if (head === "'" || head === '"') {
        const quoteMatch = expr.match(QUOTE_RE)
        if (quoteMatch) return interpolate(quoteMatch[2], scope, state)

        // 'interp'.rest — interpolate the quoted name, then access the property.
        // e.g. 'mice[follow]'.x → 'mice1.x' → dotted access
        const computedDot = expr.match(COMPUTED_DOT_RE)
        if (computedDot) {
            const name = evaluateExpr(computedDot[1] + computedDot[2] + computedDot[1], scope, state, domain)
            return evaluateExpr(name + '.' + computedDot[3], scope, state, domain)
        }
    }

    if (isNumericLiteral(expr)) return parseFloat(expr)
    // A name bound to NOTHING is still a name: `!= null` would fall through to the
    // identifier path and report a bound null as "Undefined variable".
    if (scope[expr] !== undefined) return scope[expr]
    const tree = parseMemo(mathParser, expr)

    // A LITERAL is not a reference: its word is returned as-is, never resolved.
    if (tree.type === 'string') return interpolate(tree.value, scope, state)
    // A held value is the value itself: never interpolated, resolved, or read as
    // a namespace. (id:tower-tension-repr)
    if (tree.type === 'literal') return tree.value

    // Expression or known namespace — always evaluate (ops already strict on leaves).
    if (tree.children.length > 0 || mathEvaluator.namespace_check(tree.value)) {
        return mathEvaluator.run(tree, scope)
    }

    // Bare identifier — resolveExternal, then hole residual domain.
    if (typeof tree.value === 'string' && IDENT_HEAD_RE.test(tree.value)) {
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
