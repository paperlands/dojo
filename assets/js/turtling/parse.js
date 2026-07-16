import { ASTNode } from "./ast.js"


//manage state
class ParserState {
    constructor(lines) {
        this.lines = lines;
        this.pos = 0;
        this.len = lines.length;
    }

    hasMore() {
        return this.pos < this.len;
    }

    next() {
        return this.lines[this.pos++];
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
    return new ASTNode('Empty', '')
        .assign_meta('lit', line.meadow)
        .assign_meta('meadow', true)
        .assign_meta('meadowOpen', line.meadowOpen !== false)
        .assign_meta('meadowClose', line.meadowClose !== false);
}

// A ``` fence line — code re-entering code-space inside the meadow. A no-op
// for the executor; printAST re-emits the fence (and any ### it carries).
function cellFenceNode(line) {
    const node = new ASTNode('Empty', '').assign_meta('cellFence', true);
    if (line.meadowOpen) node.assign_meta('meadowOpen', true);
    if (line.meadowClose) node.assign_meta('meadowClose', true);
    return node;
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

        const [tokens, comment] = tokenizeLine(line);

        if (tokens.length === 0) {
            const node = new ASTNode('Empty', '');
            if (comment) node.assign_meta('lit', comment);
            ast.push(node);
            continue;
        }

        const node = parseStatement(tokens, state);
        if (comment) node.assign_meta('lit', comment);
        ast.push(node);
    }

    return ast;
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
    // blanks upstream, split any mid-line `end` (word-bounded) onto its own line.
    const pushCode = (trimmed, out) => {
        if (trimmed.indexOf(END) !== -1) {
            for (const part of trimmed.replace(/\bend\b(?!$)/g, 'end\n').split('\n')) {
                const p = part.trim();
                if (p) out.push(p);
            }
        } else {
            out.push(trimmed);
        }
    };

    while (i < n) {
        const trimmed = rawLines[i].trim();

        if (trimmed === FENCE) {
            // Walk the meadow group: prose chunks stay verbatim units; a ```
            // fence re-enters code-space (id:gw-cell) — the cell's lines go
            // through the code law so the executor walks them. The group's
            // ### fences ride the edge units as meadowOpen/meadowClose.
            i++;
            const units = [];
            let chunk = [];
            const flushChunk = () => {
                if (chunk.length) {
                    units.push({ meadow: chunk.join('\n'), meadowOpen: false, meadowClose: false });
                    chunk = [];
                }
            };
            while (i < n && rawLines[i].trim() !== FENCE) {
                const t = rawLines[i].trim();
                if (t.startsWith('```')) {
                    flushChunk();
                    units.push({ cellFence: true, meadowOpen: false, meadowClose: false });
                    i++;
                    while (i < n && rawLines[i].trim() !== '```' && rawLines[i].trim() !== FENCE) {
                        const ct = rawLines[i].trim();
                        if (ct) pushCode(ct, units);
                        i++;
                    }
                    if (i < n && rawLines[i].trim() === '```') i++;
                    // Closing fence consumed — or auto-closed at the meadow's
                    // edge / EOF; either way the cell ends here.
                    units.push({ cellFence: true, meadowOpen: false, meadowClose: false });
                    continue;
                }
                chunk.push(rawLines[i]);
                i++;
            }
            flushChunk();
            if (units.length === 0) units.push({ meadow: '', meadowOpen: false, meadowClose: false });
            i++; // consume the closing fence (or step past EOF — auto-close)
            units[0].meadowOpen = true;
            units[units.length - 1].meadowClose = true;
            lines.push(...units);
            continue;
        }

        if (trimmed) pushCode(trimmed, lines);
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

function parseBlock(state) {
    const block = [];
    
    while (state.hasMore()) {
        const line = state.next();

        if (line.meadow !== undefined) { block.push(meadowNode(line)); continue; }
        if (line.cellFence) { block.push(cellFenceNode(line)); continue; }

        if (line === END) return block;

        const [tokens, comment] = tokenizeLine(line);

        if (tokens.length === 0) {
            const node = new ASTNode('Empty', '');
            if (comment) node.assign_meta('lit', comment);
            block.push(node);
            continue;
        }
        
        const node = parseStatement(tokens, state);
        if (comment) node.assign_meta('lit', comment);
        block.push(node);
    }
    
    throw new Error(`Missing 'end' at line ${state.pos}`);
}


// parse all actions 
function parseStatement(tokens, state) {
    const kw = tokens[0];
    const len = tokens.length;
    
    // Most common case first: commands
    if (!BLOCK_KW[kw]) {
        return new ASTNode('Call', kw, parseArguments(tokens.slice(1)));
    }
    
    // Block constructs - validate structure
    const last = tokens[len - 1];
    if (last !== DO) {
        throw new Error(`Expected 'do' at end of '${kw}'`);
    }
    
    // Loop: for/loop <n> do
    if (kw === 'for' || kw === 'loop') {
        if (len < 3) throw new Error(`'${kw}' requires number of loops`);
        return new ASTNode('Loop', tokens[1], parseBlock(state));
    }
    
    // Function def: def/draw <name> [args...] do
    if (kw === 'def' || kw === 'draw') {
        if (len < 3) throw new Error(`'${kw}' requires function name`);
        
        const name = tokens[1];
        const argTokens = tokens.slice(2, len - 1);
        const args = argTokens.map(arg => new ASTNode('Argument', arg));
        
        return new ASTNode('Define', name, parseBlock(state), { args });
    }
    
    // When: when <expr> do  OR  when 'eventname' [binding] do
    if (kw === 'when') {
        if (len < 3) throw new Error("'when' requires checking truthiness");
        const firstToken = tokens[1]
        const isEvent = /^['"]/.test(firstToken)

        if (isEvent) {
            // Event mode: when 'name' [binding] do
            const meta = { event: true }
            if (len > 3) meta.binding = tokens[2]
            return new ASTNode('When', firstToken, parseBlock(state), meta)
        } else {
            // Conditional mode: join all tokens between 'when' and 'do'
            const expr = tokens.slice(1, len - 1).join(' ')
            return new ASTNode('When', expr, parseBlock(state))
        }
    }

    // Ambient: as <name> [<frame>] do ... end
    if (kw === 'as') {
        if (len < 3) throw new Error("'as' requires assistant name");
        const meta = {}
        if (len > 3) meta.frame = tokens[2]
        return new ASTNode('Ambient', tokens[1], parseBlock(state), meta);
    }

    throw new Error(`Unknown keyword: ${kw}`);
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
//   sectionCells(ast) → [{ code, vocab }]  — vocab the ancestors' cells
//     re-printed in document order, or null when the outline offers none.
export function sectionCells(ast) {
    const cells = [];
    // The heading stack: root first, innermost last. Each level gathers the
    // nodes of its DIRECT cells; a cell's vocabulary is the levels strictly
    // above its own.
    const stack = [{ depth: 0, nodes: [] }];
    let cur = null;
    const closeCell = (nodes) => {
        const vocab = stack.slice(0, -1).flatMap((l) => l.nodes);
        cells.push({ code: printAST(nodes), vocab: vocab.length ? printAST(vocab) : null });
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
