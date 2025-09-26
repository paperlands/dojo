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

        // User-defined functions keys by [name, arity]: [ast, params]
        this.userspace = new Map();
        this.lexer = new Lexer();
    }

    parse(expression, options = {}) {
        try {
            const tokens = this.lexer.tokenize(expression);
            this.tokens = tokens;
            this.position = 0;

            const ast = this.parseExpression(0, options);

            // Check for unexpected trailing tokens
            if (this.position < this.tokens.length) {
                const token = this.currentToken();
                if (token.value === ')' || token.value === ']') {
                    throw new Error('Missing opening brackets');
                }
                throw new Error(`Unexpected token: ${token.value}`);
            }

            return ast;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    // Precedence climbing parser
    parseExpression(minPrec, options = {}) {
        let left = this.parsePrimary(options);

        while (this.hasMoreTokens()) {
            const token = this.currentToken();

            if (!this.isBinaryOperator(token)) break;

            const prec = this.precedence[token.value];
            if (prec < minPrec) break;

            const op = token.value;
            this.advance();

            const nextMinPrec = this.rightAssociative.has(op) ? prec : prec + 1;
            const right = this.parseExpression(nextMinPrec, options);

            left = new ASTNode('operator', op, [left, right]);
        }

        return left;
    }

    parsePrimary(options = {}) {
        const token = this.currentToken();

        if (!token) {
            throw new Error('Unexpected end of expression');
        }

        // Unary operators
        if (this.isUnaryOperator(token)) {
            const op = token.value;
            this.advance();
            const operand = this.parsePrimary(options);
            return new ASTNode('unary_operator', op, [operand]);
        }

        // Numbers
        if (token.type === 'NUMBER') {
            this.advance();
            return new ASTNode('operand', parseFloat(token.value));
        }

        // Identifiers (variables, constants, functions)
        if (token.type === 'IDENTIFIER') {
            return this.parseIdentifier(options);
        }

        // Parentheses
        if (token.type === 'LPAREN') {
            return this.parseParentheses(options);
        }

        throw new Error(`Unexpected token: ${token.value}`);
    }

    parseIdentifier(options) {
        const name = this.currentToken().value;
        this.advance();

        // Function call
        if (this.hasMoreTokens() && this.currentToken().type === 'LPAREN') {
            return this.parseFunctionCall(name, options);
        }

        // User-defined constant (0-arity function)
        if (this.isConstant(name) && !options.skipValidation) {
            return this.substituteUserFunction(name, [])
        }

        // Variable
        return new ASTNode('operand', name);
    }

    parseFunctionCall(name, options = {}) {
        this.advance(); // consume '('
        const args = this.parseArgumentList(options);

        if (!this.currentToken() || this.currentToken().type !== 'RPAREN') {
            throw new Error('Missing closing parenthesis in function call');
        }
        this.advance(); // consume ')'

        // Validation and substitution
        if (!options.skipValidation) {
            if (!this.functionExists(name, args.length)) {
                throw new Error(`Unknown function: ${name} with ${args.length} arguments`);
            }

            if (this.isUserDefined(name, args.length)) {
                return this.substituteUserFunction(name, args);
            }
        }

        return new ASTNode('function', name, args);
    }

    parseArgumentList(options) {
        const args = [];

        // Empty argument list
        if (this.currentToken()?.type === 'RPAREN') {
            return args;
        }

        // Parse comma-separated arguments
        do {
            args.push(this.parseExpression(0, options));

            if (this.currentToken()?.type === 'COMMA') {
                this.advance();
            } else {
                break;
            }
        } while (this.hasMoreTokens());

        return args;
    }

    parseParentheses(options) {
        this.advance(); // consume '('
        const expr = this.parseExpression(0, options);

        if (!this.currentToken() || this.currentToken().type !== 'RPAREN') {
            throw new Error('Missing closing brackets');
        }
        this.advance(); // consume ')'

        return expr;
    }

    // User-defined function management
    defineFunction(signature, expression, ctx = {}) {
        const signatureAST = this.parseSignature(signature);
        const { name, params } = this.extractSignature(signatureAST);

        if (this.builtins.has(name)) {
            throw new Error(`Cannot override built-in function ${name}`);
        }

        const expressionAST = this.parse(expression);

        const substitutions = new Map();

        for (const key of Object.keys(ctx)) {
            substitutions.set(key, new ASTNode('operand', ctx[key]));
        }

        const subexpressionAST = this.substituteParameters(expressionAST, substitutions)


        const key = this.makeKey(name, params.length);
        this.userspace.set(key, [subexpressionAST, params]);
    }

    parseSignature(signature) {
        try {
            return this.parse(signature, { skipValidation: true });
        } catch (error) {
            throw new Error(`Invalid function signature: ${signature}`);
        }
    }

    extractSignature(ast) {
        if (ast.type === 'operand') {
            // Constant definition: f = expression
            return { name: ast.value, params: [] };
        }

        if (ast.type === 'function') {
            // Function definition: f(x, y) = expression
            const name = ast.value;
            const params = ast.children.map(child => {
                if (child.type !== 'operand') {
                    throw new Error('Function parameters must be identifiers');
                }
                return child.value;
            });
            return { name, params };
        }

        throw new Error('Invalid function signature format');
    }

    substituteUserFunction(name, args) {
        const [ast, params] = this.getUserFunction(name, args.length);

        if (args.length === 0 ) {
            // Constant - return cloned AST
            return this.cloneAST(ast);
        }

        // Create parameter substitution map Object.entries(ctx)
        const substitutions = new Map();

        for (let i = 0; i < params.length; i++) {
            substitutions.set(params[i], args[i]);
        }

        // Substitute parameters in the function body
        return this.substituteParameters(this.cloneAST(ast), substitutions);
    }

    substituteParameters(ast, substitutions) {
        if (ast.type === 'operand' && typeof ast.value === 'string') {
            // Replace parameter with argument
            if (substitutions.has(ast.value)) {
                return this.cloneAST(substitutions.get(ast.value));
            }
        }

        // Recursively substitute in children
        if (ast.children) {
            ast.children = ast.children.map(child =>
                this.substituteParameters(child, substitutions)
            );
        }

        return ast;
    }

    cloneAST(ast) {
        const cloned = new ASTNode(ast.type, ast.value, [], { ...ast.meta });
        if (ast.children) {
            cloned.children = ast.children.map(child => this.cloneAST(child));
        }
        return cloned;
    }

    // Function lookup helpers
    makeKey(name, arity) {
        return `${name}:${arity}`;
    }

    functionExists(name, arity) {
        return this.builtins.has(name) && this.builtins.get(name) === arity ||
               this.userspace.has(this.makeKey(name, arity));
    }

    getUserFunction(name, arity) {
        const key = this.makeKey(name, arity);
        if (!this.userspace.has(key)) {
            throw new Error(`Unknown user function: ${name} with ${arity} arguments`);
        }
        return this.userspace.get(key);
    }

    // Token and operator helpers
    currentToken() {
        return this.hasMoreTokens() ? this.tokens[this.position] : null;
    }

    advance() {
        this.position++;
    }

    hasMoreTokens() {
        return this.position < this.tokens.length;
    }

    isBinaryOperator(token) {
        return token?.type === 'OPERATOR' && this.precedence.hasOwnProperty(token.value);
    }

    isUnaryOperator(token) {
        return token?.type === 'OPERATOR' && this.unaryOperators.has(token.value);
    }

    isConstant(name) {
        return this.userspace.has(this.makeKey(name, 0));
    }

    isUserDefined(name, arity) {
        return this.userspace.has(this.makeKey(name, arity));
    }

    isNumeric(str) {
        if (typeof str !== "string") return false;
        return !isNaN(str) && !isNaN(parseFloat(str));
    }

    reset() {
        this.userspace = new Map();
    }
}
