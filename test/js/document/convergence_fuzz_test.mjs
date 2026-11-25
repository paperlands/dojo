// CONVERGENCE UNDER A GENERATOR — the property, not the fixture.
//
// Three real defects on this path were all "the fast path silently did the wrong
// thing": a fallback that disarmed itself, LF-only newline counting against CRLF
// text, and a fence guard that could not see `###` → `##`. Each is one seeded
// generator away from being a permanent regression, so:
//
//   a reparse is indistinguishable from a parse, for every document and edit the
//   generator can reach — and the fast path is the one that answered.
//
// Deterministic: mulberry32, no Math.random, so a failure is reproducible from the
// seed printed in the message. `id:weave-typing-path`, `id:cmp-green-tree`.
//
// Run: node --test test/js/document/convergence_fuzz_test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    parseProgram, reparseProgram, provenanceOf, reparseStats, resetReparseStats,
} from "../../../assets/js/turtling/parse.js";

// ---- deterministic randomness ------------------------------------------------
const mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];

// The grammar's own marks and a few ordinary lines: every construct the tokenizer
// branches on must be reachable from the generator, or the sweep has a blind spot.
const FRAGMENTS = [
    "fw 1", "rt 90", "lt 45", "end", "for 2 do", "def f do", "when x do",
    "###", "* H", "prose", "```", "```lang", "", "# comment", "  fw 2",
    "wait 100", "1 + 2", "let x = 3", "fw 1 / end rt 90", "  ",
];

const makeDoc = (rng) => {
    const n = 2 + Math.floor(rng() * 15);
    let text = Array.from({ length: n }, () => pick(rng, FRAGMENTS)).join("\n");
    const eol = pick(rng, ["lf", "lf", "lf", "crlf", "cr"]);
    if (eol === "crlf") text = text.replace(/\n/g, "\r\n");
    if (eol === "cr") text = text.replace(/\n/g, "\r");
    return text;
};

const FENCE = /^[ \t]*(?:```|###)/;
// The tail the parser can actually reuse: bytes matching at the end, MINUS the
// bytes the common prefix already claimed — the two may not overlap, so an edit
// inside the document's final characters has no tail at all and MAY decline.
const commonTail = (a, b) => {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p &&
           a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    return s;
};
const linesOf = (s) => s.split(/\r\n|\r|\n/);

// One edit. Returns the new text and whether a fence line was touched — the one
// case where declining is the correct answer, not a lost optimization.
const edit = (rng, text) => {
    const lines = linesOf(text);
    const k = Math.floor(rng() * lines.length);
    const kind = pick(rng, ["insertLine", "deleteLine", "replaceLine", "typeChar", "rubChar"]);
    const touched = (arr) => FENCE.test(arr[k] ?? "") || FENCE.test(arr[k + 1] ?? "");

    if (kind === "insertLine") {
        const next = lines.slice();
        next.splice(k, 0, pick(rng, FRAGMENTS));
        return { text: next.join("\n"), fence: touched(next), kind };
    }
    if (kind === "deleteLine" && lines.length > 1) {
        const next = lines.slice();
        next.splice(k, 1);
        return { text: next.join("\n"), fence: touched(next), kind };
    }
    if (kind === "replaceLine") {
        const next = lines.slice();
        next[k] = pick(rng, FRAGMENTS);
        return { text: next.join("\n"), fence: touched(next), kind };
    }
    // A character edit: the commonest real keystroke, and the one that hides.
    const line = lines[k];
    const at = Math.floor(rng() * (line.length + 1));
    let next;
    if (kind === "typeChar") next = line.slice(0, at) + pick(rng, "abcdefg #`*") + line.slice(at);
    else next = at === 0 ? line : line.slice(0, at - 1) + line.slice(at);
    const out = lines.slice();
    out[k] = next;
    return { text: out.join("\n"), fence: FENCE.test(line) || FENCE.test(next), kind };
};

describe("convergence under a generator", () => {
    const SEEDS = 120;

    test("every reparse is indistinguishable from a parse, and stays armed", () => {
        let checks = 0;
        for (let seed = 1; seed <= SEEDS; seed++) {
            const rng = mulberry32(seed);
            let text = makeDoc(rng);
            let ast = parseProgram(text);

            for (let step = 0; step < 3; step++) {
                const { text: next } = edit(rng, text);
                const got = reparseProgram(next, text, ast);
                checks++;

                const where = `seed ${seed} step ${step}`;
                assert.equal(JSON.stringify(got), JSON.stringify(parseProgram(next)),
                             `${where}: converged onto a forest a fresh parse would not produce`);
                const cert = provenanceOf(got);
                assert.ok(cert, `${where}: the returned AST is armed`);
                assert.equal(cert.source, next, `${where}: armed with the text it describes`);

                // Identity: a converged reparse reuses the objects it did not touch.
                // A FRESH prev — adoption mutates the spans of the tree it is handed,
                // so the same tree is only ever a valid input once.
                const probe = reparseProgram(next, text, parseProgram(text));
                assert.equal(JSON.stringify(probe), JSON.stringify(got), `${where}: reparse is repeatable`);

                text = next; ast = got;
            }
        }
        assert.ok(checks >= SEEDS * 3, "the sweep actually ran");
    });

    test("a character edit that moves no fence always converges", () => {
        resetReparseStats();
        let attempts = 0, declined = [];

        for (let seed = 1; seed <= SEEDS; seed++) {
            const rng = mulberry32(seed * 7919);
            let text = makeDoc(rng);
            let ast = parseProgram(text);

            for (let step = 0; step < 4; step++) {
                const e = edit(rng, text);
                const lines = linesOf(text);
                // The guarantee's own preconditions, as the parser states them: a real
                // change, something identical at the end, and no fence line in reach.
                const plain = e.kind === "typeChar" || e.kind === "rubChar";
                const changed = e.text !== text;
                const tail = commonTail(text, e.text) > 0;
                const fences = linesOf(e.text).some((l) => FENCE.test(l)) ||
                               lines.some((l) => FENCE.test(l));

                const before = reparseStats();
                ast = reparseProgram(e.text, text, ast);
                const after = reparseStats();
                const converged = after.converged > before.converged;

                // Whichever path answered, the answer must be the forest the text means.
                assert.equal(JSON.stringify(ast), JSON.stringify(parseProgram(e.text)),
                             `seed ${seed * 7919} step ${step}: ${e.kind} produced the wrong forest`);

                if (plain && changed && tail && !e.fence && !fences) {
                    attempts++;
                    if (!converged) {
                        const why = Object.entries(after.declines)
                            .filter(([r, v]) => v > (before.declines[r] ?? 0)).map(([r]) => r);
                        declined.push(`seed ${seed * 7919} step ${step}: ${why.join("+") || "no counter"} — ${JSON.stringify(e.text.slice(0, 40))}`);
                    }
                }
                text = e.text;
            }
        }

        assert.ok(attempts > 50, `enough fence-free character edits were tried (${attempts})`);
        assert.deepEqual(declined, [], `a fence-free edit must converge, not fall back (${declined.length}/${attempts})`);
    });
});
