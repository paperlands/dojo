// Ring buffer contract — credit signal and closed-sink behaviour.
// Run: node --test test/js/runtime/ring_buffer_test.mjs
//
// Salvaged from channel_overflow_spike_test (D027 R3.6). The rest of that
// spike pinned drop-oldest geometry; the live law is in backpressure_spike_test.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createRingBuffer } from "../../../assets/js/turtling/ring-buffer.js"

describe("lossless put refuses when full", () => {
    test("put returns false and full stays true while open", () => {
        const rb = createRingBuffer(4, { lossless: true })
        for (let i = 0; i < 4; i++) assert.equal(rb.put(i), true)
        assert.equal(rb.full, true)
        assert.equal(rb.put(99), false)
        assert.equal(rb.full, true)
        assert.deepEqual(rb.drain(), [0, 1, 2, 3])
    })
})

describe("closed-channel contract (D027 R3.6)", () => {
    // `full` must mean "put would refuse" — open or closed. Before the fix,
    // a full buffer that was then closed still reported full while put accepted,
    // and a producer that checked before offering livelocked forever.

    test("`full` iff put would refuse — open AND closed", () => {
        const rb = createRingBuffer(4, { lossless: true })
        for (let i = 0; i < 4; i++) assert.equal(rb.put(i), true)
        assert.equal(rb.full, true, "a full lossless buffer refuses")
        assert.equal(rb.put(99), false, "and put agrees while open")

        rb.close()

        const stillFull = rb.full
        const nowAccepts = rb.put(100)
        assert.equal(stillFull, !nowAccepts,
            "`full` must mean `put would refuse`, closed or open")
        assert.equal(stillFull, false, "a closed sink accepts, so it is not full")
    })

    test("a producer that checks before offering does not livelock", () => {
        const rb = createRingBuffer(2, { lossless: true })
        rb.put("a"); rb.put("b")
        rb.close()

        let spins = 0
        let delivered = false
        while (spins++ < 1000) {
            if (rb.full) continue
            rb.put("c")
            delivered = true
            break
        }
        assert.equal(delivered, true, "the closed sink took it on the first ask")
        assert.equal(spins, 1, "no spinning")
    })
})
