// Movement latency bench — locate capability and cost boundaries, not justify an architecture.
//
//   node --expose-gc test/js/profile/movement_latency_bench.mjs
//   RAW=/tmp/movement.jsonl ROTATE=1 node --expose-gc test/js/profile/movement_latency_bench.mjs
//
// Scopes are NAMED, because they are not interchangeable:
//   hand edit      one scheduler.requestMotion call + the 2 settle ticks that follow it
//   motion tick    one scheduler.tick whose publication advanced the revision
//   allocation     sampled heap profiler (1 KiB, collected objects included), warmed fixture,
//                  divided by the OPERATIONS observed inside the bracket
//
// Outcomes are counted, never inferred: accept-changed, accept-unchanged, refuse, fault,
// busy, stale, unresolved. A cell whose named state does not occur is a FAILED fixture.
// Headless model time only: no input scheduling, observers, rendering or competing work.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { performance } from "node:perf_hooks"
import { createScheduler, metaRoot, frameWorldTransform, lawWorld } from "../../../assets/js/turtling/scheduler.js"
import { continueLaws } from "../../../assets/js/turtling/laws/verdict.js"
import { addressOf } from "../../../assets/js/turtling/laws/replacement.js"
import { toLocalPose } from "../../../assets/js/turtling/localize.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const FRAME_MS = 1000 / 60
const SAMPLES = Number(process.env.SAMPLES || 200)
const ACTOR_EDITS = Number(process.env.ACTOR_EDITS || 120)
const CLAMP_SAMPLES = Number(process.env.CLAMP_SAMPLES || 100)
const RAW = process.env.RAW || null
const ROTATE = Number(process.env.ROTATE || 0)

// Row schema version. A reader must filter phase === "measure" to reproduce printed stats;
// warm rows are retained and tagged, cold rows are first operations in a FRESH WORLD.
const SCHEMA = "movement-latency/2"
const SOURCE_HASH = createHash("sha256")
    .update(readFileSync(fileURLToPath(import.meta.url))).digest("hex")
const row = (fields) => ({ op: null, phase: "measure", kind: null, outcome: null, ms: null,
    delta: 0, requested: null, before: null, after: null, displacement: null,
    command: null, path: null, settleMs: null, members: null, reads: null, transforms: null,
    observed: "door", ...fields })

const raw = []
const keep = (entry) => { raw.push(entry) }

const pct = (xs, q) => {
    if (xs.length === 0) return NaN
    const sorted = [...xs].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]
}
const stats = (xs) => ({ n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), p99: pct(xs, 0.99), max: Math.max(...xs) })
const ms3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "  -  ")
const share = (v) => (Number.isFinite(v) ? ((100 * v) / FRAME_MS).toFixed(1) + "%" : "  -")
const pad = (s, n) => String(s).padEnd(n)
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))

function buildScheduler() {
    return createScheduler(metaRoot(), {
        rootName: "world",
        createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }),
        execOpts: { color: "#e77808" },   // PRODUCT defaults: breathEvery stays 512
        onShout: () => {},
    })
}

function drainAll(scheduler) {
    let drained = 0
    for (const ambient of scheduler.registry.values()) {
        if (ambient === scheduler.root) continue
        drained += ambient.channel.drain().length
    }
    return drained
}

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}

// One monotonic clock per world; never restarted, so a `wait` resumes exactly once.
function tick(scheduler, state, count = 1) {
    const times = []
    for (let i = 0; i < count; i++) {
        state.now += 1000
        const t0 = performance.now()
        scheduler.tick(state.now)
        times.push(performance.now() - t0)
        drainAll(scheduler)
        scheduler.readouts.drain()
    }
    return times
}

function seat(source, { maxTicks = 8000 } = {}) {
    const scheduler = buildScheduler()
    scheduler.hotSwapChild("buf", {
        name: "world", code: { ast: parseProgram(source), functions: null },
        style: { color: "#e77808" }, env: null,
    })
    const state = { now: 0 }
    for (let i = 0; i < maxTicks; i++) {
        const [progress] = [scheduler.tick(state.now += 1000)]
        drainAll(scheduler)
        scheduler.readouts.drain()
        if (scheduler.done || !progress) break
    }
    return { scheduler, host: scheduler.root.children.get("buf"), state }
}

// A fixture is a claim about the world. Check it before timing anything.
function expectFixture({ scheduler, host }, { laws, settled, participants }) {
    assert.deepEqual(scheduler.errors, [], "the fixture built without construction errors")
    assert.equal(scheduler.laws.active().length, laws, "the fixture's active law count is what was asked for")
    for (const name of participants) {
        const frame = find(host, name)
        assert.ok(frame, `the fixture seated ${name}`)
        if (settled) assert.equal(frame.done, true, `${name} is settled before timing`)
    }
}

const chain = (n) => {
    const ids = Array.from({ length: n }, (_, i) => `P${i}`)
    return [
        ids.map((id, i) => `${i === 0 ? "" : "jmp 5\n"}let ${id}`).join("\n"),
        ids.slice(1).map((id, i) => `let distance(${ids[i]},${id})=5`).join("\n"),
    ].join("\n")
}

const unrelated = (k) => Array.from({ length: k },
    (_, i) => `let U${i}a\njmp 3\nlet U${i}b\nlet distance(U${i}a,U${i}b)=3`).join("\n")

// --- outcome accounting ---------------------------------------------------------------
function tally(rows) {
    const counts = {}
    for (const row of rows) counts[row.outcome] = (counts[row.outcome] ?? 0) + 1
    return counts
}
const countText = (counts) => Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(" · ")

function report(label, rows, { alloc = null, note = "", warm = 0 } = {}) {
    const measured = rows.filter((entry) => entry.phase === "measure")
    const cold = rows.filter((entry) => entry.phase === "cold")
    const warmRows = rows.filter((entry) => entry.phase === "warm").length + warm
    const s = stats(measured.map((entry) => entry.ms))
    const c = stats(cold.map((entry) => entry.ms))
    const moved = stats(rows.filter((entry) => Number.isFinite(entry.displacement)).map((entry) => entry.displacement))
    console.log(`  ${pad(label, 30)} n=${pad(s.n, 4)} p50 ${ms3(s.p50)} p95 ${ms3(s.p95)} p99 ${ms3(s.p99)} max ${ms3(s.max)} ms` +
        `  = ${pad(share(s.p50), 6)} frame  disp ${ms3(moved.p50)}  ${note}`)
    console.log(`  ${pad("", 30)} cold n=${cold.length} p50 ${ms3(c.p50)} max ${ms3(c.max)} ms` +
        (alloc === null ? "" : `  alloc ~${(alloc / 1024).toFixed(0)} KB/op`) +
        `  warm ${warmRows}  outcomes: ${countText(tally(rows.filter((entry) => entry.phase !== "warm")))}`)
}

// --- one hand edit, warmed or cold ----------------------------------------------------
// `warm` runs the SAME wish pattern without recording: it warms the engine, it must not
// change the question. Cold cells pass warm: 0 and record every sample.
// Latency scope is the CALL ONLY. The settle ticks are timed separately into `settleMs`
// and stay out of `ms`; allocation brackets include them, and say so where they are reported.
function handCell({ label, source, fixture, wish, samples = SAMPLES, warm = 10 }) {
    const world = seat(source)
    expectFixture(world, fixture)
    const root = find(world.host, "P0")
    const step = (i, phase) => {
        const before = frameWorldTransform(root).position
        const pose = wish(before, i)
        const revision = world.scheduler.motionRevision
        const t0 = performance.now()
        const out = world.scheduler.requestMotion(root, pose, revision, "world")
        const ms = performance.now() - t0
        const settleMs = tick(world.scheduler, world.state, 2).reduce((a, b) => a + b, 0)
        const after = frameWorldTransform(root).position
        const delta = world.scheduler.motionRevision - revision
        const moved = dist(before, after) > 1e-9
        const outcome = out.kind !== "accept" ? out.kind : (moved ? "accept-changed" : "accept-unchanged")
        const entry = row({ cell: label, op: "hand", phase, kind: out.kind, outcome, ms, settleMs,
            delta, displacement: dist(before, after), requested: pose.position, before, after,
            command: "hand", path: "hand", observed: "door" })
        keep(entry)
        return entry
    }
    for (let i = 0; i < warm; i++) step(i, "warm")
    const rows = []
    for (let i = 0; i < samples; i++) rows.push(step(i, "measure"))
    return { world, root, rows, step: (i) => step(i, "measure") }
}

// --- allocation, with an explicit scope and observed denominators ---------------------
let sampler = null
try {
    const { Session } = await import("node:inspector/promises")
    sampler = new Session()
    sampler.connect()
} catch { sampler = null }

async function sampledAllocation(run) {
    if (!sampler) return { bytes: undefined, ops: 0 }
    await sampler.post("HeapProfiler.startSampling",
        { samplingInterval: 1024, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true })
    const ops = run()
    const { profile } = await sampler.post("HeapProfiler.stopSampling")
    let total = 0
    const walk = (node) => { total += node.selfSize ?? 0; for (const child of node.children ?? []) walk(child) }
    walk(profile.head)
    return { bytes: total, ops }
}

// ======================================================================================
console.log(`\nmovement latency — FRAME ${FRAME_MS.toFixed(2)} ms; rotate=${ROTATE}; samples=${SAMPLES}`)
console.log("scopes: latency:hand = requestMotion call only (settles excluded); latency:motion = one publishing tick")
console.log("        alloc:hand = call + 2 settles + drains; alloc:motion = ticks carrying 20 observed motions")

const cells = []

// --- hand carrying: the component grows at a FIXED displacement per edit ------------
// rebasing: the target is one step of D from the CURRENT world position, so every edit is a
// D-unit displacement and two edits return. Absolute targets are a different workload and
// are named as such below: they ask for the same two world points every time, so the chain
// is re-stretched between them.
const rebasing = (D) => (before, i) => ({ rotation: { w: 1, x: 0, y: 0, z: 0 },
    position: [before[0] + (i % 2 === 0 ? D : -D), 0, 0] })
const absolute = (targets) => (before, i) => ({ rotation: { w: 1, x: 0, y: 0, z: 0 },
    position: [targets[i % targets.length], 0, 0] })

for (const n of [2, 4, 8, 12, 16]) cells.push({
    name: "hand", label: `carry n=${n} D=1`, source: chain(n),
    fixture: { laws: n - 1, settled: true, participants: ["P0"] },
    wish: rebasing(1),
    expect: ["accept-changed"],
})
for (const D of [2, 4]) cells.push({
    name: "hand", label: `carry n=12 D=${D}`, source: chain(12),
    fixture: { laws: 11, settled: true, participants: ["P0"] },
    wish: rebasing(D),
    expect: ["accept-changed"],
})
for (const n of [8, 16]) cells.push({
    name: "hand", label: `absolute ±2 n=${n}`, source: chain(n),
    fixture: { laws: n - 1, settled: true, participants: ["P0"] },
    wish: absolute([2, -2]),
    expect: ["accept-changed"],
})

// --- difficult clamping, FOUR named states -------------------------------------------
const anchored = chain(3) + "\nlet P2.position=(10,0,0)"
const clampFixture = { laws: 3, settled: true, participants: ["P0", "P1", "P2"] }
cells.push({
    name: "clamp-changed", label: "clamp: within reach", source: anchored, fixture: clampFixture,
    // two REACHABLE targets, far enough apart that each request changes the pose
    wish: (before, i) => ({ rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [i % 2 === 0 ? 18 : 14, 0, 0] }),
    expect: ["accept-changed"],
})
cells.push({
    name: "clamp-restate", label: "clamp: restatement", source: anchored, fixture: clampFixture,
    wish: () => ({ rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [16, 0, 0] }),
    expect: ["accept-unchanged"],
})
cells.push({
    name: "clamp-initial", label: "clamp: initial (cold)", source: anchored, fixture: clampFixture,
    wish: () => ({ rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [22, 0, 0] }),
    cold: true, samples: Math.min(CLAMP_SAMPLES, 12), warm: 0, freshWorlds: true,
    expect: ["accept-changed"],   // the FIRST beyond-reach request clamps and publishes
})
cells.push({
    name: "clamp-refuse", label: "clamp: boundary refuse", source: anchored, fixture: clampFixture,
    // saturate first (at the boundary), then repeat the same impossible wish
    warm: 0, saturate: true,
    wish: () => ({ rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [200, 0, 0] }),
    expect: ["refuse"],
})

// --- unrelated laws: same edit, more active laws -------------------------------------
for (const k of [0, 50, 200]) cells.push({
    name: "unrelated", label: `unrelated K=${k}`, source: chain(4) + (k === 0 ? "" : "\n" + unrelated(k)),
    fixture: { laws: 3 + k, settled: true, participants: ["P0"] },
    wish: (before, i) => ({ rotation: { w: 1, x: 0, y: 0, z: 0 },
        position: [before[0] + (i % 2 === 0 ? 1 : -1), 0, 0] }),
    expect: ["accept-changed"],
})

// --- actor following: translation-only and rotation-only runs, labeled ---------------
for (const n of [2, 8, 16]) {
    cells.push({ name: "actor-translate", label: `actor translate n=${n}`, actor: "translate", n })
    cells.push({ name: "actor-rotate", label: `actor rotate n=${n}`, actor: "rotate", n })
}

const order = cells.slice()
for (let i = 0; i < ROTATE % order.length; i++) order.push(order.shift())

// ======================================================================================
const results = new Map()

for (const cell of order) {
    if (cell.actor) {
        const expected = cell.actor === "translate" ? "fw" : "rt"
        const driver = cell.actor === "translate"
            ? `wait 1\nas P0 do\n  loop ${ACTOR_EDITS} do\n    fw 1\n    wait 1/24\n  end\nend\n`
            : `wait 1\nas P0 do\n  loop ${ACTOR_EDITS} do\n    rt 10\n    wait 1/24\n  end\nend\n`
        // Fixture contract: one actor, one protocol motion per tick. A tick that publishes
        // twice makes a last-attempt observation ambiguous, so it fails the fixture.
        const openActor = ({ record = true } = {}) => {
            const scheduler = buildScheduler()
            scheduler.hotSwapChild("buf", {
                name: "world", code: { ast: parseProgram(chain(cell.n) + "\n" + driver), functions: null },
                style: { color: "#e77808" }, env: null,
            })
            const state = { now: 0 }
            const startRevision = scheduler.motionRevision
            let lastAttempt = scheduler.root._lastAttempt
            let done = false
            const step = () => {
                if (done) return
                state.now += 1000
                const revision = scheduler.motionRevision
                const t0 = performance.now()
                scheduler.tick(state.now)
                const elapsed = performance.now() - t0
                drainAll(scheduler)
                scheduler.readouts.drain()
                const attempt = scheduler.root._lastAttempt
                const fresh = attempt !== undefined && attempt !== lastAttempt
                const published = scheduler.motionRevision - revision
                if (published > 1) {
                    throw new Error(`${cell.label}: ${published} publications in one tick; last-attempt observation is ambiguous`)
                }
                if (fresh) lastAttempt = attempt
                if (fresh || published !== 0) {
                    // A matching OBSERVATION is the attempt record itself, published or not.
                    // A refused program motion must reach the fixture assertion, not vanish.
                    const matches = fresh && attempt?.path === "program-motion" && attempt?.command === expected
                    const entry = row({
                        cell: cell.label, op: matches ? "motion" : "other", phase: "measure",
                        kind: matches ? "motion-attempt" : (published === 1 ? "publish-other" : "attempt-other"),
                        outcome: attempt?.verdict === "accept"
                            ? (published === 1 ? "accept-changed" : "accept-unchanged")
                            : (attempt?.verdict ?? "other"),
                        ms: elapsed, delta: published,
                        command: attempt?.command ?? null, path: attempt?.path ?? null,
                        requested: attempt?.requested?.position ?? null,
                        observed: "last-attempt",
                    })
                    if (record) keep(entry)
                    if (matches) runner.observed.push(entry)
                    else runner.others.push(entry)
                }
                if (scheduler.done) done = true
            }
            const runner = { scheduler, state, startRevision, observed: [], others: [], step }
            return runner
        }
        const advance = (runner, limit) => {
            let guard = 0
            while (runner.observed.length < limit && guard++ < 8000) runner.step()
            return runner.observed.length
        }
        const first = openActor()
        assert.equal(advance(first, ACTOR_EDITS), ACTOR_EDITS,
            `${cell.label}: expected ${ACTOR_EDITS} observed ${expected} motions`)
        assert.deepEqual(first.scheduler.errors, [], `${cell.label}: no construction errors`)
        const outcomes = [...new Set(first.observed.map((entry) => entry.outcome))]
        assert.deepEqual(outcomes, ["accept-changed"], `${cell.label}: every observed motion was an accepted change, saw ${outcomes}`)
        const rows = [...first.observed, ...first.others]
        // Allocation: a SECOND warmed actor world; the bracket is ticks only, never seating.
        const alloc = sampler ? await (async () => {
            const second = openActor({ record: false })   // allocation rows are not observations
            assert.equal(advance(second, 3), 3, `${cell.label}: warmup observed 3 motions`)
            return sampledAllocation(() => {
                const before = second.observed.length
                advance(second, before + 20)
                return second.observed.length - before
            })
        })() : { bytes: undefined, ops: 0 }
        results.set(cell.label, { rows: first.observed, alloc: alloc.bytes === undefined ? null : alloc.bytes / alloc.ops })
        const s = stats(first.observed.map((entry) => entry.ms))
        const firstTick = first.observed[0]?.ms
        console.log(`  ${pad(cell.label, 30)} n=${pad(s.n, 4)} p50 ${ms3(s.p50)} p95 ${ms3(s.p95)} p99 ${ms3(s.p99)} max ${ms3(s.max)} ms` +
            `  = ${pad(share(s.p50), 6)} frame  command ${expected}  startRev ${first.startRevision}`)
        console.log(`  ${pad("", 30)} first ${ms3(firstTick)} ms (first observed op)  other attempts/publishes ${first.others.length}` +
            (alloc.bytes === undefined || alloc.ops === 0 ? "" : `  alloc ~${(alloc.bytes / alloc.ops / 1024).toFixed(0)} KB/motion-edit`) +
            `  outcomes: ${countText(tally(first.observed))}`)
        continue
    }

    if (cell.saturate) {
        // Bring the fixture to the boundary OUTSIDE timing, then prove the state it reached.
        const world = seat(cell.source)
        expectFixture(world, cell.fixture)
        const root = find(world.host, "P0")
        const first = world.scheduler.requestMotion(root, cell.wish(), world.scheduler.motionRevision, "world")
        tick(world.scheduler, world.state, 3)
        assert.equal(first.kind, "accept", `${cell.label}: the first beyond-reach request clamps`)
        const boundary = frameWorldTransform(root).position
        const rows = []
        for (let i = 0; i < CLAMP_SAMPLES; i++) {
            const revision = world.scheduler.motionRevision
            const t0 = performance.now()
            const out = world.scheduler.requestMotion(root, cell.wish(), revision, "world")
            const ms = performance.now() - t0
            tick(world.scheduler, world.state, 2)
            const after = frameWorldTransform(root).position
            const entry = row({ cell: cell.label, op: "hand", phase: "measure", kind: out.kind,
                outcome: out.kind === "accept" ? "accept-changed" : out.kind, ms,
                delta: world.scheduler.motionRevision - revision, displacement: dist(boundary, after),
                command: "hand", path: "hand", observed: "door" })
            keep(entry)
            rows.push(entry)
        }
        assert.deepEqual([...new Set(rows.map((r) => r.outcome))], ["refuse"],
            `${cell.label}: every repeated request is refused`)
        assert.ok(rows.every((r) => r.delta === 0 && !r.moved), `${cell.label}: a refusal publishes nothing`)
        results.set(cell.label, { rows })
        report(cell.label, rows, { note: "state: saturated boundary" })
        continue
    }

    if (cell.freshWorlds) {
        // A cold sample must be a FIRST request. Reusing one world would measure the
        // second request onward — the mistake this cell exists to avoid.
        const rows = []
        for (let i = 0; i < cell.samples; i++) {
            const world = seat(cell.source)
            expectFixture(world, cell.fixture)
            const root = find(world.host, "P0")
            const before = frameWorldTransform(root).position
            const revision = world.scheduler.motionRevision
            const t0 = performance.now()
            const out = world.scheduler.requestMotion(root, cell.wish(), revision, "world")
            const ms = performance.now() - t0
            tick(world.scheduler, world.state, 2)
            const after = frameWorldTransform(root).position
            const moved = dist(before, after) > 1e-9
            const entry = row({ cell: cell.label, op: "hand", phase: "cold", kind: out.kind,
                outcome: out.kind === "accept" ? (moved ? "accept-changed" : "accept-unchanged") : out.kind,
                ms, delta: world.scheduler.motionRevision - revision, displacement: dist(before, after),
                requested: cell.wish().position, before, after, command: "hand", path: "hand", observed: "door" })
            keep(entry)
            rows.push(entry)
        }
        assert.deepEqual([...new Set(rows.map((row) => row.outcome))], cell.expect,
            `${cell.label}: expected a first request to ${cell.expect.join("/")}`)
        results.set(cell.label, { rows })
        report(cell.label, rows, { note: "first request, fresh world each sample" })
        continue
    }

    const cellWorld = handCell(cell)
    const observed = [...new Set(cellWorld.rows.map((row) => row.outcome))]
    assert.deepEqual(observed.sort(), [...cell.expect].sort(),
        `${cell.label}: expected ${cell.expect.join("/")}, saw ${observed.join("/")}`)
    if (cell.name === "clamp-restate") {
        assert.ok(cellWorld.rows.every((row) => row.delta === 0), `${cell.label}: a restatement publishes no revision`)
    }
    // Allocation: the SAME warmed world, on its continuing clock, over observed operations.
    const alloc = sampler ? await sampledAllocation(() => {
        for (let i = 0; i < 20; i++) {
            const before = frameWorldTransform(cellWorld.root).position
            cellWorld.world.scheduler.requestMotion(cellWorld.root, cell.wish(before, i),
                cellWorld.world.scheduler.motionRevision, "world")
            tick(cellWorld.world.scheduler, cellWorld.world.state, 2)
        }
        return 20
    }) : { bytes: undefined, ops: 0 }
    results.set(cell.label, { rows: cellWorld.rows, alloc: alloc.bytes === undefined ? null : alloc.bytes / alloc.ops })
    report(cell.label, cellWorld.rows, {
        alloc: alloc.bytes === undefined ? null : alloc.bytes / alloc.ops,
        note: cell.expect.join("/"),
        warm: cell.warm ?? 10,
    })
}

// --- two workload classes, side by side: the difference is the WORKLOAD ---------------
console.log("\ncarry — two workloads at the same component size, both recording displacement:")
for (const n of [8, 16]) {
    const rebase = results.get(`carry n=${n} D=1`)
    const absol = results.get(`absolute ±2 n=${n}`)
    const one = (cell) => stats(cell.rows.filter((r) => r.phase === "measure").map((r) => r.ms))
    const disp = (cell) => stats(cell.rows.filter((r) => r.phase !== "warm").map((r) => r.displacement).filter(Number.isFinite))
    console.log(`  n=${pad(n, 3)} rebasing ±1  p50 ${ms3(one(rebase).p50)} ms  disp ${ms3(disp(rebase).p50)}` +
        `   |   absolute ±2  p50 ${ms3(one(absol).p50)} ms  disp ${ms3(disp(absol).p50)}` +
        `   (absolute is ×${(one(absol).p50 / one(rebase).p50).toFixed(1)} of rebasing at the same n)`)
}
console.log("\ncarry — rebasing at n=12, displacement axis (cost is not monotone in displacement here):")
for (const D of [1, 2, 4]) {
    const cell = results.get(`carry n=12 D=${D}`)
    if (!cell) { console.log(`  D=${D}: not run in this order`); continue }
    const one = stats(cell.rows.filter((r) => r.phase === "measure").map((r) => r.ms))
    console.log(`  D=${pad(D, 2)} p50 ${ms3(one.p50)} ms  disp ${ms3(stats(cell.rows.map((r) => r.displacement)).p50)}` +
        `  alloc ${cell.alloc === null ? "-" : (cell.alloc / 1024).toFixed(0) + " KB/op"}`)
}

// --- matched workload: same command, translation, one unit ---------------------------
console.log("\nmatched command — translation along x, one unit per operation (scopes still differ):")
for (const n of [2, 8, 16]) {
    const hand = stats(results.get(`carry n=${n} D=1`).rows.filter((r) => r.phase === "measure").map((r) => r.ms))
    const actor = stats(results.get(`actor translate n=${n}`).rows.filter((r) => r.phase === "measure").map((r) => r.ms))
    console.log(`  n=${pad(n, 3)} hand edit p50 ${ms3(hand.p50)} ms   motion tick p50 ${ms3(actor.p50)} ms` +
        `   ratio ${(actor.p50 / hand.p50).toFixed(2)}×  (tick also carries execution/observers; call also carries publication;` +
        ` actor motion moved one unit per tick, hand one unit per edit)`)
}

// --- M2 diagnostics: independent trace, never before a timing cell -------------------
// A replica of ONE continuation call per state, plus one whole-door count, with a full
// fingerprint before/after the replica. Nothing here runs inside a timed region, and nothing
// here runs before a timing cell; the trace order is fixed, not ROTATE-rotated.
const poseOf = (pose) => ({
    rotation: [pose.rotation.w, pose.rotation.x, pose.rotation.y, pose.rotation.z],
    position: [pose.position[0], pose.position[1], pose.position[2]],
})

function fingerprint(world) {
    const { scheduler } = world
    const participants = [...scheduler.registry.values()].map((frame) => {
        const local = frame.transform.deref()
        return {
            name: frame.name, id: frame.id, parent: frame.parent?.id ?? null,
            member: scheduler.registry.get(frame.id) === frame,
            origin: frame.origin ? poseOf(frame.origin) : null,
            transform: poseOf(local),
            world: poseOf(frameWorldTransform(frame)),
        }
    })
    const laws = scheduler.laws.active().map((law) => ({
        address: addressOf(law), feature: law.feature,
        endpoints: [...(law.endpoints ?? [])], owner: law.owner ?? null, frame: law.frame ?? null,
    }))
    return { revision: scheduler.motionRevision, participants, laws }
}

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

function countingWorld() {
    const counts = { read: 0, transform: 0 }
    return {
        counts,
        world: {
            read: (frame, overrides) => { counts.read++; return lawWorld.read(frame, overrides) },
            transform: (frame) => { counts.transform++; return lawWorld.transform(frame) },
        },
    }
}

// One whole-door count: wrap the scheduler's own world for the duration, restore in finally.
function wholeDoorCount(run) {
    const read = lawWorld.read
    const transform = lawWorld.transform
    const counts = { read: 0, transform: 0 }
    lawWorld.read = (frame, overrides) => { counts.read++; return read(frame, overrides) }
    lawWorld.transform = (frame) => { counts.transform++; return transform(frame) }
    try { run() } finally {
        lawWorld.read = read
        lawWorld.transform = transform
    }
    return counts
}

const diagnostics = []
// Identity witness: the replica must not replace a frame, its origin, its transform or a law
// object. Values are witnessed separately by the digest; this is the object-identity half.
function captureRefs(world) {
    const participants = [...world.scheduler.registry.values()].map((frame) => ({
        id: frame.id, frame, origin: frame.origin, transform: frame.transform,
    }))
    // `laws.active()` MATERIALISES fresh law records on every call (measured: same array
    // false, same objects false, declaring-frame refs true), so a law OBJECT is not a stable
    // handle. Identity is asserted on the frame refs; the law record is witnessed by address,
    // declaring frame and endpoints. The materialisation fact travels in the artifact.
    const once = [...world.scheduler.laws.active()]
    const twice = world.scheduler.laws.active()
    const lawObjectsStable = once.length === twice.length && once.every((law, i) => law === twice[i])
    return {
        participants,
        laws: once.map((law) => ({ law, address: addressOf(law), frame: law.frame,
            endpoints: [...(law.endpoints ?? [])], feature: law.feature })),
        lawObjectsStable,
    }
}

function refsIntact(world, refs) {
    const broken = []
    for (const saved of refs.participants) {
        const frame = world.scheduler.registry.get(saved.id)
        if (frame !== saved.frame) broken.push(`${saved.id}: frame`)
        if (frame && frame.origin !== saved.origin) broken.push(`${saved.id}: origin`)
        if (frame && frame.transform !== saved.transform) broken.push(`${saved.id}: transform`)
    }
    const active = world.scheduler.laws.active()
    const byAddress = new Map(active.map((law) => [addressOf(law), law]))
    for (const saved of refs.laws) {
        const law = byAddress.get(saved.address)
        if (!law) { broken.push(`${saved.address}: law missing`); continue }
        if (law.frame !== saved.frame) broken.push(`${saved.address}: declaring frame replaced`)
        if (JSON.stringify(law.endpoints ?? []) !== JSON.stringify(saved.endpoints)) broken.push(`${saved.address}: endpoints changed`)
        if (refs.lawObjectsStable && law !== saved.law) broken.push(`${saved.address}: law record replaced`)
    }
    return broken
}

// Rotation compared on basis vectors, so quaternion sign cannot masquerade as a difference.
const basisGap = (a, b) => Math.max(...[[1, 0, 0], [0, 1, 0], [0, 0, 1]].flatMap((axis) => {
    const va = a.rotateVec(axis[0], axis[1], axis[2])
    const vb = b.rotateVec(axis[0], axis[1], axis[2])
    return va.map((value, i) => Math.abs(value - vb[i]))
}))

function diagnoseHand(cell, ordinals = 3) {
    const world = seat(cell.source)
    expectFixture(world, cell.fixture)
    const root = find(world.host, "P0")
    for (let i = 0; i < (cell.warm ?? 10); i++) {          // exact warmup replay
        const before = frameWorldTransform(root).position
        world.scheduler.requestMotion(root, cell.wish(before, i), world.scheduler.motionRevision, "world")
        tick(world.scheduler, world.state, 2)
    }
    for (let i = 0; i < ordinals; i++) {
        const before = frameWorldTransform(root).position
        const pose = cell.wish(before, i)
        const oneBasedOrdinal = (cell.warm ?? 10) + i + 1
        const fpBefore = fingerprint(world)
        const refs = captureRefs(world)
        const normalized = toLocalPose(lawWorld.transform(root), pose)
        const { counts, world: probe } = countingWorld()
        const verdict = { kind: "accept", pose: normalized, component: [] }
        continueLaws(verdict, root, world.scheduler.registry, world.scheduler.laws, probe)
        const candidate = [{ frame: root, pose: verdict.pose }, ...verdict.component]
        // The producer's PREDICTION, in world coordinates, before the door is asked.
        const predicted = candidate.map(({ frame, pose: local }) => {
            const worldPose = SE3.compose(frameWorldTransform(frame), local)
            return { frame, position: worldPose.position, rotation: worldPose.rotation }
        })
        const fpAfter = fingerprint(world)
        const brokenRefs = refsIntact(world, refs)
        // One whole-door call on the same state: verdict, then the installed world poses.
        const out = (() => {
            const door = { verdict: null, counts: null }
            door.counts = wholeDoorCount(() => { door.verdict = world.scheduler.requestMotion(root, pose, world.scheduler.motionRevision, "world") })
            return door
        })()
        const doorVerdict = out.verdict
        const doorIds = [root.id, ...(doorVerdict.component ?? []).map((member) => member.frame.id)].sort()
        const candidateIds = candidate.map(({ frame }) => frame.id).sort()
        const signatureMatch = doorVerdict.kind === "accept" &&
            JSON.stringify(doorIds) === JSON.stringify(candidateIds)
        let maxPublishedPositionGap = 0
        let maxPublishedRotationGap = 0
        if (signatureMatch) {
            for (const entry of predicted) {
                const published = frameWorldTransform(entry.frame)
                maxPublishedPositionGap = Math.max(maxPublishedPositionGap,
                    dist(published.position, entry.position))
                maxPublishedRotationGap = Math.max(maxPublishedRotationGap,
                    basisGap(published.rotation, entry.rotation))
            }
        }
        diagnostics.push({
            cell: cell.label, oneBasedOrdinal, target: pose.position,
            members: verdict.component.length + 1,
            reads: counts.read, transforms: counts.transform,
            doorReads: out.counts.read, doorTransforms: out.counts.transform,
            replicaDigest: digest({ pose: poseOf(verdict.pose),
                component: verdict.component.map((member) => ({ frame: member.frame.id, pose: poseOf(member.pose) })) }),
            fingerprintBefore: digest(fpBefore), fingerprintAfter: digest(fpAfter),
            geometryUntouched: digest(fpBefore) === digest(fpAfter) && brokenRefs.length === 0,
            identityBroken: brokenRefs,
            lawObjectsStable: refs.lawObjectsStable,
            signatureMatch,
            maxPublishedPositionGap,
            maxPublishedRotationGap,
        })
        assert.equal(brokenRefs.length, 0,
            `${cell.label}#${oneBasedOrdinal}: replica replaced an object identity: ${brokenRefs.join(", ")}`)
        assert.equal(digest(fpBefore) === digest(fpAfter), true,
            `${cell.label}#${oneBasedOrdinal}: replica changed values`)
        assert.equal(signatureMatch, true,
            `${cell.label}#${oneBasedOrdinal}: door verdict ${doorVerdict.kind} does not match the private candidate`)
        assert.ok(maxPublishedPositionGap <= 1e-12 && maxPublishedRotationGap <= 1e-12,
            `${cell.label}#${oneBasedOrdinal}: published pose differs from prediction by ${maxPublishedPositionGap}/${maxPublishedRotationGap}`)
        tick(world.scheduler, world.state, 2)
    }
}

console.log("\ndiagnostics — replica of the continuation on the WARMED state (independent trace, after timing)")
for (const cell of cells.filter((entry) => entry.name === "hand" || entry.name === "unrelated")) diagnoseHand(cell)
for (const entry of diagnostics) {
    console.log(`  ${pad(entry.cell, 30)} ordinal ${pad(entry.oneBasedOrdinal, 3)} target ${JSON.stringify(entry.target.map((v) => +v.toFixed(2)))}` +
        `  members ${pad(entry.members, 3)} reads ${pad(entry.reads, 5)} transforms ${pad(entry.transforms, 4)}` +
        `  door ${pad(entry.doorReads, 5)}  published gap ${entry.maxPublishedPositionGap.toExponential(1)}/${entry.maxPublishedRotationGap.toExponential(1)}` +
        `  identity ${entry.geometryUntouched ? "intact" : "BROKEN"}` +
        (entry.lawObjectsStable ? "" : "  (law records materialised per call: frame+address identity asserted)"))
}
const touched = diagnostics.filter((entry) => !entry.geometryUntouched)
if (touched.length > 0) throw new Error(`${touched.length} diagnostic replicas changed geometry`)

if (RAW) {
    const header = {
        schema: SCHEMA,
        generated: new Date().toISOString(),
        runtime: process.version,
        sourceHash: SOURCE_HASH,
        scopes: {
            "latency:hand": "one scheduler.requestMotion call only; settle ticks excluded",
            "alloc:hand": "warmed world; requestMotion + 2 settle ticks + drains, per operation",
            "latency:motion": "one scheduler.tick whose observed attempt is program-motion/command and published",
            "alloc:motion": "warmed world (3 observed motions outside); ticks carrying 20 observed motions, per motion edit",
        },
        samples: SAMPLES, actorEdits: ACTOR_EDITS, clampSamples: CLAMP_SAMPLES, rotate: ROTATE,
    }
    writeFileSync(RAW, [JSON.stringify(header), ...raw.map((entry) => JSON.stringify(entry))].join("\n") + "\n")
    const byPhase = raw.reduce((acc, entry) => ({ ...acc, [entry.phase]: (acc[entry.phase] ?? 0) + 1 }), {})
    console.log(`\nraw: ${RAW} — ${raw.length} rows ${JSON.stringify(byPhase)}; filter phase==="measure" to reproduce printed stats`)
    if (diagnostics.length > 0) {
        const diagPath = RAW.replace(/\.jsonl$/, "") + ".diag.jsonl"
        writeFileSync(diagPath, [JSON.stringify({ schema: SCHEMA + "+diag", runtime: process.version,
            sourceHash: SOURCE_HASH,
            scope: "replica before door on the warmed state; counts, identity+value fingerprints, producer-vs-door equivalence" }),
            ...diagnostics.map((entry) => JSON.stringify(entry))].join("\n") + "\n")
        console.log(`diag: ${diagPath} — ${diagnostics.length} replica observations`)
    }
}
console.log("\nReadings only. No cell above selects a policy; 16.67 ms is a whole frame, not a movement budget.")
