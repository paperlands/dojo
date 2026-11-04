// AST walker as a generator coroutine — yields effects; scheduler is the OS.
// Math deps injected.

import { COMMANDS, DEFAULT_STYLE, contractOf } from "./commands.js"
import { SE3 } from "./se3.js"
import { recenterPose } from "./view.js"
import { createStroke, extend as strokeExtend, flush as strokeFlush, fill as strokeFill } from "./stroke.js"
import { matchPattern } from "./match.js"
import { storageSpace } from "./localize.js"
import { parseMemo } from "./mafs/parse_memo.js"
import { demand, measure, conditionOf, FINITE } from "./numerics.js"
import { notice } from "./report.js"
import { isBeing } from "./frame.js"
import { extend, project, isLocal } from "./bindings.js"
import { evalOrBlock, readsDeferred } from "./expressions.js"
import { acquireArgument, bindTarget, bindDisplay, readPointArgs, consumerOf, holeDomain, isTargetCall } from "./arguments.js"
import { declareExistence, declareValue, declareLaw, spawnEvent } from "./declarations.js"

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

// A host ceiling is a positive integer, or absent. Zero and fractions are not
// a quieter way to say "unlimited".
function positiveCeiling(value, what = "command ceiling") {
    if (value == null) return null
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${what} must be a positive integer`)
    }
    return value
}

// The program may lower its working limit. It may not raise the host ceiling.
function adoptCommandLimit(state, requested) {
    if (!Number.isInteger(requested) || requested < 1) {
        throw new Error("limitCommand needs a positive integer")
    }
    const ceiling = state.commandCeiling
    return ceiling == null ? requested : Math.min(requested, ceiling)
}

function adoptRecurseLimit(state, requested) {
    if (!Number.isInteger(requested) || requested < 1) {
        throw new Error("limitRecurse needs a positive integer")
    }
    const ceiling = state.recurseCeiling
    return ceiling == null ? requested : Math.min(requested, ceiling)
}

// Actor state for execute. Mutated in place so a throw keeps registered defs. (D020, id:cmp-t-healthy-parts)
export function createActorState(opts = {}) {
    const commandCeiling = positiveCeiling(opts.commandCeiling)
    const recurseCeiling = positiveCeiling(opts.recurseCeiling, "recurse ceiling")
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
        // The working depth cannot exceed the host ceiling. Reaching the ceiling
        // refuses; reaching a lower working depth truncates. (id:host-runtime-play)
        recurseCeiling,
        maxRecurseDepth: recurseCeiling == null
            ? (opts.maxRecurseDepth || 360)
            : Math.min(recurseCeiling, opts.maxRecurseDepth || recurseCeiling),
        maxRecurses: opts.maxRecurses || 888888,
        truncated: false,
        // Strict construction: an inert Error node is refused, so a recipe reached
        // through dynamic dispatch cannot execute a parse-error body silently.
        strict: opts.strict === true,
        // A host ceiling is not the working limit. The working limit starts at the
        // ceiling when one was promised, and a program may only lower it.
        commandCeiling,
        maxCommands: commandCeiling ?? (opts.maxCommands || 88888888),
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

    // A standalone execution owns world storage; seated frames supply their own basis.
    // (id:world-coordinate-phase-2)
    deps.space ??= storageSpace(SE3.identity)
    state.deps = deps
    if (opts.actorState) state.loopCounter = opts.loopCounter ?? state.loopCounter

    deps.mathEvaluator.userFunctions = deps.mathParser.userspace
    deps.mathEvaluator.parser = deps.mathParser

    // Lazy thunks — live values when read.
    const ec = deps.mathEvaluator.constants
    // `time` is your own clock (0 at birth); `birthtime` is your birth on the
    // shared axis. Two roots, one relation: `birthtime + time` is your place on
    // the axis, and the difference a user wants is just `time`. (id:host-beat)
    ec['time'] = () => state.elapsedTime / 1000
    ec['birthtime'] = () => state.birthtime / 1000
    // World position of the private continuation; published participant geometry has its own owner.
    // (id:world-coordinate-phase-2-reads)
    const cursor = () => state.deps.space.sample().toWorldPoint(state.transform.position)
    ec['x'] = () => cursor()[0]
    ec['y'] = () => cursor()[1]
    ec['z'] = () => cursor()[2]
    ec['count'] = () => state.loopCounter

    try {
        yield* walkBody(ast, opts.scope || {}, state, stroke)
    } catch (error) {
        adoptRebase(state)
        // Flush accumulated path before crash propagates — valid geometry survives
        const pathEvent = strokeFlush(stroke)
        if (pathEvent) yield pathEvent
        yield headEventOf(state)
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
    yield headEventOf(state)

    return { commandCount: state.commandCount, actorState: state }
}

// The head event, ONE shape — the walk's and the scheduler's display projections
// agree by construction. (id:ft-d5-head)
export function headEventOf(state, pose = state?.transform) {
    return {
        type: 'head', position: [...pose.position], rotation: pose.rotation,
        headSize: state?.style?.showTurtle, color: state?.style?.color,
    }
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
            const asked = demand(yield* evalOrBlock(node.value, scope, state.deps),
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
                const fnScope = project(scope)
                const ec = state.deps.mathEvaluator.constants
                const deferred = state.deps.mathEvaluator.deferred
                for (const key of Object.keys(ec)) {
                    if (deferred?.has(key)) continue   // late-evaluated: keep symbolic
                    if (key in fnScope) continue
                    // An omitted shadowed property is CLAIMED, not free: a locally declared
                    // `x` must not be replaced here by the cursor constant. (id:being-facets-centers-review)
                    if (isLocal(scope, key)) continue
                    fnScope[key] = ec[key]()
                }
                const parser = state.deps.mathParser
                if (typeof parser.parseSignature === "function") {
                    const { params } = parser.extractSignature(parser.parseSignature(signature))
                    if (params.length === 0) {
                        const tree = parseMemo(parser, String(expression))
                        if (!readsDeferred(tree, deferred ?? new Set())) {
                            const value = yield* evalOrBlock(String(expression), scope, state.deps)
                            if (conditionOf(value) === FINITE) {
                                expression = String(value)
                            }
                        }
                    }
                }
                parser.defineFunction(signature, expression, fnScope)
                break
            }

            // Pure point arguments share one observation; a stale candidate rereads the
            // whole command, never a retained coordinate. (id:being-facets-situated)
            const observeGoto = state.observePureGoto && node.value === 'goto' &&
                !state.functions[scope.goto || 'goto']
            const observeAim = node.value === 'faceto' && !state.functions[scope.faceto || 'faceto'] &&
                node.children.length >= 2 && node.children.length <= 3 &&
                node.children.every(arg => PURE_POINT_READ.test(arg.value)) &&
                typeof state.deps.mathEvaluator.beginObservation === 'function'
            if (state.motionProtocol && (observeGoto || observeAim)) {
                if (observeGoto && (node.children.length !== 2 ||
                    !node.children.every(arg => PURE_POINT_READ.test(arg.value)))) {
                    yield { type: 'motionUnresolved', reason: 'unsupported goto arguments' }
                    break
                }
                let settled = false, observed = false
                for (let retry = 0; retry < 2 && !settled; retry++) {
                    const reading = yield* readPointArgs(node.children, scope, state, node.value)
                    if (!reading) break
                    observed = true
                    settled = (yield* callCommand(node.value, reading.args, state, stroke, reading.baseRevision)) !== 'stale'
                }
                if (observed) {
                    if (!settled) yield { type: 'motionUnresolved', reason: 'stale motion base' }
                    break
                }
            }

            // Resolve the recipient FIRST: a user definition brings its own contract.
            // The holes (arity + kinds) follow the resolved callable, not the spelling.
            const userFn = state.functions[scope[node.value] || node.value]
            const spec = userFn ? null : contractOf(node.value)
            const holes = userFn
                ? userFn.parameters.map(() => "measure")
                : (spec?.holes ?? [])
            // A "target" callable is a whole-call signature; the ONE reader is
            // isTargetCall. Every other callable consumes one argument per hole.
            const target = !userFn && isTargetCall(spec)
            // A display consumer is named by its spec, never inferred from a hole kind.
            const display = spec?.display === true
            const maxArity = target ? 3 : holes.length
            if (node.children.length > maxArity) {
                throw new Error(`${node.value} takes ${maxArity} argument${maxArity === 1 ? "" : "s"}, but ${node.children.length} were given`)
            }
            // 1 · ACQUIRE — a name resolves to its value or retained being; a scalar hole
            // still admits. A target argument is preserved for the binder.
            // (id:world-coordinate-phase-3)
            const raw = []
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i]
                const domain = target ? "measure" : holeDomain(holes, i)
                raw.push(yield* acquireArgument(child, scope, state, domain, target))
            }
            // 2 · BIND — a display word shows a being's location, possibly waiting; a
            // target is bound by callCommand, which owns the one basis sample.
            // (id:world-coordinate-phase-3)
            const args = target ? raw : []
            if (!target) {
                for (let i = 0; i < raw.length; i++) args.push(yield* bindDisplay(raw[i], holeDomain(holes, i), display, state))
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
                if (state.recurseCeiling != null && currDepth + 1 > state.recurseCeiling) {
                    throw new Error(`Maximum recurse depth of ${state.recurseCeiling} reached`)
                }
                if (currDepth + 1 > state.maxRecurseDepth) { state.truncated = true; break }

                // Build child scope with parameter bindings. These do NOT go on the frame:
                // a frame-scoped binding would leak past the call (measured: `fw size` after
                // two calls read the second call's argument). They cross to a child through
                // the payload's captured scope instead, which is a snapshot per declaration.
                // (id:turtle-ambient-calculus)
                const childScope = {}
                // Only an OMITTED argument takes the recipe default. A supplied empty
                // string, zero, false or explicit nothing keeps its meaning and faces the
                // consumer's own policy — presence, never truthiness. (id:eval-relational)
                userFn.parameters.forEach((param, i) => {
                    childScope[param] = i < args.length ? args[i] : 0
                })
                childScope['__depth__'] = currDepth + 1
                // The call scope is innermost for this frame's execution: a formal
                // outranks the caller's own scalar. A spawned frame gets a fresh state,
                // so its own declarations outrank the scope it captured.
                // (id:being-facets-p2-seam)
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
                        const boundCaptures = node.meta.binding
                            ? [...Object.keys(captures), node.meta.binding] : Object.keys(captures)
                        const childScope = extend(scope, boundCaptures)
                        Object.assign(childScope, captures)
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
                    const asked = demand(yield* evalOrBlock(node.value, scope, state.deps),
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
            // A bare selector needs the relative precedence of two binding stores. A
            // callee's formal scope is innermost, so it outranks the caller's own scalar;
            // outside a call, THIS frame's own declaration shadows a captured outer
            // binding, and an ancestor name never redirects a passed participant.
            // Quoted and interpolated forms stay words. (id:being-facets-centers-review)
            // A bare selector resolves through the one ambient precedence: a nearer
            // frame declaration wins over a captured binding, and a call formal stays
            // innermost. Quoted and interpolated forms stay words.
            // (id:being-facets-centers-review)
            const selected = yield* evalOrBlock(node.value, scope, state.deps, "word")
            // A bound being crosses by identity; only a spelling is coerced to a name.
            // (id:being-facets-p2-seam)
            const receiver = isBeing(selected) ? selected : null
            const ambientName = receiver ? receiver.name : String(selected)
            yield spawnEvent(state, scope, ambientName, node.children, state.functions,
                { frame: node.meta?.frame || null, receiver, site: node.span?.line != null ? String(node.span.line) : null })
            break
        }

        case 'Construct': {
            // An EXPLICIT construction: a fresh local identity whose requested obligations
            // are prepared together and admitted by one publication. A condition never
            // introduces on its own; this statement asks for the place. (id:laws-first-two-pin-birth)
            yield { type: 'construct', name: String(node.value), seed: node.meta.seed ?? [0, 0, 0],
                obligations: node.meta.obligations ?? [], owner: node.span ?? null }
            break
        }

        case 'Existence':
            yield* declareExistence(node, scope, state)
            break

        case 'Law':
            yield* declareLaw(node, scope, state)
            break

        case 'Declaration':
            yield* declareValue(node, scope, state)
            break

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

    // A coordinate consumer reads the world chart through ONE adapter: the receiver's
    // own storage basis, sampled once for the forward and return conversions. The
    // callable's own spec carries the coordinate contract, so aliases inherit it.
    // (id:world-coordinate-phase-2)
    const spec = contractOf(name)
    const target = isTargetCall(spec)
    const convert = target ? state.deps.space.sample() : null
    // ONE sampled cursor: completion's world height and the return conversion share it,
    // and the consumer's required value is acquired here, possibly waiting.
    // (id:world-coordinate-phase-3)
    const world = convert ? convert.toWorld(state.transform) : null
    if (target) args = [yield* bindTarget(args, state, world.position[2])]
    const ctx = {
        transform: convert ? world : state.transform,
        style: state.style,
        random: state.random,
        as: consumerOf(state)
    }

    // Snapshot position before command mutates transform
    stroke.lastPos = [...state.transform.position]

    const result = cmd(ctx, ...args)
    if (convert && result.transform) {
        // 3 · PROPOSE — the command returned only the fields it changed, in world terms.
        // Convert exactly those; an untouched component never takes a round trip.
        // (id:world-coordinate-phase-3)
        const patch = result.transform
        result.transform = {
            rotation: patch.rotation ? convert.toLocalRotation(patch.rotation) : state.transform.rotation,
            position: patch.position ? convert.toLocalPoint(patch.position) : [...state.transform.position],
        }
        if (result.stroke === "extend") result.point = [...result.transform.position]
    }
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
            // The accepted verdict is an INDEPENDENTLY OWNED cursor value. Publishing stored
            // this pose in the receiver's atom, so adopting admission.pose directly would
            // alias the continuation to the world (mutating the parked cursor would move the
            // receiver). Copy pose AND ink point. (id:being-facets-p4-sequence)
            result.transform = SE3.clone(admission.pose)
            if (result.stroke === "extend") result.point = [...result.transform.position]
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
            state.maxRecurseDepth = adoptRecurseLimit(state, result.limits.maxRecurseDepth)
        }
        if (result.limits.maxCommands !== undefined) {
            state.maxCommands = adoptCommandLimit(state, result.limits.maxCommands)
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

// Convenience: drain a generator into an array of events (batch mode)
export function drainEvents(ast, deps, opts = {}) {
    const events = []
    for (const event of execute(ast, deps, opts)) {
        events.push(event)
    }
    return events
}
