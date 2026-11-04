// A figure's randomness is keyed to its place, not drawn from the process.
//
// A derived figure is memoized by its key: `sameSeed` refuses the rebuild and the
// readout refuses the build — both memos decide by equality, so the answer must be
// a function of the key. A derived walk reads no world, so the number and order of
// its `random` uses are a function of the closure too, which makes a POSITION in
// the key's stream well defined. Same figure, same flake; a rebuild does not
// re-roll. Ordinary ambients keep Math.random — they read the world, so a position
// is not theirs to promise. (id:cmp-become-seed, id:laws-figure-protocol)
//
// Run: node --test test/js/execute/keyed_stream_test.mjs
export function keyedSeed(...parts) {
    // FNV-1a over the parts, with a separator so ['ab','c'] and ['a','bc'] differ.
    let h = 2166136261 >>> 0
    for (const part of parts) {
        const text = String(part ?? '')
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i)
            h = Math.imul(h, 16777619)
        }
        h ^= 0x1f
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

// mulberry32: one word of state, a value in [0, 1) per call.
export function keyedStream(seed) {
    let state = seed >>> 0
    return function next() {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
