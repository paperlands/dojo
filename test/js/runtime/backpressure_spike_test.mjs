// Fence: credit-gated backpressure — capacity bounds WHEN, not WHAT (D027 R2).
// Run: node --test test/js/runtime/backpressure_spike_test.mjs
//
//   P1/P2  Lossless + pump-break delivers every path event of a wait-free
//          N=24000 loop, IN ORDER, equal to pureRun — capacity not in the figure.
//   P3     Capacity is a RATE bound: frames ≈ N/capacity, high-water ≤ capacity.
//   P4     Drop-oldest (opt-in control) still loses the prefix — policy is the
//          whole difference. One assay; not a second suite of the old defect.
//   P5     Refused events need a pushback slot or they vanish one-per-stall.
//   P6/P7  Pose and colour multiplicity do not reintroduce loss.
//   C1–C3  Mid-instant park: no sibling reads a parked frame (D011 ⊗ D027).
//   S5/S6  Loud ceiling; re-eval cancels, never interleaves.
//   S8     Stage residency refuses; it does not kill a bystander.
//   S16    a park keeps its debt (unit half; matrix in park_invariant).
//
// Ruling: D027 / specs/turtle/output-ledger.org.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { createScheduler, metaRoot, parkBreath, parkOwing } from "../../../assets/js/turtling/scheduler.js"
import { execute, createActorState } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { setResident } from "../../../assets/js/turtling/ledger.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

function spiralSrc({ N, colour = true }) {
    const c = colour ? "  beColour random\n" : ""
    return `loop ${N} do\n  fw 1\n  rt 2\n  dive 1\n${c}end`
}

const dist = (p) => Math.hypot(p[0], p[1], p[2])
const keyPt = (p) => p.map((x) => Number(x).toFixed(6)).join(",")

/** Pure executor: no scheduler, no channel — the denotation to compare against. */
function pureRun(src) {
    const deps = realDeps()
    const actorState = createActorState()
    const gen = execute(parseProgram(src), deps, { actorState })
    const paths = []
    let r = gen.next()
    while (!r.done) {
        if (r.value.type === "path") paths.push(r.value)
        r = gen.next()
    }
    return { paths, pose: [...actorState.transform.position] }
}

/**
 * Drive one top-level ambient through the real scheduler, draining after every
 * tick — this is what the compositor's flush() does under backpressure.
 * Returns the delivered path events plus the pacing measurements.
 */
function scheduledRun(src, { capacity, lossless }) {
    const deps = realDeps()
    const scheduler = createScheduler(execute(parseProgram(src), deps, { color: "#fff" }), {
        channelCapacity: capacity,
        lossless,
        createDeps: realDeps,
        execOpts: { color: "#fff" },
        rootDeps: deps,
    })

    const delivered = []
    let frames = 0
    let highWater = 0
    // Bounded by construction: a stalled pump that never drains would spin here.
    const MAX_FRAMES = 100000
    while (frames < MAX_FRAMES) {
        frames++
        const progress = scheduler.tick(0)
        let drained = 0
        for (const ambient of scheduler.registry.values()) {
            const events = ambient.channel.drain()
            if (events.length > highWater) highWater = events.length
            drained += events.length
            for (const e of events) if (e.type === "path") delivered.push(e)
        }
        if (scheduler.done && drained === 0) break
        if (!progress && drained === 0) break
    }
    return { delivered, frames, highWater, done: scheduler.done }
}

describe("SPIKE: credit-gated backpressure (D027 R2)", () => {
    const N = 24000
    const src = spiralSrc({ N })
    const pure = pureRun(src)

    test("P4 — drop-oldest still truncates to the tail (control)", () => {
        const run = scheduledRun(src, { capacity: 256, lossless: false })
        assert.ok(run.delivered.length < pure.paths.length,
            "control must reproduce the D027 defect")
        assert.ok(dist(run.delivered[0].points[0]) > 1,
            `first delivered endpoint should be far from origin (tail), got ${dist(run.delivered[0].points[0])}`)
    })

    test("P1/P2 — lossless delivers the pure sequence exactly, at capacity 256", () => {
        const run = scheduledRun(src, { capacity: 256, lossless: true })

        assert.equal(run.delivered.length, pure.paths.length,
            "delivered path count must equal pure path count")

        // Sequence equality, not just count: order and geometry both.
        // (subsumes D027's I1 + I2 + I4)
        for (let i = 0; i < pure.paths.length; i++) {
            assert.equal(keyPt(run.delivered[i].points[0]), keyPt(pure.paths[i].points[0]),
                `event ${i} start point diverges`)
            assert.equal(keyPt(run.delivered[i].points.at(-1)), keyPt(pure.paths[i].points.at(-1)),
                `event ${i} end point diverges`)
        }
    })

    test("P3 — capacity bounds WHEN, not WHAT: bounded queue, paced frames", () => {
        const small = scheduledRun(src, { capacity: 256, lossless: true })
        const large = scheduledRun(src, { capacity: 8192, lossless: true })

        assert.equal(small.delivered.length, large.delivered.length,
            "the figure must not depend on capacity")
        assert.ok(small.highWater <= 256, `high-water ${small.highWater} exceeded capacity`)
        assert.ok(large.highWater <= 8192, `high-water ${large.highWater} exceeded capacity`)
        assert.ok(small.frames > large.frames,
            `smaller credit must take more frames (${small.frames} vs ${large.frames})`)

        console.log(`      [pacing] cap 256: ${small.frames} frames, hw ${small.highWater}` +
            ` | cap 8192: ${large.frames} frames, hw ${large.highWater}` +
            ` | events ${small.delivered.length}`)
    })

    test("P6 — pose is unchanged by capacity", () => {
        const run = scheduledRun(src, { capacity: 64, lossless: true })
        const last = run.delivered.at(-1).points.at(-1)
        const pureLast = pure.paths.at(-1).points.at(-1)
        assert.equal(keyPt(last), keyPt(pureLast))
    })

    test("P7 — colour multiplicity does not reintroduce loss", () => {
        const mono = spiralSrc({ N: 4000, colour: false })
        const hued = spiralSrc({ N: 4000, colour: true })
        for (const s of [mono, hued]) {
            const p = pureRun(s)
            const r = scheduledRun(s, { capacity: 128, lossless: true })
            assert.equal(r.delivered.length, p.paths.length, "colour changed delivery count")
        }
    })

    test("P5 — the pushback slot is load-bearing (no gap at stall boundaries)", () => {
        // A missing pushback loses exactly one event per stall. With capacity 256
        // and N=24000 that is ~94 silent holes — invisible to a count-only check
        // on a lossy channel, which is why sequence equality is the invariant.
        const run = scheduledRun(src, { capacity: 256, lossless: true })
        const gaps = []
        for (let i = 1; i < run.delivered.length; i++) {
            const prevEnd = keyPt(run.delivered[i - 1].points.at(-1))
            const start = keyPt(run.delivered[i].points[0])
            if (prevEnd !== start) gaps.push(i)
        }
        assert.deepEqual(gaps, [], `polyline discontinuities at ${gaps.slice(0, 5)}`)
    })
})

// The fixture that gives the instrument coverage: `beColour random` breaks the
// polyline into one event per iteration. Without it `loop 400 do fw 1; rt 3` emits
// ONE path event of 400 points and no channel of any size ever fills — an earlier
// version of this fence measured nothing and passed.
const observedFlood = [
    "as leader do",
    "  loop 400 do",
    "    fw 1", "    rt 3", "    dive 1", "    beColour random",
    "  end",
    "end",
    "as follower do",
    "  loop 40 do",
    "    rt leader.heading", "    fw 1", "    wait 0.02",
    "  end",
    "end",
].join("\n")

// Geometry per ambient, capacity-independent by law. Colour is excluded: it is
// the one unseeded term (see the replay suite below).
function geometryByAmbient(src, { capacity, lossless }) {
    const scheduler = createScheduler(metaRoot(), {
        rootName: "world",
        channelCapacity: capacity,
        lossless,
        createDeps: realDeps,
        execOpts: { color: "#e77808" },
        onShout: () => {},
    })
    scheduler.hotSwapChild("buf", {
        name: "main", code: { ast: parseProgram(src), functions: null },
        style: { color: "#e77808" }, env: null,
    })

    const geo = new Map()
    let parks = 0
    let now = 0
    let guard = 200000
    while (guard-- > 0) {
        const progress = scheduler.tick(now)
        for (const a of scheduler.registry.values()) if (a.park?.owed) parks++
        for (const a of scheduler.registry.values()) {
            const key = a.name || String(a.id)
            for (const ev of a.channel.drain()) {
                if (ev.type !== "path") continue
                geo.set(key, (geo.get(key) || "") + ev.points.map(keyPt).join(";") + "|")
            }
        }
        if (scheduler.done) break
        if (!progress) now += 16
    }
    return { geo, parks, done: scheduler.done }
}

describe("SPIKE: credit may not be observable (D027 R2 ⊗ D011)", () => {
    // `leader.heading` resolves the leader's LIVE pose. If credit parks the leader
    // mid-instant and a sibling advances past it, the sibling reads a partial pose
    // and capacity lands in the figure — past D011, whose law is that no frame reads
    // another at a different logical instant. Measured before the fix: the leader's
    // own ink was invariant (17551 b, identical hash) while the follower's geometry
    // moved (1478 b vs 1558 b).
    test("C1 — a wait-free producer's own ink is capacity-invariant", () => {
        const tight = geometryByAmbient(observedFlood, { capacity: 16, lossless: true })
        const wide = geometryByAmbient(observedFlood, { capacity: 4096, lossless: true })
        assert.equal(tight.geo.get("leader"), wide.geo.get("leader"))
    })

    test("C2 — an OBSERVER of that producer is capacity-invariant too", () => {
        const tight = geometryByAmbient(observedFlood, { capacity: 16, lossless: true })
        const wide = geometryByAmbient(observedFlood, { capacity: 4096, lossless: true })
        assert.equal(tight.geo.get("follower"), wide.geo.get("follower"))
    })

    test("C3 — coverage: the tight run really does park (else C1/C2 are vacuous)", () => {
        const tight = geometryByAmbient(observedFlood, { capacity: 16, lossless: true })
        const wide = geometryByAmbient(observedFlood, { capacity: 4096, lossless: true })
        assert.ok(tight.parks > 0, "no backpressure occurred — the fence measures nothing")
        assert.equal(wide.parks, 0, "wide capacity should never park")
        assert.ok(tight.done && wide.done, "both runs must complete")
    })
})

describe("SPIKE: S6 — re-eval cancels, never interleaves", () => {
    const gen1 = "loop 4000 do\n  fw 1\n  rt 2\n  dive 1\n  beColour random\nend"
    const gen2 = "loop 30 do\n  fw 7\n  rt 90\n  dive 1\n  beColour random\nend"

    test("S6 — a swap mid-build yields gen2's figure with no gen1 ink", () => {
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", channelCapacity: 64, lossless: true,
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        const fork = (src) => ({
            name: "main", code: { ast: parseProgram(src), functions: null },
            style: { color: "#e77808" }, env: null,
        })

        const first = scheduler.hotSwapChild("buf", fork(gen1))
        // Advance a few frames so gen1 is genuinely mid-build and parked.
        for (let i = 0; i < 3; i++) {
            scheduler.tick(0)
            for (const a of scheduler.registry.values()) a.channel.drain()
        }
        assert.ok(first.park?.owed, "gen1 should be parked mid-instant before the swap")

        const second = scheduler.hotSwapChild("buf", fork(gen2))
        assert.notEqual(second.id, first.id, "a different seed must mint a new frame")
        assert.equal(second.park, null, "the new run starts with no parked event")
        assert.ok(!scheduler.registry.has(first.id), "the dead gen leaves the registry")

        // Drain to completion; only the live frame's channel is ever read, which is
        // what the compositor does (it walks the registry).
        const delivered = []
        let guard = 100000
        while (guard-- > 0) {
            const progress = scheduler.tick(0)
            let drained = 0
            for (const a of scheduler.registry.values()) {
                for (const ev of a.channel.drain()) { drained++; if (ev.type === "path") delivered.push(ev) }
            }
            if (scheduler.done && drained === 0) break
            if (!progress && drained === 0) break
        }

        const pure2 = pureRun(gen2)
        assert.equal(delivered.length, pure2.paths.length, "gen2 must arrive whole")
        assert.equal(keyPt(delivered.at(-1).points.at(-1)), keyPt(pure2.paths.at(-1).points.at(-1)))
    })
})

describe("SPIKE: S5 — the ceiling is loud, never silent", () => {
    // The ceiling is 1e6 segments, far past any fixture, so the assay drives the
    // helper's law rather than the constant: a run that exceeds its ink must DIE
    // with a named cause, not quietly present a partial figure as success.
    // Driven through the real pump via a tiny ceiling injected as ink already spent.
    const build = (src, spent) => {
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", channelCapacity: 256,
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        const child = scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(src), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        if (spent !== undefined) child.ink.resident = spent
        return { scheduler, child }
    }

    test("S5a — a run under the ceiling completes clean", () => {
        const { scheduler, child } = build(spiralSrc({ N: 500 }))
        let guard = 10000
        while (guard-- > 0) {
            const progress = scheduler.tick(0)
            let drained = 0
            for (const a of scheduler.registry.values()) drained += a.channel.drain().length
            if (scheduler.done || (!progress && drained === 0)) break
        }
        assert.deepEqual(scheduler.errors, [], "a healthy run raises no wound")
        assert.ok(child.done)
    })

    test("S5b — a run over the ceiling wounds loudly and stops", () => {
        // Start the run with its ink already all but spent.
        const { scheduler, child } = build(spiralSrc({ N: 500 }), 1_000_000)

        const wounds = []
        let guard = 10000
        while (guard-- > 0) {
            const progress = scheduler.tick(0)
            let drained = 0
            for (const a of scheduler.registry.values()) {
                for (const ev of a.channel.drain()) {
                    drained++
                    if (ev.type === "error") wounds.push(ev)
                }
            }
            if (scheduler.done || (!progress && drained === 0)) break
        }

        assert.equal(wounds.length, 1, "exactly one wound, on the diagnostics channel")
        assert.match(wounds[0].message, /has drawn more than/)
        assert.equal(wounds[0].kind, "ink", "an ink budget wound is not a walk error")
        assert.equal(wounds[0].ambientId, child.id, "the wound is located on its frame")
        assert.ok(child.done, "the faulted run stops — no further Output")
        assert.equal(scheduler.errors.length, 1, "and it is visible as a frame error")
    })

    test("S5c — re-eval refills the ink budget (per run, not per lifetime)", () => {
        // N must exceed capacity so the run PARKS during the inline advance —
        // a program that fits finishes before the budget is injected.
        const { scheduler, child } = build(spiralSrc({ N: 500 }), 1_000_000)
        let guard = 10000
        while (guard-- > 0) {
            const progress = scheduler.tick(0)
            let drained = 0
            for (const a of scheduler.registry.values()) drained += a.channel.drain().length
            if (scheduler.done || (!progress && drained === 0)) break
        }
        assert.equal(scheduler.errors.length, 1, "first run is wounded")

        const second = scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(spiralSrc({ N: 500 })), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        assert.notEqual(second.id, child.id)
        guard = 10000
        while (guard-- > 0) {
            const progress = scheduler.tick(0)
            let drained = 0
            for (const a of scheduler.registry.values()) drained += a.channel.drain().length
            if (scheduler.done || (!progress && drained === 0)) break
        }
        assert.deepEqual(scheduler.errors, [], "the fresh run starts with a full budget")
    })
})

describe("SPIKE: S8 — the device's ink, and who pays for it", () => {
    // Stage residency: N ambients each under their own RUN ceiling still add up to
    // an OOM. Policy (chosen 2026-08-05): the greediest ambient takes the wound and
    // every other figure lives — D020 healthy parts live. Nothing drawn is erased.
    const world = (...names) => {
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", channelCapacity: 256,
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        const frames = names.map((n, i) => scheduler.hotSwapChild(`buf-${i}`, {
            name: n, code: { ast: parseProgram(spiralSrc({ N: 500 })), functions: null },
            style: { color: "#e77808" }, env: null,
        }))
        return { scheduler, frames }
    }
    const pump = (scheduler, n = 1) => {
        for (let i = 0; i < n; i++) {
            scheduler.tick(0)
            for (const a of scheduler.registry.values()) a.channel.drain()
        }
    }

    // S8a/S8b originally asserted the KILL: "the greediest dies and the rest
    // live", with growth as the trigger so the kill did not cascade. D027 R3.5
    // retired that whole shape — killing a producer cannot fix a stock (the dead
    // frame's segments stay resident), and `worst` was chosen among `!f.done`,
    // which excluded the finished figures that actually held the ink. What the
    // stage bound does now is REFUSE, and a refusal needs no victim.
    test("S8a — over budget, NOBODY dies; the stage refuses instead", () => {
        const { scheduler, frames } = world("hog", "clover", "sprig")
        const [hog, clover, sprig] = frames
        // Comfortably over 3e6 — an exactly-equal total does not trip a `>` test.
        // setResident keeps the stage cell honest. (id:carving-todo-ledger-stock)
        setResident(hog, scheduler.stock, 2_950_000)
        setResident(clover, scheduler.stock, 60_000)
        setResident(sprig, scheduler.stock, 40_000)

        pump(scheduler)

        assert.equal(hog.error, null, "the greediest is not executed for being big")
        assert.equal(clover.error, null, "nor is a modest neighbour")
        assert.equal(sprig.error, null, "nor the smallest")
        // What DID happen: the stage cell is full, so the next path is refused —
        // which targets the flows, not the stocks. (id:carving-todo-ledger-stock)
        assert.equal(scheduler.stock.full, true, "the stage cell says full")
    })

    test("S8b — no cascade, and no growth test needed to get there", () => {
        const { scheduler, frames } = world("hog", "clover")
        const [hog, clover] = frames
        setResident(hog, scheduler.stock, 2_900_000)
        setResident(clover, scheduler.stock, 200_000)

        pump(scheduler, 6)

        // The old rule only avoided a cascade because it required the total to be
        // RISING; one live animation made growth permanent and it ate the stage
        // one frame per tick. Refusal needs no such crutch.
        assert.equal(hog.error, null, "no first victim")
        assert.equal(clover.error, null, "so no second one either")
    })

    test("S8c — a world under budget is never wounded", () => {
        const { scheduler, frames } = world("a", "b")
        setResident(frames[0], scheduler.stock, 500_000)
        setResident(frames[1], scheduler.stock, 500_000)
        pump(scheduler, 3)
        assert.deepEqual(scheduler.errors, [])
        assert.equal(scheduler.stock.full, false)
    })

    test("S8d — erase wipes the bill, not just the layer", () => {
        // An animation that clears every frame must not be charged for ink that is
        // no longer on screen. `erase` rides the same seam as ink, so the accountant
        // sees it WITHIN a run — not only across re-eval.
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", channelCapacity: 4096,
            createDeps: realDeps, execOpts: { color: "#e77808" }, onShout: () => {},
        })
        const f = scheduler.hotSwapChild("buf", {
            name: "anim",
            code: { ast: parseProgram(spiralSrc({ N: 200 }) + "\nerase\nfw 5"), functions: null },
            style: { color: "#e77808" }, env: null,
        })
        pump(scheduler, 4)
        assert.ok(f.done, "the run completes")
        assert.ok(f.ink.resident < 200,
            `erase must reset the bill mid-run, got ${f.ink.resident} segments still charged`)
    })
})

describe("SPIKE: replay determinism (is the program the ledger?)", () => {
    test("R1 — `beColour random` makes two runs of one program differ", () => {
        const src = spiralSrc({ N: 200, colour: true })
        const a = pureRun(src)
        const b = pureRun(src)
        const colours = (r) => r.paths.map((p) => p.color).join("|")
        assert.notEqual(colours(a), colours(b),
            "if this passes, replay is already deterministic and the ledger is optional")
    })

    test("R2 — geometry alone IS deterministic (only colour is the entropy)", () => {
        const src = spiralSrc({ N: 200, colour: true })
        const a = pureRun(src)
        const b = pureRun(src)
        const geom = (r) => r.paths.map((p) => keyPt(p.points.at(-1))).join("|")
        assert.equal(geom(a), geom(b))
    })
})

// ---------------------------------------------------------------------------
// S16 — a park is one object, and it never eats an owed event
// ---------------------------------------------------------------------------
//
// `park` collapses `_midInstant`, `_pending` and the residency stall clock into
// one object with a `cause`, which is what makes "a slice park is the SAME event
// as a credit park" (R2.5b) a represented fact rather than a comment.
//
// `park` collapses `_midInstant`, `_pending` and the residency stall clock into
// one object, which is what makes "a slice park is the SAME event as a credit
// park" (R2.5b) a represented fact rather than a comment.
//
// The debt used to be guarded by a RUNTIME THROW: one `parkFrame(ctx, cause,
// owed?)` door took the owed event as an optional argument, so a caller could
// hand it a fresh event while a debt stood, and only an `assert.throws` fence
// stood between that and a silent loss.
//
// It is now guarded by SHAPE. There are two doors, and neither can lose an event:
//
//   parkBreath(ctx)                 owes nothing, by construction
//   parkOwing(ctx, cause, deposit)  only ever called with a FRESH deposit
//
// because the one path that re-parks a standing debt — stepOnce's replay —
// mutates the park in place instead of rebuilding it. There is no argument left
// to pass wrongly. P5 above stays the behavioural half (remove the slot and 93
// of 24000 events vanish, one per stall, silently).

describe("S16: the park keeps its debt", () => {
    const frame = () => ({ park: null })

    test("a breath owes nothing, however often it is taken", () => {
        const f = frame()
        parkBreath(f)
        assert.equal(f.park.cause, "time")
        assert.equal(f.park.owed, null)
        parkBreath(f)                    // breath after breath, nothing owed
        assert.equal(f.park.owed, null)
    })

    test("a breath after a breath is the SAME breath — one wait, not many", () => {
        const f = frame()
        parkBreath(f)
        const first = f.park
        parkBreath(f)
        assert.equal(f.park, first, "an unchanged breath is not restarted")
    })

    test("owing holds the deposit and starts a fresh stall clock", () => {
        const f = frame()
        const event = { type: "path", points: [[0, 0, 0], [1, 0, 0]] }
        parkOwing(f, "credit", event)
        assert.equal(f.park.cause, "credit")
        assert.equal(f.park.owed, event)
        assert.equal(f.park.since, null, "a new reason to wait is a new wait")
    })

    test("a breath cannot be handed a debt — there is no argument for one", () => {
        // The old door's third parameter was the whole hazard. Its absence is
        // the fence now: `parkBreath` has no way to express an owed event.
        assert.equal(parkBreath.length, 1)
        assert.equal(parkOwing.length, 3)
    })

    test("the replay moves the CAUSE and keeps the deposit and its clock", () => {
        // stepOnce's shape, in miniature: a standing debt refused again under a
        // new cause. The park is edited, never rebuilt, so `owed` cannot be
        // dropped and only a genuinely new reason restarts the wait.
        const f = frame()
        const event = { type: "path", points: [[0, 0, 0], [1, 0, 0]] }
        parkOwing(f, "credit", event)
        f.park.since = 1000              // enforceResidency stamps the first sighting

        const refusal = "residency"
        if (f.park.cause !== refusal) { f.park.cause = refusal; f.park.since = null }
        assert.equal(f.park.owed, event, "the debt survives a change of cause")
        assert.equal(f.park.since, null, "a new reason to wait is a new wait")

        // Refused AGAIN under the same cause: the clock must not restart, or a
        // frame that never gets room is never wounded.
        f.park.since = 2000
        if (f.park.cause !== refusal) { f.park.cause = refusal; f.park.since = null }
        assert.equal(f.park.since, 2000, "a second sighting must not restart the clock")
        assert.equal(f.park.owed, event)
    })
})
