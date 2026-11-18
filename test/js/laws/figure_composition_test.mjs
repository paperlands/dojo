// The readout store's two equalities and coherent settlement — the contract the
// derived figure cell rests on. The figure binding itself is a child ambient and
// is fenced in figure_binding_test.mjs. (id:laws-figure-composition-equality)
//
// Run: node --test test/js/laws/figure_composition_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { createReadouts } from "../../../assets/js/turtling/laws/readout.js"

test("keyed: the question is captured at the commit; the answer is built in drain", () => {
    const store = createReadouts()
    let captures = 0
    let builds = 0
    const id = store.register("s", "k", {
        capture: (snapshot) => { captures++; return [snapshot.value] },
        build: ([value]) => { builds++; return value },
    })

    store.recompute({ value: 7 })
    assert.equal(captures, 1)
    assert.equal(builds, 0, "publication captured the question; it did not build")
    store.drain()
    assert.equal(builds, 1)
    assert.equal(store.value(id), 7)

    store.recompute({ value: 7 })
    assert.equal(captures, 2)
    assert.equal(builds, 1, "an unchanged question authorizes no build")
})

test("keyed: equal questions skip the build; equal answers skip propagation", () => {
    const store = createReadouts()
    let builds = 0
    const seen = []
    store.watch((change) => { if (!change.pending) seen.push(change.value) })
    const id = store.register("s", "abs", {
        capture: (snapshot) => [snapshot.value],
        build: ([value]) => { builds++; return Math.abs(value) },
    })

    store.recompute({ value: -2 }); store.drain()
    store.recompute({ value: 2 }); store.drain()
    assert.equal(builds, 2, "-2 and 2 are different questions")
    assert.deepEqual(seen, [2], "but the same answer propagates once")
    assert.equal(store.value(id), 2)
})

test("keyed: a refused question never wears the previous answer as current", () => {
    const store = createReadouts()
    let builds = 0
    const id = store.register("s", "strict", {
        capture: (snapshot) => [snapshot.value],
        build: ([value]) => {
            builds++
            if (value === 2) throw new Error("refused at two")
            return 10
        },
    })

    store.recompute({ value: 1 }); store.drain()
    assert.equal(store.value(id), 10)

    store.recompute({ value: 2 }); store.drain()
    assert.equal(store.value(id), undefined, "two has no answer, not ten")
    const settled = builds

    // Repeating the same refused question skips the build and stays refused.
    store.recompute({ value: 2 }); store.drain()
    assert.equal(builds, settled, "a settled question is not rebuilt")
    assert.equal(store.value(id), undefined)
})
