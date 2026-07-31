// THE SURFACE'S WOUNDS — one ask, one breath, N readers (assets/js/weave/wounds.js).
//
// The contract this pins:
//   - the ask is asked, never cached here (early cutoff belongs to each reader)
//   - ONE watchWorld per surface, however many readers subscribe
//   - changed() reaches every reader, not one
//   - release() unhears, and a released organ is silent forever after
//
// Why it exists: the ink used to own its own watchWorld, so a surface that also
// beat time painted twice per breath. One clock, then; the readers are pure.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { readWounds } from "../../assets/js/weave/wounds.js"
import { worldChanged } from "../../assets/js/weave/world.js"

describe("readWounds — one clock for a surface", () => {
    test("read() asks, every time — nothing is held here", () => {
        let n = 0
        const wounds = readWounds({ ask: () => [++n] })
        assert.deepEqual(wounds.read(), [1])
        assert.deepEqual(wounds.read(), [2], "no cache — the readers keep their own")
        wounds.release()
    })

    test("a missing answer is an empty one, so no reader guards the call", () => {
        const wounds = readWounds({ ask: () => null })
        assert.deepEqual(wounds.read(), [])
        wounds.release()
    })

    test("one world breath, one call to each reader", () => {
        const heard = []
        const wounds = readWounds({ ask: () => [] })
        wounds.watch(() => heard.push("ink"))
        wounds.watch(() => heard.push("voice"))
        wounds.watch(() => heard.push("wash"))
        worldChanged()
        assert.deepEqual(heard, ["ink", "voice", "wash"],
            "three readers, one breath each — not one breath per reader")
        wounds.release()
    })

    test("changed() reaches EVERY reader — the news a per-organ refresh missed", () => {
        let ink = 0, voice = 0
        const wounds = readWounds({ ask: () => [] })
        wounds.watch(() => ink++)
        wounds.watch(() => voice++)
        wounds.changed()
        assert.equal(ink, 1)
        assert.equal(voice, 1, "a push arriving is news for the voice too")
        wounds.release()
    })

    test("a reader unwatches alone; its siblings keep hearing", () => {
        let ink = 0, voice = 0
        const wounds = readWounds({ ask: () => [] })
        const unink = wounds.watch(() => ink++)
        wounds.watch(() => voice++)
        unink()
        worldChanged()
        assert.equal(ink, 0)
        assert.equal(voice, 1)
        wounds.release()
    })

    test("release() unhears the world — a torn-down surface is silent", () => {
        let heard = 0
        const wounds = readWounds({ ask: () => [] })
        wounds.watch(() => heard++)
        wounds.release()
        worldChanged()
        assert.equal(heard, 0, "the surface is gone; the world may breathe on")
    })

    test("two surfaces keep their own clocks and their own subjects", () => {
        const mine = [], theirs = []
        const a = readWounds({ ask: () => mine })
        const b = readWounds({ ask: () => theirs })
        let seenA = null, seenB = null
        a.watch(() => { seenA = a.read() })
        b.watch(() => { seenB = b.read() })
        worldChanged()
        assert.equal(seenA, mine)
        assert.equal(seenB, theirs, "one world, two subjects — neither reads the other's")
        a.release(); b.release()
    })
})
