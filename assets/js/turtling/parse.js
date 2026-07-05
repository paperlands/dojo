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
// only multiline. Everything else is a trimmed string line.
function meadowNode(line) {
    return new ASTNode('Empty', '')
        .assign_meta('lit', line.meadow)
        .assign_meta('meadow', true);
}

// main parser
export function parseProgram(program) {
    const lines = tokenize(program);
    const state = new ParserState(lines);
    const ast = [];

    while (state.hasMore()) {
        const line = state.next();

        if (line.meadow !== undefined) { ast.push(meadowNode(line)); continue; }

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

    while (i < n) {
        const trimmed = rawLines[i].trim();

        if (trimmed === FENCE) {
            const body = [];
            i++;
            while (i < n && rawLines[i].trim() !== FENCE) body.push(rawLines[i++]);
            i++; // consume the closing fence (or step past EOF — auto-close)
            lines.push({ meadow: body.join('\n') });
            continue;
        }

        if (trimmed) {
            if (trimmed.indexOf(END) !== -1) {
                // split any mid-line `end` (word-bounded) onto its own line
                for (const part of trimmed.replace(/\bend\b(?!$)/g, 'end\n').split('\n')) {
                    const p = part.trim();
                    if (p) lines.push(p);
                }
            } else {
                lines.push(trimmed);
            }
        }
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
                if (node.meta.meadow) {
                    // Re-emit the clearing: fences around the verbatim prose. Every
                    // lit line — headlines, portals, blanks — rides through intact.
                    out.push(indent + FENCE);
                    if (node.meta.lit) out.push(node.meta.lit);
                    out.push(indent + FENCE);
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
