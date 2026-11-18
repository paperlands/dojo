// ACTIVATION IDENTITY — the light must travel by OPENER, not by ordinal place.
//
// The measured finding (probe/keystroke-latency) is separate from this: here we
// pin the CORRECTNESS half of the same distinction. `coord` is an address in
// one document revision (D024); the opener, mapped through the ChangeSet, is the
// identity. Inserting a sibling cell above a held cell keeps every later coord's
// shape, so the old recovery (comparing `coord`, helper since deleted) handed
// back a DIFFERENT cell.
//
// Run: node --test test/js/editor/activation_identity_test.mjs

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { stepActivation, peerLineAt } from "../../../assets/js/editor/code-cell-activation.js";
import { docOf, insertAt } from "./doc_fixture.mjs";

const PAGE = [
    "###",        // 1  meadow opens
    "* a page",   // 2
    "",           // 3
    "```",        // 4  cell A opens
    "fw 100",     // 5
    "```",        // 6  cell A closes
    "",           // 7
    "```",        // 8  cell B opens
    "rt 90",      // 9
    "```",        // 10 cell B closes
    "###",        // 11 meadow closes
];

const before = (lines, doc) => ({
    docChanged: true, selectionChanged: false, doc, headLine: 2, peerLine: null,
    // nothing to map from on the first walk
    changes: null,
});

describe("the held cell travels by its opener", () => {
    test("a sibling cell inserted ABOVE does not steal the light", () => {
        const old = docOf(PAGE);
        const v0 = stepActivation(null, before(null, old));
        assert.equal((v0.held?.open ?? null), 4, "birth lights the first cell (its opener line)");

        // Insert a whole new cell (4 lines incl. its trailing blank) above cell A.
        const added = ["```", "fw 1", "```", ""];
        const shifted = [...PAGE.slice(0, 3), ...added, ...PAGE.slice(3)];
        const newDoc = docOf(shifted);
        const changes = insertAt(old.line(4).from, added.join("\n") + "\n");

        const v1 = stepActivation(v0, { docChanged: true, selectionChanged: false, doc: newDoc, headLine: 2, peerLine: null, changes });

        assert.equal((v1.held?.open ?? null), 8, "cell A still wears the light — its opener moved to line 8");
        assert.notEqual((v1.held?.open ?? null), 4, "the NEW cell (open 4) is not the held cell, whatever its coord says");
        assert.equal(v1.cells[1], v1.held, "the held cell is the SECOND cell in document order — cell A");
        assert.notEqual(v1.held, v1.cells[0], "…never the cell that was inserted above it");

        // INTERNAL COHERENCE — the part that catches a future consumer using the
        // wrong coordinate system. The exact key above can be right while these
        // drift (an old held object, a stale key, an anchor from the old doc).
        assert.ok(v1.cells.includes(v1.held), "held is one of THIS revision's cells");
        assert.equal((v1.held?.open ?? null), v1.held.open, "key is only the projection held.open");
        assert.equal(v1.anchor, newDoc.line(v1.held.open).from, "the anchor names the held opener, in the new doc");
        assert.notEqual(v1.held, v0.held, "a new classification pass mints a new cell object");
    })

    test("typing in the body keeps the light and moves nothing", () => {
        const old = docOf(PAGE);
        const v0 = stepActivation(null, before(null, old));

        const typedLines = PAGE.slice();
        typedLines[4] = "fw 999";                       // inside cell A's body
        const typed = docOf(typedLines);
        const changes = insertAt(old.line(5).from + 4, "99");   // "fw 1" → "fw 199"

        const v1 = stepActivation(v0, { docChanged: true, selectionChanged: false, doc: typed, headLine: 2, peerLine: null, changes });
        assert.equal((v1.held?.open ?? null), 4, "same opener line, same cell");
    });

    test("deleting the opener retires the hold — silence, not the next cell", () => {
        const old = docOf(PAGE);
        const v0 = stepActivation(null, before(null, old));
        assert.equal((v0.held?.open ?? null), 4);

        // Cell A's opener loses a backtick: no longer a fence, so no cell there.
        const broken = PAGE.slice();
        broken[3] = "``";
        const brokenDoc = docOf(broken);
        const changes = { mapPos: (pos) => pos };        // same length edit

        const v1 = stepActivation(v0, { docChanged: true, selectionChanged: false, doc: brokenDoc, headLine: 2, peerLine: null, changes });
        assert.equal((v1.held?.open ?? null), null, "the held opener no longer opens a cell — the light is out");
    });

    test("a newline above EVERY fence keeps the light on the same cell", () => {
        const old = docOf(PAGE);
        const v0 = stepActivation(null, before(null, old));

        const shifted = docOf(["", ...PAGE]);
        const changes = insertAt(0, "\n");
        const v1 = stepActivation(v0, { docChanged: true, selectionChanged: false, doc: shifted, headLine: 3, peerLine: null, changes });
        assert.equal((v1.held?.open ?? null), 5, "cell A's opener moved from 4 to 5");
    });
});

describe("a peer's line is validated, never trusted", () => {
    test("only a real line number survives", () => {
        assert.equal(peerLineAt(8, 11), 8);
        assert.equal(peerLineAt(1, 11), 1);
        assert.equal(peerLineAt(11, 11), 11);
    });

    test("fractions, strings, zero, and past-the-end are refused", () => {
        for (const bad of [1.5, "8", 0, -1, 12, null, undefined, NaN]) {
            assert.equal(peerLineAt(bad, 11), null, `${String(bad)} must not reach doc.line()`);
        }
    });
});
