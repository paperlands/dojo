import { ASTNode } from "../ast.js"
import { Lexer } from "./lexer.js"

export class Parser {
    constructor() {
        // Clean precedence table - only binary operators and their precedence
        this.precedence = {
            '||': 1,
            '&&': 2,
            '|': 3,
            '&': 4,
            '===': 5, '!==': 5, '==': 5, '!=': 5,
            '>=': 6, '>': 6, '<=': 6, '<': 6,
            '+': 7, '-': 7,
            '*': 8, '/': 8, '//': 8,
            '^': 9
        };

        this.rightAssociative = new Set(['^']);
        this.unaryOperators = new Set(['+', '-', '!']);

        this.builtins = new Map([
            ['sin', 1], ['cos', 1], ['tan', 1],
            ['asin', 1], ['acos', 1], ['atan', 1],
            ['sqrt', 1], ['log', 1], ['exp', 1],
            ['abs', 1], ['floor', 1], ['ceil', 1]
        ]);

        this.userspace = new Map();
        this.lexer = new Lexer();
    }

    run(expression) {
        try {
            const tokens = this.lexer.tokenize(expression);
            return this.parseExpression(tokens);
        } catch (error) {
            throw new Error(`${error.message}`);
        }
    }

    parseExpression(tokens) {
        this.tokens = tokens;
        this.position = 0;

        const ast = this.parseExpression_Precedence(0);

        if (this.position < this.tokens.length) {
            if (this.currentToken().value == ")" || this.currentToken().value == "]") throw new Error(`Missing opening backets`)
            throw new Error(`Unexpected token: ${this.currentToken().value}`);
        }

        return ast;
    }

    // Precedence climbing algorithm not shunting yard
    parseExpression_Precedence(minPrec) {
        let left = this.parsePrimary();

        while (this.position < this.tokens.length) {
            const token = this.currentToken();

            if (token.type !== 'OPERATOR' || !(token.value in this.precedence)) {
                break;
            }

            const prec = this.precedence[token.value];
            if (prec < minPrec) {
                break;
            }

            const op = token.value;
            this.advance();

            const nextMinPrec = this.rightAssociative.has(op) ? prec : prec + 1;
            const right = this.parseExpression_Precedence(nextMinPrec);

            left = new ASTNode('operator', op, [left, right]);
        }

        return left;
    }

    parsePrimary() {
        const token = this.currentToken();

        if (!token) {
            throw new Error('Unexpected end of expression');
        }

        // Handle unary operators
        if (token.type === 'OPERATOR' && this.unaryOperators.has(token.value)) {
            const op = token.value;
            this.advance();
            const operand = this.parsePrimary(); // Recursive call for right associativity
            return new ASTNode('unary_operator', op, [operand]);
        }

        // Handle numbers
        if (token.type === 'NUMBER') {
            this.advance();
            return new ASTNode('operand', token.value);
        }

        // Handle identifiers (variables or functions)
        if (token.type === 'IDENTIFIER') {
            const name = token.value;
            this.advance();

            // Check if it's a function call
            if (this.position < this.tokens.length && this.currentToken().type === 'LPAREN') {
                return this.parseFunctionCall(name);
            }

            // It's a variable
            return new ASTNode('operand', name);
        }

        // Handle parentheses
        if (token.type === 'LPAREN') {
            this.advance(); // consume '('
            const expr = this.parseExpression_Precedence(0);

            if (!this.currentToken() || this.currentToken().type !== 'RPAREN') {
                throw new Error('Missing closing brackets');
            }

            this.advance(); // consume ')'
            return expr;
        }


        throw new Error(`Unexpected token: ${token.value}`);
    }

    parseFunctionCall(name) {
        this.advance(); // consume '('

        const args = [];

        // Handle empty argument list
        if (this.currentToken() && this.currentToken().type === 'RPAREN') {
            this.advance();
            const expectedArity = this.getFunctionArity(name);
            if (expectedArity !== 0) {
                throw new Error(`Function ${name} expects ${expectedArity} arguments, but got 0`);
            }
            return new ASTNode('function', name, args);
        }

        // Parse arguments
        do {
            args.push(this.parseExpression_Precedence(0));

            if (this.currentToken() && this.currentToken().type === 'COMMA') {
                this.advance(); // eat ','
            } else {
                break;
            }
        } while (this.position < this.tokens.length);

        if (!this.currentToken() || this.currentToken().type !== 'RPAREN') {
            throw new Error('Missing closing parenthesis in function call');
        }

        this.advance(); // eat ')'

        // Validate arity
        const expectedArity = this.getFunctionArity(name);
        if (expectedArity !== args.length) {
            throw new Error(`Function ${name} expects ${expectedArity} arguments, but got ${args.length}`);
        }

        return new ASTNode('function', name, args);
    }

    currentToken() {
        return this.position < this.tokens.length ? this.tokens[this.position] : null;
    }

    advance() {
        this.position++;
    }



    defineFunction(signature, expression) {
        // parse signature in defn mode
        const signatureAST = this.parseSignature(signature);

        const name = signatureAST.value;
        const params = signatureAST.children.map(child => {
            if (child.type !== 'operand') {
                throw new Error(`Function parameters must be identifiers: ${signature}`);
            }
            return child.value;
        });

        if (this.builtins.has(name)) {
            throw new Error(`Cannot override built-in function ${name}`);
        }

        // Parse expression once and store as lazy AST
        const expressionAST = this.run(expression);

        this.userspace.set(name, [expressionAST, params.length, params]);
    }

    parseSignature(signature) {
        // Temporarily allow unknown functions during signature parsing
        const originalIsFunction = this.isFunction.bind(this);
        this.isFunction = (token) => originalIsFunction(token) || /^[a-zA-Z][a-zA-Z0-9_]*$/.test(token);

        try {
            const ast = this.run(signature);
            if (ast.type !== 'function') {
                throw new Error(`Invalid function signature: ${signature}`);
            }
            return ast;
        } finally {
            // Restore original function check
            this.isFunction = originalIsFunction;
        }
    }

    getFunctionArity(funcName) {
        if (this.builtins.has(funcName)) {
            return this.builtins.get(funcName);
        }
        if (this.userspace.has(funcName)) {
            return this.userspace.get(funcName)[1];
        }
        throw new Error(`Unknown function: ${funcName}`);
    }

    isFunction(token) {
        return this.builtins.has(token) || this.userspace.has(token);
    }

    isNumeric(str) {
        if (typeof str !== "string") return false;
        return !isNaN(str) && !isNaN(parseFloat(str));
    }
}
