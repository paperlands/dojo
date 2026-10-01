import { getOperator } from "./operators.js"

import { isNumericLiteral } from "./number.js"
// Nothing is not a measure. `null + 1` is 1 in JavaScript, so a read that had
// no answer must not become a quantity. Arithmetic yields nothing instead;
// a command still refuses at the demand. (id:eval-relational)
function hasNothing(...values) {
    return values.some((value) => value === null || value === undefined)
}

// Integer division and remainder. For SAFE INTEGERS with a nonzero divisor the
// quotient and remainder are exact, so `(a // b) * b + a mod b = a` holds — as a
// statement about the operands, NOT a promise that the language's own * and +
// stay exact outside the safe range (that is a Phase 3 rounding question). The
// remainder is computed directly (a % b is exact for integers) and rebased only
// when its sign disagrees with the divisor — an add that cannot overflow because
// |a % b| < |b|; division is then the exact inverse. Non-integers keep their
// floating approximation, unchanged until Phase 3. (phase 1: safe-integer behaviour)
function integerMod(a, b) {
    // Exact only for integer pairs; the floating branch is left as it was, so this
    // is an integer repair — not a silent change to floating remainder (Phase 3 rules).
    if (Number.isSafeInteger(a) && Number.isSafeInteger(b) && b !== 0) {
        const m = a % b
        if (m !== 0 && (m < 0) !== (b < 0)) return m + b
        return m === 0 ? 0 : m   // normalize the -0 `a % b` can leave
    }
    return ((a % b) + b) % b
}
function integerDiv(a, b) {
    if (Number.isSafeInteger(a) && Number.isSafeInteger(b) && b !== 0) {
        // Truncated quotient without the overflow of `(a - flooredRemainder)`.
        // `a % b` is exact for integers and carries a's sign, so `a - (a % b)`
        // moves toward zero and always stays a safe integer.
        const m = a % b
        const qt = (a - m) / b
        const q = (m !== 0 && (m < 0) !== (b < 0)) ? qt - 1 : qt
        return q === 0 ? 0 : q   // normalize the -0 a negative divisor would leave
    }
    return Math.floor(a / b)
}

export class Evaluator {
    constructor() {
        this.constants = {
            'pi': () => Math.PI,
            'e': () => Math.E,
            'random': () => Math.random(),
        };

        this.functions = {
            'sin': (x) => Math.sin(this.toRadians(x)),
            'cos': (x) => Math.cos(this.toRadians(x)),
            'tan': (x) => Math.tan(this.toRadians(x)),
            'asin': (x) => this.toDegrees(Math.asin(x)),
            'acos': (x) => this.toDegrees(Math.acos(x)),
            'atan': (x) => this.toDegrees(Math.atan(x)),
            'sqrt': Math.sqrt,
            'log': Math.log,
            'exp': Math.exp,
            'abs': Math.abs,
            'atan2': (y, x) => this.toDegrees(Math.atan2(y, x)),
            'round': (x, to = 1) => Math.round(x / to) * to
        };

        // Deferred = stochastic/streaming primitives that must re-evaluate at
        // each use, never folded into an fn body at definition time. Foldable
        // literals (pi, e) and context snapshots (x,y,z,count,time) may fold eagerly.
        this.deferred = new Set(['random']);

        // TODO: Numerical Tower extensible hierarchy of generic mathematical operations that
        // transparently handles type promotion and combinations
        // The hierarchy might follow this standard nesting:
        // Integers Rationals Reals Complex Numbers (deal w up/down tuples, vectors, and differential forms)

        
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

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    toDegrees(radians) {
        return radians * (180 / Math.PI);
    }

    applyFunction(func, args, context) {
        if (hasNothing(...args)) return null
        if (func in this.functions) {
            const evals = this.functions[func](...args)
            if (Number.isSafeInteger(evals)) return evals
            const precision = 100000000000000;
            return Math.round((evals)*precision)/precision
        }
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
        switch(row.lexeme) {
        case '!':
            return !operand;
        case '+':
            return +operand;
        case '-':
            return -operand;
        default:
            throw new Error('Unsupported operator');
        }
    }

    applyOperator(operator, left, right) {
        if (hasNothing(left, right)) return null
        const row = getOperator(operator, 'infix');
        if (!row) throw new Error(`Unknown operator: ${operator}`);

        if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)){
            const precision = 100000000000000;
            switch (row.lexeme) {
                // Arithmetic operators
            case '+': return Math.round((left + right)*precision)/precision;
            case '-': return Math.round((left - right)*precision)/precision;
            default: break
            }
        }

        switch (row.lexeme) {
            // Logical operators
        case '&&': return left && right;
        case '||': return left || right;
        case '&': return left & right;  // Bitwise AND
        case '|': return left | right;  // Bitwise OR

            // Comparison operators
        case '===': return left === right ? 1 : 0;
        case '!==': return left !== right ? 1 : 0;
        case '==': return left == right ? 1 : 0;
        case '!=': return left != right ? 1 : 0;
        case '>=': return left >= right ? 1 : 0;
        case '>': return left > right ? 1 : 0;
        case '<=': return left <= right ? 1 : 0;
        case '<': return left < right ? 1 : 0;

        case '^': return Math.pow(left, right);
        case '//': return integerDiv(left, right);
        case 'mod': return integerMod(left, right);
        case '*': return left * right;
        case '/': return left / right;
        case '+': return left + right;
        case '-': return left - right;

        default: throw new Error(`Unknown operator: ${operator}`);
        }
    }
}
