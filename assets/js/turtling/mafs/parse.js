import { ASTNode } from "../ast.js"


export class Parser {
    constructor() {
        this.precedence = {
            '||': 1,
            '&&': 2,
            '|': 3,
            '&': 4,
            '===': 5, '!==': 5, '==': 5, '!=': 5, // Equality Operators
            '>=': 6, '>': 6, '<=': 6, '<': 6, // Inequality  Operators
            '+': 7, '-': 7,
            '+-': 7, '--': 7,
            '*': 8, '/': 8,
            '*-': 9, '/-': 9,
            '!': 9,
            '^': 10,
            '^-': 10
        };

        this.userspace = new Map();

        this.builtins = new Map([
            ['sin', 1], ['cos', 1], ['tan', 1],
            ['asin', 1], ['acos', 1], ['atan', 1],
            ['sqrt', 1], ['log', 1], ['exp', 1]
        ]);
    }

    run(expression) {
        const tokens = this.tokenise(expression);
        // preprocess with implicit operators
        const expandedTokens = this.insertImplicitMultiplication(tokens);
        const output = [];
        const operators = [];
        let expectFunction = false;
        let argCount = 0;

        for (let i = 0; i < expandedTokens.length; i++) {
            const token = expandedTokens[i];

            // Handle multi-character operators
            let multiCharOp = '';
            if (token + (expandedTokens[i + 1] || '') + (expandedTokens[i + 2] || '') in this.precedence) {
                multiCharOp = token + expandedTokens[i + 1] + expandedTokens[i + 2];
                i += 2;
            } else if (token + (expandedTokens[i + 1] || '') in this.precedence) {
                multiCharOp = token + expandedTokens[i + 1];
                i += 1;
            }

            if (multiCharOp) {
                while (operators.length > 0 &&
                    this.precedence[operators[operators.length - 1]] >= this.precedence[multiCharOp]) {
                    this.createOperatorNode(operators, output);
                }
                operators.push(multiCharOp);
                continue;
            }

            if (this.isFunction(token)) {
                operators.push(token);
                expectFunction = true;
                argCount = 0;
            } else if (this.isOperand(token)) {
                output.push(new ASTNode('operand', token));
            } else if (token in this.precedence) {
                while (operators.length > 0 &&
                    this.precedence[operators[operators.length - 1]] >= this.precedence[token]) {
                    this.createOperatorNode(operators, output);
                }
                operators.push(token);
            } else if (token === '[') {
                if (expectFunction) {
                    expectFunction = false;
                }
                operators.push(token);
            } else if (token === ',') {
                while (operators.length > 0 && operators[operators.length - 1] !== '[') {
                    this.createOperatorNode(operators, output);
                }
                argCount++;
            } else if (token === ']') {
                while (operators.length > 0 && operators[operators.length - 1] !== '[') {
                    this.createOperatorNode(operators, output);
                }
                if (operators.length > 0) {
                    operators.pop(); // Remove '['
                    if (operators.length > 0 && this.isFunction(operators[operators.length - 1])) {
                        const func = operators.pop();
                        const args = [];
                        for (let j = 0; j <= argCount; j++) {
                            args.unshift(output.pop());
                        }

                        const expectedArity = this.getFunctionArity(func);
                        if (expectedArity !== args.length) {
                            throw new Error(`Function ${func} expects ${expectedArity} arguments, but got ${args.length}`);
                        }

                        output.push(new ASTNode('function', func, args));
                    }
                }
                argCount = 0;
            }
        }

        while (operators.length > 0) {
            this.createOperatorNode(operators, output);
        }

        return output[0];
    }

    insertImplicitMultiplication(tokens) {
        const result = [];
        for (let i = 0; i < tokens.length; i++) {
            result.push(tokens[i]);

            if (i < tokens.length - 1) {
                const current = tokens[i];
                const next = tokens[i + 1];

                // Cases where we need to insert multiplication:
                // 1. Number followed by variable: 2x
                // 2. Number followed by function: 2sin[x]
                // 3. Variable/closing bracket followed by number: x2 or ]2
                // 4. Closing bracket followed by variable or function: ]x or ]sin
                if (
                    (this.isNumeric(current) && (this.isVariable(next) || this.isFunction(next))) ||
                    ((this.isVariable(current) || current === ']') && this.isNumeric(next)) ||
                    (current === ']' && (this.isVariable(next) || this.isFunction(next)))
                ) {
                    result.push('*');
                }
            }
        }
        return result;
    }

    defineFunction(name, implementation, arity) {
        if (this.builtins.has(name)) {
            throw new Error(`Cannot override built-in function ${name}`);
        }
        this.userspace.set(name, [implementation, arity]);
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

    tokenise(expression) {
        return expression.match(/===|!==|&&|\|\||>=|<=|==|!=|[a-zA-Z]+|\d+\.?\d*|,|\[|\]|\S/g) || [];
    }

    isOperand(token) {
        return /^\d+\.?\d*$/.test(token) || /^[a-zA-Z]+$/.test(token);
    }

    isVariable(token) {
        return /^[a-zA-Z]+$/.test(token) && !this.isFunction(token);
    }

    isNumeric(str) {
        if (typeof str != "string") return false;
        return !isNaN(str) && !isNaN(parseFloat(str));
    }

    isFunction(token) {
        return this.builtins.has(token);
    }

    createOperatorNode(operators, output) {
        const operator = operators.pop();
        if (this.isFunction(operator)) {
            const arg = output.pop();
            output.push(new ASTNode('function', operator, [arg]));
        } else if (operator === '!') {
            // Handle unary not operator
            const operand = output.pop();
            output.push(new ASTNode('operator', operator, [operand]));
        } else {
            const right = output.pop();
            const left = output.pop();
            output.push(new ASTNode('operator', operator, [left, right]));
        }
    }
}
