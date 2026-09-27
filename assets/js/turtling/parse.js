import { ASTNode } from "./ast.js"


//manage state
class ParserState {
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

export const isMeadowFence = (s) => MEADOW_FENCE.test(s ?? '');
export const isCellOpen = (s) => CELL_OPEN.test(s ?? '');
export const isCellClose = (s) => CELL_CLOSE.test(s ?? '');

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
export const BLOCK_KW = { for: 1, loop: 1, def: 1, draw: 1, when: 1, as: 1 };

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

// Callers that split elsewhere (CM6 hands us its own lines) may still carry a
// stray `\r` — and `###\r` is not a fence to any predicate here.
const lineText = (s) => {
    const t = s ?? '';
    return t.charCodeAt(t.length - 1) === 13 ? t.slice(0, -1) : t;
};

// lines → rows, 1:1 and in document order.
//   { line, text, role } always; `info` on cellOpen (the word on the fence, or
//   null), `depth`/`title` on headline, `closesCell` on a meadowClose that cut a
//   cell short. A headline is prose too — a reader that gathers prose takes it.
// What ran off the end is the FOLD's to close: the tape ending is not a fence.
export function classify(lines) {
    const rows = [];
    const n = lines?.length ?? 0;
    let inMeadow = false, inCell = false;

    for (let i = 0; i < n; i++) {
        const text = lineText(lines[i]);
        const line = i + 1;

        if (inCell) {
            if (CELL_CLOSE.test(text)) {
                inCell = false;
                rows.push({ line, text, role: ROLE.cellClose });
            } else if (MEADOW_FENCE.test(text)) {
                // ``` closes a cell; ### closes it AND the clearing.
                inCell = false; inMeadow = false;
                rows.push({ line, text, role: ROLE.meadowClose, closesCell: true });
            } else {
                rows.push({ line, text, role: ROLE.code });
            }
            continue;
        }

        if (MEADOW_FENCE.test(text)) {
            rows.push({ line, text, role: inMeadow ? ROLE.meadowClose : ROLE.meadowOpen });
            inMeadow = !inMeadow;
            continue;
        }

        if (!inMeadow) { rows.push({ line, text, role: ROLE.code }); continue; }

        if (CELL_OPEN.test(text)) {
            inCell = true;
            rows.push({ line, text, role: ROLE.cellOpen,
                        info: text.replace(CELL_OPEN, '').trim() || null });
            continue;
        }

        const m = HEADLINE.exec(text);
        if (m) rows.push({ line, text, role: ROLE.headline, depth: m[1].length, title: m[2].trim() });
        else rows.push({ line, text, role: ROLE.prose });
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
// Spans + error nodes — the resilient parse (specs/compiler.org id:cmp-resilient)
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

// main parser
export function parseProgram(program) {
    const lines = tokenize(program);
    const state = new ParserState(lines);
    const ast = [];

    while (state.hasMore()) {
        const line = state.next();

        if (line.meadow !== undefined) { ast.push(meadowNode(line)); continue; }
        if (line.cellFence) { ast.push(cellFenceNode(line)); continue; }

        const tokens = tokenizeLine(line.text);
        const comment = line.comment;

        // A stray `end` is an error node, never a phantom Call (D020).
        if (tokens.length === 1 && tokens[0] === END) {
            ast.push(attachComment(errorNode(line, 'an open block to close', `'${END}'`), comment));
            continue;
        }

        if (tokens.length === 0) {
            const node = stamp(new ASTNode('Empty', ''), line);
            attachComment(node, comment);
            ast.push(node);
            continue;
        }

        const node = parseStatement(tokens, state, line);
        attachComment(node, comment);
        ast.push(node);
    }

    return ast;
}

// ============================================================================
// The green tree — identity across reparses (specs/compiler.org id:cmp-green-tree)
// ============================================================================
// Reparse whole, then recover identity by diffing at the top-level unit, so
// unchanged structure stays ===-identical across reparses (id:pa-zig-incremental).

// Same key ⇒ same meaning. Stays COARSE on purpose: drift costs a missed reuse,
// never a wrong tree, because the fresh parse is always the answer.
const OVERLAY = new Set(['span', 'comment', 'endComment', 'lit']);
const contentKey = (node) => JSON.stringify(node, (k, v) => (OVERLAY.has(k) ? undefined : v));

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

// Total: the answer is always the forest the text means; adoption only picks
// which objects carry it, each old node once. (prevText, prevAst) must belong to
// the buffer's OWNER — another's tree would move THEIR span overlay.
export function reparseProgram(text, prevText, prevAst) {
    if (prevText == null || prevAst == null) return parseProgram(text);
    if (prevText === text) return prevAst;

    const fresh = parseProgram(text);

    const pool = new Map();
    for (const node of prevAst) {
        const key = contentKey(node);
        const bucket = pool.get(key);
        if (bucket) bucket.push(node);
        else pool.set(key, [node]);
    }

    return fresh.map((node) => {
        const bucket = pool.get(contentKey(node));
        const prev = bucket?.shift();
        if (!prev) return node;
        adoptOverlay(prev, node);
        return prev;
    });
}


//tokenizer
// Fence-aware line pass. Between `###` fences everything is captured VERBATIM;
// outside them lines are trimmed and a glued `end` is split onto its own line.
function tokenize(program) {
    const rawLines = program.split(/\r\n|\r|\n/);
    const n = rawLines.length;
    const lines = [];
    let i = 0;

    // Comment off FIRST (trivia is a field, never text), then split a mid-line
    // `end`. The comment rides the LAST record; split parts share a birth line.
    const pushCode = (raw, out, line) => {
        const [code, comment] = splitComment(raw);
        const parts = code.replace(/\bend\b(?!$)/g, 'end\n')
            .split('\n').map((p) => p.trim()).filter(Boolean);
        const recs = (parts.length ? parts : ['']).map((text) => ({ text, line }));
        if (comment !== undefined) recs[recs.length - 1].comment = comment;
        for (const rec of recs) out.push(rec);
    };

    while (i < n) {
        if (isMeadowFence(rawLines[i])) {
            // Prose chunks stay verbatim; a ``` fence re-enters code-space
            // (id:gw-cell), so the cell's lines go through the code law.
            const fenceLine = i + 1;
            i++;
            const units = [];
            let chunk = [];
            let chunkStart = 0;
            const flushChunk = () => {
                if (chunk.length) {
                    units.push({ meadow: chunk.join('\n'), meadowOpen: false, meadowClose: false,
                                 line: chunkStart, endLine: chunkStart + chunk.length - 1 });
                    chunk = [];
                }
            };
            while (i < n && !isMeadowFence(rawLines[i])) {
                if (isCellOpen(rawLines[i])) {
                    flushChunk();
                    // The info word (```paperlang) is the child's, so it rides
                    // in the tree — fidelity lives there, never beside it.
                    const info = rawLines[i].replace(CELL_OPEN, '').trim();
                    units.push({ cellFence: true, meadowOpen: false, meadowClose: false,
                                 line: i + 1, info: info || undefined });
                    i++;
                    while (i < n && !isCellClose(rawLines[i]) && !isMeadowFence(rawLines[i])) {
                        // Blanks included: a blank is a line the child typed,
                        // and dropping it shifts every line address below (D021).
                        pushCode(rawLines[i], units, i + 1);
                        i++;
                    }
                    // An auto-close is marked IMPLICIT and the printer stays
                    // silent: never put a word in the child's mouth (id:pa-ghc-exactprint).
                    const closed = i < n && isCellClose(rawLines[i]);
                    if (closed) i++;
                    units.push({ cellFence: true, meadowOpen: false, meadowClose: false,
                                 line: Math.min(i, n), implicit: !closed || undefined });
                    continue;
                }
                if (!chunk.length) chunkStart = i + 1;
                chunk.push(rawLines[i]);
                i++;
            }
            flushChunk();
            if (units.length === 0) units.push({ meadow: '', meadowOpen: false, meadowClose: false, line: fenceLine });
            // A clearing that ran to EOF was closed by the parse, not the
            // child — so the printer stays silent about that fence too.
            const meadowClosed = i < n;
            i++; // consume the closing fence (or step past EOF — auto-close)
            units[0].meadowOpen = true;
            units[units.length - 1].meadowClose = true;
            if (!meadowClosed) units[units.length - 1].meadowCloseImplicit = true;
            lines.push(...units);
            continue;
        }

        // A blank rides through as an empty record: line parity across
        // parse → print, and a bare Enter still changes the seed.
        const trimmed = rawLines[i].trim();
        if (trimmed) pushCode(trimmed, lines, i + 1);
        else lines.push({ text: '', line: i + 1, blank: true });
        i++;
    }

    return lines;
}

// ============================================================================
// Line Tokenizer - Context-Aware preserving groups [  ] and " "
// ============================================================================

function tokenizeLine(code) {
    // The comment was already split off at line birth — this sees pure code.
    if (!code) return [];

    const tokens = [];
    const len = code.length;
    let start = 0;
    let i = 0;
    let inGroup = null;  // Track quote/bracket context
    let depth = 0;       // Track bracket nesting
    
    while (i < len) {
        const ch = code[i];
        
        // Not in a group - check for delimiters and group starts
        if (!inGroup) {
            // Whitespace - token boundary
            if (ch === ' ' || ch === '\t') {
                if (i > start) tokens.push(code.slice(start, i));
                start = i + 1;
                i++;
                continue;
            }
            
            // Check if starting a grouped context
            const closer = CLOSERS[ch];
            if (closer) {
                inGroup = closer;
                if (OPENS_BRACKET[ch]) depth = 1;
            }
            
            i++;
        }
        // In a group - look for closing delimiter
        else {
            // Bracket - track nesting
            if (OPENS_BRACKET[inGroup === ']' ? '[' : inGroup === ')' ? '(' : null]) {
                const opener = inGroup === ']' ? '[' : '(';
                if (ch === opener) {
                    depth++;
                } else if (ch === inGroup) {
                    depth--;
                    if (depth === 0) inGroup = null;
                }
            }
            // Quote - simple close check
            else if (ch === inGroup) {
                inGroup = null;
            }
            
            i++;
        }
    }
    
    // Flush final token
    if (i > start) tokens.push(code.slice(start, i));

    return tokens;
}

// ============================================================================
// Argument Parser - Single Pass 
// ============================================================================

function parseArguments(tokens) {
    const len = tokens.length;
    if (len === 0) return [];
    
    const args = [];
    let bufStart = -1;
    let closer = null;
    let depth = 0;
    
    for (let i = 0; i < len; i++) {
        const token = tokens[i];
        const firstCh = token[0];
        
        // Not in grouped context
        if (bufStart === -1) {
            const match = CLOSERS[firstCh];
            
            if (!match) {
                // Regular arg - fast path
                args.push(new ASTNode('Argument', token));
                continue;
            }
            
            closer = match;
            const lastCh = token[token.length - 1];
            
            // Bracket type - needs depth tracking
            if (OPENS_BRACKET[firstCh]) {
                depth = 1;
                const tLen = token.length;
                
                // Count depth in single pass
                for (let j = 1; j < tLen; j++) {
                    const ch = token[j];
                    if (ch === firstCh) depth++;
                    else if (ch === closer) depth--;
                }
                
                if (depth === 0) {
                    // Complete in single token
                    args.push(new ASTNode('Argument', token));
                    closer = null;
                } else {
                    bufStart = i;
                }
            } else {
                // Quote type - check if quote closes within the token
                // "mice1".x has closing " at index 6 even though lastCh is 'x'
                const closeIdx = token.indexOf(closer, 1);
                if (closeIdx !== -1) {
                    args.push(new ASTNode('Argument', token));
                    closer = null;
                } else {
                    bufStart = i;
                }
            }
        } 
        // In grouped context - accumulate
        else {
            // Bracket depth tracking
            if (OPENS_BRACKET[closer === ']' ? '[' : '(']) {
                const opener = closer === ']' ? '[' : '(';
                const tLen = token.length;
                
                for (let j = 0; j < tLen; j++) {
                    const ch = token[j];
                    if (ch === opener) depth++;
                    else if (ch === closer) depth--;
                }
                
                if (depth === 0) {
                    // Build from buffer
                    let joined = tokens[bufStart];
                    for (let k = bufStart + 1; k <= i; k++) {
                        joined += ' ' + tokens[k];
                    }
                    args.push(new ASTNode('Argument', joined));
                    bufStart = -1;
                    closer = null;
                }
            } else {
                // Quote - check last char
                if (token[token.length - 1] === closer) {
                    let joined = tokens[bufStart];
                    for (let k = bufStart + 1; k <= i; k++) {
                        joined += ' ' + tokens[k];
                    }
                    args.push(new ASTNode('Argument', joined));
                    bufStart = -1;
                    closer = null;
                }
            }
        }
    }
    
    // Unclosed group - flush buffer
    if (bufStart !== -1) {
        let joined = tokens[bufStart];
        for (let k = bufStart + 1; k < len; k++) {
            joined += ' ' + tokens[k];
        }
        args.push(new ASTNode('Argument', joined));
    }
    
    return args;
}

// A block's body, up to its `end`. On EOF without one the caller wraps the
// block in an error node — children ride INSIDE it, never reparented to run (D020).
function parseBlock(state) {
    const block = [];

    while (state.hasMore()) {
        const line = state.next();

        if (line.meadow !== undefined) { block.push(meadowNode(line)); continue; }
        if (line.cellFence) { block.push(cellFenceNode(line)); continue; }

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
function parseStatement(tokens, state, rec) {
    const kw = tokens[0];
    const len = tokens.length;

    // Most common case first: commands
    if (!BLOCK_KW[kw]) {
        return stamp(new ASTNode('Call', kw, parseArguments(tokens.slice(1))), rec);
    }

    // Block constructs - validate the head BEFORE opening a block: a broken
    // head is a one-line error node; no body is consumed on its behalf.
    const last = tokens[len - 1];
    if (last !== DO) {
        return errorNode(rec, `'do' to open '${kw}'`, last);
    }

    // The head is sound — walk the body, then close or contain.
    const blockNode = (make) => {
        const { block, terminated, endComment } = parseBlock(state);
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

    // Loop: for/loop <n> do
    if (kw === 'for' || kw === 'loop') {
        if (len < 3) return errorNode(rec, `a number of loops after '${kw}'`, DO);
        return blockNode((block) => new ASTNode('Loop', tokens[1], block));
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

    // Unreachable while BLOCK_KW lists exactly the six above — kept total
    // against drift: an unhandled block keyword rests as one line, loudly.
    return errorNode(rec, 'a known block keyword', kw);
}


// print ast fn
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
            
            case 'Loop':
                out.push(`${indent}loop ${node.value} do${margin}`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END + endMargin);
                break;

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

