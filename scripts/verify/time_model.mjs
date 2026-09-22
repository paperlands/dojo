// The clock model — headless. `time` is the walk's own clock (0 at birth);
// `birthtime` is its birth on the shared axis; the axis is `birthtime + time`.
// No browser: the beat ledger lives in the executor, so it reads directly.
// (id:host-beat)

import { parseProgram } from "../../assets/js/turtling/parse.js"
import { drainEvents, createActorState } from "../../assets/js/turtling/executor.js"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"

let failed = 0
const ok = (name, cond, detail = "") => {
    if (cond) { console.log(`ok   ${name}`); return }
    failed++
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`)
}
const near = (a, b) => Math.abs(a - b) < 1e-9
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

// --- read the two roots through the language ------------------------------
function readClock(birthMs = 0) {
    const actorState = createActorState({ birthtime: birthMs })
    const shouts = drainEvents(
        parseProgram('wait 0.25\nshout "time" time\nshout "birthtime" birthtime'),
        deps(),
        { actorState },
    ).filter((e) => e.type === "shout")
    const out = {}
    for (const s of shouts) out[s.name] = s.payload
    return out
}

const root = readClock(0)
const child = readClock(100)   // born 0.1s along the axis
ok("root.time is local (0.25)", near(root.time, 0.25), JSON.stringify(root))
ok("root.birthtime is its birth (0)", near(root.birthtime, 0), JSON.stringify(root))
ok("child.time is still its own 0.25", near(child.time, 0.25), JSON.stringify(child))
ok("child.birthtime is inherited 0.1", near(child.birthtime, 0.1), JSON.stringify(child))
ok("axis = birthtime + time (child 0.35)", near(child.birthtime + child.time, 0.35))

// --- the beat ledger ------------------------------------------------------
function beatsOf(src) {
    return drainEvents(parseProgram(src), deps(), { actorState: createActorState() })
        .filter((e) => e.type === "beat")
}

const b = beatsOf("fw 20\nwait 0.2\nrt 90\nfw 20\nwait 0.2\nfw 20")
ok("beats: one per wait joint", b.length === 3, JSON.stringify(b.map((x) => x.lines)))
ok("beat 1: line 1 at t=0, birthtime 0",
    b[0] && near(b[0].time, 0) && near(b[0].birthtime, 0) && b[0].lines.join() === "1",
    JSON.stringify(b[0]))
ok("beat 2: lines 3,4 at t=0.2",
    b[1] && near(b[1].time, 0.2) && b[1].lines.join() === "3,4",
    JSON.stringify(b[1]))
ok("beat 3: line 6 at t=0.4",
    b[2] && near(b[2].time, 0.4) && b[2].lines.join() === "6",
    JSON.stringify(b[2]))
ok("beat times never decrease",
    b.every((x, i) => i === 0 || x.time >= b[i - 1].time))

// --- a def body is walked in execution order, not declaration order -------
const d = beatsOf("def g n do\nloop n do\nfw n\nrt 90\nend\nend\ng 2")
ok("def body kindles the def line and its body",
    d.some((x) => [1, 2, 3, 4, 7].every((l) => x.lines.includes(l))),
    JSON.stringify(d.map((x) => [x.time, x.lines])))

// --- `age` was dropped: local time is `time`, not a third name ------------
let removed = false
try { drainEvents(parseProgram('shout "age" age'), deps(), { actorState: createActorState() }) }
catch (e) { removed = /Undefined variable: age/.test(e.message) }
ok("age is gone (Undefined variable)", removed)

// --- a wait is the joint, not the ink -------------------------------------
const w = beatsOf("fw 1\nwait 1\nwait 1\nfw 1")
ok("a bare wait emits no beat",
    w.every((x) => x.lines.length > 0), JSON.stringify(w.map((x) => x.lines)))

if (failed) { console.error(`\n${failed} failed`); process.exit(1) }
console.log("\ntime model ok")
