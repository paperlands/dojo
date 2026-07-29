// PaperLang (plang) language mode for CodeMirror 6.
//
// Architecture:
//   - This module has NO static imports of CM6 — it receives {StreamLanguage, foldService}
//     as arguments so it can be used after the vendor bundle is dynamically imported.
//   - Tokenizer is a CM5-compatible StreamParser, adapted for StreamLanguage.define().
//   - Folding is indent-based (equivalent to CM5's fold: "indent") via foldService.
//
// Usage:
//   import { createPlangExtensions } from "./editor/plang-mode.js"
//   // After CM6 is loaded:
//   const extensions = createPlangExtensions(cm6)
//   view.dispatch({ effects: langCompartment.reconfigure(extensions) })

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

import { outline, HEADLINE, MEADOW_FENCE, CELL_OPEN, CELL_CLOSE, DO, END } from "../turtling/parse.js";

const INDENT_UNIT = 2; // spaces per indent level (PaperLang convention)

function wordSet(words) {
    const o = {};
    for (let i = 0; i < words.length; i++) o[words[i]] = true;
    return o;
}

export const keywordList = [
    "draw",  "as", "def", "label", "erase", "goto", "do", "fw", "rt", "dive", "roll",
    "hd", "hide", "grid", "shout",  "lt", "show", "wait", "beColour", "jmp", "fill",
    "jmpto", "faceto", "end", "ensure", "for", "when", "loop", "bold", "fn"
];

const keywords    = wordSet(keywordList);
// Indent open/close track the grammar's own do/end — never a second list.
const indentWords = wordSet([DO]);
const dedentWords = wordSet([END]);
const closing     = wordSet([")", "]", "}"]);

// ---------------------------------------------------------------------------
// Tokenizer internals
// ---------------------------------------------------------------------------

// Module-level: safe in single-threaded JS because token() completes
// synchronously before the next call.
let curPunc = null;

function chain(newtok, stream, state) {
    state.tokenize.push(newtok);
    return newtok(stream, state);
}

// A quoted run, closed by its own quote. No interpolation: the language's own
// tokenizer (parse.js CLOSERS) knows only " ' [ ( — a quote is opaque inside.
function readQuoted(quote, style) {
    return function(stream, state) {
        let escaped = false, ch;
        while ((ch = stream.next()) != null) {
            if (ch === quote && !escaped) {
                state.tokenize.pop();
                break;
            }
            escaped = !escaped && ch === "\\";
        }
        return style;
    };
}

function tokenBase(stream, state) {
    // The meadow door — a lone `###` line opens prose space AROUND the code
    // (id:gw-grammar). The clearing runs until the next `###`; the marker dims.
    if (stream.sol() && stream.match(MEADOW_FENCE)) {
        state.tokenize.push(readMeadow);
        return "lineComment";
    }
    if (stream.eatSpace()) return null;

    const ch = stream.next();
    if (ch === "`" || ch === "'" || ch === '"') {
        return chain(readQuoted(ch, "string"), stream, state);
    } else if (ch === "#") {
        // The margin door — prose OF this line, riding beside the making
        // (id:weave-author). The `#` marker dims; the rest is inked prose.
        if (stream.eol()) return "lineComment";     // a lone `#`, nothing to ink
        state.marginFresh = true;                   // its first ink may open a prose block (`# * `, `# | `, `# > `)
        state.tokenize.push(readMargin);
        return "lineComment";
    } else if (ch === "0") {
        if (stream.eat("x"))      stream.eatWhile(/[\da-fA-F]/);
        else if (stream.eat("b")) stream.eatWhile(/[01]/);
        else                      stream.eatWhile(/[0-7]/);
        return "number";
    } else if (/\d/.test(ch)) {
        stream.match(/^[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?/);
        return "number";
    } else if (/[a-zA-Z_\xa1-\uffff]/.test(ch)) {
        stream.eatWhile(/[\w\xa1-\uffff]/);
        stream.eat(/[?!]/);
        return "ident";
    } else if (/[()[\]{}\\;]/.test(ch)) {
        curPunc = ch;
        return null;
    } else if (ch === "-" && stream.eat(">")) {
        return "arrow";
    } else if (/[=+\-/*:.^%<>~|]/.test(ch)) {
        const more = stream.eatWhile(/[=+\-/*:.^%<>~|]/);
        if (ch === "." && !more) curPunc = ".";
        return "operator";
    }
    return null;
}

// ---------------------------------------------------------------------------
// The literate faces — one prose space, two doors (id:gw-grammar).
// meta.lit is the store; these are renderings. There is ONE markup grammar
// inside prose space, whichever door you entered by: portals glow, headlines
// name phases, and emphasis is render sugar — discovered, never load-bearing.
//
// Three code/prose marks live in the meadow beside the headline (all sol-detected,
// the marker dissolving like `#`):
//   `| quoted`   — one line: a quotation in another's voice; the `|` is its
//                  marginal bar, the words wear the quote face (a portal glows).
//   `> snippet`  — one line: code shown, not run — a dimmed aside, the sibling of
//                  inline `=code=`, worn under the faded-mono face.
//   ``` … ```    — many lines: a full code CELL, linted at FULL strength (no
//                  fade). The fences dim; between them the real tokenizer runs, so
//                  the cell is well-formed code — the groundwork for evaluable,
//                  scrollable notebook cells. Persists across lines like the meadow.
// ---------------------------------------------------------------------------

// The portal word grammar — ONE regex, two faces (id:gw-grammar): the bare
// portal `[[roundness]]` and the pressed description portal
// `[[frag-spiral][Spiralling to the End]]` (weave/parse.js rewritePortals
// emits both). Group 1 is the target word, group 2 the display word (absent
// on the bare face). PORTAL_RE is the global scanner the portal organ
// (editor/portals.js) walks; PORTAL_INLINE_RE the anchored probe litInline
// consumes — the same grammar, never a second one.
export const PORTAL_RE = /\[\[([^\][]+)\](?:\[([^\]]*)\])?\]/g
// The anchored probe litInline consumes — DERIVED, so the two can never drift.
const PORTAL_INLINE_RE = new RegExp(`^(?:${PORTAL_RE.source})`)

// One chunk of inline prose. Advances the stream by at least one char and
// returns a sub-style; `base` is the plain-run face (inked prose, or a quoted
// voice). Unclosed sugar is just prose — never an error.
function litInline(stream, state, base = "comment") {
    if (stream.match(PORTAL_INLINE_RE)) return "link";         // [[portal]] / [[portal][word]] — a glowing word
    if (stream.match(/^=[^=\s][^=]*=/, false)) {              // =code= — same linting, faded
        stream.next();                                        // the opening delimiter, dimmed
        state.inProseCode = true;
        state.tokenize.push(readProseCode);
        return "lineComment";
    }
    if (stream.match(/^\*[^*\s][^*]*\*/)) return "strong";     // *strong*
    if (stream.match(/^\/[^/\s][^/]*\//)) return "emphasis";   // /lean/
    stream.next();                                             // a plain run of prose,
    stream.eatWhile(/[^\[\]*/=]/);                             // up to the next sugar opener
    return base;                                               // inked prose — or a quoted voice
}

// A code word riding prose (=code=). The inner runs through the real code
// tokenizer — the SAME linting — while the fade marker in token() dims it to a
// reference. The delimiters dissolve like the margin's `#`.
function readProseCode(stream, state) {
    if (stream.peek() === "=") {           // closing delimiter
        stream.next();
        state.tokenize.pop();
        state.inProseCode = false;
        return "lineComment";
    }
    if (stream.eol()) {                    // safety — never leave the fence open
        state.tokenize.pop();
        state.inProseCode = false;
        return null;
    }
    return tokenBase(stream, state);       // real linting; token() adds the fade
}

// The prose-line grammar — ONE table, both doors (id:gw-grammar). A prose line may
// open with a block mark; the SAME marks live behind the margin `#` and inside the
// meadow `###`, so `# * Title` names an outline node riding the code exactly as
// `* Title` names a phase in the clearing. Each entry renders one line; a
// `spansLines` mark (the ``` cell) needs many lines, so it opens only in the meadow —
// a one-line margin has no room to hold it. A new prose mark is one row here, alive in
// BOTH doors at once: the shared, extensible parse the grammar always promised.
const PROSE_BLOCKS = [
    // `* name` — a headline: a phase in the meadow, an outline node in the margin
    // (more `*`s, deeper). The trailing space disambiguates from inline `*strong*`.
    { spansLines: false, re: /^[ \t]*(\*+)[ \t]/,
      enter(stream)        { const m = stream.match(this.re); stream.skipToEnd();
                             return "heading" + Math.min(m[1].length, 6); } },
    // `| …` — a quotation in another's voice; the bar dissolves, the words wear quote.
    { spansLines: false, re: /^[ \t]*\|[ \t]?/,
      enter(stream, state) { stream.match(this.re);
                             if (!stream.eol()) state.tokenize.push(readQuoteLine);
                             return "lineComment"; } },
    // `> …` — a code snippet, shown not run: the real linting under the faded-mono face.
    { spansLines: false, re: /^[ \t]*>[ \t]?/,
      enter(stream, state) { stream.match(this.re);
                             if (!stream.eol()) { state.inProseCode = true; state.tokenize.push(readSnippet); }
                             return "lineComment"; } },
    // ``` … — a full code CELL, linted at full strength until the closing ```. Spans
    // many lines, so it opens in the meadow only (an info word on the opener is optional).
    // CELL_OPEN is the one grammar; the probe and the consume cannot drift.
    { spansLines: true,  re: CELL_OPEN,
      enter(stream, state) { stream.match(CELL_OPEN); state.tokenize.push(readCodeBlock);
                             // The marker dissolves; the word after it does NOT.
                             // It is the cell's NAME — the author's own (D024) —
                             // so it takes a face instead of dimming with the fence.
                             if (!stream.eol()) state.tokenize.push(readCellName);
                             return "lineComment"; } },
];

// The block mark opening this prose line, or null — probed WITHOUT consuming, so a
// miss leaves the stream untouched for litInline. `allowSpanning` gates the multi-line
// marks: true in the meadow (a place), false in the margin (one line only). The door
// then calls `entry.enter(stream, state)` to consume the mark and render the line.
function proseBlockAt(stream, allowSpanning) {
    for (const b of PROSE_BLOCKS) {
        if (b.spansLines && !allowSpanning) continue;
        if (stream.match(b.re, false)) return b;
    }
    return null;
}

// The margin — prose OF one code line. Pushed after `#`; pops at end-of-line. Its
// first ink may open a per-line prose block (`* `, `| `, `> `) — the SAME grammar the
// meadow speaks — so an outline heading or a quote can ride a single code line.
function readMargin(stream, state) {
    if (stream.eol())      { state.tokenize.pop(); return null; }
    if (stream.eatSpace()) { if (stream.eol()) state.tokenize.pop(); return null; }
    if (state.marginFresh) {                                    // at the line's first ink
        state.marginFresh = false;
        const b = proseBlockAt(stream, false);                 // per-line marks only — no ``` cell here
        if (b) {                                               // the block owns the line; the margin steps aside
            state.tokenize.pop();                              //   pop BEFORE enter pushes, so any sub-tokenizer
            return b.enter(stream, state);                     //   sits on tokenBase and releases cleanly at EOL
        }
    }
    const style = litInline(stream, state);
    if (stream.eol()) state.tokenize.pop();                    // the margin is one line only
    return style;
}

// A quotation line (`| …`) inside the meadow — another's voice. The `|` bar has
// already dissolved (readMeadow); here the words wear the quote face, yet inline
// sugar still lives (a portal in a quote still glows). One line only; a multi-
// line quote is stacked `|` lines, each popping at its own EOL so nothing leaks.
function readQuoteLine(stream, state) {
    if (stream.eol())      { state.tokenize.pop(); return null; }
    if (stream.eatSpace()) { if (stream.eol()) state.tokenize.pop(); return null; }
    const style = litInline(stream, state, "quote");
    if (stream.eol()) state.tokenize.pop();
    return style;
}

// A code snippet line (`> …`) inside the meadow — code shown, not run. The rest
// of the line runs the REAL tokenizer (same linting as the buffer) while
// inProseCode drapes it in the faded-mono face, exactly like inline `=code=`.
// One line only; pops on the same call that reaches EOL (mirroring readMargin —
// the per-line loop stops at EOL, so a pop-only-at-EOL branch would never run and
// the snippet would leak onto the next line). inProseCode stays true here so
// token() still fades THIS final token; readMeadow clears it when prose resumes.
function readSnippet(stream, state) {
    if (stream.eol()) { state.tokenize.pop(); state.inProseCode = false; return null; }
    const style = tokenBase(stream, state);                    // real linting; token() adds the fade
    if (stream.eol()) state.tokenize.pop();
    return style;
}

// A fenced code block (``` … ```) inside the meadow — a full code CELL, not a
// faded aside. Where `=code=` and the `>` one-liner are dimmed references, the
// lines here run the REAL tokenizer at FULL strength (no fade): the linting
// groundwork for evaluable, scrollable notebook cells. Persists across lines like
// the meadow itself; the opening/closing ``` fences dim, everything between is code.
function readCodeBlock(stream, state) {
    if (stream.sol() && stream.match(CELL_CLOSE)) {             // closing fence releases the cell
        state.tokenize.pop();
        return "lineComment";
    }
    return tokenBase(stream, state);                            // full linting — the interpretable cell
}

// THE CELL'S NAME (D024) — the rest of an opening fence, in one bite. One shot:
// it pops itself, and the cell's own linting takes the lines below.
function readCellName(stream, state) {
    state.tokenize.pop();
    stream.eatSpace();
    if (stream.eol()) return null;      // a fence with only trailing space names nothing
    stream.skipToEnd();
    return "labelName";
}

// The meadow — prose AROUND code. Pushed after an opening `###`; persists across
// lines until the closing `###` (or stays open to end-of-file — auto-close).
function readMeadow(stream, state) {
    state.inProseCode = false;                                 // back in prose — any snippet fade is over
    if (stream.sol() && stream.match(MEADOW_FENCE)) {          // closing fence
        state.tokenize.pop();
        return "lineComment";
    }
    if (stream.sol()) {                                        // a prose line may open with a block mark —
        const b = proseBlockAt(stream, true);                  //   all of them here (the meadow is a place, so
        if (b) return b.enter(stream, state);                  //   ``` cells are welcome); the meadow stays on the
    }                                                          //   stack beneath any sub-tokenizer the mark pushes
    if (stream.eol())      return null;                        // a blank prose line
    if (stream.eatSpace()) return null;
    return litInline(stream, state);
}

// ---------------------------------------------------------------------------
// StreamParser spec (passed to StreamLanguage.define)
// ---------------------------------------------------------------------------

export const plangModeSpec = {
    name: "plang",

    startState() {
        return {
            tokenize:        [tokenBase],
            indented:        0,
            context:         { type: "top", indented: 0, blockIndent: false },
            continuedLine:   false,
            lastTok:         null,
            indentStack:     [],
            dedentPending:   false,
            lastIndent:      0,
            nestedBlockLevel: 0,
            inProseCode:     false,
            marginFresh:     false,
        };
    },

    token(stream, state) {
        curPunc = null;
        if (stream.sol()) {
            state.indented = stream.indentation();
            state.inProseCode = false;   // a fresh line starts un-faded — the snippet fade (`> …`,
        }                                // `=code=`) never crosses a line boundary (meadow OR margin)

        const style   = state.tokenize[state.tokenize.length - 1](stream, state);
        let thisTok   = curPunc;
        let kwtype    = style;

        if (style === "ident") {
            const word = stream.current();
            // The name a `def` opens is a definition; PascalCase is a tag;
            // after `.` a property. Everything else is a plain variable —
            // no Ruby `class`/`do |x|` residue (class is not a keyword).
            kwtype = state.lastTok === "." ? "property"
                : keywords.propertyIsEnumerable(word) ? "keyword"
                : /^[A-Z]/.test(word)                 ? "tag"
                : state.lastTok === "def"             ? "def"
                : "variable";

            if (kwtype === "keyword") {
                thisTok = word;
                if (indentWords.propertyIsEnumerable(word)) {
                    state.nestedBlockLevel++;
                    state.indentStack.push(state.indented);
                    state.context = {
                        prev:        state.context,
                        type:        word,
                        indented:    state.indented,
                        blockIndent: true,
                    };
                    state.dedentPending = false;
                } else if (dedentWords.propertyIsEnumerable(word)) {
                    if (state.nestedBlockLevel > 0) state.nestedBlockLevel--;
                    state.lastIndent = state.indentStack.length > 0 ? state.indentStack.pop() : 0;
                    if (state.context && state.context.prev) state.context = state.context.prev;
                    state.dedentPending = true;
                    if (state.nestedBlockLevel === 0) state.dedentPending = false;
                }
            }
        }

        if (curPunc || (style && style !== "comment")) state.lastTok = thisTok;

        if (/[([{]/.test(curPunc)) {
            state.context = {
                prev:        state.context,
                type:        curPunc,
                indented:    state.indented,
                blockIndent: false,
            };
        } else if (/[)\]}]/.test(curPunc) && state.context.prev) {
            state.context = state.context.prev;
        }

        if (stream.eol()) state.continuedLine = (curPunc === "\\" || style === "operator");

        // A code word riding prose (=code=) keeps its linting but wears the
        // faded-mono face — the `monospace` tag carries the opacity in theme.js.
        if (state.inProseCode) kwtype = kwtype ? kwtype + " monospace" : "monospace";

        return kwtype;
    },

    indent(state, textAfter) {
        const firstChar = textAfter && textAfter.charAt(0);
        const firstWord = textAfter && textAfter.match(/^\s*(\w+)/);

        const isDedent = (firstWord && dedentWords.propertyIsEnumerable(firstWord[1])) ||
                         (firstChar && closing.propertyIsEnumerable(firstChar));

        if (isDedent) {
            return state.indentStack.length > 0
                ? state.indentStack[state.indentStack.length - 1]
                : state.context.indented;
        }

        if (state.dedentPending) {
            state.dedentPending = false;
            return state.lastIndent;
        }

        if (state.continuedLine) return state.indented + INDENT_UNIT;
        if (state.context.blockIndent) return state.context.indented + INDENT_UNIT;

        return state.indented;
    },

    languageData: {
        // PaperLang closes with `end` (and `}`); Ruby's rescue/elsif/else never lived here.
        indentOnInput: /^\s*(?:end|\})$/,
        commentTokens: { line: "#" },
    },
    lineComment: "#",
};

// ---------------------------------------------------------------------------
// Indent-based fold service
// Equivalent to CM5's fold: "indent" — folds from line end to the last
// consecutive line that has strictly greater indentation.
// ---------------------------------------------------------------------------

function indentFoldService(state, lineStart, lineEnd) {
    const line   = state.doc.lineAt(lineStart);
    const indent = line.text.search(/\S/);
    if (indent < 0) return null; // blank line — not foldable

    let foldTo = -1;

    for (let i = lineEnd + 1; i < state.doc.length; ) {
        const next       = state.doc.lineAt(i);
        const nextIndent = next.text.search(/\S/);

        if (nextIndent < 0) {
            // blank line — skip but keep the fold range open
            i = next.to + 1;
            continue;
        }

        if (nextIndent <= indent) {
                // Include the closing `end` in the fold so the block collapses
                // completely: `repeat 4 do ❦` with end hidden.
                if (foldTo > lineEnd && nextIndent === indent && /^\s*end\b/.test(next.text)) {
                    foldTo = next.to;
                }
                break;
            }

        foldTo = next.to;
        i = next.to + 1;
    }

    return foldTo > lineEnd ? { from: lineEnd, to: foldTo } : null;
}

// ---------------------------------------------------------------------------
// Phase fold service — stretchtext in the editor itself (id:gw-grammar).
// Fold a `* name` headline (inside a meadow) down to its headline line: the
// phase runs to the next sibling/ancestor headline, the closing `###`, or EOF.
// ---------------------------------------------------------------------------

// Fold a phase to its headline. The SHAPE comes from the one prose walk
// (`turtling/parse.js` outline): which lines are headlines, at what depth, and
// where the clearing ends. This service only turns that into a CM6 range.
function litFoldService(state, lineStart, lineEnd) {
    const doc  = state.doc;
    const line = doc.lineAt(lineStart);
    if (!HEADLINE.test(line.text)) return null;              // cheap reject before the walk

    const { phases, meadows } = findProse(doc);
    const i = phases.findIndex((s) => s.line === line.number);
    if (i === -1) return null;                               // not a headline in prose space
    const self = phases[i];

    // The phase runs to the next sibling/ancestor headline, else to the last
    // line inside its clearing.
    let end = null;
    for (let j = i + 1; j < phases.length; j++) {
        if (phases[j].depth <= self.depth) { end = phases[j].line - 1; break; }
    }
    if (end == null) {
        const m = meadows.find((mm) => self.line >= mm.open && self.line <= mm.end);
        end = m ? m.end - 1 : doc.lines;
    }

    const foldTo = end > line.number ? doc.line(end).to : -1;
    return foldTo > lineEnd ? { from: lineEnd, to: foldTo } : null;
}

// ---------------------------------------------------------------------------
// Margin-outline fold — the `# * name` heading riding a code line folds the code
// beneath it (id:gw-grammar). Outshine in the buffer: a code-side outline, level by
// level, before any weave page exists. The meadow's litFoldService owns headings
// inside `###`; this owns them out in code space. The phase runs to the next
// same-or-shallower margin heading, a meadow opening (`###`), or end-of-file.
// ---------------------------------------------------------------------------

const MARGIN_HEAD_RE = /#[ \t]*(\*+)[ \t]/;   // `… # * name` — an outline heading in the margin

// Depth of a margin outline heading on this line (0 = none). A bare `###` never
// matches — it has no `*` after the hashes — so a meadow fence is not a heading.
const marginHeadDepth = (text) => { const m = MARGIN_HEAD_RE.exec(text); return m ? m[1].length : 0; };

export function marginOutlineFoldService(state, lineStart, lineEnd) {
    const doc   = state.doc;
    const line  = doc.lineAt(lineStart);
    const depth = marginHeadDepth(line.text);
    if (!depth) return null;

    // Prose space belongs to the meadow's phase fold; out here is code space.
    // The meadows come from the one walk — never counted again here, since a
    // second fence counter would only restate what `inMeadowRange` knows.
    const meadows = findMeadows(doc);
    if (inMeadowRange(meadows, line.number)) return null;

    const nextMeadow = meadows.find((m) => m.open > line.number)?.open ?? Infinity;
    let foldTo = -1;
    for (let n = line.number + 1; n <= doc.lines; n++) {
        if (n >= nextMeadow) break;                            // a clearing opens — the section ends
        const t = doc.line(n);
        const d = marginHeadDepth(t.text);
        if (d && d <= depth) break;                            // next sibling/ancestor heading
        foldTo = t.to;
    }
    return foldTo > lineEnd ? { from: lineEnd, to: foldTo } : null;
}

// ---------------------------------------------------------------------------
// Code cells — the ``` … ``` regions a notebook treats as units (id:gw-grammar).
// ``` fences pair up inside a meadow, so we walk from the top tracking meadow +
// cell state. ONE walk feeds everything downstream: the phase-style fold below,
// and (in code-cell-activation.js) the cursor-driven active/inactive gate — and,
// later, evaluation, which runs only the active cell.
// ---------------------------------------------------------------------------

// THE one walk over prose space — and it does not live here. `classify(lines)`
// in turtling/parse.js is the single meadow⊗cell⊗headline state machine; every
// reader is a FOLD over its roles, and `outline` is the fold into geometry that
// the phase (attention is the address, D021) and this editor face both read.
// This is only the CM6 adapter that hands it lines. Do not grow a second walker
// here — see that file for why the first three agreed only by luck.
//   cells    { open, end, terminated, path } — `end` is the closing-fence line,
//            or the last body line when the clearing / EOF closed the cell
//   meadows  { open, end } — fence lines included; unclosed runs to EOF
//   phases { line, depth, title, path } — the headlines, in document order
// findCells / findMeadows below are views over it, never second walkers.
//
// Memoized on doc identity: CM6 replaces the Text object on every edit, so a
// hit means the content is unchanged. Fold services call this per gutter line;
// without the memo that is O(lines²).
const proseMemo = new WeakMap();

export function findProse(doc) {
    let hit = proseMemo.get(doc);
    if (hit) return hit;
    const lines = [];
    for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);
    hit = outline(lines);
    proseMemo.set(doc, hit);
    return hit;
}

// Every code cell in document order — a view over the one walk.
export const findCells = (doc) => findProse(doc).cells;

// The cell containing line `lineNo`, or null — the gate: the cursor's cell is the
// active one (evaluated), every other cell is inert (dimmed, not evaluated).
export const cellAt = (cells, lineNo) => cells.find(c => lineNo >= c.open && lineNo <= c.end) || null;

// The cell under the EYELINE while scrolling: the topmost cell still on screen
// that is ENOUGH on screen to be what the child is looking at — touching the
// viewport is not the same as being read.
//
// The eyeline leans to the top because only the top is reachable. Every cell can
// be scrolled to the top edge — and below the last line you can always press
// Enter for more room — but the bottom edge is fixed by the doc's own end, so a
// rule reading the LOWEST visible cell gives cells packed close together no
// window of their own: three cells in one viewport and only the third would ever
// light, the first two skipped over forever.
//
// But topmost alone lets a two-line tail hanging at the top edge outrank a whole
// cell open below it — the light sits in a sliver while the child's eye is on
// the figure. So a cell must ALSO fill the eye, and there are two ways to, because
// cells and viewports each come in both sizes: it shows at least half of ITSELF,
// or it covers at least half the VIEWPORT (how a cell taller than the screen
// qualifies — it is all there is to see). Measured in doc lines, the reader's
// own unit, which only drifts from the pixels where lines wrap.
//
// Failing every cell, the nearest one begun above holds (prose stickiness, the
// cursor law's rule); before any cell, the first (first-light parity).
export const eyelineCell = (cells, topLine, bottomLine) => {
    const viewLines = bottomLine - topLine + 1;
    let above = null;
    for (const c of cells) {
        if (c.open < topLine) above = c;                     // begun above the eyeline — the sticky one
        if (c.open > bottomLine) break;                      // opens below the fold
        const seen = Math.min(c.end, bottomLine) - Math.max(c.open, topLine) + 1;
        if (seen * 2 >= c.end - c.open + 1) return c;        // half of itself
        if (seen * 2 >= viewLines) return c;                 // …or half the screen
    }
    return above ?? cells[0] ?? null;
};

// The last line INSIDE a cell — where a reader would write. Never a fence line,
// because a keystroke on a fence breaks the cell and un-pages the document.
// (`end` is the closing fence when terminated, and a closer always sits below
// its opener, so that line exists. An empty cell answers its opener, which is
// safe: CELL_OPEN takes an info word, so writing there does not break it.)
export const cellBodyEnd = (cell) => (cell.terminated ? cell.end - 1 : cell.end);

// The default attend for a buffer that has never been attended: a page opens
// on its first cell — at the opener's end, the same safe landing reach.js
// already uses for an empty cell (never on a ``` fence). A program has no
// such law; null and the caller's own zero default stands.
export function defaultAttend(doc) {
    const { cells, meadows } = findProse(doc)
    if (!cells.length || !isPageDoc(doc, meadows)) return null
    return doc.line(cells[0].open).to
}

// Every meadow's span in document order — the other view over the one walk.
export const findMeadows = (doc) => findProse(doc).meadows;

// Is this line in prose space? Out here — on bare code, outside every fence —
// no cell is active and none would be evaluated (the reader is making, not
// reading); the meadow is where the cells' light lives.
export const inMeadowRange = (meadows, lineNo) =>
    meadows.some((m) => lineNo >= m.open && lineNo <= m.end);

// PAGE-shaped: every non-blank line lives inside a meadow — the shape the
// press emits. Bare code outside the fences makes the doc a PROGRAM. The
// priority law (the reach, the portal step) decides by this shape, never a
// mode flag — a view over the one walk, beside its siblings above.
export function isPageDoc(doc, meadows) {
    let m = 0
    for (let n = 1; n <= doc.lines; n++) {
        while (m < meadows.length && meadows[m].end < n) m++
        const inMeadow = m < meadows.length && n >= meadows[m].open && n <= meadows[m].end
        if (!inMeadow && /\S/.test(doc.line(n).text)) return false
    }
    return true
}

// Is line `lineNo` a cell's opening fence? (Only the opener folds.)
export const isCellOpener = (doc, lineNo) => findCells(doc).some(c => c.open === lineNo);

// Fold a ``` cell to its opening fence — phase-style stretchtext for a cell.
export function codeCellFoldService(state, lineStart, lineEnd) {
    const doc  = state.doc;
    const cell = findCells(doc).find(c => c.open === doc.lineAt(lineStart).number);
    if (!cell) return null;
    const to = doc.line(cell.end).to;
    return to > lineEnd ? { from: lineEnd, to } : null;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

// Returns an extension array ready for langCompartment.reconfigure().
// All CM6 APIs are injected to avoid static imports of the dynamic vendor bundle.
// Fold services are tried in order, first non-null wins: a meadow headline folds as a
// phase, a ``` opener folds as a code cell, a `# * ` margin heading folds as a
// code-side outline node, and everything else folds by indentation.
export const createPlangExtensions = ({ StreamLanguage, foldService }) => [
    StreamLanguage.define(plangModeSpec),
    foldService.of(litFoldService),
    foldService.of(codeCellFoldService),
    foldService.of(marginOutlineFoldService),
    foldService.of(indentFoldService),
];
