// ACTIVATION PAINT — the view may only decorate what it draws.
//
// The measured finding (probe/keystroke-latency): emitting a Decoration.line for
// every code line of the document costs ~0.9 ms/keystroke at 80 cells and grows
// with the page, while the view draws only a viewport's worth. This file pins the
// invariant that makes the regression impossible to reintroduce silently:
//
//   |plan| <= 2 * visible lines + 1
//
// …plus parity with a full-document classifier restricted to the same window, so
// "bounded" can never be achieved by painting nothing.
//
// Run: node --test test/js/editor/activation_paint_test.mjs

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { findProse, cellAt } from "../../../assets/js/editor/plang-mode.js";
import { paintPlan, peerLineAt } from "../../../assets/js/editor/code-cell-activation.js";
import { docOf } from "./doc_fixture.mjs";

// A page of `n` cells, identical prefix for every n — so a fixed window over the
// first lines must answer identically whatever the document's total size.
const page = (n) => {
    const lines = ["###", "* a page", ""];
    for (let i = 0; i < n; i++) lines.push("```", `fw ${i}`, "```", "");
    lines.push("###");
    return lines;
};

const window_ = (doc, first, last) =>
    [{ from: doc.line(first).from, to: doc.line(Math.min(last, doc.lines)).to }];

// The full-document classifier, restricted to a window — the reference answer.
const reference = (doc, cells, active, peerLine, first, last) => {
    const peerAt = peerLineAt(peerLine, doc.lines);
    const peerIn = peerAt == null ? null : cellAt(cells, peerAt);
    const out = [];
    for (let line = first; line <= last; line++) {
        const cell = cells.find((c) => line >= c.open && line <= c.end);
        if (!cell) continue;
        const marks = [cell === active ? "active" : "inactive"];
        if (cell === peerIn) marks.push("peerCell");
        out.push({ line, marks });
    }
    if (peerAt != null && peerAt >= first && peerAt <= last) {
        const hit = out.find((m) => m.line === peerAt);
        if (hit) hit.marks.push("peerLine");
        else out.push({ line: peerAt, marks: ["peerLine"] });
    }
    return out.sort((a, b) => a.line - b.line);
};

describe("paint is viewport-bounded, and says the same thing the whole document would", () => {
    test("the plan never exceeds 2 × visible lines + 1 — at 8, 80, and 200 cells", () => {
        for (const n of [8, 80, 200]) {
            const doc = docOf(page(n));
            const { cells } = findProse(doc);
            const first = 1, last = Math.min(40, doc.lines);
            const visibleLines = last - first + 1;
            const plan = paintPlan(doc, cells, cells[0], 8, window_(doc, first, last));

            assert.ok(plan.length <= 2 * visibleLines + 1,
                `${n} cells → ${plan.length} ranges for ${visibleLines} visible lines`);
            for (const { line } of plan) {
                assert.ok(line >= first && line <= last, `line ${line} is outside the window ${first}–${last}`);
            }
        }
    });

    test("…and the count does not grow with the document", () => {
        // Inside the shared prefix: lines 1–30 are identical in both pages, so
        // the same window must answer the same count. (Past a short page's end
        // the tail `###` legitimately changes what is drawn.)
        const count = (n) => {
            const doc = docOf(page(n));
            const { cells } = findProse(doc);
            return paintPlan(doc, cells, cells[0], 8, window_(doc, 1, 30)).length;
        };
        const small = count(8), large = count(200);
        assert.equal(large, small, "the same window answers the same number of ranges");
    });

    test("parity — bounded is not the same as silent", () => {
        const doc = docOf(page(12));
        const { cells } = findProse(doc);
        for (const [first, last] of [[1, 12], [4, 14], [9, 20]]) {
            const plan = paintPlan(doc, cells, cells[1], 8, window_(doc, first, last));
            assert.deepEqual(plan, reference(doc, cells, cells[1], 8, first, last),
                `window ${first}–${last} must match the full classifier`);
            assert.ok(plan.length > 0, "a window over cells must paint something");
        }
    });

    test("a fold (two disjoint visible ranges) paints only what is drawn, once", () => {
        const doc = docOf(page(6));
        const { cells } = findProse(doc);
        const ranges = [
            { from: doc.line(1).from, to: doc.line(5).to },
            { from: doc.line(20).from, to: doc.line(24).to },
        ];
        const plan = paintPlan(doc, cells, cells[0], null, ranges);
        const lines = plan.map((p) => p.line);
        assert.equal(new Set(lines).size, lines.length, "no line is painted twice");
        for (const line of lines) assert.ok((line >= 1 && line <= 5) || (line >= 20 && line <= 24),
            `line ${line} is not in either visible range`);
        assert.ok(!lines.includes(13), "the hidden middle is never decorated");
    });

    test("a peer alone in prose still paints — the line is total", () => {
        const doc = docOf(page(3));
        const { cells } = findProse(doc);
        const plan = paintPlan(doc, cells, cells[0], 2, window_(doc, 1, 10));
        assert.deepEqual(plan.find((p) => p.line === 2)?.marks, ["peerLine"]);
    });
});
