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
//  Keyword Lookup Tables
// ============================================================================

const END = 'end';
const DO = 'do';
const COMMENT = '#';
const FENCE = '###';   // the meadow door — prose AROUND code (id:gw-grammar)

// The ONE place code and comment part. A `#` opens trivia; everything before it
// is code (trailing space trimmed), everything after rides VERBATIM (the
// author's whitespace is theirs). Returns [code, comment]; comment is undefined
// only when there is no `#` — a bare `#` still yields an empty-string comment.
// Nothing downstream re-finds the `#`: the comment travels as a field.
const splitComment = (raw) => {
    const i = raw.indexOf(COMMENT);
    return i === -1 ? [raw, undefined] : [raw.slice(0, i).trimEnd(), raw.slice(i + 1)];
};

// Bracket/quote matching (O(1) lookup)
const CLOSERS = { '"': '"', "'": "'", '[': ']', '(': ')' };
const OPENS_BRACKET = { '[': 1, '(': 1 };

// Block keyword lookup (O(1))
const BLOCK_KW = { for: 1, loop: 1, def: 1, draw: 1, when: 1, as: 1 };



// A meadow (`###` … `###`) is carried through the line array as an object so the
// statement loop can turn it into one prose node — the same store as the margin,
// only multiline. A meadow holding ``` cells (id:gw-cell) tokenizes into a
// SEQUENCE of units — prose chunks, cell-fence markers, and the cell's own code
// lines — with the group's ### fences riding the edge units, so printAST can
// re-emit the group exactly and the executor still walks the cell's code.
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

// Stamp a node with its source span. Line numbers are 1-based ORIGINAL buffer
// lines, carried through the line pass on every record — the tokenizer
// reshapes lines (splits glued `end`, drops blanks, folds meadows) but never
// forgets where a record was born. Statement-grain: Argument sub-nodes ride
// their statement's line.
function stamp(node, rec, endLine = null) {
    node.span = { line: rec.line ?? 0, endLine: endLine ?? rec.endLine ?? rec.line ?? 0 };
    return node;
}

// A structure-preserving error node — the containment law, healthy parts live
// (D020, id:cmp-error-node). `value` holds the child's raw source line VERBATIM
// so printAST round-trips it; `children` hold whatever parsed inside an
// unterminated block — structure preserved, inert at walk, loud in the ink.
// Never thrown: parseProgram is total.
function errorNode(rec, expected, found, children = []) {
    return stamp(new ASTNode('Error', rec.text, children, {
        expected,
        found,
        kind: 'parse',
    }), rec);
}

// ============================================================================
// Trivia — the one uniform concept for a `#` comment (id:pa-ghc-exactprint)
// ============================================================================
// A comment is non-semantic text that RIDES a line — trivia, not structure.
// It attaches to the node whose line it trails, in ONE of two slots:
//   meta.comment    — the node's OWN / opening line (a call's margin, a block's
//                     `do` head, a comment standing on its own empty line)
//   meta.endComment — a block's `end` line (the twin site a `do … end` spans)
// One concept, one attach here, one emit in printAST (`#` + the verbatim run,
// its author-owned whitespace intact). Prose (meadow meta.lit) is CONTENT, a
// different thing — trivia never conflates with it, and neither is stored twice.
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

        // A stray `end` with no block open — an error node, never a phantom
        // Call (reachable now that a broken head consumes no block, D020).
        // Its comment rides the error as trivia (attachComment), like any node.
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
// The fast structure is not a new tree: it is the SAME plain-object tree
// with one added law — unchanged structure keeps its object identity across
// reparses. The shape is Zig's (id:pa-zig-incremental): reparse WHOLE — the
// total parse is ground truth, so reuse can never lie — then recover
// identity by diffing at the natural grain. Here that grain is the
// top-level unit: a statement, a block, a meadow chunk, a cell fence — so
// an edit to one cell of a pressed page leaves every sibling unit's nodes
// ===-identical. Identity is the product every later phase consumes: the
// Phase 2 memo key, the Phase 3 swap predicate.
//
// Adoption is early cutoff (id:pa-ghc-earlycutoff): the content key is the
// node's structure MINUS the OVERLAY, so a unit that changed only where it
// sits or what it says without meaning re-keys to its old object and every
// memo hanging off it survives. Meaning-equality, not source dirtiness,
// decides propagation.
//
// The overlay rides a reused node without being its identity:
//   · span — ABSOLUTE buffer lines (executor stamps, channel events, ink);
//     mutated IN the existing object so a standing capture (frame.error)
//     moves with it.
//   · trivia — a `#` comment (meta.comment / meta.endComment) and meadow
//     prose (meta.lit); non-semantic, so editing it must NOT restart the
//     running frame. The fresh text is still copied in, so the shared tree
//     carries the new comment/prose — propagation for sharing, no rerun.
//
// Extension point (Phase 3 stage 3, subtree become): on a key miss, recurse
// the same adoption into the fresh node's children.

// The key is everything but the OVERLAY: same key ⇒ same meaning. It stays
// COARSE — any drift costs a missed reuse, never a wrong tree, since the
// fresh parse is always the answer.
const OVERLAY = new Set(['span', 'comment', 'endComment', 'lit']);
const contentKey = (node) => JSON.stringify(node, (k, v) => (OVERLAY.has(k) ? undefined : v));

// Copy the fresh twin's overlay onto the reused node. Span mutates the
// EXISTING object (standing captures like frame.error stay live); trivia is
// rebuilt in a fresh parse's key ORDER so the adopted meta serializes
// byte-identically.
function adoptOverlay(prev, next) {
    if (next.span) {
        if (prev.span) { prev.span.line = next.span.line; prev.span.endLine = next.span.endLine; }
        else prev.span = { line: next.span.line, endLine: next.span.endLine };
    }
    const pm = prev.meta, nm = next.meta;
    if (pm && nm) {
        // meadow prose rides `lit` (first, always present) — update in place.
        if ('lit' in nm) pm.lit = nm.lit;
        // comment / endComment ride LAST, endComment first (blockNode attaches
        // endComment, the caller attaches comment). Clear then re-add in that
        // order so the adopted meta matches a fresh twin — and a deleted
        // comment never lingers.
        delete pm.endComment; delete pm.comment;
        if (nm.endComment !== undefined) pm.endComment = nm.endComment;
        if (nm.comment !== undefined) pm.comment = nm.comment;
    }
    const pc = prev.children ?? [], nc = next.children ?? [];
    for (let i = 0; i < pc.length; i++) adoptOverlay(pc[i], nc[i]);
}

// Total, like parseProgram — the answer is ALWAYS the forest the text
// means; adoption only decides which node objects carry it. Each old node
// is adopted at most once (two frames can never share one identity);
// duplicates pair in document order.
//
// The (prevText, prevAst) pair is the identity primitive's intra-session
// carrier: it must be CONSISTENT (that tree for that text — a stale pair
// is fine, reuse degrades gracefully) and it belongs to the buffer's
// OWNER (the page record, the ambient's parse memo) — handing another
// owner's tree here would move THEIR position overlay. No stateful parser
// object exists on purpose: the pair rides lifecycles that already exist.
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
// Fence-aware line pass. A `###` line opens the meadow: everything up to the
// next `###` (or end-of-file — the fence auto-closes) is captured VERBATIM as a
// single prose unit `{ meadow }`. Code/comment lines are trimmed, blanks dropped,
// and a glued `end` (`fw 10 end draw`) is split onto its own line — preserving the
// prior tokenizer's law, but never reaching inside prose.
function tokenize(program) {
    const rawLines = program.split(/\r\n|\r|\n/);
    const n = rawLines.length;
    const lines = [];
    let i = 0;

    // The code-line law, shared by bare code and cell bodies: split off the
    // comment FIRST (it is trivia, not code — carried as a field, never text),
    // then split any mid-line `end` (word-bounded) onto its own record so the
    // line-oriented block parser sees it alone. The comment rides the LAST
    // record — the line it trails. Every record remembers its BIRTH line
    // (1-based, the original buffer); split parts share it (id:cmp-resilient).
    const pushCode = (raw, out, line) => {
        const [code, comment] = splitComment(raw);
        const parts = code.replace(/\bend\b(?!$)/g, 'end\n')
            .split('\n').map((p) => p.trim()).filter(Boolean);
        const recs = (parts.length ? parts : ['']).map((text) => ({ text, line }));
        if (comment !== undefined) recs[recs.length - 1].comment = comment;
        for (const rec of recs) out.push(rec);
    };

    while (i < n) {
        const trimmed = rawLines[i].trim();

        if (trimmed === FENCE) {
            // Walk the meadow group: prose chunks stay verbatim units; a ```
            // fence re-enters code-space (id:gw-cell) — the cell's lines go
            // through the code law so the executor walks them. The group's
            // ### fences ride the edge units as meadowOpen/meadowClose.
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
            while (i < n && rawLines[i].trim() !== FENCE) {
                const t = rawLines[i].trim();
                if (t.startsWith('```')) {
                    flushChunk();
                    // The opening fence's info word (```paperlang) is the
                    // child's, so it rides in the tree — fidelity lives there,
                    // never beside it. Drop it and the document stops
                    // round-tripping, which every line-addressed reader
                    // inherits as drift (attention is the address, D021).
                    const info = t.slice(3);
                    units.push({ cellFence: true, meadowOpen: false, meadowClose: false,
                                 line: i + 1, info: info || undefined });
                    i++;
                    while (i < n && rawLines[i].trim() !== '```' && rawLines[i].trim() !== FENCE) {
                        const ct = rawLines[i].trim();
                        if (ct) pushCode(ct, units, i + 1);
                        i++;
                    }
                    // A cell ends at its closing fence, or is auto-closed by the
                    // meadow's edge / EOF. An auto-close is marked IMPLICIT so
                    // the printer stays silent about it — the exact-print rule
                    // (id:pa-ghc-exactprint): the parse may heal the walk, but
                    // it never puts a word in the child's mouth. The error node
                    // keeps the same rule for `end` (D020).
                    const closed = i < n && rawLines[i].trim() === '```';
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
            // Exact-print again: a clearing that ran to EOF was closed by the
            // parse, not by the child, so the printer stays silent about that
            // fence too — the document round-trips, the line arithmetic holds.
            const meadowClosed = i < n;
            i++; // consume the closing fence (or step past EOF — auto-close)
            units[0].meadowOpen = true;
            units[units.length - 1].meadowClose = true;
            if (!meadowClosed) units[units.length - 1].meadowCloseImplicit = true;
            lines.push(...units);
            continue;
        }

        // A blank line rides through as an empty record so its birth line
        // stays in the tree — line-number parity across parse → print, and the
        // green tree sees the edit (a bare Enter changes the seed → reruns).
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
    // The comment is already split off at line birth (splitComment) and rides
    // the record's .comment field — here we only tokenize pure code, honouring
    // [ ] and " " groups.
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

// A block's body, up to its `end`. TOTAL: reaching EOF without the `end`
// answers { terminated: false } and the CALLER wraps the whole block in an
// error node — the containment law (id:cmp-error-node): an unterminated
// block swallows to EOF, its parsed children riding INSIDE the error (inert,
// never silently reparented to run outside their intended scope).
function parseBlock(state) {
    const block = [];

    while (state.hasMore()) {
        const line = state.next();

        if (line.meadow !== undefined) { block.push(meadowNode(line)); continue; }
        if (line.cellFence) { block.push(cellFenceNode(line)); continue; }

        const tokens = tokenizeLine(line.text);
        const comment = line.comment;

        // The closing `end` — its trailing comment (`end # done`) rides home ON
        // the block as endComment, never wrapping onto a phantom line below it.
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


// parse all actions — TOTAL (id:cmp-resilient): a malformed statement becomes
// an error node in place, one line for a head error, head-to-EOF for an
// unterminated block. The healthy statements around it parse and run (D020).
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
        // The comment on the `end` line (meta.endComment) — the twin site a
        // `do … end` spans; the head/`do`-line comment (meta.comment) is
        // attached by the caller. printAST re-emits both.
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
                    // A cell fence inside the meadow group; it may carry the
                    // group's own ### edge when the cell abuts it. Exact-print:
                    // an implicit closer was never typed, so it is not emitted —
                    // but its ### edge still rides, because that the child did
                    // type.
                    if (node.meta.meadowOpen) out.push(indent + FENCE);
                    if (!node.meta.implicit) out.push(indent + '```' + (node.meta.info ?? ''));
                    if (node.meta.meadowClose && !node.meta.meadowCloseImplicit) out.push(indent + FENCE);
                } else if (node.meta.meadow) {
                    // Re-emit the clearing: fences around the verbatim prose. Every
                    // lit line — headlines, portals, blanks — rides through intact.
                    // Edge flags default open — a meadow node built elsewhere
                    // (no flags) is a whole clearing of its own.
                    //
                    // An INTERIOR chunk (both edges suppressed) with `lit === ""`
                    // is one blank line, not nothing: the blank between two
                    // adjacent cells. Test it for truthiness and that line is
                    // swallowed, breaking round-trip — hence the explicit
                    // null check. An EDGE chunk is genuinely ambiguous
                    // (`###\n###` and `###\n\n###` parse alike) and is left
                    // standing rather than fixed by guesswork.
                    const interior = node.meta.meadowOpen === false && node.meta.meadowClose === false;
                    if (node.meta.meadowOpen !== false) out.push(indent + FENCE);
                    if (node.meta.lit || (interior && node.meta.lit != null)) out.push(node.meta.lit);
                    if (node.meta.meadowClose !== false && !node.meta.meadowCloseImplicit) out.push(indent + FENCE);
                } else if (node.meta.comment != null) {
                    // A comment-only line: `#` + the verbatim text, with no code
                    // before it — so no leading ` ` (that prefix rides a margin
                    // trailing code, never a standalone comment).
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
                // The child's code, verbatim (D020) — the raw line rides in
                // `value` so the round-trip never invents an `end` nor loses
                // the brokenness; its comment rides `margin` like any node's
                // trivia. An unterminated block's parsed children follow; a
                // one-liner none.
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
// Prose space has exactly one geometry: meadows, the cells inside them, and the
// headlines that branch those cells into phases. Three hand-rolled state
// machines used to walk it — here, in `phaseAt`, and in the editor's
// `findProse` — each with its own copy of the three regexes and its own answer
// to "does ### close an open cell". They agreed by luck; nothing made them
// agree. This is the one walk, and every reader below is a view over it. Add a
// fourth walker and the luck comes back.
//
// It takes LINES, not a tree and not a CM6 doc, because a line is the one thing
// both sides already have. That is the seam: text in → shape out, pure.

export const HEADLINE = /^[ \t]*(\*+)\s+(\S.*)$/;   // `* name` — the trailing space disambiguates *bold*
const MEADOW_FENCE = /^[ \t]*###[ \t]*$/;
const CELL_OPEN = /^[ \t]*```/;              // an info word may ride the opener
const CELL_CLOSE = /^[ \t]*```[ \t]*$/;      // a bare ``` is only ever a closer

// The one stack rule, so "a headline of depth d closes every phase at that
// depth or deeper" is spelled once. Returns the path (root first) after opening.
function openPhase(stack, depth, title) {
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    stack.push({ depth, title });
    return stack.map((s) => s.title);
}

// outline(lines) → { meadows, cells, phases }
//   meadows  — { open, end }, fence lines included; an unclosed meadow runs to EOF
//   cells    — { open, end, terminated, path }, `end` the closing fence line (or
//              the last body line when the meadow's edge / EOF closed it)
//   phases — { line, depth, title, path } per headline, in document order
// The cell/meadow law is the tokenizer's, exactly: inside a cell a bare ```
// closes it, and a ### closes BOTH it and the clearing.
export function outline(lines) {
    const meadows = [], cells = [], phases = [];
    const stack = [];
    let inMeadow = false, mOpen = 0, open = 0, path = [];
    const n = lines?.length ?? 0;
    for (let i = 1; i <= n; i++) {
        const text = lines[i - 1] ?? '';
        if (open) {                                       // inside a cell
            if (CELL_CLOSE.test(text)) { cells.push({ open, end: i, terminated: true, path }); open = 0; }
            else if (MEADOW_FENCE.test(text)) {
                cells.push({ open, end: i - 1, terminated: false, path }); open = 0;
                meadows.push({ open: mOpen, end: i }); inMeadow = false;
            }
            continue;
        }
        if (MEADOW_FENCE.test(text)) {
            if (inMeadow) meadows.push({ open: mOpen, end: i });
            else mOpen = i;
            inMeadow = !inMeadow;
            continue;
        }
        if (!inMeadow) continue;                          // bare code carries no outline
        if (CELL_OPEN.test(text)) { open = i; path = stack.map((s) => s.title); continue; }
        const m = HEADLINE.exec(text);
        if (m) phases.push({ line: i, depth: m[1].length, title: m[2].trim(),
                               path: openPhase(stack, m[1].length, m[2].trim()) });
    }
    if (open) cells.push({ open, end: n, terminated: false, path });
    if (open || inMeadow) meadows.push({ open: mOpen, end: n });
    return { meadows, cells, phases };
}

// A path is an ANCESTOR of another when it is a strict prefix — outline-scoped
// vocabulary (D019) reads exactly this: down the outline, never sideways, so
// sister phases stay sovereign and sister cells share without inheriting.
const isAncestorPath = (a, b) => a.length < b.length && a.every((t, i) => t === b[i]);

// The sibling ambients of a weave page, DERIVED from the one AST — never
// ferried, never stored twice. Works on JSON-thawed nodes too (plain objects),
// like printAST, because the seam may cross a socket between parse and split.
//
// Each cell carries its VOCABULARY: the code of every earlier cell under an
// ancestor headline, folded in document order (the page root is every
// phase's ancestor). The seat rehearses that lazily from t=0, headless, and
// forks the pure functions it registered (turtle.rehearseVocab ⊗
// executor.drainNamespace) — this splitter only says whose code is vocabulary,
// never reads inside it.
//
//   → [{ code, vocab, nodes, vocabNodes, open, end, path }]
//     nodes/vocabNodes — LIVE slices of the one tree; identity flows through
//       the partition, so structure never crosses this seam as text
//       (id:cmp-vet diagnostic 1)
//     code/vocab — their printed projections, for content keys and sockets;
//       null when the outline offers no vocabulary
export function phaseCells(ast) {
    const nodes = ast ?? [];
    // The shape comes from the ONE walk, over this tree's own printed form —
    // so cell spans, sister paths and the editor's fold all read one geometry.
    const marks = outline(printAST(nodes).split('\n')).cells;
    const cells = [];
    let cur = null;
    const closeCell = (body) => {
        const mark = marks[cells.length] ?? {};
        const path = mark.path ?? [];
        // The vocabulary: every EARLIER cell of an ancestor phase, folded in
        // document order. Read off the paths the outline already assigned.
        const vocabNodes = cells.filter((c) => isAncestorPath(c.path, path))
                                .flatMap((c) => c.nodes);
        cells.push({
            code: printAST(body),
            vocab: vocabNodes.length ? printAST(vocabNodes) : null,
            nodes: body,
            vocabNodes: vocabNodes.length ? vocabNodes : null,
            // The cell's own SPAN — its fences (D021). A line is total: every
            // position has one, so a cell the child has only just opened, with
            // no body yet, is addressable exactly like a full one (dormant is
            // not empty). Node spans cannot answer this — an empty cell has no
            // nodes at all.
            open: mark.open ?? null,
            end: mark.end ?? null,
            // The PHASE this cell is a sister in — the headline path, root
            // first. Sisters share it; a deeper subheading forks its own.
            path,
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

// ============================================================================
// THE PHASE — attention is the address (D021)
// ============================================================================
// One datum names where a peer is: a LINE. Everything else is DERIVED by pure
// function at the moment it is needed — there is no stored phase, so none can
// go stale.
//
// Why a line and not a cell ordinal. An ordinal is positional: it aliases the
// moment a cell is inserted above it, and it cannot name a phase that owns no
// cell — which is the whole formative moment of authoring, when a heading and
// its paragraphs exist before any fence. A line is TOTAL (every position in the
// document has one, prose included), LOCAL (an edit shifts only lines below it),
// and EXACT across the wire, because printAST round-trips and reflection drops
// only whole nodes.
//
// The outline is read off the PRINTED document, never off node spans: the one
// printer is the one grammar, so the same walk answers for an original tree and
// for a projection of it, whose kept nodes still carry their original spans.

// The headline path enclosing `line`, root first — `[]` in a root preamble,
// where there is no headline above. A line past the end inhabits the last open
// phase rather than lying about it. Inclusive: standing ON `** phase B` is
// standing IN phase B, whether or not a caret ever enters a figure.
//
// A view over the one walk: the last headline at or above the line already
// carries the path it opened, so this is a lookup, not a second machine.
export function phaseAt(ast, line) {
    const { phases } = outline(printAST(ast ?? []).split('\n'));
    let here = [];
    for (const s of phases) {
        if (s.line > (line ?? 0)) break;
        here = s.path;
    }
    return here;
}

// The index of the cell whose FENCES enclose `line`, or null. Span-addressed,
// so a cell just opened and not yet written in is found like any other.
// Takes either shape the one walk produces — `phaseCells` entries or
// `outline().cells` — since both carry the same { open, end }.
export function cellAtLine(cells, line) {
    for (let i = 0; i < (cells?.length ?? 0); i++) {
        const c = cells[i];
        if (c.open == null) continue;
        if (line >= c.open && line <= (c.end ?? Infinity)) return i;
    }
    return null;
}

// How many printed lines a node occupies — by the one printer, so the count can
// never drift from what the reader will see.
const printedHeight = (node) => printAST([node]).split('\n').length;

// NOT WIRED, AND MUST NOT BE WIRED AS IT STANDS. It was called from
// `reflection()` for one day [2026-07-27] and reverted the same day, because
// "dormant, not missing" is a claim this function cannot keep: it drops each
// distant cell's BODY and keeps its fences, so downstream every one of them
// seats with EMPTY CODE and its figure is wiped. On a code-review surface the
// gutted text also becomes the merge baseline. A cursor move must not rewrite
// the friend's document — the attention crosses as a coordinate beside the
// whole tree instead (D025 R1 as amended), which needs no shift arithmetic at
// all, since printAST round-trips exactly.
//
// What it is waiting for, if bandwidth ever asks for it: `dormant` must mean
// NOT SEATED at the page law, not seated-with-nothing. Until the seating law
// can be told "this cell exists and is not to be run", this projection cannot
// ship. Keep the tests — the line arithmetic in here is correct and pinned
// (weave_phase_test.mjs, 21 tests); it is the DOWNSTREAM meaning of an empty
// cell that is missing.
//
// The projection a friend receives: ALL prose (every headline — the outline is
// the map), and the bodies of only the phase the attention inhabits. Sister
// cells of that phase ride together; every other cell keeps its fences and
// drops its body, so the document's shape stays whole and its slots are all
// still there — dormant, not missing.
//
// Returns { commands, attend }: the projected forest (kept nodes are the SAME
// objects — identity flows through the partition, never a re-parse) and the
// attention translated into the projection's own coordinates. The child's side
// holds both trees and owns the translation, so the friend's side stays dumb
// and cannot mis-map.
//
// attend:null is legal and is the identity — the whole tree, pointing nowhere.
// Reached by the null path rather than by a branch, so there is one code path.
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

// The program AROUND the cells — phaseCells' complement. When bare code
// stands outside the fences it takes priority: it is the buffer's program,
// and the cells are previews that run only on reach. The cell fences stay
// (Empty no-ops, and they carry the meadow's edges) so the stripped source
// re-parses clean; only the cells' code leaves.
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

