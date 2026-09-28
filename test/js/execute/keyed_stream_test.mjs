// A figure's randomness is keyed to its place: same key, same stream, and a
// rebuild does not re-roll. (id:cmp-become-seed, id:laws-figure-protocol)
//
// Run: node --test test/js/execute/keyed_stream_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { keyedSeed, keyedStream } from "../../../assets/js/turtling/mafs/keyed_stream.js"

const draw = (key, n) => {
    const stream = keyedStream(keyedSeed(key))
    return Array.from({ length: n }, () => stream())
}

test("same key, same stream — a rebuild re-walks the same run", () => {
    assert.deepEqual(draw("host/flake", 8), draw("host/flake", 8))
})

test("a different place is a different stream", () => {
    assert.notDeepEqual(draw("host/flake", 8), draw("host/spot", 8))
})

test("a part boundary is part of the key", () => {
    assert.notEqual(keyedSeed("ab", "c"), keyedSeed("a", "bc"))
})

test("values are a stream, not one constant", () => {
    const values = draw("host/flake", 8)
    assert.equal(new Set(values).size, values.length, "each use is its own draw")
    for (const value of values) assert.ok(value >= 0 && value < 1, `${value} in [0,1)`)
})
