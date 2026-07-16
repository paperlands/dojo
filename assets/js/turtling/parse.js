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
    return stamp(new ASTNode('Empty', '')
        .assign_meta('lit', line.meadow)
        .assign_meta('meadow', true)
        .assign_meta('meadowOpen', line.meadowOpen !== false)
        .assign_meta('meadowClose', line.meadowClose !== false), line);
}

// A ``` fence line — code re-entering code-space inside the meadow. A no-op
// for the executor; printAST re-emits the fence (and any ### it carries).
function cellFenceNode(line) {
    const node = stamp(new ASTNode('Empty', '').assign_meta('cellFence', true), line);
    if (line.meadowOpen) node.assign_meta('meadowOpen', true);
    if (line.meadowClose) node.assign_meta('meadowClose', true);
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

// A structure-preserving error node (D020 — the healthy parts live; the
// containment law, id:cmp-error-node). `value` holds the raw source line
// VERBATIM so printAST round-trips her text; `children` hold whatever parsed
// inside an unterminated block — structure preserved, inert at walk, loud in
// the ink. Never thrown: parseProgram is TOTAL.
function errorNode(rec, expected, found, children = []) {
    return stamp(new ASTNode('Error', rec.text, children, {
        expected,
        found,
        phase: 'parse',
    }), rec);
}

// main parser
export function parseProgram(program) {
    const lines = tokenize(program);
    const state = new ParserState(lines);
    const ast = [];

    while (state.hasMore()) {
        const line = state.next();

        if (line.meadow !== undefined) { ast.push(meadowNode(line)); continue; }
        if (line.cellFence) { ast.push(cellFenceNode(line)); continue; }

        // A stray `end` with no block open — an error node, never a phantom
        // Call (reachable now that a broken head consumes no block, D020).
        if (line.text === END) {
            ast.push(errorNode(line, 'an open block to close', `'${END}'`));
            continue;
        }

        const [tokens, comment] = tokenizeLine(line.text);

        if (tokens.length === 0) {
            const node = stamp(new ASTNode('Empty', ''), line);
            if (comment) node.assign_meta('lit', comment);
            ast.push(node);
            continue;
        }

        const node = parseStatement(tokens, state, line);
        if (comment) node.assign_meta('lit', comment);
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
// node's whole structure MINUS position, so a rebuilt-but-identical unit
// re-keys to its old object and every memo hanging off it survives. Value
// equality, not source dirtiness, decides propagation — a moved block keeps
// its identity too.
//
// Spans stay ABSOLUTE buffer lines — the contract every fence already pins
// (executor stamps, channel events, ink) — and are the red overlay, copied
// in place onto adopted nodes: the node is the identity, its span the
// current position. A standing record that captured a span object
// (frame.error) moves with it — the ink follows the text, by construction.
//
// Extension point (Phase 3 stage 3, subtree become): on a key miss, recurse
// the same adoption into the fresh node's children.

// Everything but position: two nodes with one key are the same structure
// born from the same text. The key is allowed to be COARSE — any drift
// (a reordered meta write, a new node field) costs a missed reuse, never
// a wrong tree: the fresh parse is always the answer's structure.
const contentKey = (node) => JSON.stringify(node, (k, v) => (k === 'span' ? undefined : v));

// Copy the position overlay from the fresh twin onto the adopted node —
// into the EXISTING span objects, so standing captures stay live.
function adoptSpans(prev, next) {
    if (next.span) {
        if (prev.span) { prev.span.line = next.span.line; prev.span.endLine = next.span.endLine; }
        else prev.span = { line: next.span.line, endLine: next.span.endLine };
    }
    const pc = prev.children ?? [], nc = next.children ?? [];
    for (let i = 0; i < pc.length; i++) adoptSpans(pc[i], nc[i]);
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
        adoptSpans(prev, node);
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

    // The code-line law, shared by bare code and cell bodies: trim, drop
    // blanks upstream, split any mid-line `end` (word-bounded) onto its own
    // record. Every record remembers its BIRTH line (1-based, the original
    // buffer) — split parts share it; the reshaping never forgets the source
    // (id:cmp-resilient — spans ride every record).
    const pushCode = (trimmed, out, line) => {
        if (trimmed.indexOf(END) !== -1) {
            for (const part of trimmed.replace(/\bend\b(?!$)/g, 'end\n').split('\n')) {
                const p = part.trim();
                if (p) out.push({ text: p, line });
            }
        } else {
            out.push({ text: trimmed, line });
        }
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
                    units.push({ cellFence: true, meadowOpen: false, meadowClose: false, line: i + 1 });
                    i++;
                    while (i < n && rawLines[i].trim() !== '```' && rawLines[i].trim() !== FENCE) {
                        const ct = rawLines[i].trim();
                        if (ct) pushCode(ct, units, i + 1);
                        i++;
                    }
                    if (i < n && rawLines[i].trim() === '```') i++;
                    // Closing fence consumed — or auto-closed at the meadow's
                    // edge / EOF; either way the cell ends here.
                    units.push({ cellFence: true, meadowOpen: false, meadowClose: false, line: Math.min(i, n) });
                    continue;
                }
                if (!chunk.length) chunkStart = i + 1;
                chunk.push(rawLines[i]);
                i++;
            }
            flushChunk();
            if (units.length === 0) units.push({ meadow: '', meadowOpen: false, meadowClose: false, line: fenceLine });
            i++; // consume the closing fence (or step past EOF — auto-close)
            units[0].meadowOpen = true;
            units[units.length - 1].meadowClose = true;
            lines.push(...units);
            continue;
        }

        if (trimmed) pushCode(trimmed, lines, i + 1);
        i++;
    }

    return lines;
}

// ============================================================================
// Line Tokenizer - Context-Aware preserving groups [  ] and " "
// ============================================================================

function tokenizeLine(line) {
    const commentIdx = line.indexOf(COMMENT);
    
    // Extract comment if present
    const code = commentIdx === -1 ? line : line.slice(0, commentIdx).trim();
    const comment = commentIdx === -1 ? undefined : line.slice(commentIdx + 1).trim() || undefined;
    
    if (!code) return [[], comment];
    
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
    
    return [tokens, comment];
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

        if (line.text === END) return { block, terminated: true };

        const [tokens, comment] = tokenizeLine(line.text);

        if (tokens.length === 0) {
            const node = stamp(new ASTNode('Empty', ''), line);
            if (comment) node.assign_meta('lit', comment);
            block.push(node);
            continue;
        }

        const node = parseStatement(tokens, state, line);
        if (comment) node.assign_meta('lit', comment);
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
        const { block, terminated } = parseBlock(state);
        // The last record's FAR edge: a folded meadow spans several birth
        // lines; containment reaches its endLine, not its opening line.
        const endLine = state.last?.endLine ?? state.last?.line ?? rec.line;
        if (!terminated) {
            const err = errorNode(rec, `'end' to close '${kw}'`, 'end of program', block);
            err.span.endLine = endLine;
            return err;
        }
        return stamp(make(block), rec, endLine);
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
        const comment = node.meta.lit ? ` #${node.meta.lit}` : '';
        
        switch (node.type) {
            case 'Call': {
                const children = node.children;
                const len = children.length;
                
                if (len === 0) {
                    out.push(indent + node.value + comment);
                } else {
                    let args = children[0].value;
                    for (let i = 1; i < len; i++) {
                        args += ' ' + children[i].value;
                    }
                    out.push(indent + node.value + ' ' + args + comment);
                }
                break;
            }
            
            case 'Argument':
                return node.value;
            
            case 'Empty':
                if (node.meta.cellFence) {
                    // A cell fence inside the meadow group; it may carry the
                    // group's own ### edge when the cell abuts it.
                    if (node.meta.meadowOpen) out.push(indent + FENCE);
                    out.push(indent + '```');
                    if (node.meta.meadowClose) out.push(indent + FENCE);
                } else if (node.meta.meadow) {
                    // Re-emit the clearing: fences around the verbatim prose. Every
                    // lit line — headlines, portals, blanks — rides through intact.
                    // Edge flags default open — a meadow node built elsewhere
                    // (no flags) is a whole clearing of its own.
                    if (node.meta.meadowOpen !== false) out.push(indent + FENCE);
                    if (node.meta.lit) out.push(node.meta.lit);
                    if (node.meta.meadowClose !== false) out.push(indent + FENCE);
                } else {
                    out.push(indent + comment);
                }
                break;
            
            case 'Loop':
                out.push(`${indent}loop ${node.value} do`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END);
                break;
            
            case 'When': {
                const binding = node.meta?.binding ? ` ${node.meta.binding}` : ''
                out.push(`${indent}when ${node.value}${binding} do`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END);
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

                out.push(`${indent}def ${node.value}${argStr} do`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END);
                break;
            }

            case 'Ambient': {
                const mod = node.meta?.frame ? ` ${node.meta.frame}` : ''
                out.push(`${indent}as ${node.value}${mod} do`)
                node.children.forEach(c => visit(c, depth + 1))
                out.push(indent + END)
                break
            }

            case 'Error': {
                // Her text, verbatim (D020) — the raw line rides in `value`,
                // comment included, so the round-trip never invents an `end`
                // or loses the brokenness. An unterminated block's parsed
                // children follow; a one-line error has none.
                out.push(indent + node.value)
                node.children.forEach(c => visit(c, depth + 1))
                break
            }
        }
    }
    
    ast.forEach(node => visit(node, 0));
    return out.join('\n');
}

// The sibling ambients of a weave page (Shoot 1), DERIVED from the one AST —
// never ferried, never stored twice (the meta.lit law again). The cellFence
// markers already carry the split; each cell's code is its top-level slice,
// re-printed. Works on JSON-thawed nodes too (plain objects), the same way
// printAST does — the seam may cross a socket between parse and split.
//
// The outline is the ambient tree (Decision 019): a meadow headline
// (`* name`) opens a section; cells directly under it are sibling processes
// inside it. Each cell carries its VOCABULARY — the code of every cell under
// its ANCESTOR headings, folded in document order (the page root, before any
// headline, is every section's ancestor). Down, never sideways: sibling
// cells and sibling sections stay sovereign. The vocabulary is the chapter's
// REHEARSAL: the seat runs it lazily from t=0, headless, and forks the pure
// functions it registered (turtle.rehearseVocab ⊗ executor.drainNamespace) —
// the splitter only says WHOSE code is vocabulary, never reads inside it.
//   sectionCells(ast) → [{ code, vocab, nodes, vocabNodes }] — nodes the
//     LIVE slices of the one tree (identity flows through the partition,
//     id:cmp-vet wound 1: structure never crosses this seam as text);
//     code/vocab their printed projections for content keys and sockets;
//     vocab/vocabNodes null when the outline offers none.
export function sectionCells(ast) {
    const cells = [];
    // The heading stack: root first, innermost last. Each level gathers the
    // nodes of its DIRECT cells; a cell's vocabulary is the levels strictly
    // above its own.
    const stack = [{ depth: 0, nodes: [] }];
    let cur = null;
    const closeCell = (nodes) => {
        const vocabNodes = stack.slice(0, -1).flatMap((l) => l.nodes);
        cells.push({
            code: printAST(nodes),
            vocab: vocabNodes.length ? printAST(vocabNodes) : null,
            nodes,
            vocabNodes: vocabNodes.length ? vocabNodes : null,
        });
        stack[stack.length - 1].nodes.push(...nodes);
    };
    for (const node of ast ?? []) {
        if (node?.meta?.cellFence) {
            if (cur) { closeCell(cur); cur = null; }
            else cur = [];
            continue;
        }
        if (cur) { cur.push(node); continue; }
        // Between cells: meadow prose carries the outline. A headline of
        // depth d closes every section at that depth or deeper and opens its
        // own — sibling sections fork from the ancestors, never each other.
        if (node?.meta?.meadow && node.meta.lit) {
            for (const line of String(node.meta.lit).split('\n')) {
                const m = line.match(/^(\*+)\s/);
                if (!m) continue;
                const depth = m[1].length;
                while (stack[stack.length - 1].depth >= depth) stack.pop();
                stack.push({ depth, nodes: [] });
            }
        }
    }
    if (cur) closeCell(cur);             // unterminated cell — auto-closed
    return cells;
}

// The flat view — cell code only, the shape every pre-D019 caller reads.
export function splitCells(ast) {
    return sectionCells(ast).map((c) => c.code);
}

// The program AROUND the cells — splitCells' complement. When bare code
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
// message), expected/found, and phase.
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
                phase: node.meta?.phase ?? 'parse',
            });
        }
        (node.children ?? []).forEach(visit);
    };
    (ast ?? []).forEach(visit);
    return out;
}

// ============================================================================
// Validation Utility
// ============================================================================

export function validateAST(ast) {
    function check(node, ctx) {
        if (!(node instanceof ASTNode)) {
            throw new Error(`Invalid node at ${ctx}`);
        }
        if (!node.type) {
            throw new Error(`Missing type at ${ctx}`);
        }
        if (node.children) {
            node.children.forEach((c, i) => check(c, `${ctx}[${i}]`));
        }
    }
    
    ast.forEach((node, i) => check(node, `root[${i}]`));
}
