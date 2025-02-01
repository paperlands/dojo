import { ASTNode } from "./ast.js"

function tokenize(program) {
    return program
        .replace(/#.*?(?=\n|$)/g, '') // Keep the comment handling
        .replace(/end/g, 'end\n') // Ensure 'end' is on a new line
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

// Helper function to parse a single line into tokens
function parseTokens(line) {
    const [code, commie] = line.split('#');
    return [code.trim().split(/\s+/), new ASTNode('Lit', commie)];
}

// Helper function to parse a block of lines
function parseBlock(lines, blockStack) {
    const block = [];
    blockStack.push(block);
    while (lines.length > 0) {
        const line = lines.shift();
        if (line === 'end') {
            return blockStack.pop();
        }
        block.push(parseLine(line, lines, blockStack));
    }
    throw new Error("Unmatched opening block");
}

// Function to parse a single line
function parseLine(line, lines, blockStack) {
    const [tokens, litcomment] = parseTokens(line);
    const command = tokens.shift();
    if (command === 'for' || command === 'loop') {
        const times = tokens.shift();
        if (tokens.shift() !== 'do') throw new Error("Expected ' do' after 'for'");
        return new ASTNode('Loop', times, parseBlock(lines, blockStack));
    } else if (command === 'draw') {
        const funcName = tokens.shift();
        if (tokens.pop() !== 'do') throw new Error("Expected ' do' at the end of 'draw'");
        const args = tokens.map(arg => new ASTNode('Argument', arg));
        return new ASTNode('Define', funcName, parseBlock(lines, blockStack), { args: args });
    } else if (command === 'when') {
        const pattern = tokens.shift();
        if (tokens.pop() !== 'do') throw new Error("Expected ' do' at the end of 'when'");
        return new ASTNode('When', pattern, parseBlock(lines, blockStack));
    } else if (!command) {
        return litcomment;
    } else {
        const args = tokens.map(arg => new ASTNode('Argument', arg));
        return new ASTNode('Call', command, args);
    }
}

// Main function to parse the entire program
export function parseProgram(program) {
    const lines = tokenize(program);
    const ast = [];
    const blockStack = [ast];

    while (lines.length > 0) {
        const line = lines.shift();
        blockStack[blockStack.length - 1].push(parseLine(line, lines, blockStack));
    }

    if (blockStack.length > 1) {
        throw new Error("Missing end unmatched opening do");
    }

    return ast;
}

export function printAST(ast) {
    let output = [];

    function visit(node, indent = 0) {
        const indentStr = ' '.repeat(indent * 2);

        if (node.type === 'Call') {
            output.push(`${indentStr}${node.value} ${node.children.map(child => visit(child, 0)).join(' ')}`);
        } else if (node.type === 'Argument') {
            return node.value;
        } else if (node.type === 'Lit') {
            output.push(`${indentStr}# ${node.value.trim()}`);
        } else if (node.type === 'Loop') {
            output.push(`${indentStr}for ${node.value} do`);
            node.children.forEach(child => visit(child, indent + 1));
            output.push(`${indentStr}end`);
        } else if (node.type === 'When') {
            output.push(`${indentStr}when ${node.value} do`);
            node.children.forEach(child => visit(child, indent + 1));
            output.push(`${indentStr}end`);
        } else if (node.type === 'Define') {
            output.push(`${indentStr}draw ${node.value} ${(node.meta.args || []).map(arg => visit(arg, 0)).join(' ')} do`);
            node.children.forEach(child => visit(child, indent + 1));
            output.push(`${indentStr}end`);
        }
    }

    ast.forEach(node => visit(node));
    return output.join('\n');

}
