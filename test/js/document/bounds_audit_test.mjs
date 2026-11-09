// THE BOUNDS AUDITOR — restart coordinates must be true, not merely useful.
//
// `unitBounds` is the WeakMap that lets a re-parse restart at a top-level unit:
// each entry says where that unit's first RECORD is, what line it starts on, how
// far it reaches, and the fence state at that record. A wrong entry usually
// still produces a right AST (the parse is total), so an AST comparison can pass
// while the fast path is quietly armed at the wrong coordinate — and the next
// edit after that fails.
//
// This test checks the coordinates AGAINST the record stream itself: re-tokenize
// the whole text independently, then assert every bound names a real record, the
// real line, the real state, and a far edge that covers exactly its own records.
//
// Run: node --test test/js/document/bounds_audit_test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    parseProgram, reparseProgram, splitLines, tokenizeRange, unitBoundsOf,
    reparseStats, resetReparseStats,
} from "../../../assets/js/turtling/parse.js";

const audit = (ast, text, label) => {
    // NON-VACUITY: an auditor that loops zero times proves nothing, and two zero
    // lengths would compare equal. Demand a real document, real units, real records.
    assert.ok(ast.length > 0, `${label}: the AST has units`);
    const bounds = unitBoundsOf(ast);
    assert.ok(bounds, `${label}: the AST is armed`);
    assert.ok(bounds.bounds.length > 0, `${label}: there are bounds to check`);

    const raw = splitLines(text);
    assert.equal(bounds.source, text, `${label}: the certificate names its source text`);
    const full = tokenizeRange(raw, 0, Infinity, 0);
    assert.ok(full.lines.length > 0, `${label}: the document produced records`);
    assert.equal(bounds.bounds.length, ast.length, `${label}: one bound per unit`);
    assert.equal(bounds.total, full.lines.length, `${label}: total record count`);

    for (let i = 0; i < ast.length; i++) {
        const b = bounds.bounds[i];
        const rec = full.lines[b.rec];
        assert.ok(rec, `${label}: unit ${i} points at record ${b.rec}`);
        assert.equal(rec.line, b.line, `${label}: unit ${i} starts on its record's line`);
        assert.equal(full.marks[b.rec], b.state, `${label}: unit ${i} carries the state at its record`);

        // The far edge: the unit owns the records up to the NEXT unit's start,
        // and its `end` must be the last physical line those records reach —
        // a meadow record's `endLine`, never merely its birth line.
        const stop = i + 1 < ast.length ? bounds.bounds[i + 1].rec : bounds.total;
        assert.ok(stop > b.rec, `${label}: unit ${i} owns at least one record`);
        const last = full.lines[stop - 1];
        assert.equal(b.end, last.endLine ?? last.line, `${label}: unit ${i} far edge`);
        assert.ok(b.end >= b.line, `${label}: unit ${i} end is not before its start`);
    }
};

describe("bounds auditor — restart coordinates are true", () => {
    test("a fresh parse of a page with a multi-line chunk and a cell", () => {
        const text = "###\n* H\nalpha\nbeta\n```lang\nfw 1\nrt 2\n```\n###\nfw 9";
        const ast = parseProgram(text);
        audit(ast, text, "fresh");
        // FIXTURE-SPECIFIC, so a green run cannot mean "zero of everything":
        // one clearing, one cell, and the bare line after the clearing.
        const bounds = unitBoundsOf(ast);
        assert.ok(ast.length >= 4, `expected a chunk, a cell, and code — got ${ast.length} units`);
        assert.ok(bounds.bounds.some((b) => b.line === 2 && b.end === 4), "the chunk spans its lines");
        assert.ok(bounds.bounds.some((b) => b.line === 6), "the cell body starts at line 6");
    });

    test("a chained edit sequence — the second edit is where a bad re-arm shows", () => {
        resetReparseStats();
        let text = "###\n* Chapter\nalpha\nbeta\n```\ndef fig n do\n  fw n\n  rt 90\nend\n```\n###\nfw 10\nrt 90";
        let ast = parseProgram(text);
        audit(ast, text, "0. birth");

        const step = (next, label) => { ast = reparseProgram(next, text, ast); text = next; audit(ast, text, label); };

        step("###\n* Chapter\nalpha\nbeta\ninserted\n```\ndef fig n do\n  fw n\n  rt 90\nend\n```\n###\nfw 10\nrt 90",
             "1. a line inserted above the cell");
        step("###\n* Chapter\nalpha\nbeta\ninserted\n```\ndef fig n do\n  fw 7\n  rt 90\nend\n```\n###\nfw 10\nrt 90",
             "2. edit inside the shifted cell");
        step("###\n* Chapter\nalpha\nbeta\ninserted\n```\ndef fig n do\n  fw 7\n  rt 90\nend\n###\nfw 10\nrt 90",
             "3. a line removed right before the cell's closer");
        step("###\n* Chapter\nalpha\nbeta\ninserted\n```\ndef fig n do\n  fw 7\n  rt 90\nend\n###\nfw 11 end rt 90",
             "4. a glued `end` after the cell");
        step("###\n* Chapter\nalpha\nbeta\ninserted\n```\ndef fig n do\n  fw 7\n  rt 90\n###\nfw 11 end rt 90",
             "5. an unterminated block near EOF");

        assert.ok(reparseStats().converged >= 3, `the fast path ran (${JSON.stringify(reparseStats())})`);
    });

    test("a fallback re-arms the array it returns", () => {
        const text = "###\n```\nfw 1\n```\n###\nrt 90";
        let ast = parseProgram(text);
        // structural edit: a meadow fence appears → fallback
        let next = "###\n###\n```\nfw 1\n```\n###\nrt 90";
        ast = reparseProgram(next, text, ast);
        audit(ast, next, "after a fallback");
        assert.ok(unitBoundsOf(ast), "the fallback result is armed");
        // and the next ordinary edit converges again
        const before = reparseStats().converged;
        next = "###\n###\n```\nfw 2\n```\n###\nrt 90";
        ast = reparseProgram(next, "###\n###\n```\nfw 1\n```\n###\nrt 90", ast);
        audit(ast, next, "the edit after a fallback");
        assert.ok(reparseStats().converged > before, "convergence resumed");
    });
});

describe("provenance — a certificate belongs to one text", () => {
    test("an AST from a different text is not reused, and is not mutated", () => {
        resetReparseStats();
        const a = "###\n```\nfw 1\n```\n###";
        const c = "###\n```\nfw 9\n```\n###";          // same shape, different text
        const b = "###\n```\nfw 2\n```\n###";

        const astA = parseProgram(a);
        const spansBefore = JSON.stringify(astA.map((n) => n.span));

        // prevText says `c`, but the tree came from `a`: a mismatched pair.
        const got = reparseProgram(b, c, astA);

        assert.equal(JSON.stringify(got), JSON.stringify(parseProgram(b)), "answer must be the fresh forest");
        assert.equal(reparseStats().converged, 0, "must not converge on a mismatched pair");
        assert.equal(JSON.stringify(astA.map((n) => n.span)), spansBefore,
            "the borrowed tree's spans must not be shifted under its owner");
    });

    test("the matching pair still converges", () => {
        resetReparseStats();
        const a = "###\n```\nfw 1\n```\n###";
        const b = "###\n```\nfw 2\n```\n###";
        reparseProgram(b, a, parseProgram(a));
        assert.ok(reparseStats().converged >= 1);
    });
});
