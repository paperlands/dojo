import { ASTNode } from "./ast.js"
import { parseProperty, parseSupport, propertyOf } from "./laws/authored.js"
import { affineSyntax } from "./laws/affine.js"
import { getOperator } from "./mafs/operators.js"
import { Lexer } from "./mafs/lexer.js"
import { Parser as ExprParser } from "./mafs/parse.js"


// ============================================================================
// parse.js — one pipeline. Each stage narrows what the next may say.
// ============================================================================
//   THE GRAMMAR     the marks as typed, and the predicates over them
//   THE SCAN        one walk naming each line's ROLE — no records, no tree
//   RESILIENCE      a broken part is held; the healthy parts still run (D020)
//   THE PARSE       records → top-level units
//   THE GREEN TREE  identity: an old object may carry the new answer
//   CONVERGENCE     a text diff → the same forest a full parse would build
//   THE LINE PASS   lines → records, restartable from three bits of fence state
//   THE CHUNKS      one line → tokens, groups and quotes kept whole
//   ARGUMENTS       a chunk's boundary read from the lexer, not its spelling
//   THE OUTLINE     one walk over lines: the whole shape of a page
//   GEOMETRY        a fold over the scan → meadows, cells, phases
//   THE PHASE       attention is the address (D021)

// THE CURSOR — one position over the records; `last` is what a block reads.
export class ParserState {
    constructor(lines) {
        this.lines = lines;
        this.pos = 0;
        this.len = lines.length;
        this.last = null;   // the record most recently consumed — block spans read it
    }

    hasMore() {
        return this.pos < this.len;
    }

    next() {
        this.last = this.lines[this.pos++];
        return this.last;
    }
}


// ============================================================================
// THE GRAMMAR — one table (id:gw-grammar)
// ============================================================================
// Meadow fences, cell fences, headlines, block openers. Every site that asks
// "what does this line open or close?" reads here — tokenizer, outline,
// editor mode, press, page probe. A second spelling is a second answer.
// The predicates are the marks; `classify` below is the one walk that APPLIES
// them, and every reader downstream is a fold over its roles.

export const END = 'end';
export const DO = 'do';
const COMMENT = '#';

// The marks as they are typed.
export const MEADOW_MARK = '###';   // prose AROUND code
export const CELL_MARK = '```';     // a code CELL inside a meadow

// Line predicates (full-line). Leading/trailing space is allowed; nothing else.
export const HEADLINE = /^[ \t]*(\*+)\s+(\S.*)$/;   // `* name` — trailing space disambiguates *bold*
export const MEADOW_FENCE = /^[ \t]*###[ \t]*$/;
export const CELL_OPEN = /^[ \t]*```/;              // an info word may ride the opener
export const CELL_CLOSE = /^[ \t]*```[ \t]*$/;      // a bare ``` is only ever a closer
export const CELL_PROBE = /^[ \t]*```/m;            // cheap multi-line gate (page.js)

// Callers that split elsewhere (CM6 hands us its own lines) may still carry a
// stray `\r` — and `###\r` is not a fence to any predicate here.
const lineText = (s) => {
    const t = s ?? '';
    return t.charCodeAt(t.length - 1) === 13 ? t.slice(0, -1) : t;
};

// A line's SYMBOL is a fact about the text alone; its ROLE is a fact about
// (symbol, place). Keeping them apart lets ONE table serve the scan, the record
// pass and the restart fold (id:gw-grammar).
export const SYMBOL = {
    meadow:   0,   // `###`
    tickBare: 1,   // ``` alone — a closer in a cell, an opener in a clearing
    tickInfo: 2,   // ```word — an opener in a clearing, BODY inside a cell
    headline: 3,   // `* name`
    text:     4,
};

// Every fence anchors at line start after optional blanks, so ONE peek at the
// first significant character decides which regex may match. The peek picks the
// law; it never replaces it. `text` is expected already normalized by `lineText`.
export function symbolOf(text) {
    let i = 0;
    const n = text.length;
    while (i < n && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++;
    switch (text.charCodeAt(i)) {
        case 35: return MEADOW_FENCE.test(text) ? SYMBOL.meadow : SYMBOL.text;      // #
        case 96: return CELL_CLOSE.test(text) ? SYMBOL.tickBare                    // `
                      : CELL_OPEN.test(text) ? SYMBOL.tickInfo : SYMBOL.text;
        case 42: return HEADLINE.test(text) ? SYMBOL.headline : SYMBOL.text;       // *
        default: return SYMBOL.text;
    }
}

const kindOf = (s) => (s == null ? SYMBOL.text : symbolOf(lineText(s)));
export const isMeadowFence = (s) => kindOf(s) === SYMBOL.meadow;
export const isCellOpen = (s) => {
    const k = kindOf(s);
    return k === SYMBOL.tickBare || k === SYMBOL.tickInfo;
};
export const isCellClose = (s) => kindOf(s) === SYMBOL.tickBare;

// The one place code and comment part. Everything after `#` rides verbatim —
// the author's whitespace is theirs. A bare `#` still yields a comment, not undefined.
const splitComment = (raw) => {
    const i = raw.indexOf(COMMENT);
    return i === -1 ? [raw, undefined] : [raw.slice(0, i).trimEnd(), raw.slice(i + 1)];
};

// Bracket/quote matching (O(1) lookup)
const CLOSERS = { '"': '"', "'": "'", '[': ']', '(': ')' };
const OPENS_BRACKET = { '[': 1, '(': 1 };

// Block statement heads — the only keywords that open a `… do … end` body.
// Editor indent tracks `do`/`end` themselves; depth scanners use blockDelta.
const BLOCK_KW = { for: 1, loop: 1, def: 1, draw: 1, when: 1, as: 1 };

// Depth delta for one source line. +1 opens (code half ends in `do`), -1
// closes (`end` at the start of the code half), else 0. The margin `# …` is
// stripped first, so a comment never opens a block. A mid-line `do` in a
// string no longer increments depth (unlike a bare /\bdo\b/ scan).
export function blockDelta(lineText) {
    if (lineText == null || lineText === '') return 0;
    const [code] = splitComment(lineText);
    const t = code.trim();
    if (!t) return 0;
    if (/^end\b/.test(t)) return -1;
    if (/\bdo\s*$/.test(t)) return 1;
    return 0;
}


// ============================================================================
// THE SCAN — one walk, roles only (id:gw-grammar)
// ============================================================================
// Every line gets ONE name for its place in the clearing. No spans, no records,
// no tree: readers FOLD these into what they need. The fence truth lives here,
// so a reader that disagrees is a reader with a bug, never a second grammar.
//
// Stays roles-only on purpose. The moment the scan reshapes, counts, or spans,
// it has become a second mind wearing the name of the first.

export const ROLE = {
    meadowOpen:  'meadowOpen',    // `###` — the clearing opens
    meadowClose: 'meadowClose',   // `###` — the clearing closes (and shuts any open cell)
    cellOpen:    'cellOpen',      // ``` — code re-entering code-space (id:gw-cell)
    cellClose:   'cellClose',     // a bare ``` — only ever a closer
    headline:    'headline',      // `* name` in prose space — a phase mark AND prose
    prose:       'prose',         // meadow text
    code:        'code',          // cell body, or bare code outside every clearing
};

// The ONE split. Line endings are the tape's, never the child's content.
export const splitLines = (text) => String(text ?? '').split(/\r\n|\r|\n/);


// THE FENCE MACHINE — four places, one table (id:gw-grammar).
//   out     outside every clearing
//   pending inside a clearing whose first unit has not been emitted — an unpaid
//           obligation to stamp that unit's open mark
//   meadow  inside a clearing, obligation paid
//   cell    inside a cell
// Rows `pending` and `meadow` are identical ON PURPOSE: the obligation changes
// what the record fold EMITS, never where the machine goes.
export const PLACE = { out: 0, pending: 1, meadow: 2, cell: 3 };

const R = (role, next) => ({ role, next });
const MACHINE = [
    /* out     */ [R(ROLE.meadowOpen, PLACE.pending), R(ROLE.code, PLACE.out), R(ROLE.code, PLACE.out), R(ROLE.code, PLACE.out), R(ROLE.code, PLACE.out)],
    /* pending */ [R(ROLE.meadowClose, PLACE.out), R(ROLE.cellOpen, PLACE.cell), R(ROLE.cellOpen, PLACE.cell), R(ROLE.headline, PLACE.meadow), R(ROLE.prose, PLACE.meadow)],
    /* meadow  */ [R(ROLE.meadowClose, PLACE.out), R(ROLE.cellOpen, PLACE.cell), R(ROLE.cellOpen, PLACE.cell), R(ROLE.headline, PLACE.meadow), R(ROLE.prose, PLACE.meadow)],
    /* cell    */ [R(ROLE.meadowClose, PLACE.out), R(ROLE.cellClose, PLACE.meadow), R(ROLE.code, PLACE.cell), R(ROLE.code, PLACE.cell), R(ROLE.code, PLACE.cell)],
];

// lines → rows, 1:1 and in document order.
//   { line, text, role } always; `info` on cellOpen (the word on the fence, or
//   null), `depth`/`title` on headline, `closesCell` on a meadowClose that cut a
//   cell short. A headline is prose too — a reader that gathers prose takes it.
// What ran off the end is the FOLD's to close: the tape ending is not a fence.
// `upto` stops the walk early — for a fold that wants the boundary state, not rows.
export function classify(lines, upto = Infinity) {
    const rows = [];
    const n = Math.min(lines?.length ?? 0, upto);
    let place = PLACE.out;

    for (let i = 0; i < n; i++) {
        const text = lineText(lines[i]);
        const line = i + 1;
        const prev = place;
        const step = MACHINE[place][symbolOf(text)];
        place = step.next;

        if (step.role === ROLE.cellOpen) {
            rows.push({ line, text, role: step.role,
                        info: text.replace(CELL_OPEN, '').trim() || null });
        } else if (step.role === ROLE.headline) {
            const m = HEADLINE.exec(text);
            rows.push({ line, text, role: step.role, depth: m[1].length, title: m[2].trim() });
        } else if (prev === PLACE.cell && step.role === ROLE.meadowClose) {
            rows.push({ line, text, role: step.role, closesCell: true });
        } else {
            rows.push({ line, text, role: step.role });
        }
    }
    return rows;
}


// One prose node. A meadow holding ``` cells (id:gw-cell) becomes a SEQUENCE
// instead — its ### fences ride the edge units, so printAST re-emits exactly.
function meadowNode(line) {
    const node = stamp(new ASTNode('Empty', '')
        .assign_meta('lit', line.meadow)
        .assign_meta('meadow', true)
        .assign_meta('meadowOpen', line.meadowOpen !== false)
        .assign_meta('meadowClose', line.meadowClose !== false), line);
    if (line.meadowCloseImplicit) node.assign_meta('meadowCloseImplicit', true);
    return node;
}

// A ``` fence line — code re-entering code-space inside the meadow. A no-op
// for the executor; printAST re-emits the fence (and any ### it carries).
function cellFenceNode(line) {
    const node = stamp(new ASTNode('Empty', '').assign_meta('cellFence', true), line);
    if (line.info) node.assign_meta('info', line.info);
    if (line.implicit) node.assign_meta('implicit', true);
    if (line.meadowOpen) node.assign_meta('meadowOpen', true);
    if (line.meadowClose) node.assign_meta('meadowClose', true);
    if (line.meadowCloseImplicit) node.assign_meta('meadowCloseImplicit', true);
    return node;
}

// ============================================================================
// RESILIENCE — spans, error nodes, trivia (id:cmp-resilient)
// ============================================================================

// 1-based ORIGINAL buffer lines. The tokenizer reshapes lines but every record
// remembers where it was born. Statement-grain: Arguments ride their statement.
function stamp(node, rec, endLine = null) {
    node.span = { line: rec.line ?? 0, endLine: endLine ?? rec.endLine ?? rec.line ?? 0 };
    return node;
}

// Containment: the broken part is held, the healthy parts still run (D020).
// `value` keeps the raw line verbatim so printAST round-trips it. Never thrown.
function errorNode(rec, expected, found, children = []) {
    return stamp(new ASTNode('Error', rec.text, children, {
        expected,
        found,
        kind: 'parse',
    }), rec);
}

// Trivia rides a line, never structure (id:pa-ghc-exactprint). Two slots only:
// meta.comment (own/opening line), meta.endComment (a block's `end`).
const attachComment = (node, comment) =>
    comment != null ? node.assign_meta('comment', comment) : node;

// ============================================================================
// THE PARSE — records → top-level units (id:cmp-green-tree)
// ============================================================================
// One top-level unit. The parser carries no cross-unit state at depth 0, so a
// unit is exactly the restart/stop grain (id:cmp-green-tree, id:pa-zig-incremental).
export function parseUnit(state) {
    const line = state.next();

    if (line.meadow !== undefined) return meadowNode(line);
    if (line.cellFence) return cellFenceNode(line);

    const tokens = tokenizeLine(line.text);
    const comment = line.comment;

    // A stray `end` is an error node, never a phantom Call (D020).
    if (tokens.length === 1 && tokens[0] === END) {
        return attachComment(errorNode(line, 'an open block to close', `'${END}'`), comment);
    }

    if (tokens.length === 0) {
        const node = stamp(new ASTNode('Empty', ''), line);
        attachComment(node, comment);
        return node;
    }

    const node = parseStatement(tokens, state, line);
    attachComment(node, comment);
    return node;
}

// A unit's span is the coordinates a restart needs, and it is a CONSERVATIVE
// superset of the records the unit consumes: an Error node rounds outward to the
// boundary it refused to cross (`expected 'end'` reaches the fence it stopped at).
// Rounding outward is the safe direction — a restart may re-parse extra, never skip.
//
// PROVENANCE — which text a forest's spans were born in. It rides the array it
// describes (a Symbol key: invisible to JSON and to every reader), because a side
// table keyed ON the array can be re-armed wrongly or lost. Geometry is not
// carried at all: a unit's line, far edge and fence state are read off its own
// span and the scan (id:cmp-green-tree).
const PROVENANCE = Symbol('parse.provenance');

const arm = (units, source) => {
    units[PROVENANCE] = { source, consumed: false };
    return units;
};

// Read-only, for the provenance auditor: `{ source }` — never a semantic property.
export const provenanceOf = (ast) => ast?.[PROVENANCE];

export function parseProgram(program) {
    const { lines } = tokenize(program);
    const state = new ParserState(lines);
    const ast = [];

    while (state.hasMore()) ast.push(parseUnit(state));

    return arm(ast, program);
}

// ============================================================================
// THE GREEN TREE — identity across reparses (id:cmp-green-tree)
// ============================================================================
// Reparse whole, then recover identity at the top-level unit, so unchanged
// structure stays ===-identical across reparses (id:pa-zig-incremental).

// Same key ⇒ same meaning. Stays COARSE on purpose: drift costs a missed reuse,
// never a wrong tree, because the fresh parse is always the answer.
const OVERLAY = new Set(['span', 'comment', 'endComment', 'lit']);
// Hoisted so the replacer has a STABLE identity — a fresh closure per call is a
// new callee at the JSON.stringify site (profile: the hottest frame; ~6%).
const stripOverlay = (k, v) => (OVERLAY.has(k) ? undefined : v);
const contentKey = (node) => JSON.stringify(node, stripOverlay);

// Span mutates the EXISTING object, so standing captures (frame.error) stay live.
// Trivia is rebuilt in a fresh parse's key ORDER so adopted meta serializes alike.
function adoptOverlay(prev, next) {
    if (next.span) {
        if (prev.span) { prev.span.line = next.span.line; prev.span.endLine = next.span.endLine; }
        else prev.span = { line: next.span.line, endLine: next.span.endLine };
    }
    const pm = prev.meta, nm = next.meta;
    if (pm && nm) {
        // meadow prose rides `lit` (first, always present) — update in place.
        if ('lit' in nm) pm.lit = nm.lit;
        // endComment before comment, cleared then re-added: that is a fresh
        // twin's key order, and a deleted comment must not linger.
        delete pm.endComment; delete pm.comment;
        if (nm.endComment !== undefined) pm.endComment = nm.endComment;
        if (nm.comment !== undefined) pm.comment = nm.comment;
    }
    const pc = prev.children ?? [], nc = next.children ?? [];
    for (let i = 0; i < pc.length; i++) adoptOverlay(pc[i], nc[i]);
}

// ============================================================================
// CONVERGENCE — the ChangeSet substitute (id:weave-typing-path, id:cmp-green-tree)
// ============================================================================
// Two identical ends are the diff: between them is what changed. Only the units
// inside that span must be re-parsed; the tail is the same text, hence the same
// forest, hence reusable.

// Line breaks counted as splitLines() splits them: LF, CRLF, bare CR. Counting
// LF alone names a different line than the tokenizer does, and the two
// coordinate systems must agree or a span addresses nothing real.
const countNewlines = (s, from, to) => {
    let n = 0;
    for (let i = from; i < to; i++) {
        const c = s.charCodeAt(i);
        if (c === 10) n++;
        else if (c === 13) { n++; if (i + 1 < to && s.charCodeAt(i + 1) === 10) i++; }
    }
    return n;
};

const commonPrefix = (a, b) => {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
};

// The suffix may not overlap the prefix: `floor` is the prefix's length.
const commonSuffix = (a, b, floor) => {
    const n = Math.min(a.length, b.length) - floor;
    let i = 0;
    while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
    return i;
};

// A fence line is the one construct whose reach crosses lines: a dirty `###`
// or ``` moves the chunk edges the tail's records are built from. Both sides
// are tested — a DELETED fence is as structural as an added one.
const FENCE_LINE = /(?:^|[\r\n])[ \t]*(?:```|###)/;

// Line break = LF, CRLF, or bare CR — the same three splitLines() splits on. A
// different count names a different line, and the tokenizer's coordinates are
// the ones the tree is stamped in.
const isBreak = (c) => c === 10 || c === 13;

// The whole line(s) the dirty span touches, never the span alone: deleting one
// `#` from `###` leaves a substring no fence predicate can see, while the
// grammar boundary has moved.
const affectedLine = (s, from, to) => {
    let start = from;
    while (start > 0 && !isBreak(s.charCodeAt(start - 1))) start--;
    let end = to > from ? to - 1 : from;
    while (end < s.length && !isBreak(s.charCodeAt(end))) end++;
    return s.slice(start, end);
};

// A zero-width edit still has an affected LINE on that side, and inside a fence
// line it can destroy the fence (` ``` ` → ` `x `` `). Only an insertion at a LINE
// START is harmless — it creates a line, it does not rewrite one. Everything else
// reads the whole line, span or no span.
const affectsFence = (s, from, to) => {
    if (to > from) return FENCE_LINE.test(affectedLine(s, from, to));
    if (from > 0 && isBreak(s.charCodeAt(from - 1))) return false;
    return FENCE_LINE.test(affectedLine(s, from, from));
};

// A spliced tail keeps its objects; only its line addresses moved, and the
// whole tail moves by one delta because the tail text is identical.
function shiftSpan(node, delta) {
    if (node.span) { node.span.line += delta; node.span.endLine += delta; }
    const kids = node.children;
    if (Array.isArray(kids)) for (let i = 0; i < kids.length; i++) shiftSpan(kids[i], delta);
}

// Identity reconciliation over ONE interval: an old node is claimable only
// forward of the last claim, so identical twins never swap positions and no
// object is adopted twice (id:cmp-green-tree, id:pa-zig-incremental).
function reconcile(prevSlice, fresh) {
    const pool = new Map();
    for (let i = 0; i < prevSlice.length; i++) {
        const key = contentKey(prevSlice[i]);
        const bucket = pool.get(key);
        if (bucket) bucket.push(i);
        else pool.set(key, [i]);
    }
    const next = new Map();         // key → next unclaimed slot in its bucket
    let floor = 0;                  // one past the last claimed prev index

    return fresh.map((node) => {
        const key = contentKey(node);
        const bucket = pool.get(key);
        if (!bucket) return node;
        let at = next.get(key) ?? 0;
        while (at < bucket.length && bucket[at] < floor) at++;
        if (at >= bucket.length) { next.set(key, at); return node; }
        const prev = prevSlice[bucket[at]];
        next.set(key, at + 1);
        floor = bucket[at] + 1;
        adoptOverlay(prev, node);
        return prev;
    });
}

// A meadow group is [open … close]; walking back from a unit, the first marker
// decides whether it is inside the group or already past it.
function meadowStart(prevAst, k) {
    for (let i = k; i >= 0; i--) {
        const meta = prevAst[i] && prevAst[i].meta;
        if (!meta) continue;
        if (meta.meadowOpen) return i;
        if (meta.meadowClose) {
            // The group ended before the edit — nothing of it can move.
            if (i < k) return k;
            // k IS the closing unit: deleting it moves the close marker onto a
            // neighbour, so the whole group is the unit of work.
            for (let j = i; j >= 0; j--) {
                const m = prevAst[j] && prevAst[j].meta;
                if (m && m.meadowOpen) return j;
            }
            return k;
        }
    }
    return k;
}

// Answers null whenever any precondition fails; the caller then does the total
// thing. Correctness rests on the units AFTER the dirty span being untouched
// text, parsed from the same empty top-level state — never on a key match.
function reparseConverged(text, prevText, prevAst) {
    const seen = provenanceOf(prevAst);
    if (!seen) return decline('unarmed');
    if (!prevAst.length) return decline('empty');
    // The certificate names the text these spans were born in: a mismatched pair
    // would shift THIS tree under a caller that never owned it.
    if (seen.source !== prevText) return decline('foreign-source');
    // The spans are the restart coordinates, so they must actually be stamped.
    for (const unit of prevAst) if (!unit.span) return decline('unstamped');

    const prefix = commonPrefix(prevText, text);
    const suffix = commonSuffix(prevText, text, prefix);
    if (!suffix) return decline('no-tail');

    if (affectsFence(prevText, prefix, prevText.length - suffix) ||
        affectsFence(text, prefix, text.length - suffix)) {
        return decline('fence');
    }

    const prevLines = countNewlines(prevText, 0, prevText.length) + 1;
    const nextLines = countNewlines(text, 0, text.length) + 1;
    const tailLines = countNewlines(text, text.length - suffix, text.length);
    const delta = nextLines - prevLines;

    const prevEdge = prevLines - tailLines;   // last line the edit could reach (prev)
    const fromLine = countNewlines(text, 0, prefix) + 1;

    // The tail: the first unit lying wholly inside the identical suffix.
    let q = prevAst.length;
    for (let i = 0; i < prevAst.length; i++) if (prevAst[i].span.line > prevEdge) { q = i; break; }
    // The head: restart at the unit CONTAINING the edit's first line — a glued
    // `end` shares its birth line, so "starts at or before" can step past the
    // records touched — then back up to the enclosing fence GROUP, because a
    // meadow chunk grows to absorb the edit and may now end past the line it owns.
    let k = prevAst.length;
    for (let i = 0; i < prevAst.length; i++) if (prevAst[i].span.endLine >= fromLine) { k = i; break; }
    k = meadowStart(prevAst, k);
    if (k >= prevAst.length) return decline('past-last-unit');
    // The tokenizer restarts only at a LINE, so roll back to the first unit owning
    // records on this line (id:gw-grammar).
    while (k > 0 && prevAst[k - 1].span.line === prevAst[k].span.line) k--;
    if (k >= q) return decline('head-past-tail');

    const stopLine = q < prevAst.length ? prevAst[q].span.line + delta : nextLines + 1;

    // Re-tokenize from the restart line to EOF, but PARSE only up to the tail. The
    // place is re-derived in one scan of the prefix rather than carried for every
    // unit; the saving is still the parse, not the tokenize.
    const rawLines = text.split(/\r\n|\r|\n/);
    const restartLine = prevAst[k].span.line;
    const lines = tokenizeRange(rawLines, restartLine - 1, Infinity,
                                stateAt(rawLines, restartLine)).lines;
    const state = new ParserState(lines);

    const middle = [];
    while (state.hasMore() && lines[state.pos].line < stopLine) middle.push(parseUnit(state));

    // The tail keeps its objects: its text is identical, so ONE delta moves every
    // span in it. But a splice is only sound if the boundary is where we think it
    // is, so the witness is SEMANTIC, not counted: the next unit the NEW stream
    // produces must still be the unit we are about to reuse. A unit that swallowed
    // (or shed) records at the boundary — `fw 1 / end rt 90`, where a new
    // `for 1 do` eats the `end` — shows up here, not two edits later.
    const kept = prevAst.slice(q);
    if (kept.length) {
        const at = lines[state.pos];
        if (!at || at.line !== stopLine) return decline('landing');
        const peek = new ParserState(lines);
        peek.pos = state.pos;
        peek.last = null;
        if (contentKey(parseUnit(peek)) !== contentKey(kept[0])) return decline('peek');
    }
    if (delta) for (const unit of kept) shiftSpan(unit, delta);
    const head = reconcile(prevAst.slice(k, q), middle);
    return arm(prevAst.slice(0, k).concat(head, kept), text);
}

// Witness for the convergence fast path: a silent fallback would leave every
// equivalence test green while the win never runs (id:weave-typing-path). Each
// refusal has a NAME, so a document that stops converging says which precondition
// it broke instead of only that it fell back.
const reparseCounts = { converged: 0, fallback: 0 };
const declines = Object.create(null);
const decline = (why) => { declines[why] = (declines[why] ?? 0) + 1; return null; };
export const reparseStats = () => ({ ...reparseCounts, declines: { ...declines } });
export const resetReparseStats = () => {
    reparseCounts.converged = 0; reparseCounts.fallback = 0;
    for (const k of Object.keys(declines)) delete declines[k];
};

export function reparseProgram(text, prevText, prevAst) {
    if (prevText == null || prevAst == null) return parseProgram(text);

    // LINEAR OWNERSHIP. Adoption and shifting mutate the objects they reuse, so a
    // tree is a valid input exactly once, and only for the text it was parsed from.
    // A spent or foreign tree is not repaired — it is not ours to rewrite, and its
    // certificate could no longer name what its nodes describe. Answer from scratch.
    const cert = provenanceOf(prevAst);
    if (!cert) return decline('unarmed') ?? parseProgram(text);
    if (cert.consumed) return decline('spent') ?? parseProgram(text);
    if (cert.source !== prevText) return decline('foreign-source') ?? parseProgram(text);
    if (prevText === text) return prevAst;

    const converged = reparseConverged(text, prevText, prevAst);
    cert.consumed = true;
    if (converged) { reparseCounts.converged++; return converged; }

    reparseCounts.fallback++;
    // `reconcile` returns a fresh array; arm IT, not only parseProgram's, or the
    // next ordinary edit has no provenance and falls back again.
    const parsed = parseProgram(text);
    return arm(reconcile(prevAst, parsed), text);
}


// ============================================================================
// THE LINE PASS — lines → records, restartable at a line (id:gw-grammar)
// ============================================================================
// Between `###` fences everything is VERBATIM; outside, lines are trimmed and a
// glued `end` splits onto its own line. The place carries the restart because the
// obligation is IN it — a range resumes where the last one stopped.
const tokenize = (program) => tokenizeRange(program.split(/\r\n|\r|\n/), 0, Infinity, PLACE.out);

// Lines [from, to) from a known fence place. The place travels WITH the coordinates:
//   lines — the records a full pass would produce for this range, unchanged
//   marks — the place at the FIRST record of each line (a restart coordinate)
//   end   — the place after the last consumed line, for the next range
export function tokenizeRange(rawLines, from, to, state) {
    const n = Math.min(to, rawLines.length);
    const lines = [];
    const marks = [];
    let place = state;
    let i = from;
    let chunk = null;          // { at, mark, text } while a meadow run is open
    let cellOpen = false;      // this cell has had a line processed since its opener

    // The mark is read BEFORE the unit is shaped: a unit carrying the clearing's
    // open mark still starts OUTSIDE it, and a restart there must re-mark it.
    const emit = (rec, at) => { marks.push(at); lines.push(rec); };

    const flush = (endIndex) => {
        if (!chunk) return;
        emit({ meadow: chunk.text.join('\n'), meadowOpen: chunk.mark === PLACE.pending,
               meadowClose: false, line: chunk.at + 1, endLine: endIndex }, chunk.mark);
        chunk = null;
    };

    // Comment off FIRST (trivia is a field, never text), then split a mid-line
    // `end`. The comment rides the LAST record; split parts share a birth line.
    const pushCode = (raw, line, at) => {
        const [code, comment] = splitComment(raw);
        const parts = (code.includes('end') ? code.replace(/\bend\b(?!$)/g, 'end\n') : code)
            .split('\n').map((p) => p.trim()).filter(Boolean);
        const recs = (parts.length ? parts : ['']).map((text) => ({ text, line }));
        if (comment !== undefined) recs[recs.length - 1].comment = comment;
        for (const rec of recs) emit(rec, at);
    };

    while (i < n) {
        const raw = rawLines[i];
        const step = MACHINE[place][symbolOf(lineText(raw))];
        const prev = place;
        place = step.next;
        // The old loop reached its cell branch on a LATER turn, so a cell whose
        // opener is the range's last line never closes. This remembers the turn.
        if (step.role === ROLE.cellOpen) cellOpen = false;
        else if (prev === PLACE.cell) cellOpen = true;

        switch (step.role) {
            case ROLE.meadowOpen:
                break;                                  // the opener is not a unit

            case ROLE.meadowClose:
                flush(i);
                if (prev === PLACE.cell) {
                    // The `###` took the cell with it: an IMPLICIT closer stamped on
                    // the last body line, silent in the printer (id:pa-ghc-exactprint).
                    emit({ cellFence: true, meadowOpen: false, meadowClose: false,
                           line: i, implicit: true }, prev);
                } else if (prev === PLACE.pending) {
                    // An empty clearing. Adjacent fences, so the closer's 0-based
                    // index IS the opener's line — one coordinate a resume recovers
                    // without being told where the clearing began.
                    emit({ meadow: '', meadowOpen: true, meadowClose: false, line: i }, PLACE.out);
                }
                if (lines.length) lines[lines.length - 1].meadowClose = true;
                break;

            case ROLE.cellOpen: {
                // The info word (```paperlang) is the child's, so it rides in the
                // tree — fidelity lives there, never beside it.
                flush(i);
                const info = lineText(raw).replace(CELL_OPEN, '').trim();
                emit({ cellFence: true, meadowOpen: prev === PLACE.pending, meadowClose: false,
                       line: i + 1, info: info || undefined }, prev);
                break;
            }

            case ROLE.cellClose:
                flush(i);
                emit({ cellFence: true, meadowOpen: false, meadowClose: false, line: i + 1 }, prev);
                break;

            case ROLE.prose:
            case ROLE.headline:
                if (!chunk) chunk = { at: i, mark: prev, text: [] };
                chunk.text.push(raw);
                break;

            case ROLE.code:
                if (prev === PLACE.cell) {
                    // Blanks included: a blank is a line the child typed, and
                    // dropping it shifts every line address below (D021).
                    pushCode(raw, i + 1, prev);
                } else {
                    // Outside is trimmed BEFORE the comment parts, so the author's
                    // whitespace after `#` is theirs — a semantic trim, not cosmetic.
                    const trimmed = raw.trim();
                    if (trimmed) pushCode(trimmed, i + 1, prev);
                    else emit({ text: '', line: i + 1, blank: true }, prev);
                }
                break;
        }
        i++;
    }

    // A clearing that ran to EOF was closed by the parse, not the child — so the
    // printer stays silent about that fence too. Only at real EOF: a truncated
    // range stops mid-place and says so in `end`.
    flush(n);
    if (n < rawLines.length) return { lines, marks, end: place };

    // A cell that opened on the range's LAST line is never closed: the old loop
    // needed another turn to reach its branch. Preserved until the repair lands.
    if (place === PLACE.cell && cellOpen) {
        emit({ cellFence: true, meadowOpen: false, meadowClose: false, line: n, implicit: true },
             PLACE.cell);
        place = PLACE.meadow;
    }
    if (place === PLACE.pending) {
        emit({ meadow: '', meadowOpen: true, meadowClose: false, line: n }, PLACE.out);
        place = PLACE.meadow;
    }
    if (place !== PLACE.out && lines.length) {
        lines[lines.length - 1].meadowClose = true;
        lines[lines.length - 1].meadowCloseImplicit = true;
    }
    return { lines, marks, end: place };
}

// The place at the START of `line` (1-based), folded from the same table. The
// obligation is IN the place, so a restart needs no hint from the tree — and the
// fold reads the text, never a parallel index (id:gw-grammar). State changes only
// BETWEEN lines, never within one, which is why a restart is always at a boundary.
export function stateAt(rawLines, line) {
    let place = PLACE.out;
    const n = Math.min(rawLines.length, Math.max(0, line - 1));
    for (let i = 0; i < n; i++) place = MACHINE[place][symbolOf(lineText(rawLines[i]))].next;
    return place;
}

// ============================================================================
// THE CHUNKS — a line → tokens, groups and quotes kept whole (id:gw-grammar)
// ============================================================================

function tokenizeLine(code) {
    // The comment was already split off at line birth — this sees pure code.
    if (!code) return [];

    const tokens = [];
    const len = code.length;
    let start = 0;
    let i = 0;
    // A stack of pending closers: brackets nest, and a quote closes only with its
    // own kind — a `)` inside a string is not a structural close. One quote or group
    // is one chunk, so its interior whitespace never separates arguments.
    // (id:gw-grammar)
    const stack = [];
    while (i < len) {
        const ch = code[i];
        if (stack.length === 0) {
            if (ch === ' ' || ch === '\t') {
                if (i > start) tokens.push(code.slice(start, i));
                start = i + 1;
                i++;
                continue;
            }
            const closer = CLOSERS[ch];
            if (closer) stack.push(closer);
            i++;
        } else {
            const closer = stack[stack.length - 1];
            if (ch === closer) {
                stack.pop();
            } else if (CLOSERS[ch] && closer !== '"' && closer !== "'") {
                // Inside brackets a nested group or quote opens; inside a quote nothing nests.
                stack.push(CLOSERS[ch]);
            }
            i++;
        }
    }
    if (i > start) tokens.push(code.slice(start, i));
    return tokens;
}

// ============================================================================
// ARGUMENTS — a chunk's boundary read from the lexer, not its spelling (id:gw-grammar)
// ============================================================================

// A chunk is classified by the ROLE of its boundary token, read from the shared
// lexer — not by its spelling. The lexer knows which operators can stand
// prefix; the boundary just asks it. (id:gw-grammar)
const chunkLexer = new Lexer()
function chunkTokens(chunk) {
    try { return chunkLexer.tokenize(chunk) } catch { return null }  // unsupported ink: an opaque operand
}
// Bridges the gap BEFORE the chunk when its first token is an operator in INFIX
// position. A `+`/`-` followed by an operand is a prefix SIGN, not a bridge:
// `goto 1 -2`, `1 -(2)` and `1 -pi` are each two coordinates.
function startsWithOperator(chunk) {
    const toks = chunkTokens(chunk)
    if (!toks || toks.length === 0 || toks[0].type !== 'OPERATOR') return false
    if (toks.length > 1 && getOperator(toks[0].value, 'prefix')) return false
    return true
}
// Bridges the gap AFTER the chunk when its last token is an operator that still
// wants a right operand (`2+`).
function endsWithOperator(chunk) {
    const toks = chunkTokens(chunk)
    if (!toks || toks.length === 0) return false
    return toks[toks.length - 1].type === 'OPERATOR'
}

// A gap bridges only where an operator binds across it. The SCOPE of the boundary
// rule is a command line: outside an explicit expression region, whitespace separates
// command arguments; inside one (a group `(...)`/`[...]`, a quote, or a whole
// expression), the expression grammar owns whitespace.
//   · `fw sin (20)`  → `sin` and `(20)` are two arguments (one is surplus, refused)
//   · `fw (sin (20))` → one region, so the expression grammar reads the call
//   · a bare `sin (20)` → a whole expression, so also a call
// Application is glued at the boundary; it is not "not a call anywhere". (id:gw-grammar)
function bridgesAcross(left, right) {
    return endsWithOperator(left) || startsWithOperator(right)
}

// ONE boundary rule for every route: whitespace separates arguments, EXCEPT where
// an operator (or application) binds across the gap. The argument's text is the
// ORIGINAL source span, so internal spacing — and every diagnostic offset — is
// preserved. (id:gw-grammar)
function parseArguments(chunks, source) {
    const args = []
    let cursor = 0
    const locate = (text) => {
        if (source == null) return -1
        const at = source.indexOf(text, cursor)
        if (at >= 0) cursor = at + text.length
        return at
    }
    let i = 0
    while (i < chunks.length) {
        const runStart = i
        const startAt = locate(chunks[i])
        let endAt = startAt < 0 ? -1 : startAt + chunks[i].length
        while (i + 1 < chunks.length && bridgesAcross(chunks[i], chunks[i + 1])) {
            i++
            const at = locate(chunks[i])
            if (at >= 0) endAt = at + chunks[i].length
        }
        const value = startAt >= 0 ? source.slice(startAt, endAt) : chunks.slice(runStart, i + 1).join(' ')
        const node = new ASTNode('Argument', value)
        args.push(node)
        i++
    }
    return args
}

// The shared command-argument reader, exposed for a caller that must read an argument
// list from source it holds — a held figure's invocation. Same contract as a command
// line, so holding a construction cannot re-read its arguments. It is NOT a second
// grammar: the math parser still owns binding inside an expression. (id:gw-grammar)
export function readArguments(source) {
    return parseArguments(tokenizeLine(source), source).map((node) => node.value)
}

// A block's body, up to its `end`. On EOF without one the caller wraps the
// block in an error node — children ride INSIDE it, never reparented to run (D020).
function parseBlock(state, kind = null) {
    // Which body are we inside? A declaration is supported in a source body and
    // in an `as` body, refused in a loop, conditional or function body.
    // (id:laws-decl-batch)
    const prevKind = state.blockKind ?? null
    state.blockKind = kind
    try { return parseBlockLines(state) } finally { state.blockKind = prevKind }
}

function parseBlockLines(state) {
    const block = [];

    while (state.hasMore()) {
        const line = state.next();

        if (line.meadow !== undefined) { block.push(meadowNode(line)); continue; }
        // A CELL FENCE IS A BOUNDARY NO BLOCK MAY CROSS (id:cmp-resilient): swallowing
        // one let an unterminated block absorb the next cell's fences, so the source
        // said two cells and the runnable partition said one.
        if (line.cellFence) { state.pos--; break; }

        const tokens = tokenizeLine(line.text);
        const comment = line.comment;

        // `end # done` rides home ON the block as endComment, never onto a
        // phantom line below it.
        if (tokens.length === 1 && tokens[0] === END) {
            return { block, terminated: true, endComment: comment };
        }

        if (tokens.length === 0) {
            const node = stamp(new ASTNode('Empty', ''), line);
            attachComment(node, comment);
            block.push(node);
            continue;
        }

        const node = parseStatement(tokens, state, line);
        attachComment(node, comment);
        block.push(node);
    }

    return { block, terminated: false };
}


// Total (id:cmp-resilient): a malformed statement becomes an error node in
// place, and the healthy statements around it still parse and run (D020).


// One shared expression reader. It answers ONE question — does this ink parse? — so a
// malformed right-hand side is a located error in place and the healthy statements
// around it still run (D020), never a runtime surprise. It does NOT read the
// expression's KIND: that is the value's business, at the walk.
// (id:notation-coordinate-vector, id:cmp-resilient)
const syntaxReader = new ExprParser()
const parses = (expr) => {
    try { return syntaxReader.parse(expr, { skipValidation: true }) !== null } catch { return false }
}
// A bracketed form is a QUANTITY literal — `(…)` a point, `[…]` a vector. That is a
// grammar fact, so the parser validates it here. Everything else is the executor's
// reader (quotes, figures, dotted names), and is not this one's to judge.
const listed = (expr) => expr[0] === '[' || expr[0] === '('

// The assignment delimiter is outside every group/quote. (id:laws-free-relations-f1)
function declarationEquals(source) {
    const stack = []
    for (let i = 0; i < source.length; i++) {
        const ch = source[i], closer = stack.at(-1)
        if (ch === '=' && stack.length === 0) return i
        if (ch === closer) stack.pop()
        else if (CLOSERS[ch] && closer !== '"' && closer !== "'") stack.push(CLOSERS[ch])
    }
    return -1
}

// A binder is a plain name OR one quoted word — the spelling `let "part[count]"`
// already uses. The word's VALUE is read at its reach by the one name seam; the
// parser only says whether a name was written. (id:laws-names)
const QUOTED_WORD = /^(?:'[^']*'|"[^"]*")$/
const names = (lhs) => /^[A-Za-z_][\w-]*$/.test(lhs) || QUOTED_WORD.test(lhs)

function parseStatement(tokens, state, rec) {
    const kw = tokens[0];
    const len = tokens.length;

    // A name identifies a slot in its declaring scope; repetition revisits it.
    // Distinct names/scopes construct distinct things. (id:laws-generative-experiments)
    if (kw === 'let') {
        if (len < 2) return errorNode(rec, "a name after 'let'", 'end of statement')
        // `let A` — existence. `let A.distance = 5` (or glued) — a dotted relation.
        // The declaring frame is the observer; the address matches the function
        // spelling. (id:laws-ordered-replacement)
        const source = tokens.slice(1).join(' ')
        const eqAt = declarationEquals(source)
        const lhs = (eqAt < 0 ? source : source.slice(0, eqAt)).trim()
        let expr = eqAt < 0 ? null : source.slice(eqAt + 1).trim()
        const named = /^(distance|length)\s*\(/.exec(lhs)?.[1]
        if (named || /\bdistance\s*\(/.test(lhs) && lhs.startsWith('(')) {
            let head
            try { head = syntaxReader.parse(lhs, { skipValidation: true }) } catch {}
            // A distance subject is a live name, `origin`, a coordinate literal `(x,y)`,
            // or a vector literal `[x,y]`. A coordinate is an absolute point in the
            // declaring placement; a vector is a displacement from the declaring frame's
            // live head. (id:laws-distance-literal-address)
            const coordOf = (c) => {
                // Optionally signed — a unary operator on a literal only, never an
                // arbitrary expression. Negative zero normalizes to zero.
                if (c.type === 'literal' && Number.isFinite(c.value)) return c.value
                if (c.type === 'unary_operator' && (c.value === '-' || c.value === '+') &&
                    c.children.length === 1 && c.children[0].type === 'literal' &&
                    Number.isFinite(c.children[0].value)) {
                    const v = c.value === '-' ? -c.children[0].value : c.children[0].value
                    return v === 0 ? 0 : v
                }
                return null
            }
            const tupleOf = (n) => {
                const coords = n.children.map(coordOf)
                if (coords.some((c) => c === null)) return null
                if (coords.length === 2) return [coords[0], coords[1], 0]
                return coords.length === 3 ? coords : null
            }
            const subjectOf = (n) => {
                if (n.type === 'string') return JSON.stringify(n.value)
                if (n.type === 'operand') {
                    if (n.value === 'origin') return { framed: [0, 0, 0] }
                    return /^[A-Za-z_][\w-]*$/.test(n.value) ? n.value : null
                }
                if (n.type === 'point') { const t = tupleOf(n); return t ? { framed: t } : null }
                if (n.type === 'vector') { const t = tupleOf(n); return t ? { relative: t } : null }
                return null
            }
            const spanSum = head?.type === 'operator' && head.value === '+'
            const terms = (n) => n.type === 'operator' && n.value === '+' ? n.children.flatMap(terms) : [n]
            const distancePair = (n) => n.type === 'function' && n.value === 'distance' && n.children.length === 2
            const spans = spanSum ? terms(head) : null
            const route = head?.type === 'function' && head.value === 'length'
            const subjects = spanSum
                ? (spans.every(distancePair) ? spans.flatMap((span) => span.children.map(subjectOf)) : null)
                : (head && (route ? head.children.length >= 2 : distancePair(head)) ? head.children.map(subjectOf) : null)
            if (!subjects || subjects.some((s) => s == null)) {
                return errorNode(rec, 'distance(point, point), a sum of distances, or length(point, point, …)', lhs)
            }
            if (!expr || !parses(expr)) return errorNode(rec, route || spanSum ? 'a length expression after =' : 'a radius expression after =', expr ?? 'end of statement')
            return stamp(new ASTNode('Law', route || spanSum ? 'length' : 'distance', [], {
                subjects, expr, ...(spanSum ? { spanSum: true } : {}),
            }), rec)
        }
        if (eqAt < 0 && tokens.length > 2) return errorNode(rec, "'=' after a name", tokens[2])
        if (expr === null) return stamp(new ASTNode('Existence', lhs), rec)
        if (!expr) return errorNode(rec, 'a value after =', 'end of statement')
        // `origin` is this frame's zero in a declaration RHS — not a tower name, and
        // not a value. The declaring frame supplies the world location.
        // (id:notation-coordinate-vector)
        if (expr === 'origin') expr = '(0, 0, 0)'
        const affineLhs = lhs.includes('.position') && !/^[A-Za-z_][\w-]*\.position$/.test(lhs)
            || lhs.startsWith('[') && expr.includes('.position')
        if (!names(lhs) && affineLhs) {
            let affine
            try {
                const read = (text) => syntaxReader.parse(text, { skipValidation: true })
                affine = affineSyntax(read(lhs), read(expr))
            } catch {}
            if (!affine) return errorNode(rec, 'an affine equality between points or between displacements', lhs)
            return stamp(new ASTNode('Law', 'affine', [], { ...affine, lhs, expr }), rec)
        }
        const dot = lhs.indexOf('.')
        if (dot > 0) {
            const target = lhs.slice(0, dot)
            const property = lhs.slice(dot + 1)
            const parsed = parseProperty(property)
            if (parsed) {
                return stamp(new ASTNode('Law', parsed.feature, [], { target, expr, ...parsed }), rec)
            }
            return errorNode(rec, parseSupport(), lhs)
        }
        // ONE declaration, ONE reading: `let NAME = <expr>`. The parser does not read
        // the expression to learn its KIND — what the VALUE is decides what the name
        // is: a point is a place, a vector an object and a value, anything else a
        // derived value. The walk that reads it knows. (id:notation-coordinate-vector)
        //
        // Other function-looking binders are not declarations; a quoted word IS a
        // name, read at its reach by the same seam. (id:laws-names)
        if (!names(lhs)) {
            return errorNode(rec, "a name after 'let'", lhs)
        }
        if (listed(expr) && !parses(expr)) {
            return errorNode(rec, 'a quantity — (…) a coordinate or […] a vector', expr)
        }
        return stamp(new ASTNode('Declaration', lhs, [], { expr }), rec)
    }


    // Most common case first: commands
    if (!BLOCK_KW[kw]) {
        return stamp(new ASTNode('Call', kw, parseArguments(tokens.slice(1), rec.text)), rec);
    }

    // Block constructs - validate the head BEFORE opening a block: a broken
    // head is a one-line error node; no body is consumed on its behalf.
    const last = tokens[len - 1];
    if (last !== DO) {
        return errorNode(rec, `'do' to open '${kw}'`, last);
    }

    // The head is sound — walk the body, then close or contain.
    const blockNode = (make) => {
        const { block, terminated, endComment } = parseBlock(state, kw);
        // The last record's FAR edge: a folded meadow spans several birth
        // lines; containment reaches its endLine, not its opening line.
        const endLine = state.last?.endLine ?? state.last?.line ?? rec.line;
        if (!terminated) {
            const err = errorNode(rec, `'end' to close '${kw}'`, 'end of program', block);
            err.span.endLine = endLine;
            return err;
        }
        const node = stamp(make(block), rec, endLine);
        // The `end`-line comment; the head's is attached by the caller.
        if (endComment != null) node.assign_meta('endComment', endComment);
        return node;
    };

    // `until` reads a condition, except for the swept `touch(path)` head.
    // Validate before consuming a body. (id:gw-grammar, id:touch-generative-centers)
    if (kw === 'for' || kw === 'loop') {
        const head = tokens.slice(1, len - 1)
        if (head[0] === 'until') {
            const expr = head.slice(1).join(' ')
            const [first, group, ...tail] = head.slice(1)
            if (first?.startsWith('touch(') || (first === 'touch' && group?.startsWith('('))) {
                const call = first === 'touch' && !tail.length ? `touch${group}` : expr
                const inner = /^touch\((.*)\)$/.exec(call)?.[1].trim()
                if (!inner || !parses(inner) || tokenizeLine(call).length !== 1) {
                    return errorNode(rec, "one balanced touch(<a path>) after 'until'", expr || DO)
                }
                return blockNode((block) => new ASTNode('Loop', '', block, { touch: inner }))
            }
            if (!parses(expr)) return errorNode(rec, "a condition after 'until'", expr || DO)
            return blockNode((block) => new ASTNode('Loop', '', block, { until: expr }))
        }
        // A count is what a bounded loop asks for; an omitted one is the unbounded loop,
        // closed by the body's own `stop`. `for` keeps its count: it never reads as
        // "forever". (id:gw-grammar)
        if (kw === 'loop' && head.length === 0) {
            return blockNode((block) => new ASTNode('Loop', '', block))
        }
        if (head.length !== 1) return errorNode(rec, `one count after '${kw}'`, head.join(' ') || DO)
        return blockNode((block) => new ASTNode('Loop', head[0], block));
    }

    // Function def: def/draw <name> [args...] do
    if (kw === 'def' || kw === 'draw') {
        if (len < 3) return errorNode(rec, `a name after '${kw}'`, DO);

        const name = tokens[1];
        const argTokens = tokens.slice(2, len - 1);
        const args = argTokens.map(arg => new ASTNode('Argument', arg));

        return blockNode((block) => new ASTNode('Define', name, block, { args }));
    }

    // When: when <expr> do  OR  when 'eventname' [binding] do
    if (kw === 'when') {
        if (len < 3) return errorNode(rec, "a condition or event after 'when'", DO);
        const firstToken = tokens[1]
        const isEvent = /^['"]/.test(firstToken)

        if (isEvent) {
            // Event mode: when 'name' [binding] do
            const meta = { event: true }
            if (len > 3) meta.binding = tokens[2]
            return blockNode((block) => new ASTNode('When', firstToken, block, meta))
        } else {
            // Conditional mode: join all tokens between 'when' and 'do'
            const expr = tokens.slice(1, len - 1).join(' ')
            return blockNode((block) => new ASTNode('When', expr, block))
        }
    }


    // Ambient: as <name> [<frame>] do ... end
    if (kw === 'as') {
        if (len < 3) return errorNode(rec, "an assistant name after 'as'", DO);
        const meta = {}
        if (len > 3) meta.frame = tokens[2]
        return blockNode((block) => new ASTNode('Ambient', tokens[1], block, meta));
    }

    // Unreachable while BLOCK_KW lists exactly the five above — kept total
    // against drift: an unhandled block keyword rests as one line, loudly.
    return errorNode(rec, 'a known block keyword', kw);
}


// print ast fn

// The printer's inverse of the distance-subject reader: a live name, a framed point
// `(x,y,z)`, or a relative vector `[x,y,z]`. (id:laws-distance-literal-address)
const spellSubject = (s) => typeof s === 'string' ? s
    : Array.isArray(s?.framed) ? `(${s.framed.join(', ')})`
        : Array.isArray(s?.relative) ? `[${s.relative.join(', ')}]`
            : String(s)
export function printAST(ast) {
    const out = [];
    
    function visit(node, depth) {
        const indent = depth ? '  '.repeat(depth) : '';
        // Trivia emit — the one path (id:pa-ghc-exactprint). A comment rides
        // ` #` + its verbatim run (author whitespace included); `!= null` so an
        // empty `#` survives. `margin` sits on the node's own/opening line,
        // `endMargin` on a block's `end`.
        const trail = (c) => (c != null ? ` #${c}` : '');
        const margin = trail(node.meta.comment);
        const endMargin = trail(node.meta.endComment);

        switch (node.type) {
            case 'Call': {
                const children = node.children;
                const len = children.length;

                if (len === 0) {
                    out.push(indent + node.value + margin);
                } else {
                    let args = children[0].value;
                    for (let i = 1; i < len; i++) {
                        args += ' ' + children[i].value;
                    }
                    out.push(indent + node.value + ' ' + args + margin);
                }
                break;
            }
            
            case 'Argument':
                return node.value;
            
            case 'Empty':
                if (node.meta.cellFence) {
                    // An implicit closer was never typed, so it is not emitted.
                    // Its ### edge still rides — that the child did type.
                    if (node.meta.meadowOpen) out.push(indent + MEADOW_MARK);
                    if (!node.meta.implicit) out.push(indent + CELL_MARK + (node.meta.info ?? ''));
                    if (node.meta.meadowClose && !node.meta.meadowCloseImplicit) out.push(indent + MEADOW_MARK);
                } else if (node.meta.meadow) {
                    // An interior chunk with `lit === ""` is one blank line, not
                    // nothing — hence the null check, not truthiness.
                    const interior = node.meta.meadowOpen === false && node.meta.meadowClose === false;
                    if (node.meta.meadowOpen !== false) out.push(indent + MEADOW_MARK);
                    if (node.meta.lit || (interior && node.meta.lit != null)) out.push(node.meta.lit);
                    if (node.meta.meadowClose !== false && !node.meta.meadowCloseImplicit) out.push(indent + MEADOW_MARK);
                } else if (node.meta.comment != null) {
                    // No code before it, so no leading space — that prefix
                    // belongs to a margin trailing code.
                    out.push(indent + '#' + node.meta.comment);
                } else {
                    out.push(indent);
                }
                break;
            
            case 'Loop': {
                // The head prints as the author's own kind of head: a fact, a count, or
                // nothing — the inverse of the reader above. (id:pa-ghc-exactprint)
                const head = node.meta?.touch != null ? ` until touch(${node.meta.touch})`
                    : node.meta?.until != null ? ` until ${node.meta.until}`
                    : node.value ? ` ${node.value}` : ''
                out.push(`${indent}loop${head} do${margin}`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END + endMargin);
                break;
            }

            case 'When': {
                const binding = node.meta?.binding ? ` ${node.meta.binding}` : ''
                out.push(`${indent}when ${node.value}${binding} do${margin}`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END + endMargin);
                break;
            }
            
            case 'Define': {
                const args = node.meta.args || [];
                const len = args.length;
                let argStr = '';

                if (len > 0) {
                    argStr = args[0].value;
                    for (let i = 1; i < len; i++) {
                        argStr += ' ' + args[i].value;
                    }
                    argStr = ' ' + argStr;
                }

                out.push(`${indent}def ${node.value}${argStr} do${margin}`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END + endMargin);
                break;
            }

            case 'Ambient': {
                const mod = node.meta?.frame ? ` ${node.meta.frame}` : ''
                out.push(`${indent}as ${node.value}${mod} do${margin}`)
                node.children.forEach(c => visit(c, depth + 1))
                out.push(indent + END + endMargin)
                break
            }

            case 'Existence':
                // A bare `let NAME` — a place, seeded at its reach. (id:laws-ordered-birth)
                out.push(`${indent}let ${node.value}${margin}`)
                break

            case 'Declaration':
                out.push(`${indent}let ${node.value}=${node.meta.expr}${margin}`)
                break

            case 'Law': {
                // `feature(subjects) = e` or `target.property = e`. The authored
                // spelling comes from the row, never a local feature list. (D058)
                const subjects = node.meta.subjects
                if (node.meta.lhs) {
                    out.push(`${indent}let ${node.meta.lhs} = ${node.meta.expr}${margin}`)
                } else if (subjects) {
                    const args = subjects.map(spellSubject)
                    const lhs = node.meta.spanSum ? args.flatMap((a, i) => i % 2 ? [] : [`distance(${a}, ${args[i + 1]})`]).join(' + ')
                        : `${node.value}(${args.join(', ')})`
                    out.push(`${indent}let ${lhs}=${node.meta.expr}${margin}`)
                } else {
                    out.push(`${indent}let ${node.meta.target}.${propertyOf(node.value, node.meta.axis)}=${node.meta.expr}${margin}`)
                }
                break
            }

            case 'Error': {
                // The child's line verbatim (D020): the round-trip never
                // invents an `end`, and never loses the brokenness.
                out.push(indent + node.value + margin)
                node.children.forEach(c => visit(c, depth + 1))
                break
            }
        }
    }
    
    ast.forEach(node => visit(node, 0));
    return out.join('\n');
}

// ============================================================================
// THE OUTLINE — one walk over lines, the whole shape of a page
// ============================================================================
// Prose geometry has ONE walk; every reader below is a view over it. A second
// walker means two answers to "does ### close a cell". It takes lines, not a
// tree — a line is the one thing both sides already have. Fence predicates
// come from THE GRAMMAR above — never re-spelled here.

// A headline of depth d closes every phase at that depth or deeper. `idx` is its
// ORDER among its siblings, kept on the parent so a pop cannot lose the count:
// titles are prose and change freely, so only order enters a coordinate (D024).
function openPhase(stack, depth, title, root) {
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1] ?? root;
    parent.kids += 1;
    // `kids` and `cells` start at zero: a section parents the headlines below it
    // and homes its own cells, both counted from one.
    stack.push({ depth, title, idx: parent.kids, kids: 0, cells: 0 });
    return stack.map((s) => s.title);
}

// GEOMETRY — a fold over the scan (id:gw-grammar). → { meadows, cells, phases },
// all fence-inclusive spans in document order. Reads roles, never the text: the
// fences were already named once, in `classify`.
export function outline(lines) {
    const meadows = [], cells = [], phases = [];
    const stack = [];
    // The preamble is a section too — cells above every headline live here, and
    // their coordinate is one segment long.
    const root = { kids: 0, cells: 0 };
    let inMeadow = false, mOpen = 0, open = 0, path = [], name = null, coord = [];
    const shut = (end, terminated) => cells.push({ open, end, terminated, path, name, coord });

    const rows = classify(lines);
    for (const row of rows) {
        switch (row.role) {
            case ROLE.meadowOpen:
                mOpen = row.line; inMeadow = true;
                break;
            case ROLE.meadowClose:
                // The clearing took the cell with it — the body's last line stands.
                if (row.closesCell) { shut(row.line - 1, false); open = 0; }
                meadows.push({ open: mOpen, end: row.line }); inMeadow = false;
                break;
            case ROLE.cellOpen: {
                open = row.line;
                path = stack.map((s) => s.title);
                // THE CELL WEARS ITS NAME (D024). The word on the fence is the
                // author's and is the cell's identity. Unnamed, it is named by WHERE
                // IT SITS: the section chain, then its order among its own section's
                // cells — which every cell takes, so naming a sister never re-keys
                // the others.
                name = row.info;
                const section = stack[stack.length - 1] ?? root;
                section.cells += 1;
                coord = [...stack.map((s) => s.idx), section.cells];
                break;
            }
            case ROLE.cellClose:
                shut(row.line, true); open = 0;
                break;
            case ROLE.headline:
                phases.push({ line: row.line, depth: row.depth, title: row.title,
                              path: openPhase(stack, row.depth, row.title, root) });
                break;
            // prose and code carry no geometry.
        }
    }

    // Whatever ran to EOF was closed by the parse, not the child.
    const n = rows.length;
    if (open) shut(n, false);
    if (open || inMeadow) meadows.push({ open: mOpen, end: n });
    return { meadows, cells, phases };
}

// D019'S ONE EDGE, and it is read BOTH ways. An EARLIER cell of an ANCESTOR
// phase is vocabulary for a later one — vocabulary flows down the outline, never
// sideways. `phaseCells` walks it FORWARD to build a cell's vocabulary; the
// diagnostics query walks it BACKWARD to name who a dead cell takes with it.
// One predicate, so the two can never disagree about who depends on whom.
export const feedsVocabulary = (sourcePath, targetPath) =>
    sourcePath.length < targetPath.length && sourcePath.every((t, i) => t === targetPath[i]);

// Every LATER cell that inherits a dead cell's vocabulary — compromised
// whether or not it has run, since the page seats lazily and would otherwise
// learn the death only on reach. (D019 vocabulary edge)
export const dependentsOf = (cells, i) => {
    const out = [];
    for (let k = i + 1; k < (cells?.length ?? 0); k++) {
        if (feedsVocabulary(cells[i].path, cells[k].path)) out.push(k);
    }
    return out;
};

// Address grammar lives in address.js — re-exported so existing callers keep
// one import while `#` is spelled in exactly one place.
export { cellKey } from "./address.js";

// The one print→outline of an AST. phaseCells and phaseAt share it so a
// diagnostics pass never reprints the tree per wound.
export function outlineFromAst(ast) {
    return outline(splitLines(printAST(ast ?? [])));
}

// A weave page's cells, DERIVED from the one AST — never ferried, never stored
// twice; works on JSON-thawed nodes because this seam may cross a socket.
// → [{ code, vocab, nodes, vocabNodes, open, end, path, name, coord }]; nodes are
// LIVE slices, so identity flows through the partition instead of crossing as text.
// Optional `marks` reuses a prior outlineFromAst (or outline of printed lines).
export function phaseCells(ast, marks) {
    const nodes = ast ?? [];
    // The one walk, over this tree's own printed form — unless the caller
    // already paid for it.
    const cellMarks = (marks ?? outlineFromAst(nodes)).cells;
    const cells = [];
    let cur = null;
    const closeCell = (body) => {
        const mark = cellMarks[cells.length] ?? {};
        const path = mark.path ?? [];
        // The edge, walked forward. `cells` holds only the cells already closed,
        // so "earlier in document order" is the loop's own shape.
        const vocabNodes = cells.filter((c) => feedsVocabulary(c.path, path))
                                .flatMap((c) => c.nodes);
        cells.push({
            code: printAST(body),
            vocab: vocabNodes.length ? printAST(vocabNodes) : null,
            nodes: body,
            vocabNodes: vocabNodes.length ? vocabNodes : null,
            // Fence lines, not node spans (D021): an empty cell has no nodes,
            // but a child who just opened one must still be addressable.
            open: mark.open ?? null,
            end: mark.end ?? null,
            // The headline path, root first. Sisters share it.
            path,
            // Identity (D024): the author's word, or the place standing in for
            // one. Carried, never joined — the key is the law's to spell.
            name: mark.name ?? null,
            coord: mark.coord ?? [],
        });
    };
    for (const node of nodes) {
        if (node?.meta?.cellFence) {
            if (cur) { closeCell(cur); cur = null; }
            else cur = [];
            continue;
        }
        if (cur) cur.push(node);
    }
    if (cur) closeCell(cur);             // unterminated cell — auto-closed
    return cells;
}

// D024: id = section chain + name (else sisters' order). Same name twice in
// one section collides — first keeps it, rest fall back to ordinal. A
// place-shaped name (`1.2`) is refused: it would alias the cell truly there.
const PLACE_LIKE = /^\d+(\.\d+)*$/;

export function cellIdentities(cells) {
    const taken = new Set();
    return (cells ?? []).map(({ name, coord }) => {
        const chain = (coord ?? []).slice(0, -1);        // the section it sits in
        const place = (coord ?? []).join('.');           // …and her order in it
        const refuse = (why) => ({ id: place, name: null, named: false, collides: true, why });
        if (!name) return { id: place, name: null, named: false, collides: false, why: null };
        if (PLACE_LIKE.test(name)) return refuse('place');
        const id = [...chain, name].join('.');
        if (taken.has(id)) return refuse('duplicate');
        taken.add(id);
        return { id, name, named: true, collides: false, why: null };
    });
}

// ============================================================================
// THE PHASE — attention is the address (D021)
// ============================================================================
// One datum names where a peer is: a LINE. Everything else is derived on
// demand, so no stored phase can go stale. A line is total (prose has one too)
// and local (an edit shifts only what is below); a cell ordinal is neither.

// The headline path enclosing `line`, root first; `[]` in a preamble.
// Inclusive — standing ON `** phase B` is standing IN phase B.
// Optional `marks` reuses a prior outlineFromAst so N wounds cost one print.
export function phaseAt(ast, line, marks) {
    const { phases } = marks ?? outlineFromAst(ast);
    let here = [];
    for (const s of phases) {
        if (s.line > (line ?? 0)) break;
        here = s.path;
    }
    return here;
}

// The index of the cell whose FENCES enclose `line`, or null — so a cell just
// opened and not yet written in is found like any other.
export function cellAtLine(cells, line) {
    for (let i = 0; i < (cells?.length ?? 0); i++) {
        const c = cells[i];
        if (c.open == null) continue;
        if (line >= c.open && line <= (c.end ?? Infinity)) return i;
    }
    return null;
}

// Printed lines per node, by the one printer, so the count cannot drift.
const printedHeight = (node) => printAST([node]).split('\n').length;

// NOT WIRED: a distant cell loses its body, seating EMPTY CODE and wiping its
// figure — blocked until "dormant" means NOT SEATED. Attention crosses as a
// coordinate instead (D025 R1); kept nodes are the SAME objects, never copies.
export function reflectPhase(ast, attend) {
    if (!ast || !attend || attend.line == null) return { commands: ast, attend: null };

    const here = phaseAt(ast, attend.line);
    const samePath = (p) => p.length === here.length && p.every((t, i) => t === here[i]);

    // The body nodes to shed — every cell outside the inhabited phase.
    const shed = new Set();
    for (const cell of phaseCells(ast)) {
        if (samePath(cell.path)) continue;
        for (const node of cell.nodes) shed.add(node);
    }
    if (!shed.size) return { commands: ast, attend: { ...attend } };

    // One walk: keep what rides, and count the printed lines shed ABOVE the
    // attention so its coordinate lands on the same text in the projection.
    // The caret is never inside a shed body — the cell it sits in IS the live
    // phase — so there is no clamping and no lying.
    const commands = [];
    let cursor = 1;          // next printed line in the ORIGINAL
    let dropped = 0;
    for (const node of ast) {
        const height = printedHeight(node);
        if (shed.has(node)) {
            if (cursor + height - 1 < attend.line) dropped += height;
        } else {
            commands.push(node);
        }
        cursor += height;
    }
    const shift = (n) => (n == null ? n : n - dropped);
    return {
        commands,
        attend: { ...attend, line: shift(attend.line), endLine: shift(attend.endLine) },
    };
}

// phaseCells' complement: bare code outside the fences IS the buffer's
// program; cells are previews that run only on reach. Fences stay as
// no-ops so the stripped source still re-parses clean.
export function stripCells(ast) {
    const out = [];
    let inCell = false;
    for (const node of ast ?? []) {
        if (node?.meta?.cellFence) { inCell = !inCell; out.push(node); continue; }
        if (!inCell) out.push(node);
    }
    return out;
}

// Every error node in a tree, in document order — the seed of Phase 2's
// diagnostics query (specs/compiler.org id:cmp-queries). Walks JSON-thawed
// nodes too (plain objects), the same way printAST does. Each answer carries
// the structured birth: span (true lines, never regexed back out of a
// message), expected/found, and kind.
export function collectErrors(ast) {
    const out = [];
    const visit = (node) => {
        if (!node) return;
        if (node.type === 'Error') {
            out.push({
                message: `looking for ${node.meta?.expected ?? 'something'}, found ${node.meta?.found ?? 'something else'}`,
                span: node.span ?? null,
                expected: node.meta?.expected ?? null,
                found: node.meta?.found ?? null,
                kind: node.meta?.kind ?? 'parse',
            });
        }
        (node.children ?? []).forEach(visit);
    };
    (ast ?? []).forEach(visit);
    return out;
}

