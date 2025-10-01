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

// Bracket/quote matching (O(1) lookup)
const CLOSERS = { '"': '"', "'": "'", '[': ']', '(': ')' };
const OPENS_BRACKET = { '[': 1, '(': 1 };

// Block keyword lookup (O(1))
const BLOCK_KW = { for: 1, loop: 1, def: 1, draw: 1, when: 1 };



// main parser
export function parseProgram(program) {
    const lines = tokenize(program);
    const state = new ParserState(lines);
    const ast = [];
    
    while (state.hasMore()) {
        const line = state.next();
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
function tokenize(program) {
    const len = program.length;
    const lines = [];
    let start = 0;
    let i = 0;
    let needsEndNewline = false;
    
    // Single pass through string
    while (i < len) {
        const ch = program[i];
        
        // Check for 'end' keyword that needs newline injection
        if (ch === 'e' && i + 3 <= len && program.substr(i, 3) === END) {
            const after = i + 3;
            if (after < len && program[after] !== '\n' && program[after] !== '\r') {
                needsEndNewline = true;
            }
        }
        
        // Line break
        if (ch === '\n' || ch === '\r') {
            const line = program.slice(start, i).trim();
            if (line) lines.push(line);
            
            // Handle \r\n
            if (ch === '\r' && i + 1 < len && program[i + 1] === '\n') {
                i++;
            }
            
            start = i + 1;
        }
        
        i++;
    }
    
    // Final line
    const line = program.slice(start).trim();
    if (line) lines.push(line);
    
    // Handle end newline injection if needed (rare case)
    if (needsEndNewline) {
        return program.replace(/\bend\b(?!\n)/g, 'end\n')
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l);
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
                // Quote type - no nesting
                if (token.length > 1 && lastCh === closer) {
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
    
    // When: when <pattern> do
    if (kw === 'when') {
        if (len < 3) throw new Error("'when' requires checking truthiness");
        return new ASTNode('When', tokens[1], parseBlock(state));
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
                out.push(indent + comment);
                break;
            
            case 'Loop':
                out.push(`${indent}for ${node.value} do`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END);
                break;
            
            case 'When':
                out.push(`${indent}when ${node.value} do`);
                node.children.forEach(c => visit(c, depth + 1));
                out.push(indent + END);
                break;
            
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
