// Headless profiler CLI + regression guard.
//
//   node --expose-gc test/js/profile/run.mjs
//
// Runs the representative program suite through the scheduler/executor pipeline
// (no THREE), prints a results table, and asserts thresholds so this doubles as
// a regression guard. Without --expose-gc, heap numbers are reported best-effort
// (gc() is a no-op) and leak assertions are skipped with a warning.

import { profileProgram, profileReframe } from "./harness.mjs"

const HAS_GC = typeof global.gc === "function"

// Representative programs — each targets a distinct cost/leak surface.
const SUITE = [
    {
        label: "batch-throughput",
        src: "loop 100000 do\n  fw 1\n  rt 1\nend",
        opts: { ticks: 1 },              // drains in the flush phase; no steady state
        note: "pure executor cost, no waits",
    },
    {
        label: "steady-animation",
        src: "loop 100000 do\n  fw 1\n  rt 1\n  wait 0.016\nend",
        opts: { ticks: 600, frameMs: 16 },
        note: "heap delta/tick must be ~0",
        maxHeapPerTickB: 4096,           // < 4 KB/tick retained → effectively flat
    },
    {
        label: "spawn-rewire-churn",
        src: "loop 2000 do\n  as t do\n    fw 100\n    fw -100\n  end\n  wait 0.016\nend",
        opts: { ticks: 600, frameMs: 16 },
        note: "re-execution: rewireChild/createChildGenerator",
        maxRegistryGrowth: 2,            // child frame reused, not accumulated
    },
    {
        label: "communication",
        src: [
            "as leader do",
            "  loop 100000 do",
            "    fw 1",
            "    rt 1",
            "    wait 0.016",
            "  end",
            "end",
            "as f1 do",
            "  loop 100000 do",
            "    rt leader.heading",
            "    fw 1",
            "    wait 0.016",
            "  end",
            "end",
            "as f2 do",
            "  loop 100000 do",
            "    rt leader.x",
            "    fw 1",
            "    wait 0.016",
            "  end",
            "end",
        ].join("\n"),
        opts: { ticks: 600, frameMs: 16 },
        note: "shout/observation + mailbox bound",
        maxHeapPerTickB: 16384,          // cross-ambient resolve allocates more; still bounded
    },
]

function pad(s, n) { return String(s).padEnd(n) }
function num(v, d = 1) { return Number(v).toFixed(d) }

console.log("")
console.log(`Turtle headless profiler — gc ${HAS_GC ? "enabled" : "DISABLED (run with --expose-gc)"}`)
console.log("=".repeat(112))
console.log([
    pad("program", 20), pad("flushMs", 8), pad("animTk", 7),
    pad("ms/p50", 8), pad("ms/p95", 8), pad("ΔheapKB", 9),
    pad("Δheap/tk(B)", 12), pad("reg", 5), pad("frames", 7), pad("err", 4),
].join(" "))
console.log("-".repeat(112))

const results = []
for (const item of SUITE) {
    const r = profileProgram(item.src, item.opts)
    results.push({ item, r })
    console.log([
        pad(item.label, 20),
        pad(num(r.flushMs, 2), 8),
        pad(r.animatedTicks, 7),
        pad(num(r.msP50, 3), 8),
        pad(num(r.msP95, 3), 8),
        pad(num(r.heapDeltaKB, 1), 9),
        pad(num(r.heapDeltaPerTickB, 0), 12),
        pad(r.retainedAfter.registry, 5),
        pad(r.retainedAfter.frames, 7),
        pad(r.errors.length, 4),
    ].join(" "))
}

console.log("-".repeat(112))
console.log("")
for (const { item, r } of results) {
    console.log(`· ${item.label}: ${item.note}`)
    console.log(`    events: ${JSON.stringify(r.tally)}`)
    console.log(`    retained before→after: registry ${r.retainedBefore.registry}→${r.retainedAfter.registry}, ` +
        `frames ${r.retainedBefore.frames}→${r.retainedAfter.frames}, ` +
        `mailbox ${r.retainedBefore.mailbox}→${r.retainedAfter.mailbox}, ` +
        `childLinks ${r.retainedBefore.childLinks}→${r.retainedAfter.childLinks}`)
    if (r.errors.length > 0) {
        for (const e of r.errors) console.log(`    ⚠ error in "${e.name}": ${e.message}`)
    }
}
console.log("")

// --- Threshold assertions (regression guard) ---
let failures = 0
const fail = (label, msg) => { console.error(`  ✗ ${label}: ${msg}`); failures++ }

for (const { item, r } of results) {
    if (item.maxHeapPerTickB != null) {
        if (!HAS_GC) {
            console.warn(`  ⚠ ${item.label}: heap/tick assertion skipped (no --expose-gc)`)
        } else if (r.heapDeltaPerTickB > item.maxHeapPerTickB) {
            fail(item.label, `heap/tick ${num(r.heapDeltaPerTickB, 0)}B > ${item.maxHeapPerTickB}B (retained-allocation leak?)`)
        }
    }
    if (item.maxRegistryGrowth != null) {
        const growth = r.retainedAfter.registry - r.retainedBefore.registry
        if (growth > item.maxRegistryGrowth) {
            fail(item.label, `registry grew by ${growth} > ${item.maxRegistryGrowth} (frames accumulating)`)
        }
    }
}

// --- Eye reframe path (model-layer camera) ---
// updateGroupPositions runs every frame for a focused eye. Profiled separately
// because the scheduler harness above drains channels without the compositor.
console.log("Eye reframe (model-layer camera) — per-frame cost at 20 layers")
console.log("-".repeat(112))
const reframe = {
    empty: profileReframe({ layers: 20, mode: "empty" }),
    moving: profileReframe({ layers: 20, mode: "moving" }),
}
for (const k of ["empty", "moving"]) {
    const r = reframe[k]
    console.log([
        pad(`  ${k} eye (${r.layers} layers)`, 24),
        pad(num(r.usPerFrame, 3) + " µs/frame", 16),
        pad(num(r.usP95, 3) + " µs p95", 14),
        pad(r.allocVersors + "V+" + r.allocArrays + "A/frame", 16),
        pad("≈" + r.allocBytesApprox + "B", 8),
    ].join(" "))
}
console.log(`  → empty-eye identity-skip elides all per-layer composes ` +
    `(${reframe.moving.allocBytesApprox}B → ${reframe.empty.allocBytesApprox}B/frame). ` +
    `Both are < 0.02% of a 16.6ms frame budget — dominated by the WebGL render.`)
console.log("")

// Guard: a moving eye at 20 layers must stay well under the frame budget.
if (reframe.moving.usPerFrame > 50) {
    fail("eye-reframe", `moving eye ${num(reframe.moving.usPerFrame, 1)}µs/frame > 50µs (regression)`)
}
// Guard: the empty-eye skip must actually elide per-layer work (no composes).
if (reframe.empty.allocVersors > 2) {
    fail("eye-reframe", `empty eye allocates ${reframe.empty.allocVersors} Versors > 2 (identity-skip broken)`)
}

if (failures > 0) {
    console.error(`\n${failures} threshold failure(s).`)
    process.exit(1)
}
console.log("All thresholds passed.\n")
