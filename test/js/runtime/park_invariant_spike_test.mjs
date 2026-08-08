// Spike: hunt the park invariant (S16). Can `parkFrame` ever drop an owed event?
// Run: node --test test/js/runtime/park_invariant_spike_test.mjs
//
// `parkFrame` keeps the STANDING park when re-parked for the same cause, which
// discards the incoming `owed`. D027 R3 asserts that is unreachable. That claim
// came from READING the code, which is exactly the kind of claim this codebase
// has been burned by (R2.9 shipped a "superset" listen-set that was a subset;
// the pacer was verified on the one figure that could not escape it).
//
// So: make the assertion an instrument and try hard to fire it.
//
// The structural claim under assay is sharper than "unreachable". It is:
//
//   *A park's CAUSE determines whether it owes.*
//     'time'                 → always owed === null   (a breath owes nothing)
//     'credit' / 'residency' → always owed !== null    (a refusal owes its event)
//
// If that holds, a same-cause re-park either already owes this exact event or
// owes nothing and cannot be reached with one — the two namespaces never meet.
// If it is ever violated, S16's assertion fires and an event would have been
// eaten silently.
//
// Predictions recorded BEFORE measurement:
//   P1  Across the whole adversarial matrix the assertion never fires.
//   P2  The observed (cause, owes) matrix has exactly two rows: time/no and
//       {credit,residency}/yes. No cause appears in both columns.
//   P3  All three causes are actually EXERCISED — a run that never parks for
//       credit or residency proves nothing about them. Coverage is the gate:
//       absence of a counterexample only counts under coverage.
//   P4  Truth is untouched under the whole matrix: every figure still equals
//       its pure-executor denotation.
//
// SPIKE instrument. Pins measured behaviour; the ruling lives in D027 R3.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { execute, createActorState } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { MAX_STAGE_SEGMENTS, setResident } from "../../../assets/js/turtling/ledger.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

// ---------------------------------------------------------------------------
// Adversarial programs — every shape that parks for a different reason
// ---------------------------------------------------------------------------

const PROGRAMS = {
    // One unbounded event: the shape that used to escape every meter.
    continuous: `loop 900 do\n  fw 1\n  rt 0.4\nend`,

    // Maximum chatter: an event per step, so credit is hammered.
    chatty: `loop 400 do\n  fw 1\n  rt 0.9\n  beColour 0.3\nend`,

    // No ink at all — parks only for time.
    silent: `loop 3000 do\n  rt 1\nend`,

    // Erase animation: `clear` events interleaved with ink.
    erasing: `loop 12 do\n  loop 60 do\n    fw 1\n    rt 6\n  end\n  erase\nend`,

    // Spawn storm — drives the INLINE pump (drainUntilPause), a different
    // clearSpentPark site from the tick pump.
    spawner: `loop 24 do\n  as 'kid[count]' do\n    fw 5\n    rt 15\n  end\nend`,

    // Nested spawns: the trampoline unwinds a whole stack on a mid-instant park.
    nested: `as outer do\n  fw 10\n  as middle do\n    fw 10\n    as inner do\n      loop 60 do\n        fw 1\n        rt 6\n      end\n    end\n  end\nend`,

    // Waits: resumeAt gating interleaved with parks.
    waiting: `loop 20 do\n  fw 5\n  rt 18\n  wait 10\nend`,

    // A duet — mailbox traffic crossing frames while they park.
    duet: `as crier do\n  loop 30 do\n    shout 'beat' 1\n    wait 5\n  end\nend\nas ear do\n  loop 30 do\n    when 'beat' do\n      fw 3\n    end\n    wait 5\n  end\nend`,

    // Frame targeting: ink routed into ANOTHER frame's channel, so the sink that
    // refuses is not the producer's own.
    targeted: `as anchor do\n  fw 1\nend\nas painter in anchor do\n  loop 120 do\n    fw 1\n    rt 3\n  end\nend`,
}

// ---------------------------------------------------------------------------
// The instrument — sample every frame's park after every tick
// ---------------------------------------------------------------------------

function makeWorld(src, { capacity, sliceMs, lossless, floodResidency }) {
    // A clock that advances by a fixed step per read, so a tiny slice really
    // does expire mid-walk and 'time' parks are reachable deterministically.
    let t = 0
    const scheduler = createScheduler(metaRoot(), {
        rootName: "world",
        clock: () => (t += 0.05),
        channelCapacity: capacity,
        lossless,
        createDeps: realDeps,
        execOpts: { color: "#e77808" },
        onShout: () => {},
    })
    if (sliceMs !== null) scheduler.sliceFor(sliceMs)
    scheduler.hotSwapChild("buf", {
        name: "main", code: { ast: parseProgram(src), functions: null },
        style: { color: "#e77808" }, env: null,
    })
    if (floodResidency) {
        // Push the stage over its bound without materialising 3M segments, the
        // same way the S8 fences do. This is the ONLY way to exercise the
        // 'residency' refusal without a multi-second fixture.
        for (const f of scheduler.registry.values()) {
            if (f !== scheduler.root) setResident(f, scheduler.stock, MAX_STAGE_SEGMENTS + 1)
        }
    }
    return scheduler
}

// Returns { matrix, throws, ticks } — the observed (cause → owes?) pairs.
function stress(src, cfg, maxTicks = 4000) {
    const matrix = new Map()   // cause -> Set of booleans (owed !== null)
    let threw = null
    let ticks = 0
    let scheduler
    try {
        scheduler = makeWorld(src, cfg)
    } catch (e) {
        return { matrix, threw: e, ticks: 0, delivered: [] }
    }

    const delivered = []
    const sample = () => {
        for (const f of scheduler.registry.values()) {
            if (!f.park) continue
            if (!matrix.has(f.park.cause)) matrix.set(f.park.cause, new Set())
            matrix.get(f.park.cause).add(f.park.owed !== null)
        }
    }
    sample()   // the inline seat drain may already have parked

    try {
        while (ticks < maxTicks) {
            ticks++
            if (cfg.sliceMs !== null) scheduler.sliceFor(cfg.sliceMs)
            scheduler.tick(ticks * 16)
            sample()
            let drained = 0
            for (const f of scheduler.registry.values()) {
                for (const ev of f.channel.drain()) {
                    drained++
                    if (ev.type === "path") delivered.push(ev)
                }
            }
            if (scheduler.done && drained === 0) break
            if (!scheduler.building && !drained && !scheduler.done) break
        }
    } catch (e) {
        threw = e
    }
    return { matrix, threw, ticks, delivered }
}

const CONFIGS = []
for (const capacity of [1, 2, 4, 16, 4096]) {
    for (const sliceMs of [0.01, 0.2, 4, null]) {
        for (const lossless of [true, false]) {
            for (const floodResidency of [false, true]) {
                CONFIGS.push({ capacity, sliceMs, lossless, floodResidency })
            }
        }
    }
}

// ---------------------------------------------------------------------------

describe("SPIKE: can a park ever drop its debt? (S16)", () => {
    // 9 programs x 80 configs = 720 worlds, each stepped to completion or stall.
    const merged = new Map()
    const failures = []
    let worlds = 0

    for (const [label, src] of Object.entries(PROGRAMS)) {
        for (const cfg of CONFIGS) {
            worlds++
            const r = stress(src, cfg)
            if (r.threw) {
                failures.push({ label, cfg, message: r.threw.message })
            }
            for (const [cause, owes] of r.matrix) {
                if (!merged.has(cause)) merged.set(cause, new Set())
                for (const o of owes) merged.get(cause).add(o)
            }
        }
    }

    test("P1 the assertion never fires across the whole matrix", () => {
        console.log(`  worlds stepped: ${worlds}`)
        const dropped = failures.filter((f) => /would drop an owed event/.test(f.message))
        assert.deepEqual(dropped, [],
            `S16 fired: ${JSON.stringify(dropped.slice(0, 3), null, 1)}`)
    })

    test("P1b nothing else threw either", () => {
        assert.deepEqual(failures.map((f) => `${f.label}: ${f.message}`), [],
            "an adversarial config broke the scheduler")
    })

    test("P2 cause determines whether a park owes — the namespaces never meet", () => {
        const table = {}
        for (const [cause, owes] of merged) {
            table[cause] = [...owes].map((o) => (o ? "owes" : "no-debt")).sort()
        }
        console.log("  observed park matrix:", JSON.stringify(table))

        for (const [cause, owes] of merged) {
            assert.equal(owes.size, 1,
                `cause '${cause}' was seen BOTH owing and not owing — the two ` +
                `namespaces meet, and a same-cause re-park can now eat an event`)
        }
        if (merged.has("time")) {
            assert.deepEqual([...merged.get("time")], [false], "a breath owes nothing")
        }
        for (const cause of ["credit", "residency"]) {
            if (merged.has(cause)) {
                assert.deepEqual([...merged.get(cause)], [true], `a ${cause} refusal owes its event`)
            }
        }
    })

    test("P3 coverage — absence of a counterexample counts only if all three park", () => {
        const seen = [...merged.keys()].sort()
        console.log("  causes exercised:", JSON.stringify(seen))
        for (const cause of ["time", "credit", "residency"]) {
            assert.ok(merged.has(cause),
                `'${cause}' never parked in 720 worlds — this suite proves nothing about it`)
        }
    })
})

// ---------------------------------------------------------------------------
// P4 — and none of this moved the figure
// ---------------------------------------------------------------------------

function pureRun(src) {
    const deps = realDeps()
    const st = createActorState()
    const gen = execute(parseProgram(src), deps, { actorState: st })
    const paths = []
    for (let r = gen.next(); !r.done; r = gen.next()) {
        if (r.value.type === "path") paths.push(r.value)
    }
    return paths
}

const segsOf = (paths) => paths.reduce((n, p) => n + p.points.length - 1, 0)

describe("SPIKE: the matrix does not move truth", () => {
    // Single-frame programs only: `pureRun` has no scheduler, so a program that
    // spawns has no denotation to compare against here (the spawn tests above
    // cover those shapes for the park question).
    const SOLO = ["continuous", "chatty", "erasing"]

    test("P4 every lossless config delivers the pure figure, exactly", () => {
        for (const label of SOLO) {
            const src = PROGRAMS[label]
            const want = segsOf(pureRun(src))
            for (const cfg of CONFIGS) {
                if (!cfg.lossless) continue        // drop-oldest is opt-in loss
                if (cfg.floodResidency) continue   // refusal is meant to withhold
                const got = segsOf(stress(src, cfg).delivered)
                assert.equal(got, want,
                    `${label} lost ink at ${JSON.stringify(cfg)}: ${got} vs ${want}`)
            }
        }
    })
})

// ---------------------------------------------------------------------------
// Deeper — the two places 720 fixed worlds do not reach
// ---------------------------------------------------------------------------
//
// The matrix above runs programs I thought of, to completion. Two gaps:
//
//   1. LIFECYCLE. A park is state that outlives a pass. Re-eval mid-park is
//      exactly where such state rots — a debt from a dead run riding into a
//      live one is D027 S6's whole concern, and `_pending` had to be cleared in
//      `rewireChild` for the same reason.
//   2. SHAPES I DID NOT THINK OF. Absence of a counterexample among nine
//      hand-picked programs is weak evidence. A seeded generator explores the
//      grammar instead of my imagination.

const CAUSES_THAT_OWE = new Set(["credit", "residency"])

// Every park on the stage agrees with the law: cause determines debt.
function auditParks(scheduler, where) {
    for (const f of scheduler.registry.values()) {
        if (!f.park) continue
        const owes = f.park.owed !== null
        const shouldOwe = CAUSES_THAT_OWE.has(f.park.cause)
        assert.equal(owes, shouldOwe,
            `${where}: '${f.park.cause}' park ${owes ? "owes" : "owes nothing"} — the law is broken`)
    }
}

describe("SPIKE: re-eval mid-park (the lifecycle seam)", () => {
    test("a debt from a dead run never rides into a live one", () => {
        let t = 0
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", clock: () => (t += 0.05),
            channelCapacity: 1, lossless: true,
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })

        const seat = (n) => {
            scheduler.sliceFor(0.2)
            scheduler.hotSwapChild("buf", {
                name: "main",
                code: { ast: parseProgram(`loop ${n} do\n  fw 1\n  rt 3\n  beColour 0.4\nend`), functions: null },
                style: { color: "#e77808" }, env: null,
            }, { fresh: true })
        }

        let parkedAtSwap = 0
        for (let round = 0; round < 40; round++) {
            seat(200 + round)
            // Tick a few times WITHOUT draining, so credit runs out and frames
            // park holding a debt. Then re-seat on top of the parked frame.
            for (let i = 0; i < 3; i++) {
                scheduler.sliceFor(0.2)
                scheduler.tick(i * 16)
                auditParks(scheduler, `round ${round} tick ${i}`)
            }
            for (const f of scheduler.registry.values()) {
                if (f.park?.owed) parkedAtSwap++
            }
            // The swap happens here, on the next loop turn, while a debt stands.
        }

        console.log(`  re-seats over a standing debt: ${parkedAtSwap}`)
        assert.ok(parkedAtSwap > 0,
            "no re-seat ever landed on a parked frame — this test proved nothing")

        // And the world still finishes rather than deadlocking on a stale debt.
        let guard = 20000
        while (guard-- > 0 && !scheduler.done) {
            scheduler.sliceFor(4)
            scheduler.tick(0)
            for (const f of scheduler.registry.values()) f.channel.drain()
        }
        auditParks(scheduler, "after settle")
        assert.equal(scheduler.done, true, "a stale debt deadlocked the world")
    })

    test("removeChild while parked leaves nothing behind", () => {
        let t = 0
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", clock: () => (t += 0.05),
            channelCapacity: 1, lossless: true,
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        for (let round = 0; round < 25; round++) {
            scheduler.sliceFor(0.2)
            scheduler.hotSwapChild(`k${round}`, {
                name: `m${round}`,
                code: { ast: parseProgram(PROGRAMS.chatty), functions: null },
                style: { color: "#e77808" }, env: null,
            })
            scheduler.sliceFor(0.2)
            scheduler.tick(round * 16)
            auditParks(scheduler, `round ${round}`)
            if (round > 0) scheduler.removeChild(`k${round - 1}`)
            auditParks(scheduler, `after remove ${round}`)
        }
    })
})

// ---------------------------------------------------------------------------
// A seeded generator — shapes nobody chose
// ---------------------------------------------------------------------------

function rng(seed) {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

// Deliberately excludes `beColour random`: D027 R2.6 records it as unseeded, so
// a program using it is not replayable and a failing seed could not be re-run.
function fuzzProgram(seed) {
    const r = rng(seed)
    const pick = (xs) => xs[Math.floor(r() * xs.length)]
    const num = (lo, hi) => (lo + r() * (hi - lo)).toFixed(2)

    const stmt = (depth) => {
        const kinds = depth < 2
            ? ["fw", "rt", "jmp", "colour", "erase", "wait", "loop", "spawn", "when"]
            : ["fw", "rt", "jmp", "colour", "erase", "wait"]
        switch (pick(kinds)) {
            case "fw": return `fw ${num(0.1, 8)}`
            case "rt": return `rt ${num(1, 90)}`
            case "jmp": return `jmp ${num(0.5, 4)}`
            case "colour": return `beColour ${num(0.05, 0.95)}`
            case "erase": return `erase`
            case "wait": return `wait ${Math.floor(r() * 20) + 1}`
            case "loop":
                return `loop ${Math.floor(r() * 40) + 2} do\n${body(depth + 1)}\nend`
            case "spawn":
                return `as 'f${Math.floor(r() * 5)}' do\n${body(depth + 1)}\nend`
            case "when":
                return `when 'beat' do\n${body(depth + 1)}\nend`
        }
    }
    const body = (depth) => {
        const n = Math.floor(r() * 3) + 1
        return Array.from({ length: n }, () => "  " + stmt(depth)).join("\n")
    }
    return body(0)
}

describe("SPIKE: fuzzed shapes", () => {
    // Default 400 seeds ≈ 5s in the suite. DOJO_FUZZ_SEEDS=20000 for a real hunt.
    const SEEDS = Number(process.env.DOJO_FUZZ_SEEDS || 400)

    test(`${SEEDS} generated programs x 4 configs keep the park law`, () => {
        const cfgs = [
            { capacity: 1, sliceMs: 0.01, lossless: true, floodResidency: false },
            { capacity: 2, sliceMs: 0.2, lossless: true, floodResidency: true },
            { capacity: 16, sliceMs: 4, lossless: false, floodResidency: false },
            { capacity: 4096, sliceMs: null, lossless: true, floodResidency: true },
        ]
        const merged = new Map()
        const broke = []
        let programs = 0

        for (let seed = 1; seed <= SEEDS; seed++) {
            const src = fuzzProgram(seed)
            let ast
            try { ast = parseProgram(src) } catch { continue }   // generator is loose
            if (!ast) continue
            programs++
            for (const cfg of cfgs) {
                const r = stress(src, cfg, 1500)
                if (r.threw) broke.push({ seed, cfg, message: r.threw.message })
                for (const [cause, owes] of r.matrix) {
                    if (!merged.has(cause)) merged.set(cause, new Set())
                    for (const o of owes) merged.get(cause).add(o)
                }
            }
        }

        const table = {}
        for (const [c, o] of merged) table[c] = [...o].map((x) => (x ? "owes" : "no-debt"))
        console.log(`  fuzzed programs: ${programs}`)
        console.log("  fuzz park matrix:", JSON.stringify(table))

        const dropped = broke.filter((b) => /would drop an owed event/.test(b.message))
        assert.deepEqual(dropped, [],
            `S16 fired on a fuzzed shape: ${JSON.stringify(dropped.slice(0, 2), null, 1)}`)
        assert.deepEqual(broke.map((b) => `seed ${b.seed}: ${b.message}`), [],
            "a fuzzed program broke the scheduler")
        for (const [cause, owes] of merged) {
            assert.equal(owes.size, 1, `fuzz: cause '${cause}' seen both owing and not`)
        }
    })
})
