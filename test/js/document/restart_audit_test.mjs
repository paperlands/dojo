// THE RESTART AUDITOR — the tree's own spans ARE the restart coordinates.
//
// A converged reparse restarts at a top-level unit, so three facts must be TRUE,
// not merely convenient: the unit's `span.line` names its first record's line, its
// `span.endLine` names the last record it owns, and the fence state at that line
// is derivable from the scan alone. A false coordinate usually still yields a
// right AST (the parse is total), so an AST comparison can pass while the fast
// path is armed at the wrong place — and the next edit after that fails.
//
// So this audits the coordinates against the RECORD STREAM, not against a stored
// index: tokenize the whole text independently and require the spans to partition
// it exactly. `id:cmp-green-tree`, `id:pa-zig-incremental`.
//
// Run: node --test test/js/document/restart_audit_test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    parseProgram, reparseProgram, splitLines, tokenizeRange, stateAt,
    provenanceOf, ParserState, parseUnit, reparseStats, resetReparseStats,
} from "../../../assets/js/turtling/parse.js";

const audit = (ast, text, label) => {
    // NON-VACUITY: an auditor that loops zero times proves nothing.
    assert.ok(ast.length > 0, `${label}: the AST has units`);

    const cert = provenanceOf(ast);
    assert.ok(cert, `${label}: the AST carries provenance`);
    assert.equal(cert.source, text, `${label}: the certificate names its source text`);
    // It rides a Symbol key: no reader may see it, and JSON must not either.
    assert.deepEqual(Object.keys(ast), ast.map((_, i) => String(i)), `${label}: nothing enumerable added`);
    assert.equal(JSON.stringify(ast), JSON.stringify(Array.from(ast)), `${label}: invisible to JSON`);

    const raw = splitLines(text);
    const full = tokenizeRange(raw, 0, Infinity, 0);
    assert.ok(full.lines.length > 0, `${label}: the document produced records`);

    // THE RECORD PARTITION, instrumented: parse the stream again and record the
    // cursor before and after every unit. The intervals must tile it exactly —
    // no record unclaimed, no record claimed twice — and each unit's span must
    // START on its first record and REACH its last (spans round OUTWARD: an Error
    // node names the boundary it refused, never less than it consumed).
    const state = new ParserState(full.lines);
    let cursor = 0;
    for (let i = 0; state.hasMore(); i++) {
        const start = state.pos;
        const unit = parseUnit(state);
        const end = state.pos;
        assert.ok(end > start, `${label}: unit ${i} consumed records`);
        assert.equal(start, cursor, `${label}: unit ${i} begins exactly where unit ${i - 1} stopped`);
        assert.equal(full.lines[start].line, unit.span.line,
                     `${label}: unit ${i} span.line is its first record's line`);
        const lastRec = full.lines[end - 1];
        assert.ok(unit.span.endLine >= (lastRec.endLine ?? lastRec.line),
                  `${label}: unit ${i} span reaches its last record (${unit.span.endLine} vs ${lastRec.endLine ?? lastRec.line})`);
        cursor = end;
        assert.ok(i < 10_000, `${label}: terminates`);
    }
    assert.equal(cursor, full.lines.length, `${label}: every record is owned once`);

    // A restart at EVERY unit reproduces the record stream from the derived state,
    // all three bits — the third says the clearing's first unit was already emitted.
    for (const unit of ast) {
        const line = unit.span.line;
        const state0 = stateAt(raw, line);
        const resumed = tokenizeRange(raw, line - 1, Infinity, state0);
        assert.deepEqual(resumed.lines, full.lines.filter((rec) => rec.line >= line),
                         `${label}: restart at line ${line} (state ${state0}) reproduces the stream`);
    }
};

const PAGE = "###\n* H\nalpha\nbeta\n```lang\nfw 1\nrt 2\n```\n###\nfw 9";

describe("restart auditor — spans are the coordinates", () => {
    test("a fresh parse of a page with a multi-line chunk and a cell", () => {
        const ast = parseProgram(PAGE);
        audit(ast, PAGE, "fresh");
        // FIXTURE-SPECIFIC, so a green run cannot mean "zero of everything".
        assert.ok(ast.length >= 4, `expected a chunk, a cell, and code — got ${ast.length} units`);
        assert.ok(ast.some((u) => u.span.line === 2 && u.span.endLine === 4), "the chunk spans its lines");
        assert.ok(ast.some((u) => u.span.line === 6), "the cell body starts at line 6");
    });

    test("shape zoo: implicit closes, a cut cell, glued `end`, CRLF, bare CR, empties", () => {
        const texts = [
            "###\nprose\n",                                  // implicit meadow close at EOF
            "```\nfw 1",                                     // unclosed cell at EOF
            "###\n* H\n```\n###\nfw 1\n###",                 // a cell cut short by a meadow fence
            "fw 1 / end rt 90",                              // glued `end` on one physical line
            "def f do\n  fw 1 / end rt 90",                  // glued inside a block
            "\n\nfw 1\n\n\nrt 2\n\n",
            "",
            "###\n###",                                       // empty clearing
        ];
        for (const base of texts) {
            for (const [tag, text] of [["LF", base], ["CRLF", base.replace(/\n/g, "\r\n")],
                                       ["CR", base.replace(/\n/g, "\r")]]) {
                audit(parseProgram(text), text, `${tag} ${JSON.stringify(base.slice(0, 24))}`);
            }
        }
    });

    test("a chained edit sequence — the later edit is where a bad coordinate shows", () => {
        resetReparseStats();
        let text = PAGE, ast = parseProgram(PAGE);
        const step = (next) => {
            const got = reparseProgram(next, text, ast);
            audit(got, next, `step -> ${JSON.stringify(next.slice(0, 30))}`);
            text = next; ast = got;
            return got;
        };
        step(PAGE.replace("fw 1", "fw 2"));                        // ordinary edit: converges
        step(text.replace("###\n## H", "").replace("###\n* H", "###\n## H"));  // fence edit: declines
        step(text.replace("fw 2", "fw 3"));                        // must converge again
        step("rt 5\n" + text);                                     // insert above everything
        step(text + "\nfw 77");                                    // append

        assert.ok(reparseStats().converged >= 2, `the fast path answered (${JSON.stringify(reparseStats())})`);
    });

    test("a mismatched pair declines and leaves the borrowed tree untouched", () => {
        resetReparseStats();
        const stranger = parseProgram("###\nother\n###\nfw 1");
        const before = JSON.stringify(stranger);
        const got = reparseProgram("###\nother\n###\nfw 2", "###\nmine\n###\nfw 1", stranger);
        assert.equal(reparseStats().converged, 0, "must not converge on a mismatched pair");
        assert.equal(JSON.stringify(stranger), before, "and must not rewrite the tree it was lent");
        assert.equal(JSON.stringify(got), JSON.stringify(parseProgram("###\nother\n###\nfw 2")));
    });
});
