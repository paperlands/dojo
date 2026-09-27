// The light rig — moods are weather, never words (id:kr-light, id:kr-moods).
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { MOODS, moodOf, nearness, rigOf, shadeOf } from "../../../assets/js/river/light.js"

describe("moodOf: the sky, from truths the fold already owns", () => {
    test("all shared and nothing happening is noon", () => {
        assert.equal(moodOf({ keptLocal: 0 }), "rest")
        assert.equal(moodOf(), "rest")
    })

    test("one keep still only mine is dawn", () => {
        assert.equal(moodOf({ keptLocal: 1 }), "waking")
        assert.equal(moodOf({ keptLocal: 9 }), "waking", "a count is not a mood")
    })

    test("edges win over holds — a land ignites even over kept-local", () => {
        assert.equal(moodOf({ keptLocal: 3, landing: true }), "ignite")
        assert.equal(moodOf({ keptLocal: 0, settling: true }), "settle")
        assert.equal(moodOf({ keptLocal: 3, landing: true, settling: true }), "ignite")
    })

    test("there are four moods and no fifth", () => {
        assert.deepEqual(MOODS, ["rest", "waking", "ignite", "settle"])
        assert.equal(Object.isFrozen(MOODS), true)
        for (const truths of [
            {},
            { keptLocal: 1 },
            { landing: true },
            { settling: true },
            { keptLocal: 4, landing: true, settling: true },
        ]) {
            assert.ok(MOODS.includes(moodOf(truths)))
        }
    })
})

describe("rigOf: sun size + wash, once per mood (no dual-author CSS)", () => {
    test("every mood answers with --sun-size and --river-wash", () => {
        for (const mood of MOODS) {
            const rig = rigOf(mood)
            assert.deepEqual(Object.keys(rig).sort(), ["--river-wash", "--sun-size"])
            assert.ok(/^\d+px$/.test(rig["--sun-size"]))
            assert.ok(/^\d+%$/.test(rig["--river-wash"]))
        }
    })

    test("ignite is the largest sun; rest is smaller than waking's heat", () => {
        const rest = parseInt(rigOf("rest")["--sun-size"], 10)
        const waking = parseInt(rigOf("waking")["--sun-size"], 10)
        const ignite = parseInt(rigOf("ignite")["--sun-size"], 10)
        assert.ok(ignite > rest)
        assert.ok(waking < ignite)
    })

    test("ignite is the brightest wash", () => {
        const rest = parseInt(rigOf("rest")["--river-wash"], 10)
        const ignite = parseInt(rigOf("ignite")["--river-wash"], 10)
        assert.ok(ignite > rest)
    })

    test("an unknown mood rests rather than throws — light never faults", () => {
        assert.deepEqual(rigOf("nonsense"), rigOf("rest"))
    })
})

describe("shadeOf: dim falls with distance from the meridian", () => {
    test("at the meridian full; at the edge, dimmer", () => {
        const noon = shadeOf(0)
        const edge = shadeOf(1)
        assert.equal(noon.dim, 1)
        assert.ok(edge.dim < noon.dim)
        assert.equal(Object.keys(noon).join(), "dim")
    })

    test("monotone across the strip", () => {
        let last = shadeOf(0)
        for (let t = 0.1; t <= 1.0001; t += 0.1) {
            const here = shadeOf(t)
            assert.ok(here.dim < last.dim, `dim falls at ${t}`)
            last = here
        }
    })

    test("beyond the edge it clamps — night is an envelope, not an error", () => {
        assert.deepEqual(shadeOf(4), shadeOf(1))
        assert.deepEqual(shadeOf(-3), shadeOf(0))
        assert.deepEqual(shadeOf(NaN), shadeOf(0))
        assert.deepEqual(shadeOf(undefined), shadeOf(0))
    })

    test("a seat is never fully dark — warm dark, never black", () => {
        assert.ok(shadeOf(1).dim > 0.5)
    })
})

describe("nearness: distance in SEATS, so the neighbour is fully inactive", () => {
    const PITCH = 66

    test("full at the sun, nothing one seat away", () => {
        assert.equal(nearness(0, PITCH), 1)
        assert.equal(nearness(PITCH, PITCH), 0)
        assert.equal(nearness(-PITCH, PITCH), 0)
        assert.equal(nearness(2 * PITCH, PITCH), 0, "and no less than nothing further out")
    })

    test("symmetric, and continuous across the seat between", () => {
        assert.equal(nearness(20, PITCH), nearness(-20, PITCH))
        let last = 1
        for (let dx = 0; dx <= PITCH; dx += PITCH / 12) {
            const here = nearness(dx, PITCH)
            assert.ok(here <= last, "never rises on the way out")
            last = here
        }
        // The whole point: the crossfade is spent within one seat of travel,
        // whatever the strip's width. A wide river must not light two seats.
        assert.ok(nearness(PITCH / 2, PITCH) > 0.4 && nearness(PITCH / 2, PITCH) < 0.6)
    })

    test("a strip with no width lights nothing rather than dividing by it", () => {
        assert.equal(nearness(0, 0), 0)
        assert.equal(nearness(10, -5), 0)
        assert.equal(nearness(NaN, PITCH), 0)
        assert.equal(nearness(10, NaN), 0)
    })
})

describe("structural greps: light adds no vocabulary (id:kr-light)", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, "../../../assets/js/river/light.js"), "utf8")

    test("no stored sun, no per-seat lamp, no third word", () => {
        assert.equal(/\bdocument\b|\bwindow\b/.test(src), false, "the rig is pure")
        for (const word of ["syncing", "pending", "progress", "percent", "badge"]) {
            assert.equal(
                new RegExp(`\\b${word}\\b`).test(src),
                false,
                `light.js must not name ${word}`,
            )
        }
    })
})
