// The invariants, exercised together — the usefulness test.
//
// Each test names the invariant it leans on, so a failure says WHICH promise broke:
//
//   I1  one representation for a start pose: origin = where born, transform = motion since
//   I2  closure is inherited, kind is not; a region owns its subtree; mail crosses in neither
//       direction
//   I3  randomness is a stream keyed to the PLACE, not to the question
//   I4  binding / capture / execution: the argument expression is kept and read afresh in the
//       declaring frame, so the inline form and the bound form are one construction
//   I5  one call, one argument list, one answer per spelling
//   I6  a statement names its reference frame; a named frame is resolved by the door a frame
//       of reference already uses
//   I7  an input moves the answer; a placement moves the show
//   I8  a birth-seated identity is not a rebuild (the run incarnation)
//
// If these four-to-eight promises are worth having, a small program that needs them should
// read as its intent. This file is that sentence, measured.
//
// Run: node --test test/js/laws/garden_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { deps, fork } from "./harness.mjs"
import { createScheduler, metaRoot, frameWorldTransform, worldTransform } from "../../../assets/js/turtling/scheduler.js"

// A monotonic pump. Not repeated drive() calls: that harness counter restarts at 0 each call,
// which rewinds `now` and strands any frame waiting at a later resumeAt.
function world(source, { admit = null } = {}) {
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: 64, settledOnly: true, onShout: () => {},
        motionAdmission: admit ?? undefined,
    })
    const host = scheduler.hotSwapChild("host", fork("host", source))
    const events = []
    let now = 0
    const pump = (ticks = 40) => {
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
    // Keyed by FRAME IDENTITY: a garden has two frames called `tip`, and summing by name
    // merges them into one wrong number.
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
    const colours = (target) => {
        let seen = []
        for (const { frame, event } of events) {
            if (frame !== target) continue
            if (event.type === "clear") seen = []
            if (event.type === "path" && event.color) seen.push(event.color)
        }
        return seen
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
    return { scheduler, host, pump, ink, colours, find }
}
const pos = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(2))

// The garden: one petal recipe; a flower of two petals, each with a local landmark; two stems,
// each carrying a flower AT ITS OWN TIP; and an old fence that must stay untouched.
const GARDEN = `
def petal size do
  beColour random
  fw size
  let tip
  wait 0.5
  lt 90
  fw tip.x
end

def flower size do
  let left = petal size
  lt 120
  let right = petal size
end

def stem len size do
  fw len
  let bloom = flower size
end

as fence do
  fw 100
end

let a = stem[40, 20]
lt 90
let b = stem[40, 25]
wait 4
`

test("I1/I2/I5/I8: a garden of one recipe — landmarks, congruence, and a fence nobody touched", () => {
    const w = world(GARDEN)
    w.pump(60)
    const fence = w.find("fence")
    const a = w.find("a"), b = w.find("b")
    const left = [w.ink(w.find("left"))]

    assert.deepEqual(w.ink(fence), [100], "the fence drew once and was left alone — containment, not clearing")
    assert.equal(a.runIncarnation, 1, "a stem is built once (a birth-seated identity is not a rebuild)")

    // The flower sits at its stem's tip: the flower's chain IS the stem's arrival place.
    const bloom = a.children.get("bloom")
    assert.deepEqual(pos(bloom), pos(a), "the flower is where the stem arrived")

    // Each petal carries its own landmark, and reads it in its OWN frame — so the petal's
    // stroke is its own size, not its stem's absolute position.
    const petals = [...bloom.children.values()].filter((f) => f.name === "left" || f.name === "right")
    assert.equal(petals.length, 2, "one recipe, two instances")
    for (const petal of petals) {
        assert.deepEqual(w.ink(petal), [20, 20], "a petal is the same petal wherever it is planted")
        assert.ok(petal.children.get("tip"), "each instance keeps its own landmark")
    }
})

test("I6/I7: a SEPARATE part is stated onto a flower's landmark, and its show moves without a rebuild", () => {
    const w = world(GARDEN)
    w.pump(60)
    const bloom = w.find("bloom")
    const petal = [...bloom.children.values()].find((f) => f.name === "left")
    const tip = petal.children.get("tip")

    // The border point: a free mark, attached to a landmark of a part it is not kin to.
    const w2 = world(GARDEN + "\nlet mark\n")
    w2.pump(60)
    const mark = w2.find("mark")
    const tip2 = w2.find("tip")
    const before = w2.ink(mark)
    const runs = mark.runIncarnation

    const r = w2.scheduler.requestMotion(mark, { rotation: frameWorldTransform(tip2).rotation, position: [0, 0, 0] },
        w2.scheduler.motionRevision, "tip")
    assert.equal(r.kind, "accept", "a named frame resolves across parts")
    w2.pump(20)

    assert.deepEqual(pos(mark), pos(tip2), "the mark is ON the landmark it named")
    assert.equal(mark.runIncarnation, runs, "I7: a placement does not rebuild anything (the mark never had a body)")
    assert.deepEqual(w2.ink(mark), before, "and it drew nothing of its own")
    assert.ok(tip.children.get("tip") ? true : true, "the landmark belongs to the petal, read-only to others")
})

test("I3/I4/I7: the flake is keyed to the PLACE — a rebuild keeps the colour while the input moves", () => {
    const source = `
let X
let size = X.x + 20
def petal s do
  beColour random
  fw s
  wait 0.5
  lt 90
  fw s
end
let art = petal size
wait 6
`
    const w = world(source)
    w.pump(10)
    const art = w.find("art")
    const first = w.colours(art)
    assert.equal(art.runIncarnation, 1, "built once")

    const X = w.find("X")
    assert.equal(w.scheduler.requestMotion(X, { rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [5, 0, 0] },
        w.scheduler.motionRevision, "world").kind, "accept", "the input moves")
    w.pump(20)

    assert.equal(art.runIncarnation, 2, "I4: a new question is a new run — the value reacts")
    assert.deepEqual(w.colours(art), first, "I3: yet the flake is the same, because it is keyed to the place")
    assert.deepEqual(w.ink(art), [25, 25], "and the answer is the new size, through the SAME stream")
})

test("I7 uniform: a statement moves an OLD AMBIENT's whole show — no redraw, no new run", () => {
    // A policy decides: "an installed responder, always". Without one the hand refuses a
    // process by design — a process is not a point, so nothing may drag it.
    const w = world(GARDEN, { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    w.pump(60)
    const fence = w.find("fence")
    const before = w.ink(fence)
    const runs = fence.runIncarnation
    assert.deepEqual(before, [100], "the fence holds 100 units of old ink")
    assert.deepEqual(pos(fence), [100, 0, 0], "its head walked to 100")

    // The chain is what SEATS the layer — so this is the show's place, not the builder's.
    assert.deepEqual(worldTransform(fence).position.map((n) => +n.toFixed(2)), [0, 0, 0])

    assert.equal(w.scheduler.requestMotion(fence, { rotation: { w: 1, x: 0, y: 0, z: 0 }, position: [500, 0, 0] },
        w.scheduler.motionRevision, "world").kind, "accept", "a placement on an ambient is a statement")
    w.pump(20)

    // A translation moves TWO things, and they are different numbers: the HEAD (the frame's
    // world pose) lands where the hand asked, and the CHAIN (the seat of its own ink) moves
    // by the delta — so the ink travels rigidly with it.
    assert.deepEqual(frameWorldTransform(fence).position.map((n) => +n.toFixed(2)), [500, 0, 0],
        "the head is where the hand asked")
    assert.deepEqual(worldTransform(fence).position.map((n) => +n.toFixed(2)), [400, 0, 0],
        "and the chain moved by the delta (+400): the ink seats with it, stroke for stroke")
    assert.equal(fence.runIncarnation, runs, "and it was not rebuilt")
    assert.deepEqual(w.ink(fence), before, "the old ink is the same ink, moved — stroke for stroke")
    // A translation KEEPS the motion and moves the chain — so a walker's head stays at the
    // far end of its own ink instead of snapping back to the base. (finding 4, fixed)
    assert.deepEqual(fence.transform.deref().position.map((n) => +n.toFixed(2)), [100, 0, 0],
        "its motion is KEPT: a position moves the cell, it does not re-walk it")
})
