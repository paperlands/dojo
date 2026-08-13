// Helios sun-day glyph generics + walk + nerve adapter.
// node --test test/js/nerve/helios_test.mjs

import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
    CAST,
    TRACK,
    CENTER,
    SKY,
    SKY_DWELL_MS,
    SETTLE_DWELL_MS,
    LADDER,
    phaseOf,
    rungIdFor,
    sideAt,
    pathGlyph,
    nightGlyph,
    successGlyph,
    glyphFor,
    glyphForRung,
    heliosView,
    createHeliosWalk,
} from "../../../assets/js/nerve/helios.js"
import {
    CHANNELS,
    signals as S,
    createSignalStore,
} from "../../../assets/js/nerve/store.js"

describe("CAST — atoms are fixed", () => {
    test("body pair is white sun walking, black sun at rest", () => {
        assert.equal(CAST.sunWhite, "☼")
        assert.equal(CAST.sunBlack, "☀︎")
    })
    test("low-sun dust is small ⋆", () => {
        assert.equal(CAST.dust, "⋆")
    })
    test("success flourish has no outer ˗", () => {
        const g = successGlyph()
        assert.equal(g, "ˏˋ☀︎ˎˊ")
        assert.ok(!g.startsWith("˗") && !g.endsWith("˗"))
    })
    test("NO FAULT ATOM — a fault is health, and health owns the base layer", () => {
        assert.equal(CAST.fault, undefined)
        assert.equal(LADDER.some((r) => r.id === "fault"), false)
    })
})

// THE SUN IS NOT A LOAD BAR. Ink used to pick the rung, which made a big figure
// "finish the bar" while it was still drawing. Building is a boolean; there is
// no rung to derive from it.
describe("no ratio anywhere", () => {
    test("ink no longer bands the sun", async () => {
        const mod = await import("../../../assets/js/nerve/helios.js")
        assert.equal(mod.PACE_AT, undefined)
        assert.equal(mod.paceForLines, undefined)
    })

    test("truth says only: at rest, or up", () => {
        assert.equal(rungIdFor({ phase: "settled" }), "success")
        assert.equal(rungIdFor({ phase: "building", lines: 0 }), 0)
        assert.equal(rungIdFor({ phase: "building", lines: 10_000 }), 0)
    })
})

describe("phaseOf — two states, and a fault is neither", () => {
    test("weather is building or settled", () => {
        assert.equal(phaseOf({ phase: "settled" }), "settled")
        assert.equal(phaseOf({ phase: "building" }), "building")
        // A stray `faults` in a progress bag no longer steers the glyph.
        assert.equal(phaseOf({ phase: "building", faults: 3 }), "building")
        assert.equal(phaseOf({ phase: "fault" }), "settled")
    })
})

describe("the day — geometry and paint", () => {
    test("SKY is one crossing east→west, then a beat of night", () => {
        assert.deepEqual([...SKY], [0, 1, 2, 3, 4, "night"])
    })

    test("every declared rung paints its glyph", () => {
        assert.equal(glyphForRung(0), "☼----")
        assert.equal(glyphForRung(1), "⋆☼⋆--")
        assert.equal(glyphForRung(2), "-ˋ☼ˊ-")
        assert.equal(glyphForRung(3), "--⋆☼⋆")
        assert.equal(glyphForRung(4), "----☼")
        assert.equal(glyphForRung("night"), "-----")
        assert.equal(glyphForRung("noon"), pathGlyph(CENTER, CAST.sunBlack, "mark"))
        assert.equal(glyphForRung("success"), successGlyph())
    })

    test("LADDER and paint agree, rung for rung", () => {
        for (const rung of LADDER) {
            assert.equal(glyphForRung(rung.id), rung.glyph, `rung ${rung.id}`)
        }
    })

    test("the arc: bare at the horizons, dust climbing, marks up high", () => {
        assert.equal(sideAt(0), null)
        assert.equal(sideAt(1), "dust")
        assert.equal(sideAt(CENTER), "mark")
        assert.equal(sideAt(3), "dust")
        assert.equal(sideAt(4), null)
    })

    test("the west seat is a real west — not the center again", () => {
        // The old ladder parked 3 and 4 both at the middle, so the walk read
        // as a bar filling to the center and stopping.
        assert.equal(glyphForRung(4).indexOf(CAST.sunWhite), TRACK - 1)
        assert.equal(glyphForRung(0).indexOf(CAST.sunWhite), 0)
    })

    test("TRACK and CENTER are the 5-cell midline geometry", () => {
        assert.equal(TRACK, 5)
        assert.equal(CENTER, 2)
        assert.equal(pathGlyph(CENTER, "*", null).length, TRACK)
        assert.equal(nightGlyph().length, TRACK)
        assert.equal(glyphFor({ phase: "settled" }), successGlyph())
    })
})

describe("heliosView — pure truth bag", () => {
    test("carries the counts without inventing a ratio", () => {
        const v = heliosView({ phase: "building", lines: 58, commands: 420, ambients: 2 })
        assert.equal(v.id, 0)
        assert.equal(v.commands, 420)
        assert.equal(v.lines, 58)
        assert.equal(v.ambients, 2)
        assert.equal("ratio" in v, false)
        assert.equal("kind" in v, false)
    })
})

// The walk PULLS. A test owns a mutable world and hands the walk its reader —
// the same seam the shell uses (worldProgress(scheduler)), so nothing here can
// pass by feeding a bag the runtime would never have produced.
function world(initial) {
    const w = { ...initial }
    const walk = createHeliosWalk({ read: () => w, skyMs: 150, settleMs: 60 })
    return {
        walk,
        set(next) { Object.assign(w, next) },
        /** Tick across a clock; collect the ids actually SPOKEN. */
        drive(times) {
            const seq = []
            for (const now of times) {
                const v = walk.tick(now)
                if (v) seq.push(v.id)
            }
            return seq
        },
    }
}

/** Clock ticks every `step` ms up to `until`. */
const clock = (until, step = 10) =>
    Array.from({ length: Math.floor(until / step) + 1 }, (_, i) => i * step)

describe("createHeliosWalk — building walks the day, again and again", () => {
    test("east → west, then night, then east again", () => {
        const w = world({ phase: "building", lines: 10_000, run: 1 })
        assert.deepEqual(
            w.drive(clock(1200)),
            [0, 1, 2, 3, 4, "night", 0, 1, 2],
        )
    })

    test("a world that keeps building keeps the sun walking", () => {
        // The old ladder topped out at the center and stood there: a bar that
        // filled and then lied about the rest of the run.
        const w = world({ phase: "building", lines: 5, run: 1 })
        const seq = w.drive(clock(3000))
        assert.ok(seq.length > SKY.length * 2, "more than two crossings")
        assert.equal(w.walk.isAnimating(), true, "a building sun is never parked")
    })

    test("ink does not move it — only the clock does", () => {
        const w = world({ phase: "building", lines: 0, run: 1 })
        assert.deepEqual(w.drive([0, 20, 40]), [0])
        w.set({ lines: 900_000 })
        assert.equal(w.walk.tick(60), null, "a fat figure is not a later hour")
        assert.deepEqual(w.drive([150]), [1])
    })
})

describe("createHeliosWalk — settled comes to rest at noon, then holds", () => {
    test("from the east it goes on to the middle, turns ☀︎, flourishes", () => {
        const w = world({ phase: "building", lines: 20, run: 1 })
        assert.deepEqual(w.drive([0]), [0])

        // A quick one: settles inside its first crossing. The leading 0 is the
        // breath changing under the same glyph — the seat stops breathing.
        w.set({ phase: "settled" })
        assert.deepEqual(
            w.drive(clock(400)),
            [0, 1, 2, "noon", "success"],
        )
        assert.equal(w.walk.isAnimating(), false)
    })

    test("from past the middle it finishes the day rather than turning back", () => {
        // A sun does not walk backwards. West, under, up again, and rest.
        const w = world({ phase: "building", lines: 20, run: 1 })
        w.drive(clock(500))                       // …reaches seat 3
        assert.equal(w.walk.shown, 3)
        w.set({ phase: "settled" })
        assert.deepEqual(
            w.drive(clock(1000).map((t) => t + 500)),
            [3, 4, "night", 0, 1, 2, "noon", "success"],
        )
    })

    test("a settled sun holds — no second day", () => {
        const w = world({ phase: "settled", lines: 8, run: 1 })
        w.drive(clock(1000))
        assert.equal(w.walk.mode, "idle")
        assert.equal(w.walk.shown, "success")
        assert.deepEqual(w.drive(clock(3000)), [])
    })
})

// A RUN IS THE IDENTITY. These are the cases the deleted `notifySettled` back
// door existed to patch: a run too small to ever breathe `building`.
describe("createHeliosWalk — the run, not the phase edge", () => {
    test("a tiny run never seen building still rises east, then rests", () => {
        const w = world({ phase: "settled", lines: 8, run: 1 })
        assert.deepEqual(w.drive([0]), [0])
        assert.equal(w.walk.isAnimating(), true)
        assert.deepEqual(w.drive(clock(400)), [1, 2, "noon", "success"])
        assert.equal(w.walk.isAnimating(), false)
    })

    test("a SECOND tiny run rises again — settled→settled is not an edge, but a run is", () => {
        const w = world({ phase: "settled", lines: 4, run: 1 })
        w.drive(clock(400))
        assert.equal(w.walk.mode, "idle")

        w.set({ run: 2 })                       // re-run, same shape, same phase
        assert.deepEqual(w.drive([500]), [0])
        assert.deepEqual(
            w.drive(clock(400).map((t) => t + 500)),
            [1, 2, "noon", "success"],
        )
    })

    test("a re-run that starts where the last ended is still news", () => {
        // Same glyph both times — only the run tells them apart, so the seat
        // lights instead of sitting on the previous sun.
        const w = world({ phase: "building", lines: 3000, run: 1 })
        assert.deepEqual(w.drive([0]), [0])
        w.set({ run: 2, lines: 0 })
        assert.deepEqual(w.drive([40]), [0])
        assert.equal(w.walk.mode, "building")
    })

    test("new building phase restarts at the east", () => {
        const w = world({ phase: "building", lines: 10_000, run: 1 })
        w.drive(clock(500))
        w.set({ phase: "settled" })
        w.drive(clock(1000).map((t) => t + 500))
        w.set({ phase: "building", run: 2 })
        assert.deepEqual(w.drive([2000]), [0])
    })
})

describe("createHeliosWalk — speaks on edges, so no caller diffs glyphs", () => {
    test("an unmoved world says nothing", () => {
        const w = world({ phase: "building", lines: 10_000, run: 1 })
        assert.equal(w.walk.tick(0).id, 0)
        assert.equal(w.walk.tick(10), null)
        assert.equal(w.walk.tick(20), null)
        assert.equal(w.walk.tick(150).id, 1)
    })

    test("the breath is part of the edge — building→settled at one rung is news", () => {
        const w = world({ phase: "building", lines: 3000, run: 1 })
        assert.equal(w.walk.tick(0).id, 0)
        assert.equal(w.walk.tick(10), null)
        w.set({ phase: "settled" })
        const v = w.walk.tick(10)
        assert.equal(v.id, 0)
        assert.equal(v.phase, "settled")     // same glyph, different breath
    })
})

describe("createHeliosWalk — timing constants", () => {
    test("a crossing reads as an arc, the rest as a landing", () => {
        // One day = 6 * 150 = 900ms; coming to rest is brisker, the run is done.
        assert.equal(SKY_DWELL_MS, 150)
        assert.equal(SETTLE_DWELL_MS, 60)
        assert.ok(SETTLE_DWELL_MS < SKY_DWELL_MS)
    })

    test("the tick chain asks for the pace it is actually walking", () => {
        const w = world({ phase: "building", lines: 1, run: 1 })
        w.drive([0])
        assert.equal(w.walk.nextDelayMs(), 150)
        w.set({ phase: "settled" })
        w.drive([10])
        assert.equal(w.walk.nextDelayMs(), 60)
    })
})

describe("signals.helios — the adapter", () => {
    test("glyph as msg, COMMANDS as payload", () => {
        const sig = S.helios(heliosView({ phase: "building", lines: 58, commands: 1200 }))
        assert.equal(sig.kind, "helios")
        assert.equal(sig.msg, "☼----")
        assert.equal(sig.payload, "1200")
    })

    test("no count yet, nothing said beside the sun", () => {
        assert.equal(S.helios(heliosView({ phase: "building", commands: 0 })).payload, null)
    })

    test("living while building, quiet when settled", () => {
        assert.equal(S.helios(heliosView({ phase: "building", commands: 10 })).living, true)
        assert.equal(S.helios(heliosView({ phase: "settled", commands: 10 })).living, false)
        const store = createSignalStore()
        store.push(S.helios(heliosView({ phase: "building", commands: 1 })))
        assert.equal(store.signals[0].living, true)
    })

    test("dedicated channel routes to status", () => {
        assert.equal(CHANNELS.helios.zone, "status")
        assert.equal(CHANNELS.helios.css, "nerve-helios")
    })

    test("walk display → push through store", () => {
        const store = createSignalStore()
        const seen = []
        store.subscribe((s) => seen.push(s))
        const w = world({ phase: "building", lines: 10_000, commands: 7, run: 1 })
        store.push(S.helios(w.walk.tick(0)))
        assert.equal(seen[0].msg, "☼----")
        assert.equal(seen[0].payload, "7")
        store.push(S.helios(w.walk.tick(150)))
        assert.equal(seen[1].msg, "⋆☼⋆--")
    })
})
