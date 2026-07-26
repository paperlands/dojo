// The scene seam — the surfaces' shared vocabulary (bridged.js). Run with:
//   node --test test/js/scene_seam_test.mjs
//
// Producers and consumers name the SAME moves; the tuple is the wire shape and
// the shape, not a switch, is the seam. A rename that lands on one side only is
// silent at runtime (`handlers[type]?.()` swallows it) — so it is pinned here.
//
// D021's cull in particular: the cursor gate crosses as (addr, LINE). It used
// to cross as a cell ORDINAL, which made the reach organ resolve "which cell"
// for itself and let a cell inserted above re-aim a standing reach.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { scene } from "../../assets/js/bridged.js"

// Every named move the surfaces publish, with a representative payload.
const MOVES = {
    focus:       [["coil"], { ambientId: "coil" }],
    remove:      [["b1"], { ambientId: "b1" }],
    ambient:     [["@ada", "ada", "fw 1"], { addr: "@ada", name: "ada", code: "fw 1" }],
    ambientStop: [["@ada"], { addr: "@ada" }],
    attend:      [["b1", 12], { addr: "b1", line: 12 }],
}

describe("the scene seam — one vocabulary, both sides", () => {
    for (const [move, [args, expected]] of Object.entries(MOVES)) {
        test(`${move} arrives whole at a consumer of the same name`, () => {
            const seen = []
            const unsub = scene.sub({ [move]: (p) => seen.push(p) })
            scene[move](...args)
            unsub()
            assert.deepEqual(seen, [expected])
        })
    }

    test("fork travels as one payload — the surface never reshapes it", () => {
        const payload = { source: "fw 1", name: "ada", addr: "@ada", time: 1, offset: 0 }
        const seen = []
        const unsub = scene.sub({ fork: (p) => seen.push(p) })
        scene.fork(payload)
        unsub()
        assert.deepEqual(seen, [payload])
    })

    test("the cursor gate crosses as a LINE — the ordinal is culled (D021)", () => {
        assert.equal(typeof scene.attend, "function")
        assert.equal(scene.cell, undefined, "no ordinal door survives")
        const seen = []
        const unsub = scene.sub({ attend: (p) => seen.push(p) })
        scene.attend("b1", null)          // out on bare code — every cell rests
        scene.attend("b1", 7)
        unsub()
        assert.deepEqual(seen, [{ addr: "b1", line: null }, { addr: "b1", line: 7 }])
    })

    test("an unsubscribed consumer hears nothing more", () => {
        const seen = []
        scene.sub({ attend: (p) => seen.push(p) })()
        scene.attend("b1", 3)
        assert.deepEqual(seen, [])
    })
})
