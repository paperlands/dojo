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
            'exp': Math.exp
        };

        // Deferred (late-evaluated) constants: stochastic / streaming primitives that
        // must re-evaluate at each point of use and must never be folded into an fn body
        // at definition time. Foldable literals (pi, e) and contextual snapshots
        // (x, y, z, count, time) are NOT here — they may be captured eagerly. Seed of the
        // scmutils numerical tower: values-now vs generators-per-access.
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

        if (ast.type === 'operand') {
            if (/^\d+\.?\d*$/.test(ast.value)) {
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
        if (func in this.functions) {
            const evals = this.functions[func](args[0])
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
        switch(operator) {
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

        if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)){
            const precision = 100000000000000;
            switch (operator) {
                // Arithmetic operators
            case '+': return Math.round((left + right)*precision)/precision;
            case '--': return Math.round((left + right)*precision)/precision;
            case '+-': return Math.round((left - right)*precision)/precision;
            case '-': return Math.round((left - right)*precision)/precision;
            default: break
            }
        }

        if(operator == "-") return left - right

        // account of negative numbers
        if (operator[operator.length - 1] == "-") {
            right = -right
            operator = operator.slice(0, -1)
        }
        switch (operator) {
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
        case '//': return left % right;
        case '*': return left * right;
        case '/': return left / right;
        case '+': return left + right;
        case '-': return left - right;

        default: throw new Error(`Unknown operator: ${operator}`);
        }
    }
}
