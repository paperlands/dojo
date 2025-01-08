export class Evaluator {
    constructor() {
        // Define mathematical constants
        this.constants = {
            'pi': Math.PI,
            'e': Math.E,
            'random': Math.random()
        };

        // Define function mappings
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
    }

    run(ast, context) {
        if (!ast) return 0;

        if (ast.type === 'operand') {
            if (/^\d+\.?\d*$/.test(ast.value)) {
                return parseFloat(ast.value);
            } else if (ast.value === "random") {
                return Math.random();
            } else if (ast.value in this.constants) {
                return this.constants[ast.value];
            } else {
                return this.resolveContext(ast.value, context);
            }
        } else if (ast.type === 'function') {
            const arg = this.run(ast.children[0], context);
            return this.applyFunction(ast.value, arg);
        } else if (ast.type === 'operator') {
            const left = this.run(ast.left, context);
            const right = this.run(ast.right, context);
            return this.applyOperator(ast.value, left, right);
        }
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    toDegrees(radians) {
        return radians * (180 / Math.PI);
    }

    applyFunction(func, arg) {
        if (func in this.functions) {
            return this.functions[func](arg);
        }
        throw new Error(`Undefined function: ${func}`);
    }

    resolveContext(variable, context) {
        if (variable in context) {
            return context[variable];
        }
        throw new Error(`Undefined variable: ${variable}`);
    }

    applyOperator(operator, left, right) {
        switch (operator) {
            case '&': return left && right;
            case '|': return left || right;
            case '>': return (left > right) ? left || 1 : 0;
            case '<': return (left < right) ? left || 1 : 0;
            case '=': return (left === right) ? left || 1 : 0;
            case '^': return Math.pow(left, right);
            case '*': return left * right;
            case '/': return (left / right == Infinity) ? 2147483647 : left / right;
            case '+': return left + right;
            case '-': return left - right;
            default: throw new Error(`Unknown operator: ${operator}`);
        }
    }
}
