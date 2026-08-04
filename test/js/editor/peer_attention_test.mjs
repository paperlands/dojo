// PEER ATTENTION — the pure half (D021's promised name, D025 R5/R6).
//
// What is testable here is what stayed pure: the chase's whole logic, and the
// activation field's transition with a second key. The viewport move
// (`followTo`) and the firefly's DOM are not — they are a scroller and an
// element, and they belong to the two-browser walk (pres-gauge), not to a
// suite that would only prove a mock agrees with itself.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { chaseDirection } from "../../../assets/js/editor/peer-attention.js";
import { stepActivation } from "../../../assets/js/editor/code-cell-activation.js";
import { minimalChange } from "../../../assets/js/terminal/view.js";

// ---------------------------------------------------------------------------
// chaseDirection — is the friend off the top, off the bottom, or here?
// ---------------------------------------------------------------------------

describe("chaseDirection — direction, and the honest silence", () => {
    it("names the edge the friend is past", () => {
        assert.equal(chaseDirection(3, 10, 40), "above");
        assert.equal(chaseDirection(90, 10, 40), "below");
    });

    it("is silent when the friend is inside the window — the boundaries count as inside", () => {
        assert.equal(chaseDirection(25, 10, 40), null);
        assert.equal(chaseDirection(10, 10, 40), null);
        assert.equal(chaseDirection(40, 10, 40), null);
    });

    it("is silent with no line at all — a friend on bare code is MAKING, and his cells rest", () => {
        assert.equal(chaseDirection(null, 10, 40), null);
        assert.equal(chaseDirection(undefined, 10, 40), null);
    });

    it("is silent when the window cannot be read, rather than guessing an edge", () => {
        assert.equal(chaseDirection(5, null, null), null);
        assert.equal(chaseDirection(5, 10, null), null);
    });

    // The property that lets the firefly carry NO knowledge of consent: while
    // following we have just centred the window on the friend's line, so it is
    // inside, so this answers null on its own. No suppression clause exists
    // because none is needed (D025 R6).
    it("answers null for any line the viewport was just moved onto", () => {
        for (const line of [1, 7, 50, 999]) {
            const first = Math.max(1, line - 12);
            const last = line + 12;
            assert.equal(chaseDirection(line, first, last), null,
                `a centred line ${line} must never raise a chase`);
        }
    });
});

// ---------------------------------------------------------------------------
// The surface law (applyAttend): only a line the document holds is news.
// Pure form of the meta-before-doc gate — no geometry, no follow, one predicate.
// ---------------------------------------------------------------------------

const heldBy = (line, lines) => line == null || (line >= 1 && line <= lines);

describe("heldBy — a name is news only when the body is here", () => {
    it("accepts a line the document holds", () => {
        assert.equal(heldBy(1, 10), true);
        assert.equal(heldBy(10, 10), true);
        assert.equal(heldBy(null, 10), true);   // leaving is always real
    });

    // outerAttend can name N before seeOuterShell grows the doc to N. Refusing
    // the name leaves peerAt behind, so the push that brings the body is still
    // a move — following completes instead of freezing on the first paint.
    it("refuses a name ahead of its body", () => {
        assert.equal(heldBy(11, 10), false);
        assert.equal(heldBy(0, 10), false);
    });
});

// ---------------------------------------------------------------------------
// stepActivation with a peer key — one walk, two keys, and the memo intact.
// ---------------------------------------------------------------------------

// A doc stub shaped like CM6's: 1-indexed lines, `lines` count. `findProse`
// needs only those two, and it walks the REAL geometry — so the fences here are
// PaperLang's own: a `###` meadow, `*` headlines, and cells that only count
// inside the clearing.
const docOf = (lines) => ({
    lines: lines.length,
    line: (n) => ({ number: n, from: n * 1000, to: n * 1000 + lines[n - 1].length, text: lines[n - 1] }),
});

const PAGE = [
    "###",                  // 1   the meadow opens
    "* a page",             // 2
    "",                     // 3
    "```",                  // 4   cell 1 opens
    "fw 100",               // 5
    "```",                  // 6   cell 1 closes
    "",                     // 7
    "** deeper",            // 8
    "",                     // 9
    "```",                  // 10  cell 2 opens
    "rt 90",                // 11
    "```",                  // 12  cell 2 closes
    "###",                  // 13  the meadow closes
];

const CELL_1 = 4;   // keyed by its opening fence
const CELL_2 = 10;

// A `build` that records what it was handed, so the assertions can speak about
// the DECORATION the field would make without owning a RangeSet. It records the
// friend's LINE, because that is what the field now keeps.
const spyBuild = () => {
    const calls = [];
    const build = (doc, cells, active, peerLine) => {
        const call = { active: active?.open ?? null, peerLine: peerLine ?? null };
        calls.push(call);
        return call;
    };
    return { build, calls };
};

const NONE = Symbol("none");

const first = (doc, headLine, peerLine, build) =>
    stepActivation(null, { docChanged: true, selectionChanged: false, doc, headLine, peerLine }, build, NONE);

const move = (prev, doc, headLine, peerLine, build) =>
    stepActivation(prev, { docChanged: false, selectionChanged: true, doc, headLine, peerLine }, build, NONE);

const peerMove = (prev, doc, headLine, peerLine, build) =>
    stepActivation(prev, { docChanged: false, selectionChanged: false, doc, headLine, peerLine }, build, NONE);

describe("stepActivation — the friend's LINE rides the one field", () => {
    const doc = docOf(PAGE);

    it("keeps the line, not the cell — one walk, both marks", () => {
        const { build, calls } = spyBuild();
        const v = first(doc, 5, 11, build);          // my cursor in cell 1, friend in cell 2
        assert.equal(v.key, CELL_1, "my cell is keyed by its opening fence");
        assert.equal(v.peerLine, 11, "the friend is kept as a LINE — the cell is derived at build");
        assert.equal(v.peerKey, undefined, "no second key is stored; derive, don't duplicate");
        assert.equal(calls.length, 1, "one build — never a second decoration engine");
        assert.deepEqual(calls[0], { active: CELL_1, peerLine: 11 });
    });

    // THE POINT OF A LINE: it is TOTAL. Every position in the document has one,
    // so the friend is locatable in prose, between cells, and on bare code —
    // the places a cell-quantized datum has nothing to say about.
    it("carries a line that falls in NO cell — prose, headline, outside a fence", () => {
        const { build } = spyBuild();
        for (const line of [2, 3, 8, 9]) {            // headline, blank, deeper headline, blank
            assert.equal(first(doc, 5, line, build).peerLine, line,
                `line ${line} must survive even though no cell contains it`);
        }
    });

    it("carries a line in a document with no cells at all", () => {
        const bare = docOf(["fw 100", "rt 90", "fw 100"]);
        const { build, calls } = spyBuild();
        const v = first(bare, 1, 2, build);
        assert.equal(v.peerLine, 2);
        assert.equal(calls.length, 1, "a cell-less doc still paints, because the friend is in it");
        assert.notEqual(v.deco, NONE);
    });

    it("paints nothing in a cell-less document when no friend is there", () => {
        const bare = docOf(["fw 100", "rt 90"]);
        const { build, calls } = spyBuild();
        assert.equal(first(bare, 1, null, build).deco, NONE);
        assert.equal(calls.length, 0, "no cells and no friend — nothing to say");
    });

    it("a null peer line paints no friend — and is not an error", () => {
        const { build } = spyBuild();
        const v = first(doc, 5, null, build);
        assert.equal(v.peerLine, null);
        assert.equal(v.deco.peerLine, null);
    });

    // THE 443× PROPERTY (code-cell-activation.js). The move path must still
    // return the SAME object — the friend must cost nothing to a cursor that
    // moves while he does not.
    it("returns prev UNCHANGED when neither my cell nor his line moves", () => {
        const { build, calls } = spyBuild();
        const a = first(doc, 5, 11, build);
        const b = move(a, doc, 5, 11, build);        // I moved within my cell
        assert.equal(b, a, "must be the same object — no rebuild, no allocation");
        assert.equal(calls.length, 1, "build must not have run again");
    });

    it("rebuilds when MY cell moves and his line does not", () => {
        const { build, calls } = spyBuild();
        const a = first(doc, 5, 11, build);
        const b = move(a, doc, 11, 11, build);       // I walked into his cell
        assert.notEqual(b, a);
        assert.equal(b.key, CELL_2);
        assert.equal(b.peerLine, 11, "he has not moved");
        assert.deepEqual(calls.at(-1), { active: CELL_2, peerLine: 11 },
            "my light and his line on one cell — following is a coincidence, not a branch");
    });

    it("rebuilds when HE moves and my cursor does not", () => {
        const { build, calls } = spyBuild();
        const a = first(doc, 5, 11, build);
        const b = peerMove(a, doc, 5, 5, build);     // no selection change at all
        assert.notEqual(b, a, "his move must reach the field without a selection");
        assert.equal(b.key, CELL_1, "my cell is untouched");
        assert.equal(b.peerLine, 5);
    });

    // The line is finer than the cell, and that is the whole reason to keep it.
    it("rebuilds when he moves WITHIN one cell — the mark must follow him exactly", () => {
        const { build, calls } = spyBuild();
        const a = first(doc, 5, CELL_2, build);      // his fence
        const b = peerMove(a, doc, 5, 11, build);    // his body — same cell, different line
        assert.notEqual(b, a, "a cell-keyed mark would have stood still here");
        assert.equal(b.peerLine, 11);
        assert.equal(calls.length, 2);
    });

    it("a friend who leaves clears his mark and nothing else", () => {
        const { build } = spyBuild();
        const a = first(doc, 5, 11, build);
        const b = peerMove(a, doc, 5, null, build);
        assert.equal(b.peerLine, null);
        assert.equal(b.key, a.key, "my own light is not disturbed by his leaving");
    });

    it("an idle transition is a pass-through", () => {
        const { build } = spyBuild();
        const a = first(doc, 5, 11, build);
        assert.equal(
            stepActivation(a, { docChanged: false, selectionChanged: false, doc, headLine: 5, peerLine: 11 }, build, NONE),
            a);
    });

    // The field is shared with the child's own shell, which never dispatches a
    // peer effect. Absent `peerLine` must behave exactly as it did before the
    // friend existed.
    it("is unchanged for a surface that never speaks of a friend", () => {
        const { build, calls } = spyBuild();
        const a = stepActivation(null, { docChanged: true, selectionChanged: false, doc, headLine: 5 }, build, NONE);
        assert.equal(a.peerLine, null);
        const b = stepActivation(a, { docChanged: false, selectionChanged: true, doc, headLine: 5 }, build, NONE);
        assert.equal(b, a, "the inner shell's move path is untouched");
        assert.equal(calls.length, 1);
    });
});

// ---------------------------------------------------------------------------
// minimalChange — why the watcher keeps her place while he types.
//
// CM6 anchors the viewport and maps the selection THROUGH the changes it is
// given. Replacing the whole document says "every character died", which leaves
// nothing to anchor to: the scroll snaps and the cursor collapses on every
// keystroke the friend makes. This is pres-p1 milestone 8, and it is a string
// function.
// ---------------------------------------------------------------------------

describe("minimalChange — the smallest true edit", () => {
    const apply = (from, change) =>
        change == null ? from : from.slice(0, change.from) + change.insert + from.slice(change.to);

    it("is null when nothing changed — no transaction at all", () => {
        assert.equal(minimalChange("abc", "abc"), null);
        assert.equal(minimalChange("", ""), null);
    });

    it("touches only the character that changed, deep inside a document", () => {
        const from = "###\n* a page\n\n```\nfw 100\n```\n###";
        const to   = "###\n* a page\n\n```\nfw 200\n```\n###";
        const c = minimalChange(from, to);
        assert.equal(c.insert, "2");
        assert.equal(c.to - c.from, 1, "one character replaced — not the whole buffer");
        assert.equal(apply(from, c), to);
    });

    it("names an insertion as an insertion — zero-width, so everything after it maps", () => {
        const from = "fw 1\nrt 9";
        const to   = "fw 1\nfw 2\nrt 9";
        const c = minimalChange(from, to);
        assert.equal(c.from, c.to, "pure insert — nothing is deleted, so nothing loses its anchor");
        assert.equal(apply(from, c), to);
    });

    it("names a deletion as a deletion", () => {
        const from = "fw 1\nfw 2\nrt 9";
        const to   = "fw 1\nrt 9";
        const c = minimalChange(from, to);
        assert.equal(c.insert, "");
        assert.equal(apply(from, c), to);
    });

    it("round-trips every shape, including the degenerate ones", () => {
        const cases = [
            ["", "hello"], ["hello", ""], ["abc", "abcdef"], ["abcdef", "abc"],
            ["aaa", "aa"], ["aa", "aaa"], ["abc", "xyz"], ["a\nb\nc", "a\nB\nc"],
            ["repeat 4 do\n  fw 10\nend", "repeat 8 do\n  fw 10\nend"],
        ];
        for (const [from, to] of cases) {
            assert.equal(apply(from, minimalChange(from, to)), to, `${JSON.stringify(from)} → ${JSON.stringify(to)}`);
        }
    });

    it("never reports a range outside the source", () => {
        for (const [from, to] of [["aaa", "aa"], ["aa", "aaaa"], ["", "x"], ["x", ""]]) {
            const c = minimalChange(from, to);
            if (!c) continue;
            assert.ok(c.from >= 0 && c.to <= from.length && c.from <= c.to,
                `bad range ${c.from}..${c.to} for ${JSON.stringify(from)}`);
        }
    });
});
