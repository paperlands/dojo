// Deep probe: what helios shows vs ink.resident vs the LIVE command count.
// Run: node test/js/profile/helios_progress_probe.mjs
//
// This probe is what showed the old ladder was a load bar: ink banded the rung,
// so a big figure "arrived" while it was still drawing, and the count beside it
// froze because a frame's commandCount only landed when its generator ended.
// Both are gone — the sun walks its day on the clock, and the running batch is
// readable while it runs (scheduler.commandsOf).
//
// Axes:
//   A  square mill wait-free     — ink stairs of 511, phase building→settled
//   B  sparse wait loop          — a quiet world, and the sun still walking
//   C  the count while it counts — does it move mid-run, or only at settle?
//   D  erase loop                — resident vs lifetime

import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { createScheduler, commandsOf } from "../../../assets/js/turtling/scheduler.js"
import { execute, createActorState } from "../../../assets/js/turtling/executor.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { worldProgress } from "../../../assets/js/turtling/vitals.js"
import { createHeliosWalk, SKY_DWELL_MS } from "../../../assets/js/nerve/helios.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

function makeSched(src, { channelCapacity = 4096 } = {}) {
    const gen = execute(parseProgram(src), deps(), { actorState: createActorState() })
    return createScheduler(gen, { createDeps: deps, channelCapacity })
}

function drain(sched) {
    for (const f of sched.registry.values()) f.channel.drain()
}

function frameProbe(sched) {
    const rows = []
    for (const f of sched.registry.values()) {
        rows.push({
            name: f.name,
            done: f.done,
            resident: f.ink?.resident ?? null,
            frameCmd: f.commandCount ?? null,
            batchCmd: f.batch?.commandCount ?? null,
            liveCmd: commandsOf(f),
            reductions: f.batch?.reductions ?? f.actorState?.reductions ?? null,
            park: f.park?.cause ?? null,
            chLen: f.channel?.length ?? null,
            run: f.run ?? null,
        })
    }
    return rows
}

function sampleSeries(src, { frames = 120, sliceMs = 4, channelCapacity = 64, label } = {}) {
    const sched = makeSched(src, { channelCapacity })
    const walk = createHeliosWalk({ read: () => worldProgress(sched) })
    const truth = []
    const spoken = []
    let prevLines = -1
    let drops = 0

    for (let i = 0; i < frames && !sched.done; i++) {
        const now = i * 16
        sched.sliceFor(sliceMs)
        sched.tick(now)
        const p = worldProgress(sched)
        if (p.lines < prevLines) drops++
        if (p.lines !== prevLines || i < 3) {
            truth.push({
                i, lines: p.lines, commands: p.commands, phase: p.phase, run: p.run,
                building: sched.building,
                frames: frameProbe(sched),
            })
            prevLines = p.lines
        }
        drain(sched)
        // ~progress breath + walk anim
        if (i % 6 === 0 || walk.isAnimating()) {
            const v = walk.tick(now)
            if (v) spoken.push({ i, id: v.id, commands: v.commands, phase: v.phase, mode: walk.mode })
        }
    }

    // finish drain
    for (let guard = 0; guard < 5000 && !sched.done; guard++) {
        sched.sliceFor(8)
        sched.tick(frames * 16 + guard)
        drain(sched)
    }
    const final = worldProgress(sched)
    const spokenLines = spoken.map((s) => s.lines)
    const stairs = []
    for (let i = 1; i < truth.length; i++) {
        const d = truth[i].lines - truth[i - 1].lines
        if (d > 0) stairs.push(d)
    }
    const stairMode = mode(stairs)

    return {
        label,
        final,
        done: sched.done,
        drops,
        truthN: truth.length,
        truthHead: truth.slice(0, 12),
        truthTail: truth.slice(-4),
        spoken,
        spokenLines,
        stairDeltasHead: stairs.slice(0, 15),
        stairMode,
        allStairsAre511: stairs.length > 0 && stairs.every((d) => d % 511 === 0),
        multOf511: {
            "4088": 4088 / 511,
            "4599": 4599 / 511,
        },
        liveCmdReadableMidRun: truth.some((t) =>
            t.frames.some((f) => !f.done && f.liveCmd > 0)),
        finalFrames: frameProbe(sched),
    }
}

function mode(arr) {
    const m = new Map()
    for (const x of arr) m.set(x, (m.get(x) || 0) + 1)
    let best = null, n = 0
    for (const [k, v] of m) if (v > n) { best = k; n = v }
    return best
}

// --- does the count MOVE while the world works, across slice budgets? ---
// The old answer was no: it sat at 0 for the whole build and appeared at the
// end. What we want to see is a strictly rising cursor at every budget.
function countWhileCounting(src, trials = 5) {
    const rows = []
    for (let t = 0; t < trials; t++) {
        const sliceMs = 2 + t * 2
        const sched = makeSched(src, { channelCapacity: 32 })
        const seen = []
        for (let i = 0; i < 200 && !sched.done; i++) {
            sched.sliceFor(sliceMs)
            sched.tick(i * 16)
            drain(sched)
            const p = worldProgress(sched)
            if (seen[seen.length - 1] !== p.commands) seen.push(p.commands)
        }
        rows.push({
            sliceMs,
            moves: seen.length,
            zeroUntilTheEnd: seen.filter((c) => c > 0).length <= 1,
            head: seen.slice(0, 8),
            last: seen[seen.length - 1],
        })
    }
    return rows
}

const SQUARE = `loop 80000 do
  fw 10
  rt 90
end`

const WAIT_SPARSE = `loop 200 do
  fw 10
  wait 50
end`

const ERASE = `loop 40 do
  loop 900 do
    fw 1
    rt 1
  end
  erase
end`

console.log("=== the sun's pace ===", { SKY_DWELL_MS })
console.log("\n=== A square mill ===")
const A = sampleSeries(SQUARE, { label: "square", frames: 200, sliceMs: 3, channelCapacity: 24 })
console.log(JSON.stringify({
    final: A.final, done: A.done, drops: A.drops,
    stairMode: A.stairMode, allStairsAre511: A.allStairsAre511,
    stairDeltasHead: A.stairDeltasHead,
    spoken: A.spoken,
    liveCmdReadableMidRun: A.liveCmdReadableMidRun,
    multOf511: A.multOf511,
    truthHead: A.truthHead.map(({ i, lines, commands, phase, building }) => ({ i, lines, commands, phase, building })),
    finalFrames: A.finalFrames,
}, null, 2))

console.log("\n=== B sparse wait ===")
const B = sampleSeries(WAIT_SPARSE, { label: "wait", frames: 400, sliceMs: 8, channelCapacity: 4096 })
console.log(JSON.stringify({
    final: B.final, spoken: B.spoken, drops: B.drops,
    truthHead: B.truthHead.map(({ i, lines, commands, phase }) => ({ i, lines, commands, phase })),
}, null, 2))

console.log("\n=== C the count while it counts, across slice budgets ===")
console.log(JSON.stringify(countWhileCounting(SQUARE), null, 2))

console.log("\n=== D erase loop — resident vs lifetime ===")
const D = sampleSeries(ERASE, { label: "erase", frames: 300, sliceMs: 4, channelCapacity: 128 })
console.log(JSON.stringify({
    final: D.final, drops: D.drops,
    maxTruth: Math.max(...D.truthHead.map((t) => t.lines), 0),
    truthSamples: D.truthHead.slice(0, 8).concat(D.truthTail),
    spoken: D.spoken,
}, null, 2))

console.log("\n=== E the running batch, mid-run ===")
// instrument: after a partial run, what can a frame be asked?
{
    const sched = makeSched(SQUARE, { channelCapacity: 8 })
    for (let i = 0; i < 15; i++) {
        sched.sliceFor(2)
        sched.tick(i * 16)
        drain(sched)
    }
    console.log(JSON.stringify({
        mid: frameProbe(sched),
        progress: worldProgress(sched),
        note: "frameCmd fills only when a batch ends; batchCmd is the batch still running (liveCmd = both)",
    }, null, 2))
}
