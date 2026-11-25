// THE FENCE MACHINE — one transition, three readers (id:gw-grammar).
//
// `classify`, `tokenizeRange` and `stateAt` fold ONE four-place table. This file
// is the independent oracle for that law: every expectation below is written by
// hand from the grammar, never read back out of the implementation. If the table
// changes, these fail before either reader can agree with itself.
//
//   place:  out · pending (clearing open, its first unit owes the open mark)
//                meadow (obligation paid) · cell
//   symbol: ### · bare ``` · named ```w · * headline · text
//
// Two facts the alphabet has to carry, because they are NOT state-free:
//   a NAMED ```w inside a cell is BODY, not a closer;
//   a HEADLINE transitions exactly like prose and differs only in its role.
//
// Run: node --test test/js/document/fence_machine_test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    PLACE, ROLE, SYMBOL, symbolOf, classify, splitLines, tokenizeRange, stateAt,
    parseProgram, reparseProgram, reparseStats, resetReparseStats,
} from "../../../assets/js/turtling/parse.js";

const MEADOW = "###", BARE = "```", NAMED = "```w", HEAD = "* h", TEXT = "fw 1";
const SYM = { [MEADOW]: SYMBOL.meadow, [BARE]: SYMBOL.tickBare, [NAMED]: SYMBOL.tickInfo,
              [HEAD]: SYMBOL.headline, [TEXT]: SYMBOL.text };

// A prefix that leaves the machine in each place, verified by stateAt elsewhere.
const AT = { out: "", pending: "###\n", meadow: "###\nx\n", cell: "###\n```\n" };

const roleOf = (src) => classify(splitLines(src)).at(-1).role;

describe("the transition — every place under every symbol", () => {
    // [prefix, symbol line, role, probe line, the probe's role (proves `next`)]
    const TABLE = [
        // out
        ["out", MEADOW, ROLE.meadowOpen, MEADOW, ROLE.meadowClose],
        ["out", BARE, ROLE.code, MEADOW, ROLE.meadowOpen],
        ["out", NAMED, ROLE.code, MEADOW, ROLE.meadowOpen],
        ["out", HEAD, ROLE.code, MEADOW, ROLE.meadowOpen],
        ["out", TEXT, ROLE.code, MEADOW, ROLE.meadowOpen],
        // pending — the clearing's first unit is still owed its open mark
        ["pending", MEADOW, ROLE.meadowClose, MEADOW, ROLE.meadowOpen],   // → out
        ["pending", BARE, ROLE.cellOpen, BARE, ROLE.cellClose],           // → cell
        ["pending", NAMED, ROLE.cellOpen, BARE, ROLE.cellClose],          // → cell
        ["pending", HEAD, ROLE.headline, BARE, ROLE.cellOpen],            // → meadow
        ["pending", TEXT, ROLE.prose, BARE, ROLE.cellOpen],               // → meadow
        // meadow — identical transitions, obligation paid
        ["meadow", MEADOW, ROLE.meadowClose, MEADOW, ROLE.meadowOpen],
        ["meadow", BARE, ROLE.cellOpen, BARE, ROLE.cellClose],
        ["meadow", NAMED, ROLE.cellOpen, BARE, ROLE.cellClose],
        ["meadow", HEAD, ROLE.headline, BARE, ROLE.cellOpen],
        ["meadow", TEXT, ROLE.prose, BARE, ROLE.cellOpen],
        // cell — only a BARE ``` closes; a named one is body
        ["cell", MEADOW, ROLE.meadowClose, BARE, ROLE.code],              // → out
        ["cell", BARE, ROLE.cellClose, BARE, ROLE.cellOpen],              // → meadow
        ["cell", NAMED, ROLE.code, BARE, ROLE.cellClose],                 // stays cell
        ["cell", HEAD, ROLE.code, BARE, ROLE.cellClose],                  // stays cell
        ["cell", TEXT, ROLE.code, BARE, ROLE.cellClose],                  // stays cell
    ];

    for (const [place, line, want, probe, wantProbe] of TABLE) {
        test(`${place} + ${JSON.stringify(line)} → ${want}`, () => {
            const src = AT[place] + line;
            assert.equal(roleOf(src), want);
            assert.equal(roleOf(src + "\n" + probe), wantProbe,
                `the transition's NEXT place is what makes ${JSON.stringify(probe)} ${wantProbe}`);
        });
    }

    test("`###` inside a cell says it took the cell with it", () => {
        const row = classify(splitLines("###\n```\nfw 1\n###")).at(-1);
        assert.equal(row.role, ROLE.meadowClose);
        assert.equal(row.closesCell, true);
        // …and a `###` closing a clearing with no cell open says nothing of the kind
        assert.equal(classify(splitLines("###\nprose\n###")).at(-1).closesCell, undefined);
    });
});

describe("the alphabet — a fact about the text alone", () => {
    test("each fence kind is its own symbol", () => {
        assert.equal(symbolOf(MEADOW), SYMBOL.meadow);
        assert.equal(symbolOf(BARE), SYMBOL.tickBare);
        assert.equal(symbolOf(NAMED), SYMBOL.tickInfo);
        assert.equal(symbolOf(HEAD), SYMBOL.headline);
        assert.equal(symbolOf(TEXT), SYMBOL.text);
    });

    test("leading blanks are allowed; anything after the mark is not", () => {
        assert.equal(symbolOf("  \t###  "), SYMBOL.meadow);
        assert.equal(symbolOf("### more"), SYMBOL.text, "a word on a `###` fence is prose space");
        assert.equal(symbolOf("###x"), SYMBOL.text);
        assert.equal(symbolOf("  ```w  "), SYMBOL.tickInfo);
        assert.equal(symbolOf("```  "), SYMBOL.tickBare);
        assert.equal(symbolOf("``"), SYMBOL.text);
        assert.equal(symbolOf(" "), SYMBOL.text);
        assert.equal(symbolOf(""), SYMBOL.text);
    });

    test("a headline may carry backticks and stars in its text", () => {
        assert.equal(symbolOf("* see ``` and **bold**"), SYMBOL.headline);
        assert.equal(symbolOf("** two"), SYMBOL.headline);
        assert.equal(symbolOf("*"), SYMBOL.text, "no space after the stars");
    });

    test("the kind is the line's, never the reader's position", () => {
        // the same physical line has one symbol in every place
        for (const line of [MEADOW, BARE, NAMED, HEAD, TEXT])
            assert.equal(symbolOf(line), SYM[line]);
    });
});

describe("stateAt — the fold is the restart coordinate", () => {
    const SRC = "###\nprose\n```\nfw 1\n```\n###";
    // hand-written: the place at the START of each line, then one past the end
    // at the START of each line: the closer on line 5 has not run yet, so line 6
    // is already back in the meadow.
    const EXPECT = [PLACE.out, PLACE.pending, PLACE.meadow, PLACE.cell,
                    PLACE.cell, PLACE.meadow, PLACE.out];

    test("every line's place, and the end", () => {
        const raw = splitLines(SRC);
        EXPECT.forEach((want, i) => assert.equal(stateAt(raw, i + 1), want, `line ${i + 1}`));
    });

    test("an empty clearing's closer is still inside it", () => {
        const raw = splitLines("###\n###");
        assert.equal(stateAt(raw, 1), PLACE.out);
        assert.equal(stateAt(raw, 2), PLACE.pending);
        assert.equal(stateAt(raw, 3), PLACE.out);
    });

    test("the obligation is IN the place — no hint from the tree", () => {
        // the first unit inside a clearing and a later unit differ by place alone
        assert.equal(stateAt(splitLines("###\nprose"), 2), PLACE.pending);
        assert.equal(stateAt(splitLines("###\nprose\nmore"), 3), PLACE.meadow);
    });
});

describe("the record fold — coordinates a restart can use", () => {
    test("resuming at the first record of a line reproduces the suffix", () => {
        const CORPUS = [
            "###\nprose\n```\nfw 1\n```\n###",
            "###\n* H\n```lang\nfw 1\n```\n###",
            "###\n```\nfw 1\n###\nrt 2",
            "###\n```\nfw 1",
            "```\nfw 1\n```",
            "###\n###",
            "fw 1\n###\nprose to the end",
            "###\n\n```\n```lang\n```\n\n###",
            "fw 10\n\n# a note\nfw 20 end draw",
        ];
        for (const src of CORPUS) {
            const raw = splitLines(src);
            const all = tokenizeRange(raw, 0, Infinity, PLACE.out);
            let tried = 0;
            for (let k = 0; k < all.lines.length; k++) {
                if (k > 0 && all.lines[k].line === all.lines[k - 1].line) continue;  // lines only
                const line = all.lines[k].line;
                if (!(line >= 1 && line <= raw.length)) continue;
                const got = tokenizeRange(raw, line - 1, Infinity, stateAt(raw, line));
                assert.deepEqual(got.lines, all.lines.slice(k),
                    `${JSON.stringify(src)}: restart at line ${line} diverged`);
                tried++;
            }
            assert.ok(tried > 0, "the corpus produced restart points");
        }
    });

    test("records split off one physical line share it", () => {
        const recs = tokenizeRange(splitLines("fw 1 end rt 90"), 0, Infinity, PLACE.out).lines;
        assert.deepEqual(recs.map((r) => [r.text, r.line]),
            [["fw 1 end", 1], ["rt 90", 1]], "a glued `end` splits, the coordinate does not");
    });

    test("the implicit cell close is stamped on the last body line", () => {
        const recs = tokenizeRange(splitLines("###\n```\nfw 1\n###"), 0, Infinity, PLACE.out).lines;
        const shut = recs.at(-1);
        assert.equal(shut.cellFence, true);
        assert.equal(shut.implicit, true);
        assert.equal(shut.line, 3, "the body's last line, not the `###` that closed it");
        assert.equal(shut.meadowClose, true);
    });
});

describe("bounded ranges — a cut range invents nothing", () => {
    const SRC = "###\nprose\n```\nfw 1\nrt 2\n```\nmore\n###";

    test("a cut inside a cell fabricates no closer, and its place resumes", () => {
        const raw = splitLines(SRC);
        const all = tokenizeRange(raw, 0, Infinity, PLACE.out);
        const cut = 5;                                   // 0-based index: after "fw 1"
        const part = tokenizeRange(raw, 0, cut, PLACE.out);
        assert.ok(!part.lines.some((r) => r.cellFence && r.implicit), "no cell close at the edge");
        assert.ok(!part.lines.some((r) => r.meadowClose), "no clearing close either");
        assert.equal(part.end, PLACE.cell, "the place says we stopped inside a cell");

        const resumed = tokenizeRange(raw, cut, Infinity, part.end);
        const firstAfter = all.lines.findIndex((r) => r.line >= cut + 1);
        assert.deepEqual(resumed.lines, all.lines.slice(firstAfter));
    });

    test("a cut inside a prose run still reports where the run ended", () => {
        const raw = splitLines("###\na\nb\nc\n###");
        const part = tokenizeRange(raw, 0, 3, PLACE.out);   // lines 1..3
        assert.deepEqual(part.lines.map((r) => [r.meadow, r.line, r.endLine]),
            [["a\nb", 2, 3]], "one chunk, and the bound is its last line");
        assert.equal(part.end, PLACE.meadow);
    });
});

describe("the terminal — the fold closes what the tape leaves open", () => {
    test("an unterminated clearing gets one silent close", () => {
        const recs = tokenizeRange(splitLines("###\nprose"), 0, Infinity, PLACE.out).lines;
        assert.equal(recs.length, 1);
        assert.deepEqual([recs[0].meadow, recs[0].meadowOpen, recs[0].meadowClose,
                          recs[0].meadowCloseImplicit],
            ["prose", true, true, true]);
    });

    test("a pending clearing with no remaining input still exists", () => {
        const out = tokenizeRange(splitLines("###"), 0, Infinity, PLACE.out);
        assert.deepEqual(out.lines, [{ meadow: "", meadowOpen: true, meadowClose: true,
                                       line: 1, meadowCloseImplicit: true }]);
        assert.equal(out.end, PLACE.meadow, "the close paid the obligation");
    });

    test("a resumed pending clearing names its opener, never line 0", () => {
        // The opener is always the line before a pending place, so the coordinate
        // is recoverable from the position alone — the old `groupLine` was not
        // carried across a restart and emitted `line: 0` here.
        const out = tokenizeRange(splitLines("###"), 1, Infinity, PLACE.pending);
        assert.deepEqual(out.lines.map((r) => r.line), [1]);
    });

    test("an empty clearing is addressed at the OPENER's line", () => {
        // `###` `###` is a clearing with no unit; `x` after it is BARE CODE, not
        // prose — a fence closes the place, it does not leave us in prose space.
        const recs = tokenizeRange(splitLines("###\n###\nx\n###"), 0, Infinity, PLACE.out).lines;
        assert.deepEqual(recs.map((r) => [r.meadow !== undefined ? "meadow" : "code", r.line]),
            [["meadow", 1], ["code", 3], ["meadow", 4]]);
    });

    test("a cell that opens on the last line is not closed — until the repair", () => {
        // Preserved, not endorsed: the old loop needed a later turn to reach its
        // cell branch, so this one cell has no implicit closer. Pinned so the
        // repair is visible when it lands.
        const recs = tokenizeRange(splitLines("###\n```"), 0, Infinity, PLACE.out).lines;
        assert.deepEqual(recs.map((r) => [!!r.cellFence, r.implicit ?? false, r.line]),
            [[true, false, 2]]);
    });
});

describe("record fidelity — the parts that are not fences", () => {
    test("outside code trims before the comment; cell body does not", () => {
        // Not cosmetic: the trim happens BEFORE `#` is split off, so it decides
        // whether the author's trailing whitespace survives into the comment.
        const outside = tokenizeRange(splitLines("fw 1 # note   "), 0, Infinity, PLACE.out).lines;
        assert.equal(outside[0].comment, " note");
        const inside = tokenizeRange(splitLines("###\n```\nfw 1 # note   \n```\n###"),
                                     0, Infinity, PLACE.out).lines;
        assert.equal(inside[1].comment, " note   ");
    });

    test("a blank outside is its own record; inside a cell it is body", () => {
        const outside = tokenizeRange(splitLines("fw 1\n\nrt 2"), 0, Infinity, PLACE.out).lines;
        assert.deepEqual(outside[1], { text: "", line: 2, blank: true });
        const inside = tokenizeRange(splitLines("###\n```\n\n```\n###"), 0, Infinity, PLACE.out).lines;
        assert.deepEqual(inside[1], { text: "", line: 3 }, "no `blank` flag — the child typed it");
    });

    test("CRLF and bare CR split into the same records", () => {
        const lf = tokenizeRange(splitLines("###\n```\nfw 1\n```\n###"), 0, Infinity, PLACE.out);
        const crlf = tokenizeRange(splitLines("###\r\n```\r\nfw 1\r\n```\r\n###"), 0, Infinity, PLACE.out);
        const cr = tokenizeRange(splitLines("###\r```\rfw 1\r```\r###"), 0, Infinity, PLACE.out);
        assert.deepEqual(crlf.lines, lf.lines);
        assert.deepEqual(cr.lines, lf.lines);
    });

    test("a tape that still carries a stray \r is still read as fences", () => {
        assert.deepEqual(classify(["###\r", "```\r", "fw 1\r", "```\r", "###\r"]).map((r) => r.role),
            [ROLE.meadowOpen, ROLE.cellOpen, ROLE.code, ROLE.cellClose, ROLE.meadowClose]);
    });
});

describe("the convergence guard stays a superset of the grammar", () => {
    // FENCE_LINE is a deliberately WEAKER, conservative spelling of "this line
    // could be structural". The table cannot protect that property, so pin it: a
    // one-character creation or destruction of either fence must decline.
    const EDITS = [
        ["meadow created", "##\nprose\n##", "###\nprose\n##"],
        ["meadow created (trailing)", "##  \nprose\n##", "###  \nprose\n##"],
        ["cell open created", "###\n``\nfw 1\n```\n###", "###\n```\nfw 1\n```\n###"],
        ["cell close created", "###\n```\nfw 1\n``\n###", "###\n```\nfw 1\n```\n###"],
        ["meadow destroyed", "###\nprose\n###", "##\nprose\n###"],
        ["cell open destroyed", "###\n```\nfw 1\n```\n###", "###\n``\nfw 1\n```\n###"],
    ];

    for (const [name, before, after] of EDITS) {
        test(`${name}: declines, and stays correct`, () => {
            const prev = parseProgram(before);
            resetReparseStats();
            const got = reparseProgram(after, before, prev);
            assert.equal(reparseStats().declines.fence, 1, "the guard saw the fence");
            assert.deepEqual(got.map((n) => n.type), parseProgram(after).map((n) => n.type));
            assert.equal(got[0]?.span?.line, parseProgram(after)[0]?.span?.line ?? got[0]?.span?.line,
                "and the fallback still stamps spans");
        });
    }
});
