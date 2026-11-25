// THE EDGES THE ORACLE FOUND — each of these was a WRONG FOREST while the
// fast-path counter said `converged: 1`. That combination — success reported, tree
// wrong — is the only failure this path can produce that hurts, so each case is
// pinned by exact JSON equality AND by which path answered.
//
// `id:weave-typing-path`, `id:cmp-green-tree`.
//
// Run: node --test test/js/document/convergence_edges_test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    parseProgram, reparseProgram, provenanceOf, reparseStats, resetReparseStats,
} from "../../../assets/js/turtling/parse.js";

const frozen = (ast) => JSON.stringify(ast);
const step = (text, prevText, prevAst) => reparseProgram(text, prevText, prevAst);

describe("edges — a converged reparse is never a wrong forest", () => {
    test("a meadow opener nested inside a block's Error still marks the group", () => {
        // The opener `###` at line 2 becomes a CHILD of `for 2 do`'s error node (the
        // block stops before the cell fence at line 4). No top-level unit carries
        // meadowOpen, so backing up to a visible opener finds none — and the restart
        // state must not conclude that the clearing has not been opened yet.
        const prev = "for 2 do\n###\na\n```\n```\nx\n```";
        const next = prev.replace("x", "z");
        resetReparseStats();
        const got = step(next, prev, parseProgram(prev));

        assert.equal(frozen(got), frozen(parseProgram(next)), "the forest the text means");
        assert.equal(reparseStats().converged, 1, "and the fast path answered");
        const atLine6 = got.find((u) => u.span.line === 6);
        assert.equal(atLine6.meta.meadowOpen, false, "line 6 is prose INSIDE a clearing it did not open");
        assert.equal(atLine6.meta.lit, "z");
    });

    test("a zero-width insertion that destroys a fence declines", () => {
        // Inserting inside a fence line rewrites it: ``` becomes `x ``. The dirty
        // span is empty on the old side, so a guard that only reads non-empty
        // spans never sees the fence it just destroyed.
        const prev = "###\n```\n```\n";
        const next = "###\n`x ``\n```\n";
        resetReparseStats();
        const got = step(next, prev, parseProgram(prev));

        assert.equal(frozen(got), frozen(parseProgram(next)), "the forest the text means");
        assert.equal(reparseStats().converged, 0, "the fast path must decline");
        assert.equal(reparseStats().declines.fence, 1, "and say why");
    });

    test("a foreign tree is never adopted — not even on the fallback path", () => {
        // The certificate guarded the fast path only, so the fallback's reconcile
        // could still rewrite a stranger's trivia: contentKey ignores comments, so
        // `fw 1 #old` and `fw 1 #new` reconcile and the stranger's comment moves.
        const stranger = parseProgram("fw 1 #old\nrt 2");
        const before = frozen(stranger);
        resetReparseStats();
        const got = step("fw 1 #new\nrt 2", "a different previous source", stranger);

        assert.equal(frozen(stranger), before, "the stranger's tree is untouched");
        assert.equal(stranger[0].meta.comment, "old");
        assert.equal(frozen(got), frozen(parseProgram("fw 1 #new\nrt 2")));
        assert.equal(reparseStats().declines["foreign-source"], 1, "and it is not silent");
    });

    test("a tree is a single-use input — reuse is loud, not silently double-shifted", () => {
        // Adoption mutates the nodes it reuses, so a second call with the same tree
        // would shift the tail AGAIN. Ownership is linear: say so, answer fresh.
        const text0 = "fw 1\nrt 2\nlt 3";
        const a0 = parseProgram(text0);
        const a1 = step("fw 9\nrt 2\nlt 3", text0, a0);
        assert.equal(provenanceOf(a0).consumed, true, "the input is spent by the call");
        assert.equal(provenanceOf(a1).consumed, false, "the answer is armed and fresh");

        const snapshot = frozen(a1);
        resetReparseStats();
        const a2 = step("fw 8\nrt 2\nlt 3", "fw 9\nrt 2\nlt 3", a0);   // the spent tree again

        assert.equal(frozen(a1), snapshot, "the spent tree was not shifted a second time");
        assert.equal(reparseStats().declines.spent, 1, "misuse is counted, not absorbed");
        assert.equal(frozen(a2), frozen(parseProgram("fw 8\nrt 2\nlt 3")), "and the answer is fresh");
    });

    test("unarmed input (an array that never came from a parse) declines", () => {
        resetReparseStats();
        const got = step("fw 2", "fw 1", []);
        assert.equal(frozen(got), frozen(parseProgram("fw 2")));
        assert.equal(reparseStats().declines.unarmed, 1);
    });
});
