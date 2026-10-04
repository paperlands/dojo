import { ASTNode } from "../ast.js"
import { Lexer } from "./lexer.js"
import { getOperator } from "./operators.js"
import { isOpenType, isCloseType, closerTypeFor, glyphOf } from "./delimiters.js"
import { isNumericLiteral } from "./number.js"
import { SCALAR_BUILTINS, SHADOWABLE_BUILTINS } from "./tower.js"

// A held value is not a name: it gets its own node, exactly as a string literal
// does, so no evaluation can resolve a capture as a reference. Plain data is copied,
// so a held value is never an alias to a live pose. (id:tower-tension-repr)
export function heldValue(value) {
    if (Array.isArray(value)) return value.map(heldValue)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, heldValue(v)]))
    }
    return value
}

export class Parser {
    constructor() {
        // One owner for the builtin signatures: the center's own description. The
        // parser reserves these names and checks their arity from the same list the
        // evaluator dispatches from, so the two can never disagree.
        // (id:notation-phase-center)
        this.builtins = new Map(SCALAR_BUILTINS.map((builtin) => [builtin.name, builtin.arity]));
        // Which of those names yield to the child's own fn. (id:tower-center-shadowable)
        this.shadowable = new Set(SHADOWABLE_BUILTINS);

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
            // A literal is a VALUE, not a name — its own node, exactly as a string
            // literal has its own. (id:tower-synth-literal)
            return new ASTNode('literal', parseFloat(token.value));
        }

        // Identifiers (variables, constants, functions)
        if (token.type === 'IDENTIFIER') {
            return this.parseIdentifier(options);
        }

        // Groups — ( … ) and [ … ], each closed only by its own kind
        if (isOpenType(token.type)) {
            return this.parseGroup(options);
        }

        // A quoted name is a string followed by a path, not reparsed source.
        // It stays an AST read in commands, definitions and figure questions.
        if (token.type === 'STRING') {
            this.advance();
            const name = new ASTNode('string', token.value);
            if (this.currentToken()?.type !== 'DOT') return name;
            this.advance();
            const path = this.currentToken();
            if (path?.type !== 'IDENTIFIER') throw new Error('Expected a property after quoted name');
            this.advance();
            if (isOpenType(this.currentToken()?.type)) {
                const call = this.parseFunctionCall('.' + path.value, options);
                return new ASTNode('access_call', path.value, [name, ...call.children]);
            }
            return new ASTNode('access', path.value, [name]);
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

    // A comma-list is a QUANTITY; the delimiter names its kind. `(a, b, c)` is a
    // coordinate (a point — where), `[a, b, c]` a vector (a displacement — which
    // way, how far). Without a comma `(e)` still groups and `[e]` is the singleton
    // vector. A suffix `f[…]/f(…)` after a name is still application.
    // (id:notation-coordinate-vector)
    parseGroup(options = {}) {
        const openType = this.currentToken().type;
        const closeType = closerTypeFor(openType);
        const isBracket = openType === 'LBRACKET';
        this.advance(); // consume the opener

        if (isBracket && this.currentToken()?.type === closeType) {
            throw new Error('An empty vector literal has no components');
        }

        const elements = [this.parseExpression(0, options)];
        let listed = isBracket;   // a bracket is always a list, even the singleton
        while (this.currentToken()?.type === 'COMMA') {
            this.advance(); // consume the comma
            listed = true;   // a comma marks a list, even a terminal one
            // A terminal comma contributes no component; the empty slot is still
            // refused — `[x,,y]`, `[x,,]`, `(x,,y)` do not parse.
            if (this.currentToken()?.type === closeType) break;
            elements.push(this.parseExpression(0, options));
        }
        if (this.currentToken()?.type !== closeType) {
            throw this.closingError(openType);
        }
        this.advance(); // consume the closer

        if (!listed) return elements[0];   // `(e)` groups
        return new ASTNode(isBracket ? 'vector' : 'point', null, elements);
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

        // A shadowable builtin (round, mod) yields to the child's own definition;
        // the rest stay reserved. (id:tower-center-shadowable)
        if (this.builtins.has(name) && !this.shadowable.has(name)) {
            throw new Error(`Cannot override built-in function ${name}`);
        }

        const expressionAST = this.parse(expression);

        const substitutions = new Map();

        for (const key of Object.keys(ctx)) {
            // Don't substitute parameter names — they stay symbolic
            if (!params.includes(key)) {
                // A captured value is held, never referenced: its own node and a copy,
                // so the body reads the snapshot it was declared with. (id:tower-tension-repr)
                substitutions.set(key, new ASTNode('literal', heldValue(ctx[key])));
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
        // A literal's payload is copied here too: two instantiations of one body
        // must not share one array. (id:tower-tension-repr)
        const value = ast.type === 'literal' ? heldValue(ast.value) : ast.value
        const cloned = new ASTNode(ast.type, value, [], { ...ast.meta });
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
