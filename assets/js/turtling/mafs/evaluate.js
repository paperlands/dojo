import { getOperator } from "./operators.js"
import { isNumericLiteral } from "./number.js"
import { createTower, installScalarFloor } from "./tower.js"

// Nothing is not a measure. `null + 1` is 1 in JavaScript, so a read that had
// no answer must not become a quantity. Arithmetic yields nothing instead;
// a command still refuses at the demand. (id:eval-relational)
function hasNothing(...values) {
    return values.some((value) => value === null || value === undefined)
}

export class Evaluator {
    constructor() {
        this.constants = {
            'pi': () => Math.PI,
            'e': () => Math.E,
            'random': () => Math.random(),
        };

        // Scalar meanings now live in the center (mafs/tower.js): operators and
        // builtins are registrations, not a switch. Installation ends here and the
        // registry is sealed, so no later define reinterprets a computation already
        // in flight. (id:tower-center-boundaries)
        this.tower = installScalarFloor(createTower())
        this.tower.seal()

        // Deferred = stochastic/streaming primitives that must re-evaluate at
        // each use, never folded into an fn body at definition time. Foldable
        // literals (pi, e) and context snapshots (x,y,z,count,time) may fold eagerly.
        this.deferred = new Set(['random']);

        this.userFunctions = null;
    }

    namespace_check(val) {
        if (val in this.constants) return true
        // Dotted paths (ambient.property) resolve through evaluator chain
        if (typeof val === 'string' && val.includes('.') && this.resolveExternal) return true
        return false
    }

    run(ast, context) {
        if (!ast) return 0;

        // A literal evaluates to itself — never resolved as a name.
        if (ast.type === 'string') return ast.value;

        if (ast.type === 'operand') {
            // Function/constant folding may leave a number in the AST. Keep it
            // numeric; routing it through name resolution breaks on exponents.
            if (typeof ast.value === 'number') return ast.value;
            if (isNumericLiteral(ast.value)) {
                return parseFloat(ast.value);
            }
            else if (context && ast.value in context) {
                return context[ast.value];
            }
            else if (ast.value in this.constants) {
                return this.constants[ast.value]();
            } else {
                return this.resolveContext(ast.value, context);
            }
        } else if (ast.type === 'function') {
            const args = ast.children.map(child => this.run(child, context));
            return this.applyFunction(ast.value, args, context);
        } else if (ast.type === 'operator') {
            const left = this.run(ast.children[0], context);
            const right = this.run(ast.children[1], context);
            return this.applyOperator(ast.value, left, right);
        }
        else if (ast.type === 'unary_operator'){
            const operand = this.run(ast.children[0], context);
            return this.applyUnaryOperator(ast.value, operand)
        }
    }

    applyFunction(func, args, context) {
        if (hasNothing(...args)) return null
        // A scalar builtin is a center registration now; the same door the
        // operators use. Anything else falls through to user functions and
        // ambient resolution, which stay outside the algebra.
        // Identify the callable before testing applicability: a known builtin
        // owns its name even when its operands are unsupported, so it refuses
        // through the center instead of leaking to another resolver.
        if (this.tower.known(func)) return this.tower.apply(func, ...args)
        if (this.userFunctions) {
            const key = `${func}:${args.length}`;
            const entry = this.userFunctions.get(key);
            if (entry) {
                const [body, params] = entry;
                const childContext = { ...context };
                params.forEach((p, i) => { childContext[p] = args[i]; });
                return this.run(body, childContext);
            }
        }
        if (this.resolveExternal) {
            const result = this.resolveExternal(func, args);
            if (result !== undefined) return result;
        }
        throw new Error(`Undefined function: ${func}`);
    }

    resolveContext(variable, context) {
        if (variable in context) {
            return context[variable];
        }
        if (this.resolveExternal) {
            const resolved = this.resolveExternal(variable);
            if (resolved !== undefined) return resolved;
        }
        throw new Error(`Undefined variable: ${variable}`);
    }

    applyUnaryOperator(operator, operand) {
        if (hasNothing(operand)) return null
        const row = getOperator(operator, 'prefix');
        if (!row) throw new Error('Unsupported operator');
        return this.tower.apply(row.lexeme, operand)
    }

    applyOperator(operator, left, right) {
        if (hasNothing(left, right)) return null
        const row = getOperator(operator, 'infix');
        if (!row) throw new Error(`Unknown operator: ${operator}`);
        return this.tower.apply(row.lexeme, left, right)
    }
}
