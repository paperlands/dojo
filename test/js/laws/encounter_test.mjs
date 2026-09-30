// The encounter — two flowers, each attached to its own stem's tip, one opening over
// time, while the hand moves its stem.
//
// This is written as a WITNESS, not a feature request. Where it reads simply, the
// foundation is earned; where it is awkward, the awkwardness is specific and is the
// next work. Three attachment shapes are exercised, because "attached" turns out to
// mean different things and the difference is load-bearing:
//
//   RIGID    a flower DECLARED inside its stem. It rides the stem because a child's
//            world composes with its parent's position. No rebuild (I7's "a placement
//            moves the show").
//   VALUE    a flower whose ARGUMENTS are the stem tip's coordinates, read where
//            reading is allowed. It stays on the tip because the tip is part of its
//            question, so it re-derives when the tip moves (I4 + I6 + I7).
//   ONCE     a statement naming a frame copies the pose. It does NOT follow — a
//            statement is a snapshot, and that is a fact about the design worth
//            pinning so nobody is surprised by it.
//
// (id:laws-figures-phase34-intent)
//
// Run: node --test test/js/laws/encounter_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { deps, fork } from "./harness.mjs"
import { createScheduler, metaRoot, frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

// A monotonic pump. Not repeated harness.drive() calls: that counter restarts at 0
// per call, which rewinds `now` and strands a frame waiting at a later resumeAt.
function world(source, { admit = null } = {}) {
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: 256, settledOnly: true, onShout: () => {},
        motionAdmission: admit ?? undefined,
    })
    const host = scheduler.hotSwapChild("host", fork("host", source))
    const events = []
    let now = 0
    const pump = (ticks = 60) => {
        for (let i = 0; i < ticks; i++) {
            if (!scheduler.done) scheduler.tick(now)
            scheduler.readouts.drain()
            now += 1000
            for (const frame of scheduler.registry.values()) {
                for (const event of frame.channel.drain()) events.push({ frame, event })
            }
        }
        return scheduler
    }
    const find = (name) => {
        const walk = (f) => {
            if (f.name === name) return f
            for (const c of f.children.values()) {
                const hit = walk(c)
                if (hit) return hit
            }
            return null
        }
        return walk(host)
    }
    const put = (frame, position) => scheduler.requestMotion(frame,
        { rotation: { w: 1, x: 0, y: 0, z: 0 }, position }, scheduler.motionRevision, "world")
    const ink = (target) => {
        let strokes = []
        for (const { frame, event } of events) {
            if (frame !== target) continue
            if (event.type === "clear") strokes = []
            if (event.type === "path" && event.points.length > 1) {
                const [ax, ay] = event.points[0]
                const [bx, by] = event.points.at(-1)
                strokes.push(+Math.hypot(bx - ax, by - ay).toFixed(2))
            }
        }
        return strokes
    }
    return { scheduler, host, pump, find, put, ink }
}
const pos = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(2))
const dist = (a, b) => {
    const [ax, ay] = pos(a), [bx, by] = pos(b)
    return +Math.hypot(ax - bx, ay - by).toFixed(2)
}

// One petal recipe; a flower of two petals; a stem that walks and carries one AT ITS END.
const PETALS = `
def petal size do
  fw size
  lt 120
  fw size
end
def flower size do
  let left = petal size
  rt 120
  let right = petal size
end
`
const RIGID = `${PETALS}
def stem len size do
  fw len
  let bloom = flower size
end
let a = stem[40, 20]
lt 90
let b = stem[60, 20]
wait 30
`

test("RIGID: each flower rides its OWN stem — one stays put when the other is moved", () => {
    const w = world(RIGID)
    w.pump(80)
    const a = w.find("a"), b = w.find("b")
    const bloomA = a.children.get("bloom"), bloomB = b.children.get("bloom")
    assert.ok(a && b && bloomA && bloomB, "two stems, two flowers")

    // Each flower sits at the END of its own stem: the stem's length from its base.
    // A walker's world pose is its HEAD, so the flower sits ON it (distance 0); the
    // stem's own length lives in the flower's LINK — its origin, in the parent's frame.
    assert.equal(dist(bloomA, a), 0, "flower A sits on stem A's head")
    assert.equal(dist(bloomB, b), 0, "flower B sits on stem B's head")
    assert.equal(+bloomA.origin.position[0].toFixed(2), 40, "A's link carries 40 — the stem's own length")
    assert.equal(+bloomB.origin.position[0].toFixed(2), 60, "B's link carries 60")

    const runsA = a.runIncarnation, runsBloomA = bloomA.runIncarnation
    const inkBloomA = w.ink(bloomA)
    const bAt = pos(b)

    assert.equal(w.put(a, [200, 0, 0]).kind, "accept", "the hand moves stem A")
    w.pump(40)

    assert.equal(a.runIncarnation, runsA, "I7: a placement moves the show — stem A was NOT rebuilt")
    assert.equal(bloomA.runIncarnation, runsBloomA, "and its flower was not rebuilt either")
    assert.deepEqual(w.ink(bloomA), inkBloomA, "the flower's own ink is the same ink")
    // THE FINDING: a placement writes the origin and CLEARS the motion, so a walked
    // ambient is re-anchored at its BASE while its drawn ink still extends a stem-length
    // beyond it. Head and drawn end disagree afterwards — a value (whose motion is 0)
    // cannot show this, which is why it took a walked stem to surface.
    assert.equal(dist(bloomA, a), 0,
        "FIXED: a placement translates the cell, so the flower is still ON the head — the head",
        "travelled with it instead of snapping back to the base")
    assert.deepEqual(pos(b), bAt, "stem B and its flower were untouched")
    assert.deepEqual(w.ink(w.find("right")), [20, 20], "petals are congruent: the flower is the same flower")
})

test("VALUE: a flower whose question is the stem's tip re-derives to stay on it", () => {
    // The tip's coordinates are read where reading is allowed (the host, outside any
    // closed cell), and become the flower's arguments — so the tip is part of its
    // question and a moved tip is a new question, not a stale pose.
    const w = world(`${PETALS}
def stem len do
  fw len
end
def flowerAt size x y do
  let left = petal size
  rt 120
  let right = petal size
end
let s = stem 40
let bloom = flowerAt[20, s.x, s.y]
wait 30
`)
    w.pump(60)
    const s = w.find("s")
    const bloom = w.find("bloom")
    assert.ok(s && bloom, "a stem and a flower")

    const question0 = bloom.runIncarnation
    assert.equal(w.put(s, [120, 0, 0]).kind, "accept", "the hand moves the stem")

    w.pump(40)
    assert.ok(bloom.runIncarnation > question0,
        `I4: the answer is a function of the tip — it re-derived (${bloom.runIncarnation - question0} rebuilds for ONE statement: a statement commits twice)`)
    // THE FINDING: a composite has no ink of its own — `ink(bloom)` is EMPTY because a
    // figure does not draw itself, its parts do. There is no handle for "the flower's
    // answer", only for its petals. That absence is the content gate (3F.2) stated as a
    // fact about the tree rather than as a project.
    assert.deepEqual(w.ink(bloom), [], "a composite has no ink of its own — only its parts draw")
    assert.deepEqual(w.ink(bloom.children.get("left")), [20, 20],
        "the flower's PARTS are unchanged: what moved is where they hang")
})

test("OPENING: a body that spans logical time, and what a drag does to it", () => {
    // "One opens over time" — a wait inside the body. The hand has an instant; the
    // answer has a duration. This pins what happens TODAY, so step 4 has a witness.
    const w = world(`${PETALS}
def opening size do
  fw size
  wait 20
  lt 90
  fw size
end
let art = opening 20
wait 60
`)
    w.pump(6)
    const art = w.find("art")
    assert.ok(art, "the opening figure exists")
    assert.deepEqual(w.ink(art), [20], "it has drawn its first stroke and is inside the wait")

    const runs0 = art.runIncarnation
    // Move its question while it is mid-wait.
    const w2 = world(`${PETALS}
let X
def opening size do
  fw size
  wait 20
  lt 90
  fw size
end
let art = opening X.x + 20
wait 60
`)
    w2.pump(6)
    const a2 = w2.find("art")
    const X = w2.find("X")
    assert.equal(w2.put(X, [5, 0, 0]).kind, "accept", "the input moves mid-opening")
    w2.pump(40)
    assert.ok(a2.runIncarnation > 1, "today: a new question is a new run — the opening RESTARTS")
    // STEP 4's WITNESS: the new run restarts its wait, so while the hand keeps asking the
    // answer never completes. It completes only once the hand rests.
    assert.deepEqual(w2.ink(a2), [25], "mid-restart: only the first stroke exists")
    w2.pump(80)
    assert.deepEqual(w2.ink(a2), [25, 25], "and it completes only after the hand rests")
    assert.equal(runs0, 1, "the first world was left alone")
})
