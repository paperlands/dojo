// Head pose during a build — evidence for specs/tensions/live-head-vs-instant-law.
//
// Run:  node test/js/profile/head_pose_probe.mjs
//
// Head events land at program end, on `wait`, and on cooperative yield — never
// per breath. So a build with no `wait` shows a STALE head: it sits at the
// origin while ink grows out of it, then teleports. This counts the distinct
// head poses an author would see across a whole paced build.
//
// A probe, not a fence: it reports, it does not assert. Re-run it before
// arguing either pole of the tension.

import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

function probe(label, src) {
    let t = 0
    const s = createScheduler(metaRoot(), {
        rootName: "world", clock: () => (t += 0.05),
        createDeps: deps, execOpts: { color: "#e77808" }, onShout: () => {},
    })
    s.sliceFor(0.3)
    s.hotSwapChild("buf", { name: "main", code: { ast: parseProgram(src), functions: null }, style: {}, env: null })
    const f = [...s.registry.values()].find(x => x !== s.root)

    const poses = []
    let ticks = 0
    while (ticks++ < 3000 && !s.done) {
        s.sliceFor(0.3)
        s.tick(ticks * 16)
        for (const a of s.registry.values()) a.channel.drain()
        const p = f.sync?.head?.position ?? f.transform.deref().position
        poses.push(p.map(v => Math.round(v)).join(","))
    }
    const distinct = [...new Set(poses)]
    console.log(label.padEnd(22),
        "ticks:", String(ticks).padStart(5),
        " distinct head poses during build:", String(distinct.length).padStart(4),
        " first:", distinct[0], " last:", distinct[distinct.length - 1])
}

probe("continuous (no wait)", `loop 4000 do\n  fw 1\n  rt 0.4\nend`)
probe("chatty (no wait)",     `loop 2000 do\n  fw 1\n  rt 0.9\n  beColour 0.3\nend`)
probe("with wait",            `loop 200 do\n  fw 5\n  rt 2\n  wait 5\nend`)
