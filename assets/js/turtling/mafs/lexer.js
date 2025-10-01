class Token {
    constructor(type, value, position = 0) {
        this.type = type;
        this.value = value;
        this.position = position;
    }
}


export class Lexer {
    constructor() {
        // Multi-character operators must be checked in order of length (longest first)
        this.operators = [
            '===', '!==', '&&', '||',
            '>=', '<=', '==', '!=', '//',
            '+', '-', '*', '/', '^',
            '>', '<', '&', '|', '!'
        ];

        this.operatorRegex = new RegExp(
            this.operators.map(op => this.escapeRegex(op)).join('|')
        );
    }

    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    tokenize(expression) {
        const tokens = [];
        let position = 0;

        //tokenization pattern
        const pattern = new RegExp([
            // Numbers (including decimals)
            '\\d+(?:\\.\\d+)?',
            // Multi-character operators (must come before single chars)
            this.operators.map(op => this.escapeRegex(op)).join('|'),
            // Identifiers (functions/variables)
            '[a-zA-Z][a-zA-Z0-9_]*',
            // Single character tokens
            '[\\[\\],\\(\\)]',
            // Skip whitespace
            '\\s+'
        ].join('|'), 'g');

        let match;
        while ((match = pattern.exec(expression)) !== null) {
            const value = match[0];

            // Skip whitespace
            if (/^\s+$/.test(value)) {
                continue;
            }

            let type;
            if (/^\d/.test(value)) {
                type = 'NUMBER';
            } else if (this.operators.includes(value)) {
                type = 'OPERATOR';
            } else if (/^[a-zA-Z]/.test(value)) {
                type = 'IDENTIFIER';
            } else if (value === '[' || value === '(') {
                type = 'LPAREN';
            } else if (value === ']' || value === ')') {
                type = 'RPAREN';
            } else if (value === ',') {
                type = 'COMMA';
            } else {
                throw new Error(`Unknown token: ${value} at position ${match.index}`);
            }

            tokens.push(new Token(type, value, match.index));
        }

        return this.insertImplicitMultiplication(tokens);
    }

    insertImplicitMultiplication(tokens) {
        const result = [];

        for (let i = 0; i < tokens.length; i++) {
            result.push(tokens[i]);

            if (i < tokens.length - 1) {
                const current = tokens[i];
                const next = tokens[i + 1];

                const shouldInsertMult = (
                    // number identifier: 2x, 2sin
                    (current.type === 'NUMBER' && next.type === 'IDENTIFIER') ||
                    // number paren: 2(x)
                    (current.type === 'NUMBER' && next.type === 'LPAREN') ||
                    // paren identifier: (x)y, (x)sin
                    (current.type === 'RPAREN' && next.type === 'IDENTIFIER') ||
                    // paren paren: (x)(y)
                    (current.type === 'RPAREN' && next.type === 'LPAREN') ||
                    // identifier identifier: xy (if not functions with explicit args)
                    (current.type === 'IDENTIFIER' && next.type === 'IDENTIFIER') ||
                    // identifier number: x2
                    (current.type === 'IDENTIFIER' && next.type === 'NUMBER') ||
                    // identifier paren: x(y), sin(x) is handled separately
                    (current.type === 'IDENTIFIER' && next.type === 'LPAREN' && !this.couldBeFunction(current, next, i, tokens))
                );

                if (shouldInsertMult) {
                    result.push(new Token('OPERATOR', '*', current.position));
                }
            }
        }

        return result;
    }

    couldBeFunction(identifierToken, parenToken, index, tokens) {
        // Simple heuristic: if identifier is followed by (, assume function call
        //  could check against known function names
        return true; // Conservative approach
    }
}
