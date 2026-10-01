import { isOperatorLexeme, WORD_OPERATOR_PATTERN, SYMBOL_OPERATOR_PATTERN } from "./operators.js"
import { TYPE_OF_GLYPH, isOpenType, isCloseType } from "./delimiters.js"
import { NUMBER_PATTERN } from "./number.js"
export { OPERATOR_LEXEMES as OPERATORS } from "./operators.js"

// Compile once per lexer, not once per expression. Numbers claim decimal dots
// and exponent signs; dotted identifiers remain whole. (id:tower-surface)
const TOKEN_PATTERN = [
    NUMBER_PATTERN,
    // Quoted strings — read as one token (its residual is the word's content), so a
    // `fn` body like 'ping' is lossless instead of silently stripped. The executor's
    // quote path handles whole quoted args; this covers the rest that reach a parser.
    '\'[^\']*\'|"[^"]*"',
    WORD_OPERATOR_PATTERN,
    '[a-zA-Z][a-zA-Z0-9_]*(?:\\.[a-zA-Z][a-zA-Z0-9_]*)*',
    SYMBOL_OPERATOR_PATTERN,
    '[\\[\\],\\(\\)]',
    '\\s+'
].join('|')

class Token {
    constructor(type, value, position = 0) {
        this.type = type;
        this.value = value;
        this.position = position;
    }
}

export class Lexer {
    constructor() {
        this.pattern = new RegExp(TOKEN_PATTERN, 'g');
    }

    tokenize(expression) {
        const tokens = [];
        const pattern = this.pattern;
        pattern.lastIndex = 0;
        let cursor = 0;
        let match;
        while ((match = pattern.exec(expression)) !== null) {
            // Exhaustive coverage: every source character must be claimed by a
            // token. A gap means the pattern skipped ink it cannot read — that
            // must refuse where it occurs, not vanish behind the child's back.
            // (phase 1: lossless reading)
            if (match.index !== cursor) {
                throw new Error(`Unknown token: ${expression[cursor]} at position ${cursor}`);
            }
            cursor = match.index + match[0].length;
            const value = match[0];

            // Skip whitespace (already consumed by the coverage check).
            if (/^\s+$/.test(value)) {
                continue;
            }

            let type;
            if (/^\d/.test(value)) {
                type = 'NUMBER';
            } else if (isOperatorLexeme(value)) {
                type = 'OPERATOR';
            } else if (/^[a-zA-Z]/.test(value)) {
                type = 'IDENTIFIER';
            } else if (TYPE_OF_GLYPH[value]) {
                type = TYPE_OF_GLYPH[value];
            } else if (value === ',') {
                type = 'COMMA';
            } else if (/^['"]/.test(value)) {
                type = 'STRING';
            } else {
                throw new Error(`Unknown token: ${value} at position ${match.index}`);
            }

            tokens.push(new Token(type, type === 'STRING' ? value.slice(1, -1) : value, match.index));
        }

        if (cursor < expression.length) {
            throw new Error(`Unknown token: ${expression[cursor]} at position ${cursor}`);
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
                    // number group: 2(x), 2[x]
                    (current.type === 'NUMBER' && isOpenType(next.type)) ||
                    // group identifier: (x)y, (x)sin
                    (isCloseType(current.type) && next.type === 'IDENTIFIER') ||
                    // group group: (x)(y), (x)[y], [x](y)
                    (isCloseType(current.type) && isOpenType(next.type)) ||
                    // identifier identifier: xy (if not functions with explicit args)
                    (current.type === 'IDENTIFIER' && next.type === 'IDENTIFIER') ||
                    // identifier number: x2
                    (current.type === 'IDENTIFIER' && next.type === 'NUMBER') ||
                    // identifier call/group: x(y), sin(x) is handled separately
                    (current.type === 'IDENTIFIER' && isOpenType(next.type) && !this.couldBeFunction(current, next, i, tokens))
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
