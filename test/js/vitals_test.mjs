// The stage's pulse (turtling/vitals.js) — restored from the portal-organs
// stash, where these pins first stood (portal_ink_test.mjs). Run with:
//   node --test test/js/vitals_test.mjs
//
// What this pins: vitals are a READER over an injected scheduler — pure,
// headless, never advancing a frame; nobody home answers null (the peek
// degrades to the word); livingFamily speaks the ONE pattern law (match.js,
// the same scan `when` uses) and the root stays out — it is the stage, not
// a member.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { frameVitals, livingFamily } from "../../assets/js/turtling/vitals.js"

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
            error: { message: "Undefined property: x", span: { line: 3 }, phase: "walk" },
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
