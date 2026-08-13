// Fence: the breath is the preemption boundary (D027 R3).
// Run: node --test test/js/runtime/quantum_spike_test.mjs
//
// Protection is charged in work (reductions / walkBody visits), not in how
// often the figure yields output. The breath yields every K units of work so
// the scheduler can read the clock; shape and talkativeness do not decide.
//
// What this file gates:
//   • commandCount / reductions meter the work (no multi-point BIF in the table)
//   • breath consults the clock on every shape (B1); slice knob reconnects (B4)
//   • breath never moves the figure (B3, S1/S2/S7 vs pureRun)
//   • walkBody charges spawn / when / empty loops (no silent freeze)
//
// Cost / wall-clock of the breath: test/js/profile/breath_cost_bench.mjs
//   (worst-block under slice is reported there — a wall fence measures the machine)
// Choice of K:       test/js/profile/command_cost_bench.mjs
// Product anti-hang: test/js/runtime/pacer_test.mjs
// Ruling: D027 / specs/turtle/output-ledger.org

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { execute, createActorState } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { COMMANDS } from "../../../assets/js/turtling/commands.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

// ---------------------------------------------------------------------------
// Fixtures — three shapes, one workload
// ---------------------------------------------------------------------------

// One unbroken stroke: N points accumulate in stroke.js, ONE path event at end.
const continuousLine = (n) => `loop ${n} do\n  fw 1\n  rt 0.01\nend`

// No ink at all: the turtle turns in place. Zero path events, zero yields.
const pureCompute = (n) => `loop ${n} do\n  rt 1\nend`

// Same walk, but every step breaks the stroke (beColour → stroke: "break").
const strokeBroken = (n) => `loop ${n} do\n  fw 1\n  rt 0.01\n  beColour random\nend`

// ---------------------------------------------------------------------------
// The instrument — real wall clock (pacer_test's fake clock only ages on
// deadline checks, so a figure that never checks never freezes there either).
// ---------------------------------------------------------------------------

function run(src, { sliceMs = 4, maxTicks = 200000, breathEvery = 0 } = {}) {
    let clockCalls = 0
    const clock = () => { clockCalls++; return performance.now() }

    const scheduler = createScheduler(metaRoot(), {
        rootName: "world", clock,
        createDeps: realDeps,
        execOpts: { color: "#e77808", breathEvery },
        onShout: () => {},
    })

    // Arm before seating: hotSwapChild drains inline, which is the path that
    // hangs the tab at the keystroke, before any frame exists.
    let sliceForCalls = 1
    scheduler.sliceFor(sliceMs)
    const seatStart = performance.now()
    scheduler.hotSwapChild("buf", {
        name: "main", code: { ast: parseProgram(src), functions: null },
        style: { color: "#e77808" }, env: null,
    })
    const seatBlockMs = performance.now() - seatStart

    let paths = 0
    let points = 0
    let segments = 0
    let ticks = 0
    let worstBlockMs = seatBlockMs
    const blocks = [seatBlockMs]

    while (ticks < maxTicks) {
        ticks++
        sliceForCalls++
        scheduler.sliceFor(sliceMs)
        const t0 = performance.now()
        scheduler.tick(0)
        const blockMs = performance.now() - t0
        blocks.push(blockMs)
        if (blockMs > worstBlockMs) worstBlockMs = blockMs

        let drained = 0
        for (const a of scheduler.registry.values()) {
            for (const ev of a.channel.drain()) {
                drained++
                if (ev.type === "path") {
                    paths++
                    points += ev.points.length
                    segments += ev.points.length - 1
                }
            }
        }
        if (scheduler.done && drained === 0) break
        if (!scheduler.building && !drained && !scheduler.done) break
    }

    // clock() is consulted by sliceFor and by outOfTime. What we want is the
    // second: how many times did the scheduler ask "am I over my slice?"
    const deadlineChecks = clockCalls - sliceForCalls

    // Root sits in the registry too (it is the stage). The walker is the other one.
    const frame = [...scheduler.registry.values()].find((f) => f !== scheduler.root)
    return {
        ticks, worstBlockMs, deadlineChecks, paths, points, segments, blocks,
        commands: frame?.commandCount ?? 0,
        done: scheduler.done,
        error: frame?.error ?? null,
    }
}

// ---------------------------------------------------------------------------
// The meter — work is counted; the breath spends it on a boundary
// ---------------------------------------------------------------------------

describe("the meter — commandCount already counts the work", () => {
    test("no command in the table produces more than one point", () => {
        // A cost-proportional command (an `arc` that emits 100 points for one
        // command) would be an unbudgeted BIF: charged one reduction, doing N
        // units of work. Assay the whole table.
        const ctx = {
            transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            style: { color: "#fff", thickness: 1, down: true, showTurtle: 10 },
            worldPosition: [0, 0, 0],
        }
        const multiPoint = []
        for (const [name, fn] of COMMANDS) {
            let result
            try { result = fn(ctx, 1) } catch { continue }
            if (!result) continue
            // `point` is a single vec3 or absent. Anything array-of-arrays would
            // be a multi-point command.
            if (Array.isArray(result.point) && Array.isArray(result.point[0])) {
                multiPoint.push(name)
            }
            if (result.effects && result.effects.length > 2) multiPoint.push(name)
        }
        assert.deepEqual(multiPoint, [],
            `cost-proportional commands would break the meter: ${multiPoint}`)
    })

    test("commands track the work, whatever the batching", () => {
        // SEGMENTS, not points: a stroke break duplicates its seam vertex, so
        // points depend on batching and segments do not.
        const r = run(continuousLine(20000), { sliceMs: 4 })
        assert.ok(r.commands >= 40000, `commands ${r.commands}`)   // fw + rt
        assert.equal(r.segments, 20000, "one segment per fw, however it is batched")
    })
})

describe("the breath — a boundary charged in work", () => {
    const N = 200000
    const K = 1024

    // Deterministic: the breath asked the clock. Wall worst-block is a machine
    // measurement — reported (not fenced) in breath_cost_bench.mjs.
    test("B1 every shape consults the clock under a slice", () => {
        const shapes = {
            continuous: continuousLine(N),
            pureCompute: pureCompute(N * 4),
            strokeBroken: strokeBroken(N),
        }
        for (const [label, src] of Object.entries(shapes)) {
            const on = run(src, { sliceMs: 4, breathEvery: K })
            assert.ok(on.deadlineChecks > 0, `${label}: breath never consulted the clock`)
            assert.equal(on.done, true, `${label}: did not finish`)
            assert.equal(on.error, null, `${label}: wounded`)
        }
    })

    test("B3 truth does not move at any quantum", () => {
        const src = continuousLine(20000)
        const base = run(src, { sliceMs: 4 })
        for (const q of [64, 256, 1024, 4096]) {
            const r = run(src, { sliceMs: 4, breathEvery: q })
            assert.equal(r.segments, base.segments, `segments moved at K=${q}`)
            assert.equal(r.commands, base.commands, `commands moved at K=${q}`)
            assert.equal(r.done, true, `did not finish at K=${q}`)
            assert.equal(r.error, null, `wounded at K=${q}`)
        }
    })

    test("B4 the slice knob reconnects", () => {
        const tight = run(continuousLine(N), { sliceMs: 1, breathEvery: K })
        const loose = run(continuousLine(N), { sliceMs: 8, breathEvery: K })
        assert.equal(tight.segments, loose.segments, "same figure")
        assert.ok(tight.ticks > loose.ticks * 1.5,
            `a tighter slice must spread the build: ${tight.ticks} vs ${loose.ticks}`)
    })
})

// ---------------------------------------------------------------------------
// The breath against the denotation (S1/S2/S7)
// ---------------------------------------------------------------------------
//
// B3 above only compared aggregates. D027 R2.7's S1 is stronger: the delivered
// SEQUENCE must equal the pure executor's, order included. A boundary that
// moved a point, split a path, or reordered ink would pass B3 and fail here.

/** Pure executor: no scheduler, no channel — the denotation. */
function pureRun(src, breathEvery = 0) {
    const deps = realDeps()
    const actorState = createActorState({ breathEvery })
    const gen = execute(parseProgram(src), deps, { actorState })
    const paths = []
    let breaths = 0
    let r = gen.next()
    while (!r.done) {
        if (r.value.type === "path") paths.push(r.value)
        if (r.value.type === "breath") breaths++
        r = gen.next()
    }
    return { paths, breaths, pose: [...actorState.transform.position] }
}

const fingerprint = (paths) =>
    paths.map((p) => `${p.color}|${p.filled}|${p.points.map(
        (pt) => pt.map((x) => Number(x).toFixed(6)).join(",")).join(";")}`)

describe("the breath does not move truth", () => {
    // Colour breaks AND jump breaks AND long extends — several path shapes, so
    // a reordering has somewhere to show. `beColour 0.5` and not `random`:
    // `random` is unseeded (D027 R2.6), so two runs of the SAME program differ
    // in colour. A fixture built on it measures that, not the breath — which is
    // what the control below exists to catch.
    const mixed = `loop 3000 do
  fw 1
  rt 0.7
  beColour 0.5
  fw 2
  jmp 1
end`

    test("control — the fixture is deterministic (else S1 proves nothing)", () => {
        assert.deepEqual(fingerprint(pureRun(mixed).paths),
            fingerprint(pureRun(mixed).paths),
            "two breath-free runs already differ: the fixture is not replayable")
    })

    test("S1 delivered sequence equals the pure denotation, order included", () => {
        const pure = pureRun(mixed)
        // K=1 is the inversion: a boundary after EVERY command. If truth holds
        // there, the breath is orthogonal to semantics, not merely rare enough
        // to get away with. 7 is deliberately not a power of two.
        for (const q of [1, 7, 64, 512, 4096]) {
            const withBreath = pureRun(mixed, q)
            assert.ok(withBreath.breaths > 0, `no breath was taken at K=${q}`)
            assert.deepEqual(fingerprint(withBreath.paths), fingerprint(pure.paths),
                `the ink sequence moved at K=${q}`)
        }
    })

    test("S2 pose is breath-invariant", () => {
        const pure = pureRun(mixed)
        // K=1 is the inversion: a boundary after EVERY command. If truth holds
        // there, the breath is orthogonal to semantics, not merely rare enough
        // to get away with. 7 is deliberately not a power of two.
        for (const q of [1, 7, 64, 512, 4096]) {
            const r = pureRun(mixed, q)
            assert.deepEqual(r.pose.map((x) => x.toFixed(9)),
                pure.pose.map((x) => x.toFixed(9)), `pose moved at K=${q}`)
        }
    })

    test("S1 holds THROUGH the scheduler under a real slice", () => {
        const pure = pureRun(mixed)
        const paced = run(mixed, { sliceMs: 1, breathEvery: 256 })
        assert.equal(paced.done, true)
        assert.equal(paced.error, null)
        assert.equal(paced.paths, pure.paths.length,
            "same number of path events, delivered whole")
        assert.equal(paced.segments,
            pure.paths.reduce((n, p) => n + p.points.length - 1, 0),
            "same segments")
        assert.ok(paced.ticks > 1, "and it really was spread over frames")
    })

    test("S7 a breathing frame is never observable mid-instant", () => {
        // The breath reuses the credit-park path, so `park` must be set
        // when it parks — that flag is what keeps a sibling from reading it.
        let sawMidInstant = false
        const src = continuousLine(50000)
        let clockCalls = 0
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world",
            clock: () => { clockCalls++; return performance.now() },
            createDeps: realDeps,
            execOpts: { color: "#e77808", breathEvery: 256 },
            onShout: () => {},
        })
        scheduler.sliceFor(1)
        scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(src), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        let guard = 100000
        while (guard-- > 0 && !scheduler.done) {
            scheduler.sliceFor(1)
            scheduler.tick(0)
            for (const f of scheduler.registry.values()) {
                if (f !== scheduler.root && !f.done && f.park) sawMidInstant = true
                f.channel.drain()
            }
        }
        assert.ok(sawMidInstant,
            "a breath-parked frame must be flagged mid-instant (unobservable)")
        assert.equal(scheduler.done, true)
    })
})


// ---------------------------------------------------------------------------
// The walkBody escapees — why the charge is not on the command
// ---------------------------------------------------------------------------
//
// Found while assessing the phases, not predicted. `callCommand` is one arm of
// `walkBody`; the other node types never touch `commandCount`. Measured before
// the charge moved:
//
//   loop 2000 do fw 1 rt 1 end          → 4000 commands, 15 breaths, 17 values
//   loop 2000 do as 'kid[count]' do end → 0 commands,     0 breaths, 2001 values
//   loop 2000 do when 'go' do end end   → 0 commands,     0 breaths,    1 value
//
// The spawn loop escaped the breath but was rescued by the old event-counting
// gauge. The `when` loop escaped BOTH — 2000 iterations, one yielded value.
// `loop 99999999 do when 'go' do end end` was a freeze no meter could see.

describe("no walk escapes the meter", () => {
    function walkOnly(src, breathEvery = 512) {
        const st = createActorState({ breathEvery })
        const gen = execute(parseProgram(src), realDeps(), { actorState: st })
        let breaths = 0, values = 0
        for (let r = gen.next(); !r.done; r = gen.next()) {
            values++
            if (r.value.type === "breath") breaths++
        }
        return { breaths, values, commands: st.commandCount, reductions: st.reductions }
    }

    const N = 4000

    test("a spawn loop is charged (commands say zero)", () => {
        const r = walkOnly(`loop ${N} do\n  as 'kid[count]' do\n  end\nend`)
        console.log("  spawn loop:", JSON.stringify(r))
        assert.equal(r.commands, 0, "no command runs — the old meter reads zero")
        assert.ok(r.breaths > 0, "but the walk is charged and breathes")
    })

    test("a `when` loop is charged — the escapee no meter could see", () => {
        const r = walkOnly(`loop ${N} do\n  when 'go' do\n  end\nend`)
        console.log("  when loop:", JSON.stringify(r))
        assert.equal(r.commands, 0)
        // It yields ONE non-breath value for the whole walk: without the breath
        // there is nothing for a scheduler to get between.
        assert.ok(r.breaths > 0, "the when loop now offers boundaries")
        assert.ok(r.reductions >= N, `every iteration charged: ${r.reductions}`)
    })

    test("an EMPTY loop body is charged — no nodes to visit at all", () => {
        const r = walkOnly(`loop ${N} do\nend`)
        console.log("  empty loop:", JSON.stringify(r))
        assert.ok(r.breaths > 0, "the iteration is itself work")
        assert.ok(r.reductions >= N, `every iteration charged: ${r.reductions}`)
    })

    test("the breath is still inert — same figure, charged or not", () => {
        const src = `loop 2000 do\n  fw 1\n  rt 0.7\n  beColour 0.5\nend`
        const pure = pureRun(src, 0)
        for (const q of [1, 512]) {
            assert.deepEqual(fingerprint(pureRun(src, q).paths), fingerprint(pure.paths),
                `the walkBody charge moved the ink at K=${q}`)
        }
    })
})
