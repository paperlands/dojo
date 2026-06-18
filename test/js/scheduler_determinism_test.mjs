// Causal logical time — determinism under wall-clock jitter.
// Run with: node --test test/js/scheduler_determinism_test.mjs
//
// The oracle is WALL-CLOCK INVARIANCE (Decision 011): the geometry a program
// draws must be a pure function of LOGICAL time (the `wait` durations), so the
// final trail fingerprint must be identical no matter how the render-on-demand
// loop's wall clock is sampled (frame rate, dropped/janky frames).
//
// NOTE: this is NOT wait invariance — `prog-with-waits != prog-with-waits-stripped`
// is expected and correct (the stripped program is the instantaneous limit).
//
// This test drives the REAL scheduler exactly as compositor.advance does: a
// per-frame catch-up `do { tick(now) } while (progress && budget)` against a
// variable frame-delta schedule. It fails on the round-robin scheduler (the
// pre-Decision-011 bug) and passes once the drain is logical-resumeAt-ordered.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../assets/js/turtling/parse.js"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"

const FRAME_BUDGET = 64 // mirrors compositor.js advance() budget

function buildScheduler() {
    return createScheduler(metaRoot(), {
        rootName: "world",
        createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }),
        execOpts: { color: "#e77808" },
        onShout: () => {},
    })
}

const r3 = (n) => Math.round(n * 1000) / 1000

// Drain every non-root ambient's channel, appending positioned events to a
// per-ambient (address-keyed) trail in FIFO order — the drawn geometry.
function drainTrails(scheduler, trails) {
    for (const a of scheduler.registry.values()) {
        // Include the root: `as … world` ink is PROJECTED into the world (root)
        // frame and routed to the root channel — that projected geometry is
        // exactly what varies run-to-run, so it must be in the fingerprint.
        const key = a === scheduler.root ? "world*" : (a.address ?? a.name ?? String(a.id))
        const evs = a.channel.drain()
        for (const ev of evs) {
            if (!ev || !ev.position) continue
            let trail = trails.get(key)
            if (!trail) { trail = []; trails.set(key, trail) }
            trail.push(`${ev.type}:${r3(ev.position[0])},${r3(ev.position[1])},${r3(ev.position[2])}`)
        }
    }
}

// Run `src` to completion, driving the scheduler the way compositor.advance does:
// per RAF frame, advance `now` by the next delta in `deltas` (cycled) and run the
// budgeted catch-up loop. Returns a stable fingerprint of all ambient trails.
function fingerprint(src, deltas, maxFrames = 20000) {
    const scheduler = buildScheduler()
    scheduler.hotSwapChild("buf", {
        name: "main",
        code: { ast: parseProgram(src), functions: null },
        style: { color: "#e77808" },
        env: null,
    })

    const trails = new Map()

    // Batch flush phase (now = 0), mirrors compositor.flush.
    let guard = 100000
    while (guard-- > 0) {
        const progress = scheduler.tick(0)
        drainTrails(scheduler, trails)
        if (scheduler.done || !progress) break
    }

    // Steady reveal phase with a variable wall-clock schedule.
    let now = 0
    let i = 0
    for (let f = 0; f < maxFrames && !scheduler.done; f++) {
        now += deltas[i++ % deltas.length]
        let budget = FRAME_BUDGET
        let progress
        do {
            progress = scheduler.tick(now)
            if (progress) drainTrails(scheduler, trails)
        } while (progress && !scheduler.done && --budget > 0)
    }

    assert.ok(scheduler.done, `program did not complete within ${maxFrames} frames`)
    assert.deepEqual(scheduler.errors, [], "program raised errors")

    // Sorted, stable serialization of every ambient's trail.
    return JSON.stringify([...trails.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1))
}

// Three wall-clock schedules: smooth-fast, smooth-slow, and janky (dropped frames).
const SMOOTH_FAST = [16]
const SMOOTH_SLOW = [50]
const JANKY = [16, 16, 16, 800, 16, 250, 16, 16, 500, 33]

describe("causal logical time — wall-clock invariance (Decision 011)", () => {
    // Cross-ambient read: the follower's geometry depends on WHEN it observes the
    // leader. Under round-robin catch-up a janky frame makes it read the leader's
    // future — so the fingerprint shifts with the wall clock. It must not.
    const communication = [
        "as leader do",
        "  loop 40 do",
        "    fw 1",
        "    rt 3",
        "    wait 0.05",
        "  end",
        "end",
        "as follower do",
        "  loop 40 do",
        "    rt leader.heading",
        "    fw 1",
        "    wait 0.02",
        "  end",
        "end",
    ].join("\n")

    test("communication: same geometry across frame rates", () => {
        assert.equal(fingerprint(communication, SMOOTH_FAST), fingerprint(communication, SMOOTH_SLOW))
    })

    test("communication: same geometry under janky frames", () => {
        assert.equal(fingerprint(communication, SMOOTH_FAST), fingerprint(communication, JANKY))
    })

    // The reported program: an `as name world do` spiral inside a loop.
    const asWorld = [
        "loop 40 do",
        "  fw 1",
        "  wait 0.1",
        "  as name world do",
        "    loop 40 do",
        "      fw 1",
        "      rt 2",
        "      wait 0.1",
        "    end",
        "  end",
        "end",
    ].join("\n")

    test("as-world: same geometry across frame rates", () => {
        assert.equal(fingerprint(asWorld, SMOOTH_FAST), fingerprint(asWorld, SMOOTH_SLOW))
    })

    test("as-world: same geometry under janky frames", () => {
        assert.equal(fingerprint(asWorld, SMOOTH_FAST), fingerprint(asWorld, JANKY))
    })

    // INCOMMENSURATE rates (parent 0.01 : child 0.05 = 1:5) with renewal coupling:
    // the parent re-encounters the `as name world` spawn and rebirths the child on
    // `existing.done`. Pre-bullet-3 (round-robin) the `done` test was sampled at
    // wall-clock-jittery instants, so a janky frame let the child complete inside one
    // catch-up burst and the parent then rebirthed it — JANKY drew extra squares
    // (clears 0 → 4, fingerprint 403 → 635). With the logical-resumeAt-ordered drain
    // the rebirth falls at a deterministic logical instant, so all schedules agree.
    // (Decision 011 bullet 3 — the case the commensurate programs above never exposed.)
    const asWorldIncommensurate = [
        "loop 20 do",
        "  fw 10",
        "  wait 0.01",
        "  as name world do",
        "    loop 4 do",
        "      fw 10",
        "      rt 90",
        "      wait 0.05",
        "    end",
        "  end",
        "end",
    ].join("\n")

    test("as-world incommensurate: same geometry across frame rates", () => {
        assert.equal(fingerprint(asWorldIncommensurate, SMOOTH_FAST), fingerprint(asWorldIncommensurate, SMOOTH_SLOW))
    })

    test("as-world incommensurate: same geometry under janky frames", () => {
        assert.equal(fingerprint(asWorldIncommensurate, SMOOTH_FAST), fingerprint(asWorldIncommensurate, JANKY))
    })
})

// Fix A — a spawned child's first wait anchors to the PARENT's LOGICAL time, not
// the wall-clock `now` of the tick that processed the spawn. This is the exact
// mechanism behind the in-browser "shape changes with the absolute wait value"
// bug: a wall-clock anchor offsets parent/child logical grids, so commensurate
// events stop coinciding. RED before Fix A (child.resumeAt would be now+dur).
describe("Fix A — child anchored to parent logical time (Decision 011)", () => {
    test("child first wait ignores the tick's wall-clock now", () => {
        const scheduler = buildScheduler()
        // Parent waits 0.1 (→ logical 100), THEN spawns a child that waits 0.1.
        scheduler.hotSwapChild("buf", {
            name: "main",
            code: { ast: parseProgram("wait 0.1\nas kid do\n  wait 0.1\nend"), functions: null },
            style: { color: "#e77808" },
            env: null,
        })

        // First tick at now=0: parent runs to its first wait (resumeAt → 100).
        scheduler.tick(0)
        // A massively janky frame: now jumps to 9999. The parent resumes, reaches
        // the spawn, and the child is born + inline-advanced with now=9999.
        scheduler.tick(9999)

        const kid = [...scheduler.registry.values()].find(a => a.name === "kid")
        assert.ok(kid, "child 'kid' was spawned")
        // Logical: born at parent logical 100, waits 0.1 → resumeAt 200.
        // The wall-clock-anchored bug would give 9999 + 100 = 10099.
        assert.equal(kid.logicalBirth, 100, "born on parent's logical clock")
        assert.equal(kid.resumeAt, 200, "first wait anchored to logical birth, not now")
    })
})
