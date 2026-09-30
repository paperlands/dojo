// A figure-valued binding is a CLOSED CHILD AMBIENT — the same door `as … do`
// uses. It inherits space, colour, scope and logical birth; its ink is the
// figure; its question re-seats it. No parallel construction, no second mount.
// (id:turtle-ambient-calculus, id:laws-figure-eidos-naming)
//
// Run: node --test test/js/laws/figure_binding_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive } from "./harness.mjs"
// The compositor seats a frame's group at worldTransform — the origin chain — and draws
// its published ink inside it. A place is therefore AT the chain, and the ink is local:
// asserting one field would assert which slot the form happens to use.
// (id:laws-figures-phase34-ground)
import { worldTransform } from "../../../assets/js/turtling/scheduler.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const drag = (scheduler, frame, x) => scheduler.requestMotion(frame,
    { rotation: frame.transform.deref().rotation, position: [x, 0, 0] }, scheduler.motionRevision)

// The child's ink, across the drain boundaries: its channel events land in the
// per-tick trace, so collect them across a settle.
function settle(scheduler, rounds = 4) {
    const seen = []
    for (let r = 0; r < rounds; r++) {
        const trace = drive(scheduler, { maxTicks: 8 })
        for (const event of trace.get("flake") ?? []) seen.push(event)
        scheduler.readouts.drain()
    }
    return seen
}
const forwards = (events) => events.filter((e) => e.type === "path")
    .reduce((n, p) => n + p.points.length - 1, 0)

const SIERPINSKI = `
def sierpinski len step do
  when step > 0 do
    loop 3 do
      fw len
      lt 120
      sierpinski len/2 step-1
    end
  end
end
`

test("a figure-valued let is a closed child ambient that follows its question", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `${SIERPINSKI}
let X
fn round(no, nearest) (no - (no // nearest))
let depth = round[X.x, 50]/50
let flake = sierpinski 400 depth
wait 1
`))
    const X = find(host, "X")

    assert.equal(forwards(settle(scheduler)), 0, "depth zero is an empty figure")

    drag(scheduler, X, 100)
    assert.equal(forwards(settle(scheduler)), 12, "crossing to depth 2 draws the figure")

    drag(scheduler, X, 60)
    assert.equal(forwards(settle(scheduler)), 3, "returning to depth 1 draws 3")

    drag(scheduler, X, 99)
    assert.equal(forwards(settle(scheduler)), 0, "a same-bucket move authorizes no rebuild")

    assert.equal(scheduler.errors.length, 0)
})


test("an unused sibling scalar is not the question — same bucket does not rebuild", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `${SIERPINSKI}
let X
fn round(no, nearest) (no - (no // nearest))
let input = X.x
let depth = round[X.x, 50]/50
let flake = sierpinski 400 depth
wait 1
`))
    const X = find(host, "X")
    drag(scheduler, X, 60)
    settle(scheduler)
    const run = find(host, "flake").runIncarnation

    drag(scheduler, X, 99)
    settle(scheduler)
    assert.equal(find(host, "flake").runIncarnation, run,
        "input twitched; depth stayed 1; the figure is the same question")
    const questions = scheduler.readouts.list().filter((n) => n.keyed).map((n) => n.question)
    assert.ok(questions.every((q) => !JSON.stringify(q).includes("input")),
        `the unused sibling is not in the key: ${JSON.stringify(questions)}`)

    drag(scheduler, X, 100)
    settle(scheduler)
    assert.ok(find(host, "flake").runIncarnation > run,
        "crossing the bucket is a new question")
    assert.equal(scheduler.errors.length, 0)
})

test("a figure's question is its arguments — a free ancestor let does not rebuild", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def peek d do
  fw depth
end
let X
let depth = X.x
let flake = peek 0
wait 1
`))
    const X = find(host, "X")
    settle(scheduler)
    const run = find(host, "flake").runIncarnation
    drag(scheduler, X, 5)
    settle(scheduler)
    assert.equal(find(host, "flake").runIncarnation, run,
        "peek 0 is not peek depth — pass the live name at the call")
    assert.equal(scheduler.errors.length, 0)
})

test("passing a live argument is the question", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def peek d do
  fw d
end
let X
let depth = X.x
let flake = peek depth
wait 1
`))
    const X = find(host, "X")
    settle(scheduler)
    const run = find(host, "flake").runIncarnation
    drag(scheduler, X, 5)
    settle(scheduler)
    assert.ok(find(host, "flake").runIncarnation > run,
        "peek depth rebuilds when depth moves")
    assert.equal(scheduler.errors.length, 0)
})

test("a derived child inherits the declaration's space, colour and logical birth", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def spot d do
  fw birthtime
end
let X
jmp 100
beColour red
wait 1
let flake = spot[0]
wait 1
`))
    const events = settle(scheduler)
    const child = find(host, "flake")
    const path = events.find((e) => e.type === "path")
    assert.ok(path, "the child drew its figure")
    assert.equal(path.color, "red", "the declaration's colour is inherited")
    assert.equal(child.isPlace, true, "a `let` figure earns a place")
    assert.deepEqual(worldTransform(child).position, [100, 0, 0],
        "the place stands at the declaration pose — the chain the compositor seats")
    assert.equal(worldTransform(child).position[0] + path.points.at(-1)[0], 101,
        "fw birthtime draws 1s from there — local ink inside the seated layer")
})

test("a derived child is closed: no world read, no randomness", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def peek d do
  fw X.x
end
let X
let flake = peek[0]
wait 1
`))
    settle(scheduler)
    const child = find(host, "flake")
    assert.ok(child, "the binding is a child ambient")
    assert.ok(child.error, "a world read inside a derived figure is a wound")
    assert.match(child.error.message, /no world read|Undefined variable/, child.error.message)
})

test("a derived figure spans logical time: wait is a dt, not a refusal", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def anim d do
  fw 10
  wait 1
  beColour red
  fw 10
end
let flake = anim[0]
wait 1
`))
    const paths = settle(scheduler).filter((e) => e.type === "path")
    assert.equal(paths.length, 2, "the walk suspended and resumed across the wait")
    assert.deepEqual(paths.map((p) => p.color), ["#000000", "red"], "style survives the joint")
})

test("the newest question preempts a running build", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def slow d do
  fw d
  wait 1
  beColour red
  fw d
end
let X
fn round(no, nearest) (no - (no // nearest))
let depth = round[X.x, 50]/50
let flake = slow depth
wait 1
`))
    const X = find(host, "X")
    const seen = []
    const pump = (n) => {
        const trace = drive(scheduler, { maxTicks: n })
        for (const event of trace.get("flake") ?? []) seen.push(event)
        scheduler.readouts.drain()
    }

    pump(1)                              // the child is suspended mid-build at `wait`
    drag(scheduler, X, 150)              // depth 3, while the build is in flight
    scheduler.readouts.drain()
    pump(8)

    const paths = seen.filter((e) => e.type === "path")
    assert.deepEqual(paths.slice(-2).map((p) => p.points.at(-1)[0]), [3, 6],
        "the figure is the newest question's, not the stale run's")
    assert.ok(seen.some((e) => e.type === "clear"), "the stale run's ink was withdrawn")
    assert.equal(scheduler.errors.length, 0)
})

test("a derived cell is strict: a body that cannot parse is refused", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `def r d do
  let Q = [0,0]
  fw 1
end
let f = r 0
wait 1`))
    for (let i = 0; i < 3; i++) { drive(scheduler, { maxTicks: 8 }); scheduler.readouts.drain() }
    const child = find(host, "f")
    assert.ok(child?.error, "an unparsable body must refuse")
    assert.match(child.error.message, /did not parse/)
})

test("a derived figure's randomness is keyed to its place, not to the process", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def step d do
  beColour random
  fw 10
end
let X
fn round(no, nearest) (no - (no // nearest))
let depth = round[X.x, 50]/50
let flake = step depth
wait 1
`))
    const X = find(host, "X")
    const colours = []
    const pump = (n) => {
        scheduler.readouts.drain()
        const trace = drive(scheduler, { maxTicks: n })
        const paths = (trace.get("flake") ?? []).filter((e) => e.type === "path")
        if (paths.length) colours.push(paths.map((p) => p.color))
    }
    pump(4)
    drag(scheduler, X, 60); pump(6)
    drag(scheduler, X, 120); pump(6)
    assert.equal(colours.length, 3, "each question drew a run")
    assert.deepEqual(colours[1], colours[0], "a rebuild re-walks the same stream")
    assert.deepEqual(colours[2], colours[0], "and again — the flake does not re-roll")
    assert.equal(scheduler.errors.length, 0)
})

test("a word argument in a derived figure is its literal", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `def r d do
  beColour orange
  fw 1
end
let f = r 0
wait 1
`))
    const seen = []
    for (let i = 0; i < 3; i++) {
        const trace = drive(scheduler, { maxTicks: 8 })
        for (const event of trace.get("f") ?? []) seen.push(event)
        scheduler.readouts.drain()
    }
    assert.equal(seen.find((e) => e.type === "path")?.color, "orange",
        "beColour orange resolves the word, not a world read")
})

test("a derived figure is a proper let that restarts at its birth pose", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def step d do
  fw 10
end
let X
fn round(no, nearest) (no - (no // nearest))
let depth = round[X.x, 50]/50
let flake = step depth
wait 1
`))
    const X = find(host, "X")
    const runs = []
    const pump = (n) => {
        scheduler.readouts.drain()
        const trace = drive(scheduler, { maxTicks: n })
        const paths = (trace.get("flake") ?? []).filter((e) => e.type === "path")
        if (paths.length) runs.push(paths.map((p) => p.points[0]))
    }

    pump(4)
    assert.equal(find(host, "flake").isPlace, true, "a `let` figure earns a place")
    drag(scheduler, X, 60); pump(6)
    drag(scheduler, X, 120); pump(6)
    assert.deepEqual(runs, [[[0, 0, 0]], [[0, 0, 0]], [[0, 0, 0]]],
        "every rebuild starts at the birth pose — a value is rebuilt, not drifted")
    assert.equal(scheduler.errors.length, 0)
})

test("a derived figure's pin marks its birth, not its moving head", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def step d do
  fw 10
end
let flake = step 0
wait 1
`))
    for (let i = 0; i < 3; i++) { drive(scheduler, { maxTicks: 8 }); scheduler.readouts.drain() }
    const child = find(host, "flake")
    assert.deepEqual([...child.birthPose.position], [0, 0, 0], "the pin's anchor is the birth")
    assert.deepEqual([...child.transform.deref().position], [10, 0, 0], "the head walked")
    assert.equal(scheduler.errors.length, 0)
})

test("a command is a figure: `let name = label …`", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
let P
let Pbear = label P.bearing 10
wait 1
`))
    const texts = () => {
        const seen = []
        for (let r = 0; r < 4; r++) {
            const trace = drive(scheduler, { maxTicks: 8 })
            for (const e of trace.get("Pbear") ?? []) if (e.type === "label") seen.push(e.text)
            scheduler.readouts.drain()
        }
        return seen
    }
    assert.deepEqual(texts(), [], "no compass yet — the figure waits")
    assert.equal(scheduler.errors.length, 0)
    const P = find(host, "P")
    scheduler.requestMotion(P, { rotation: P.transform.deref().rotation, position: [0, 10, 0] }, scheduler.motionRevision)
    const got = texts()
    assert.ok(got.some((t) => Number(t) === 270), `the label follows the bearing (saw ${got})`)
    assert.equal(scheduler.errors.length, 0)
})

test("a new question inks on the drain's tick — same cadence as the pose", () => {
    // The hand already moved P. Construction stays off the pointer; the walk
    // of the seated answer is this tick, not the next. (id:laws-figure-eidos-cell)
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
let X
def step s do
  fw s
end
let art = step X.x
wait 1
`))
    drive(scheduler)
    const X = find(host, "X")
    const art = find(host, "art")
    drag(scheduler, X, 40)
    scheduler.readouts.drain()
    assert.equal(art.done, false, "the cell is walking the new question")
    scheduler.tick((scheduler.lastTickTime || 0) + 16)
    const ink = art.channel.drain().filter((e) => e.type === "path")
    assert.ok(ink.length > 0, "the new stroke landed with this tick")
    assert.equal(scheduler.errors.length, 0)
})

test("a short call is forgiven — missing holes are 0, not a wound", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `
def turn s a do
  fw s
  rt a
end
let art = turn 40
wait 1
`))
    const seen = []
    for (let r = 0; r < 4; r++) {
        const trace = drive(scheduler, { maxTicks: 8 })
        for (const e of trace.get("art") ?? []) seen.push(e)
        scheduler.readouts.drain()
    }
    const path = seen.find((e) => e.type === "path")
    assert.ok(path, "turn 40 draws — the missing angle is 0")
    assert.equal(scheduler.errors.length, 0)
    assert.ok(find(host, "art"))
})
