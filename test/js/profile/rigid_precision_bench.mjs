// Run standalone: pure prototype methods are swapped only in this process.
// The pinned old kernel and A/A control keep the before/after comparison reproducible.
import { execFileSync } from "node:child_process"

const baselineRevision = "88db2bbc68b84cc4bb44f373ae40179cd7585832"
const source = execFileSync("git", ["show", baselineRevision + ":assets/js/turtling/mafs/versors.js"],
    { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })
const { Versor: Baseline } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))

import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { execute, createActorState } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"

const current = { multiply: Versor.prototype.multiply, rotateVec: Versor.prototype.rotateVec,
    rotate: Versor.prototype.rotate, getTransformValues: Versor.prototype.getTransformValues }
const previous = Object.fromEntries(Object.keys(current).map(k => [k, Baseline.prototype[k]]))
const N = 40000, REPS = 9
const fixtures = {
    "forward-reuse": `rt 37\nloop ${N} do\nfw 1\nend`,
    "turn-and-forward": `loop ${N} do\nrt 0.01\nfw 1\nend`,
    "decomposed-quarter": `loop ${N} do\nrt 45\nrt 45\nfw 1\nend`,
    "mixed-axes": `loop ${N} do\nrt 13\npitch 7\nroll 11\nfw 1\nend`,
}
const arms = [{ name: "baseline", methods: previous }, { name: "candidate", methods: current }, { name: "baseline-copy", methods: previous }]
let sink = 0
function measure(ast, methods) {
    Object.assign(Versor.prototype, methods)
    const state = createActorState()
    const iterator = execute(ast, { mathParser: new Parser(), mathEvaluator: new Evaluator() }, { actorState: state })
    const start = process.cpuUsage()
    for (const event of iterator) if (event) sink++
    const time = process.cpuUsage(start)
    sink += state.transform.position[0]
    return (time.user + time.system) * 1000 / state.commandCount
}
const rows = []
try {
    for (const [name, source] of Object.entries(fixtures)) {
        const ast = parseProgram(source)
        for (const arm of arms) for (let r = 0; r < 3; r++) measure(parseProgram(source.replace(String(N), "2000")), arm.methods)
        const samples = new Map(arms.map(a => [a.name, []]))
        for (let r = 0; r < REPS; r++) {
            for (const arm of r % 2 ? arms.toReversed() : arms) samples.get(arm.name).push(measure(ast, arm.methods))
        }
        for (const arm of arms) {
            const times = samples.get(arm.name)
            rows.push({ fixture: name, arm: arm.name, min: Math.min(...times), median: times.toSorted((a, b) => a - b)[4],
                jitter: Math.max(...times) / Math.min(...times), samples: times })
        }
    }
} finally { Object.assign(Versor.prototype, current) }
for (const row of rows) console.log(JSON.stringify(row))
if (!Number.isFinite(sink)) throw new Error("invalid/unconsumed results")
