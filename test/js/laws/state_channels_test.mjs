// Access versus law — two channels of state, two update disciplines.
//
// The rule this pins down:
//
//   * What the answer DEPENDS ON changes (an input, a read from the region's environment)
//     -> the answer is re-derived. A VALUE restarts (a new run, a new question); a PROCESS
//        keeps running and inherits the new value at its next use, because a process's
//        answer IS its history.
//   * Where the answer is SHOWN changes (a law or a hand states a position)
//     -> the placement moves and the answer is untouched. Showing does not own meaning.
//
// A source here must keep the WORLD alive across the change: drive() stops ticking once
// every frame is done, so a short tail would freeze the rebuilt run before it drew again.
//
// The discriminator is the RUN COUNT, not the ink: a value and a process can draw the same
// picture while one of them is a fresh run and the other is a continued walk.
// (id:laws-figures-phase34-ref, id:laws-figure-protocol)
//
// Run: node --test test/js/laws/state_channels_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}

// One world, settling in rounds, collecting each frame's committed ink by FRAME IDENTITY —
// two frames may share a name, and summing by name merges them into one wrong number.
function world(source) {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source))
    const events = []
    // `drive` drains each frame's channel into the trace it returns — so collect from the
    // A MONOTONIC pump, NOT repeated harness.drive(): `drive` keeps its own tick counter and
    // restarts it at 0 on every call, so driving in rounds rewinds `now` and a frame waiting
    // at a later resumeAt can never resume. The boundary review already learned this; same
    // lesson, one file later. This drains the channels itself.
    let now = 0
    const settle = (rounds = 6, ticks = 4) => {
        for (let i = 0; i < rounds * ticks; i++) {
            if (!scheduler.done) scheduler.tick(now)
            scheduler.readouts.drain()
            now += 1000
            for (const frame of scheduler.registry.values()) {
                for (const event of frame.channel.drain()) events.push({ frame, event })
            }
        }
        return scheduler
    }
    const ink = (target) => {
        let strokes = []
        for (const { frame, event } of events) {
            if (frame !== target) continue
            if (event.type === "clear") strokes = []
            if (event.type === "path" && event.points.length > 1) {
                const [ax, ay] = event.points[0]
                const [bx, by] = event.points.at(-1)
                strokes.push(+Math.hypot(bx - ax, by - ay).toFixed(3))
            }
        }
        return strokes
    }
    // A hand states a world position: naming the frame is what makes it a statement.
    const put = (frame, position) => scheduler.requestMotion(frame,
        { rotation: { w: 1, x: 0, y: 0, z: 0 }, position }, scheduler.motionRevision, "world")
    return { scheduler, host, settle, ink, put }
}

test("PROCESS: an access change is INHERITED — one run, trail intact, the next read sees it", () => {
    const w = world(`
let X
let depth = X.x + 1
as walker do
  fw 10
  wait 6
  fw depth
end
wait 30
`)
    w.settle(1, 3)                    // the first stroke is drawn; the wait is still pending
    const walker = find(w.host, "walker")
    const X = find(w.host, "X")
    assert.deepEqual(w.ink(walker), [10], "the walk drew its first stroke")
    assert.equal(w.put(X, [5, 0, 0]).kind, "accept", "the input moves during the wait")

    w.settle(8, 4)
    assert.equal(walker.runIncarnation, 1, "a process continues: no new run")
    assert.deepEqual(w.ink(walker), [10, 6], "and its next read inherits the new value — the trail is kept")
})

test("VALUE: the same access change REACTS — a new run, a new question, a re-derived answer", () => {
    const w = world(`
let X
let depth = X.x + 1
def opening d do
  fw 10
  wait 3
  fw d
end
let bloom = opening depth
wait 30
`)
    w.settle(2, 2)
    const bloom = find(w.host, "bloom")
    const X = find(w.host, "X")
    assert.equal(bloom.runIncarnation, 1, "the value is built once")
    assert.equal(w.put(X, [5, 0, 0]).kind, "accept")

    w.settle(8, 4)
    assert.equal(bloom.runIncarnation, 2, "a value is re-established: a new run")
    assert.ok(bloom.capture?.get("depth") === 6,
        "and its question carries the new input, so reuse is licensed by equality again")
    assert.deepEqual(w.ink(bloom), [10, 6], "the answer is a fresh function of the new question")
})

test("SHOWING: a stated placement moves where the value is, and never rebuilds it", () => {
    const w = world(`
def spot d do
  fw d
end
let art = spot 7
wait 1
`)
    w.settle(4, 4)
    const art = find(w.host, "art")
    const before = w.ink(art)
    const runs = art.runIncarnation
    assert.deepEqual(before, [7], "the value drew its answer")

    assert.equal(w.put(art, [50, 0, 0]).kind, "accept", "a statement places it elsewhere")
    w.settle(4, 4)

    assert.deepEqual(frameWorldTransform(art).position.map((n) => +n.toFixed(3)), [50, 0, 0],
        "the value is shown where it was stated")
    assert.equal(art.runIncarnation, runs, "and it was NOT rebuilt — showing does not own meaning")
    assert.deepEqual(w.ink(art), before, "the answer is untouched, stroke for stroke")
})
