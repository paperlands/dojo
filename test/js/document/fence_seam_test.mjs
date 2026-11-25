// THE FENCE SEAM — the parser's records and the editor's geometry must agree.
//
// Two machines read one grammar (id:gw-grammar): `tokenize` produces parser
// records, `classify`/`outline` produce the editor's cells and meadows. They
// share predicates but not transitions — this file is the CONTRACT between them,
// and it fails when either side learns a fence the other does not.
//
// It is deliberately independent of green_tree_test's equivalence sweep: that
// sweep proves reparse ≡ parse (one machine, two paths). This proves parse ≡
// outline (two machines, one document). Both can be green while the editor
// disagrees with the parser; only this test notices.
//
// Run: node --test test/js/document/fence_seam_test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    ROLE, classify, splitLines, outline, parseProgram, reparseProgram, phaseCells,
} from "../../../assets/js/turtling/parse.js";

const walk = (xs) => xs.flatMap((x) => [x, ...walk(x.children ?? [])]);

// [ source, cells as [open, end, terminated, name], meadows as [open, end] ]
const CASES = [
    ["###\nprose\n```\nfw 1\n```\n###", [[3, 5, true, null]], [[1, 6]]],
    ["###\n```lang\nfw 1\n###", [[2, 3, false, "lang"]], [[1, 4]]],
    ["###\n```\nfw 1", [[2, 3, false, null]], [[1, 3]]],
    // THE GRAMMAR'S RULE: a cell exists only inside a clearing. Bare ``` fences
    // outside every meadow are plain code — both machines must say so.
    ["```\nfw 1\n```", [], []],
    // an info-bearing backtick line INSIDE a cell is body text, not a closer
    ["###\n```\n```lang\n```\n###", [[2, 4, true, null]], [[1, 5]]],
    ["###\n* H\n```\nfw 1 end rt 90\n```\n###", [[3, 5, true, null]], [[1, 6]]],
    // no spurious fences: ###x is prose-space noise, not a clearing
    ["###\n###x\nfw 1\n###", [], [[1, 4]]],
    // backticks outside every meadow are code, never a cell
    ["fw 0\n`x`\n```\nfw 1\n```", [], []],
];

describe("fence seam — parser records and editor geometry describe one document", () => {
    for (const [src, cells, meadows] of CASES) {
        test(`agrees on: ${JSON.stringify(src)}`, () => {
            const lines = splitLines(src);
            const rows = classify(lines);
            const nodes = walk(parseProgram(src));
            const shape = outline(lines);

            // 1. explicit cell fences: the parser's lines ARE the classifier's
            const authored = rows.filter((r) => r.role === ROLE.cellOpen || r.role === ROLE.cellClose);
            const fences = nodes.filter((n) => n.meta?.cellFence && !n.meta.implicit);
            assert.deepEqual(fences.map((n) => n.span.line), authored.map((r) => r.line),
                "explicit cell-fence lines must match the classifier's");

            // 2. opener information: the word on the fence is the same word
            assert.deepEqual(
                fences.map((n) => n.meta.info ?? null),
                authored.map((r) => (r.role === ROLE.cellOpen ? r.info ?? null : null)),
                "opener info must travel to both machines");

            // 3. implicit closes: one per unterminated cell, on the parser side
            const implicit = nodes.filter((n) => n.meta?.cellFence && n.meta.implicit);
            assert.equal(implicit.length, cells.filter((c) => !c[2]).length,
                "every unterminated cell gets exactly one implicit parser fence");

            // 4. geometry, against the SPECIFIED table — not recomputed from roles
            assert.deepEqual(shape.cells.map((c) => [c.open, c.end, c.terminated, c.name]), cells);
            assert.deepEqual(shape.meadows.map((m) => [m.open, m.end]), meadows);

            // 5. authored meadow markers agree; implicit EOF closure is not authored
            assert.equal(nodes.filter((n) => n.meta?.meadowOpen).length,
                rows.filter((r) => r.role === ROLE.meadowOpen).length);
            assert.equal(nodes.filter((n) => n.meta?.meadowClose && !n.meta.meadowCloseImplicit).length,
                rows.filter((r) => r.role === ROLE.meadowClose).length);
        });
    }

    test("a one-character fence edit still agrees after a reparse", () => {
        // The dirty substring of `###` → `##` is a single "#", which no fence
        // predicate can see — so the seam is checked on the RESULT, not the edit.
        const src = "###\n```\nfw 1\n```\n###";
        const edited = "##\n```\nfw 1\n```\n###";
        const prev = parseProgram(src);
        const got = reparseProgram(edited, src, prev);
        assert.deepEqual(got.map((n) => n.type), parseProgram(edited).map((n) => n.type));

        const rows = classify(splitLines(edited));
        const shape = outline(splitLines(edited));
        assert.equal(shape.cells.length, rows.filter((r) => r.role === ROLE.cellOpen).length,
            "the editor and the parser agree that a demoted fence opens nothing");
    });
});

// THE PARTITION LAW — the cells the SOURCE defines are the cells the RUNTIME
// runs, one for one and in order, including when the parser recovers from a
// malformed block. The two worlds are allowed different grains internally; they
// are not allowed to disagree about which cells exist.
//
// This is the invariant a model review named as missing: phaseCells walks the
// AST's TOP-LEVEL nodes, while outline reads the source — so anywhere a block
// could swallow a fence, the runtime partition lost a cell. A fence is now a
// boundary no block may cross; these cases pin that.
describe("partition law — source-defined cells are the runnable cells", () => {
    const partition = (src) => outline(splitLines(src)).cells.map((c) => [c.open, c.end, c.terminated]);
    const runtime = (src) => phaseCells(parseProgram(src)).map((c) => [c.open, c.end]);

    const table = [
        ["well-formed pair", "###\n```\nfw 1\n```\nprose\n```\nfw 2\n```\n###"],
        // the case that used to lose a cell: an unterminated block swallowing the
        // next cell's fences
        ["unterminated block before a fence", "###\n```\ndef figure do\n  fw 1\n```\nprose\n```\nfw 2\n```\n###"],
        ["unterminated block closed later", "###\n```\ndef figure do\n  fw 1\nend\n```\n###"],
        ["missing end before the closer", "###\n```\nfor 2 do\n  fw 1\n```\n###"],
        ["stray end inside a cell", "###\n```\nend\nfw 1\n```\n###"],
        ["implicit close at ###", "###\n```\nfw 1\n###"],
        ["a cell running to EOF", "###\n```\nfw 1"],
        ["an empty cell", "###\n```\n```\n###"],
    ];

    for (const [name, src] of table) {
        test(`agrees on: ${name}`, () => {
            const geo = partition(src);
            const run = runtime(src);
            assert.equal(run.length, geo.length, "the same NUMBER of cells");
            for (let i = 0; i < geo.length; i++) {
                assert.equal(run[i][0], geo[i][0], `cell ${i}: same opener line`);
                assert.equal(run[i][1], geo[i][1], `cell ${i}: same closing line`);
            }
        });
    }

    test("a chained edit keeps the partition — the second edit is where it would drift", () => {
        let text = "###\n```\nfw 1\n```\nprose\n```\nfw 2\n```\n###";
        let ast = parseProgram(text);
        const check = (src, got) => {
            const geo = partition(src);
            const run = phaseCells(got).map((c) => [c.open, c.end]);
            assert.equal(run.length, geo.length);
            for (let i = 0; i < geo.length; i++) {
                assert.equal(run[i][0], geo[i][0]);
                assert.equal(run[i][1], geo[i][1]);
            }
        };
        const step = (next) => { ast = reparseProgram(next, text, ast); text = next; check(text, ast); };

        step("###\n```\nfw 9\n```\nprose\n```\nfw 2\n```\n###");
        step("###\n```\nfw 9\n```\nprose\n```\nfw 3\n```\n###");
        step("###\n```\nfw 9\n```\nmore prose\n```\nfw 3\n```\n###");
        step("###\n```\ndef fig do\n  fw 9\n```\nmore prose\n```\nfw 3\n```\n###");
    });
});
