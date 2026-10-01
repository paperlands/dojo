import { ASTNode } from "../ast.js"
import { Lexer } from "./lexer.js"
import { getOperator } from "./operators.js"
import { isOpenType, isCloseType, closerTypeFor, glyphOf } from "./delimiters.js"
import { isNumericLiteral } from "./number.js"

export class Parser {
    constructor() {
        this.builtins = new Map([
            ['sin', 1], ['cos', 1], ['tan', 1],
            ['asin', 1], ['acos', 1], ['atan', 1],
            ['sqrt', 1], ['log', 1], ['exp', 1],
            ['abs', 1], ['atan2', 2], ['round', [1, 2]]
        ]);

        // User-defined functions keys by [name, arity]: [ast, params]
        this.userspace = new Map();
        // Bumped on every userspace write so expression parse-memos that
        // expanded 0-arity names (out → 0) cannot outlive a later `fn out …`.
        this.epoch = 0;
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
    parseExpression(minPrec, options = {}, includeEqual = true) {
        let left = this.parsePrimary(options);

        while (this.hasMoreTokens()) {
            const token = this.currentToken();

            const row = token.type === 'OPERATOR' && getOperator(token.value, 'infix');
            if (!row) break;

            const prec = row.prec;
            if (prec < minPrec || (prec === minPrec && !includeEqual)) break;

            const op = token.value;
            this.advance();

            // Strict binding for left association also admits fractional precedences.
            const right = this.parseExpression(prec, options, row.assoc === 'right');

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
        const row = token.type === 'OPERATOR' && getOperator(token.value, 'prefix');
        if (row) {
            const op = token.value;
            this.advance();
            const operand = this.parseExpression(row.prec, options);
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

        // Groups — ( … ) and [ … ], each closed only by its own kind
        if (isOpenType(token.type)) {
            return this.parseGroup(options);
        }

        // String literal — a LITERAL, not a reference. It keeps its own node so
        // evaluation can never mistake the word 'pi' for the constant pi.
        if (token.type === 'STRING') {
            this.advance();
            return new ASTNode('string', token.value);
        }
        throw new Error(`Unexpected token: ${token.value}`);
    }

    parseIdentifier(options) {
        const name = this.currentToken().value;
        this.advance();

        // Function call
        if (this.hasMoreTokens() && isOpenType(this.currentToken().type)) {
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
        const openType = this.currentToken().type;
        const closeType = closerTypeFor(openType);
        this.advance(); // consume the opener
        const args = this.parseArgumentList(closeType, options);

        if (!this.currentToken() || this.currentToken().type !== closeType) {
            throw this.closingError(openType);
        }
        this.advance(); // consume ')'

        // Validation — substitution deferred to evaluator for call-by-value.
        // Dotted names (sky.sine) skip validation — resolved at runtime via resolveExternal.
        if (!options.skipValidation && !name.includes('.')) {
            if (!this.functionExists(name, args.length)) {
                throw new Error(`Unknown function: ${name} with ${args.length} arguments`);
            }
        }

        return new ASTNode('function', name, args);
    }

    parseArgumentList(closeType, options) {
        const args = [];

        // Empty argument list
        if (this.currentToken()?.type === closeType) {
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

    parseGroup(options = {}) {
        const openType = this.currentToken().type;
        const closeType = closerTypeFor(openType);
        this.advance(); // consume the opener
        const expr = this.parseExpression(0, options);

        if (!this.currentToken() || this.currentToken().type !== closeType) {
            throw this.closingError(openType);
        }
        this.advance(); // consume the closer

        return expr;
    }

    // A close of the wrong kind is a mismatched pair; no close at all is missing.
    closingError(openType) {
        const found = this.currentToken();
        const expected = closerTypeFor(openType);
        if (found && isCloseType(found.type)) {
            return new Error(`Mismatched delimiters: '${glyphOf(openType)}' must close with '${glyphOf(expected)}', not '${found.value}'`);
        }
        return new Error(`Missing closing '${glyphOf(expected)}'`);
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
            // Don't substitute parameter names — they stay symbolic
            if (!params.includes(key)) {
                substitutions.set(key, new ASTNode('operand', ctx[key]));
            }
        }

        const subexpressionAST = this.substituteParameters(expressionAST, substitutions)


        const key = this.makeKey(name, params.length);
        this.userspace.set(key, [subexpressionAST, params]);
        // Parse expands 0-arity names into their bodies; a cached tree of
        // bare `out` must not survive this write. (label-before-fn mice bug)
        this.epoch++;
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
        if (this.builtins.has(name)) {
            const arities = this.builtins.get(name)
            if (Array.isArray(arities) ? arities.includes(arity) : arities === arity) return true
        }
        return this.userspace.has(this.makeKey(name, arity))
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

    isConstant(name) {
        return this.userspace.has(this.makeKey(name, 0));
    }

    isUserDefined(name, arity) {
        return this.userspace.has(this.makeKey(name, arity));
    }

    isNumeric(str) {
        if (typeof str !== "string") return false;
        return isNumericLiteral(str);
    }

    reset() {
        this.userspace = new Map();
        this.epoch++;
    }
}
