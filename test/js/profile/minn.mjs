// min-of-N timing — the instrument this repo was missing.
//
// A single timed run of N operations on this box has a measured 3× session-to-session
// spread (identical code: 0.94 / 1.57 / 3.07 / 3.32 ms for the same 80-cell parse),
// so any delta read off one run — including the tables in test/js/profile/README.org
// and specs/weave/typing-path.org — is noise unless it survived repetition. Take the
// MINIMUM across rounds: interference only ever adds time, so the floor is the signal.
//
//   import { minOf, report } from "./minn.mjs"
//   const ms = minOf(() => parseProgram(src))          // ms per operation
//   report("parseProgram", ms)
//
// Run benches with `node --expose-gc` and let the caller define N and rounds: a
// 3000-line parse needs fewer operations than a 128-line one to fill the same clock.

export const ROUNDS = 7;
export const OPS = 20;

/**
 * Milliseconds per operation, minimised over rounds.
 * @param {(i: number) => unknown} fn   the operation; `i` is the operation index
 * @param {{rounds?: number, ops?: number}} [o]
 */
export function minOf(fn, { rounds = ROUNDS, ops = OPS } = {}) {
    for (let i = 0; i < Math.min(10, ops); i++) fn(i);        // warm the path
    if (globalThis.gc) globalThis.gc();
    let best = Infinity;
    for (let r = 0; r < rounds; r++) {
        const t0 = performance.now();
        for (let i = 0; i < ops; i++) fn(i);
        best = Math.min(best, (performance.now() - t0) / ops);
    }
    return best;
}

/** One aligned row: `name  0.123 ms/op  (min of N×M)`. */
export function report(name, ms, extra = "") {
    console.log(`${name.padEnd(34)} ${ms.toFixed(3).padStart(8)} ms/op${extra ? "  " + extra : ""}`);
}
