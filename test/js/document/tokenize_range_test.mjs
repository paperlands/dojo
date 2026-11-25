// THE RESTART LAW — a record pass may begin anywhere a record begins.
//
// tokenizeRange(lines, from, to, state) is the floor under every finer "only
// change what is relevant": convergence can restart the record pass inside the
// dirty span instead of re-reading the document. That is only sound if a restart
// is INDISTINGUISHABLE from a full pass — same records, same flags, same lines.
//
// This asserts the property, not an example: for every corpus document, at every
// line where a record starts, restarting there with the state the full pass
// recorded must reproduce the full pass's suffix exactly.
//
// Run: node --test test/js/document/tokenize_range_test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { tokenizeRange, splitLines } from "../../../assets/js/turtling/parse.js";

const CORPUS = [
    "###\nprose\n```\nfw 1\n```\n###\nrt 90",
    "###\n* H\n```lang\nfw 1\n```\n###",
    "###\n```\nfw 1\n###\nrt 2",
    "###\n```\nfw 1",
    "```\nfw 1\n```",
    "###\n###",
    "###",
    "###\n###\n###\n###",
    "fw 1\n###\nprose to the end",
    "###\n```\nfw 1\n```\n```\nrt 2\n```\n###",
    "###\nbetween\n```\nfw 1\n###",
    "###\n\n```\n```lang\n```\n\n###",
    "fw 10\n\n# a note\nfw 20 end draw",
];

const full = (src) => tokenizeRange(splitLines(src), 0, Infinity, 0);

describe("restart law — any record start reproduces the full pass", () => {
    for (const src of CORPUS) {
        test(`restart anywhere in: ${JSON.stringify(src)}`, () => {
            const raw = splitLines(src);
            const all = full(src);
            let tried = 0;

            for (let k = 0; k < all.lines.length; k++) {
                // only the FIRST record of a physical line: the pass consumes lines
                if (k > 0 && all.lines[k].line === all.lines[k - 1].line) continue;
                const line = all.lines[k].line;
                if (!(line >= 1 && line <= raw.length)) continue;   // an EOF marker is not a restart point

                const got = tokenizeRange(raw, line - 1, Infinity, all.marks[k]);
                assert.deepEqual(got.lines, all.lines.slice(k),
                    `restart at line ${line} (record ${k}) diverged`);
                tried++;
            }

            assert.ok(tried > 0, "the corpus produced restart points");
        });
    }

    test("a truncated range invents NO close — neither clearing nor cell", () => {
        const src = "###\nprose\n```\nfw 1\nrt 2\n```\nmore\n###";
        const raw = splitLines(src);
        const all = full(src);
        const prose = all.lines.findIndex((r) => r.meadow === "prose");
        assert.ok(prose >= 0);
        const from = all.lines[prose].line;                 // the chunk's own line + state
        const cut = from + 2;                                  // the 0-based index the range stops at
        const part = tokenizeRange(raw, from - 1, cut, all.marks[prose]);   // cut after "fw 1"

        // The range ends INSIDE a cell: it has learned nothing about how the cell
        // closes, so it must not emit a closer.
        assert.ok(!part.lines.some((r) => r.cellFence && r.implicit && r.line > from + 1),
            "no cell close fabricated at the range edge");
        assert.ok(!part.lines.some((r) => r.meadowClose === true), "no clearing close invented either");

        // BEHAVIOURAL, not bit-reading: whatever state the range reported, resuming
        // from it must reproduce exactly the rest of the full pass. (If someone
        // swapped the bit assignments, this still passes and the bit test would not.)
        const resumed = tokenizeRange(raw, cut, Infinity, part.end);
        const firstAfter = all.lines.findIndex((r) => r.line >= cut + 1);
        assert.deepEqual(resumed.lines, all.lines.slice(firstAfter),
            "resuming from the reported state must reproduce the rest");
    });

    test("the pass is also restartable from a cell body", () => {
        const raw = splitLines("###\n```lang\nfw 1\nrt 2\n```\n###");
        const all = tokenizeRange(raw, 0, Infinity, 0);
        const body = all.lines.findIndex((r) => r.text === "rt 2");
        assert.ok(body > 0, "the body record exists");
        const got = tokenizeRange(raw, all.lines[body].line - 1, Infinity, all.marks[body]);
        assert.deepEqual(got.lines, all.lines.slice(body));
    });
});
