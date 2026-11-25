// Phase 0 diagnostic probes: real executor + scheduler boundaries, without a law DSL.
// Run: node --test test/js/laws/phase0_probe_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { createActorState, execute } from "../../../assets/js/turtling/executor.js"
import { createScheduler, frameWorldTransform, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const pos = (transform) => [...transform.position]

// The executor owns a mutable actor pose; the scheduler learns it only through
// yielded events. This trace pins when command mutations become externally visible.
test("P0.1 — actor pose is already mutated when the first ink event is yielded", () => {
    const actorState = createActorState()
    const gen = execute(parseProgram("fw 10\nfw 10"), deps(), { actorState })

    const first = gen.next()
    assert.equal(first.value.type, "path")
    assert.deepEqual(first.value.points, [[0, 0, 0], [10, 0, 0], [20, 0, 0]])
    assert.deepEqual(pos(actorState.transform), [20, 0, 0], "both commands ran before publication")
    assert.equal(gen.next().value.type, "beat")
    assert.equal(gen.next().value.type, "head")
})

// Existing world coordinates intentionally include both ambient placement and
// local actor pose. This trace keeps those two quantities visible instead of
// silently calling either one "the point".
test("P0.2 — a nested frame's observed position is placement plus local motion", () => {
    const scheduler = createScheduler(metaRoot(), {
        rootHears: [],
        createDeps: deps,
        execOpts: { color: "#000000" },
    })
    const origin = { rotation: SE3.identity().rotation, position: [100, 7, 0] }
    const child = scheduler.hotSwapChild("placed", {
        name: "placed",
        origin,
        code: { ast: parseProgram("fw 5"), functions: {} },
        env: { userspace: new Map(), loopCounter: 0 },
    })

    assert.deepEqual(pos(child.transform.deref()), [5, 0, 0], "actor-local pose")
    assert.deepEqual(pos(frameWorldTransform(child)), [105, 7, 0], "composed observed pose")
    // Ink is carried by the frame channel; materialized mesh and frame-targeted cases
    // are outside this headless diagnostic and remain an explicit Phase 0 gap.
})

test("P0.4 — named child reuse and fresh replacement are different scheduler lifetimes", () => {
    const scheduler = createScheduler(metaRoot(), { createDeps: deps, execOpts: { color: "#000000" } })
    const ast = parseProgram("fw 5")
    const spec = {
        name: "placed",
        origin: SE3.identity(),
        code: { ast, functions: {} },
        env: { userspace: new Map(), loopCounter: 0 },
    }
    const first = scheduler.hotSwapChild("placed", spec)
    assert.equal(first.done, true, "finished output remains seated")
    assert.equal(scheduler.hotSwapChild("placed", spec), first, "same source identity reuses the ambient")

    const fresh = scheduler.hotSwapChild("placed", spec, { fresh: true })
    assert.notEqual(fresh, first, "fresh play replaces the prior ambient")
    assert.equal(first.channel.closed, true, "replaced ambient channel is closed")
    assert.equal(scheduler.root.children.get("placed"), fresh)
    scheduler.removeChild("placed")
    assert.equal(scheduler.root.children.has("placed"), false, "dispose/removal drops the seated frame")
})

// Historical baseline: without the opt-in protocol, the executor has no admission
// yield. Phase 0b tests the intervention directly in phase0b_motion_test.mjs.
test("P0.3 — default executor emits no motion reply; baseline pose and ink agree", () => {
    const gen = execute(parseProgram("fw 10\nfw 10"), deps())
    const emitted = []
    for (let step = gen.next(); !step.done; step = gen.next()) emitted.push(step.value)
    const path = emitted.find((event) => event.type === "path")
    const head = emitted.find((event) => event.type === "head")

    assert.deepEqual(path.points.at(-1), [20, 0, 0])
    assert.deepEqual(head.position, [20, 0, 0])
    // Default execution remains on the original path unless admission is enabled.
    assert.equal(emitted.some((event) => event.type === "motion"), false)
})
