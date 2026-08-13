// The stage's pulse (turtling/vitals.js) — restored from the portal-organs
// stash, where these pins first stood (portal_ink_test.mjs). Run with:
//   node --test test/js/stage/vitals_test.mjs
//
// What this pins: vitals are a READER over an injected scheduler — pure,
// headless, never advancing a frame; nobody home answers null (the peek
// degrades to the word); livingFamily speaks the ONE pattern law (match.js,
// the same scan `when` uses) and the root stays out — it is the stage, not
// a member.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { frameVitals, livingFamily, worldProgress } from "../../../assets/js/turtling/vitals.js"

const mkFrame = (name, over = {}) => ({
    name, address: name, elapsedTime: 3.2, commandCount: 12,
    mailbox: [], children: new Map(), error: null, ...over,
})
const mkScheduler = (...frames) => {
    const root = { name: "origin", address: "origin", children: new Map() }
    const registry = new Map([["root", root]])
    for (const f of frames) {
        root.children.set(f.name, f)
        registry.set(f.name, f)
    }
    return { root, registry }
}

describe("the stage's pulse — vitals and the living family", () => {
    test("a live frame answers with its observable pulse", () => {
        const coil = mkFrame("coil", {
            elapsedTime: 7.5, commandCount: 42,
            mailbox: [1, 2], children: new Map([["eye", {}]]),
        })
        const v = frameVitals(mkScheduler(coil), "coil")
        assert.deepEqual(v, {
            name: "coil", address: "coil", elapsed: 7.5,
            commands: 42, letters: 2, kin: 1, error: null,
        })
    })

    test("a standing ailment speaks through the pulse, message only", () => {
        const sick = mkFrame("coil", {
            error: { message: "Undefined property: x", span: { line: 3 }, kind: "walk" },
        })
        assert.equal(frameVitals(mkScheduler(sick), "coil").error,
            "Undefined property: x")
    })

    test("nobody home answers null — the peek degrades to the word", () => {
        assert.equal(frameVitals(mkScheduler(), "coil"), null)
        assert.equal(frameVitals(null, "coil"), null)
    })

    test("a hole-pattern finds its living family; root stays out", () => {
        const s = mkScheduler(mkFrame("mice1"), mkFrame("mice2"), mkFrame("coil"))
        assert.deepEqual(livingFamily(s, "mice[i]"), ["mice1", "mice2"])
    })

    test("a pattern without holes still answers — the family of one", () => {
        const s = mkScheduler(mkFrame("coil"))
        assert.deepEqual(livingFamily(s, "coil"), ["coil"])
        assert.deepEqual(livingFamily(s, "mice[i]"), [])
        assert.deepEqual(livingFamily(null, "coil"), [])
    })
})

// TWO SUNS OVER ONE SCHEDULER (id:light-ladders-place-axis). Both shells'
// figures live in one registry, keyed by Slot — a place-blind sum is one total
// answering for two.
describe("worldProgress — scoped by seat", () => {
    const twoShells = () => mkScheduler(
        mkFrame("coreshell:mine", { commandCount: 10, done: true, run: 3 }),
        mkFrame("outershell:friend", { commandCount: 7, done: true, run: 5 }),
    )

    test("the world sums everything; a seat counts only its own shell", () => {
        const s = twoShells()
        assert.equal(worldProgress(s).commands, 17, "both shells, one total")
        assert.equal(worldProgress(s, ["coreshell:mine"]).commands, 10)
        assert.equal(worldProgress(s, ["outershell:friend"]).commands, 7)
    })

    test("a figure's children count with it — the subtree is the figure", () => {
        const child = mkFrame("coil", { commandCount: 5, done: true })
        const top = mkFrame("coreshell:mine", {
            commandCount: 10, done: true, children: new Map([["coil", child]]),
        })
        const s = mkScheduler(top, mkFrame("outershell:friend", { commandCount: 7, done: true }))
        assert.equal(worldProgress(s, ["coreshell:mine"]).commands, 15, "10 + its spawned coil")
        assert.equal(worldProgress(s, ["outershell:friend"]).commands, 7, "and none of theirs")
    })

    test("a seat with no frame is silent, never a throw", () => {
        assert.equal(worldProgress(twoShells(), []).commands, 0)
        assert.equal(worldProgress(twoShells(), ["coreshell:gone"]).commands, 0)
    })

    test("a place builds on its OWN unfinished work, not the world's", () => {
        const s = mkScheduler(
            mkFrame("coreshell:mine", { done: true }),
            mkFrame("outershell:friend", { done: false }),
        )
        // The scheduler parked with work outstanding — a world fact.
        s.building = true
        assert.equal(worldProgress(s).phase, "building", "the world is busy")
        assert.equal(worldProgress(s, ["outershell:friend"]).phase, "building", "theirs runs")
        assert.equal(
            worldProgress(s, ["coreshell:mine"]).phase, "settled",
            "mine is done — their work must not keep my sun up",
        )
    })

    test("run identity is the place's own — a new sun there is not one here", () => {
        const s = twoShells()
        assert.equal(worldProgress(s, ["coreshell:mine"]).run, 3)
        assert.equal(worldProgress(s, ["outershell:friend"]).run, 5)
    })
})
