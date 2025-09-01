import { ASTNode } from "../ast.js"


export class Parser {
    constructor() {
        this.precedence = {
            '||': 1,
            '&&': 2,
            '|': 3,
            '&': 4,
            '===-': 5, '!==-': 5, '==-': 5, '!=-': 5, '===': 5, '!==': 5, '==': 5, '!=': 5,
            '>=-': 6, '>-': 6, '<=-': 6, '<-': 6, '>=': 6, '>': 6, '<=': 6, '<': 6,
            '+': 7, '-': 7,
            '+-': 7, '--': 7,
            '*': 8, '/': 8, '//': 8,
            '*-': 9, '/-': 9,
            'unary-': 10, 'unary+': 10, 'unary!': 10, // Unary operators have high precedence
            '^': 11,
            '^-': 11
        };

        // Right-associative operators
        this.rightAssociative = new Set(['^', '^-', 'unary-', 'unary+', '!']);

        this.userspace = new Map();
        this.builtins = new Map([
            ['sin', 1], ['cos', 1], ['tan', 1],
            ['asin', 1], ['acos', 1], ['atan', 1],
            ['sqrt', 1], ['log', 1], ['exp', 1]
        ]);
    }

    run(expression) {
        const tokens = this.tokenise(expression);
        const processedTokens = this.preprocessUnaryOperators(tokens);
        const expandedTokens = this.insertImplicitMultiplication(processedTokens);

        const output = [];
        const operators = [];
        let expectFunction = false;
        let argCount = 0;

        for (let i = 0; i < expandedTokens.length; i++) {
            const token = expandedTokens[i];

            // Handle multi-character operators
            let multiCharOp = '';
            if (token + (expandedTokens[i + 1] || '') + (expandedTokens[i + 2] || '') in this.precedence) {
                multiCharOp = token + (expandedTokens[i + 1] || '') + (expandedTokens[i + 2] || '');
                i += 2;
            } else if (token + (expandedTokens[i + 1] || '') in this.precedence) {
                multiCharOp = token + (expandedTokens[i + 1] || '');
                i += 1;
            }

            if (multiCharOp) {
                this.processOperator(multiCharOp, operators, output);
                continue;
            }

            if (this.isFunction(token)) {
                operators.push(token);
                expectFunction = true;
                argCount = 0;
            } else if (this.isOperand(token)) {
                output.push(new ASTNode('operand', token));
            } else if (token in this.precedence) {
                this.processOperator(token, operators, output);
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

        return output[0] || null;
    }

    preprocessUnaryOperators(tokens) {
        const result = [];

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const prevToken = i > 0 ? tokens[i - 1] : null;

            // Determine if this is a unary operator
            if ((token === '-' || token === '+' || token === '!') && this.isUnaryContext(prevToken)) {
                // Mark as unary operator
                result.push(`unary${token}`);
            } else {
                result.push(token);
            }
        }

        return result;
    }

    isUnaryContext(prevToken) {
        // Unary operators appear:
        // 1. At the beginning of expression
        // 2. After opening bracket [
        // 3. After another operator
        // 4. After comma ,
        return (
            prevToken === null ||
            prevToken === '[' ||
            prevToken === ',' ||
            (prevToken in this.precedence && prevToken !== ']') ||
            prevToken.startsWith('unary')
        );
    }

    processOperator(operator, operators, output) {
        if (this.rightAssociative.has(operator)) {
            // Right-associative operators (including unary)
            while (operators.length > 0 &&
                   operators[operators.length - 1] !== '[' &&
                   this.precedence[operators[operators.length - 1]] > this.precedence[operator]) {
                this.createOperatorNode(operators, output);
            }
        } else {
            // Left-associative operators
            while (operators.length > 0 &&
                   operators[operators.length - 1] !== '[' &&
                   this.precedence[operators[operators.length - 1]] >= this.precedence[operator]) {
                this.createOperatorNode(operators, output);
            }
        }
        operators.push(operator);
    }

    insertImplicitMultiplication(tokens) {
        const result = [];
        for (let i = 0; i < tokens.length; i++) {
            result.push(tokens[i]);
            if (i < tokens.length - 1) {
                const current = tokens[i];
                const next = tokens[i + 1];

                // Insert multiplication between:
                // 1. Number and variable: 2x
                // 2. Number and function: 2sin
                // 3. Closing bracket and variable/function: ]x or ]sin
                // 4. Variable and variable: xy
                // 5. Number and opening bracket: 2[x]
                // 6. Variable and opening bracket: x[y]
                // 7. Closing bracket and opening bracket: ][

                if (
                    (this.isNumeric(current) && (this.isVariable(next) || this.isFunction(next) || next === '[')) ||
                    (current === ']' && (this.isVariable(next) || this.isFunction(next) || next === '[')) ||
                    (this.isVariable(current) && (this.isVariable(next) || this.isFunction(next) || next === '[')) ||
                    (this.isVariable(current) && this.isNumeric(next))
                ) {
                    result.push('*');
                }
            }
        }
        return result;
    }

    createOperatorNode(operators, output) {
        const operator = operators.pop();

        if (this.isFunction(operator)) {
            const arg = output.pop();
            output.push(new ASTNode('function', operator, [arg]));
        } else if (operator.startsWith('unary') || operator === '!') {
            // Handle unary operators
            const operand = output.pop();
            if (!operand) {
                throw new Error(`Missing operand for unary operator ${operator}`);
            }
            // Store the actual operator symbol (without 'unary' prefix)
            const actualOp = operator.startsWith('unary') ? operator.slice(5) : operator;
            output.push(new ASTNode('unary_operator', actualOp, [operand]));
        } else {
            // Handle binary operators
            const right = output.pop();
            const left = output.pop();

            if (!right) {
                throw new Error(`Missing right operand for operator ${operator}`);
            }
            if (!left) {
                throw new Error(`Missing left operand for operator ${operator}`);
            }

            output.push(new ASTNode('operator', operator, [left, right]));
        }
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
        // Enhanced tokenizer that handles multi-character operators and preserves order
        return expression.match(/===|!==|&&|\|\||>=|<=|==|!=|[a-zA-Z]+|\d+\.?\d*|,|\[|\]|\S/g) || [];
    }

    isOperand(token) {
        return /^\d+\.?\d*$/.test(token) || /^[a-zA-Z]+$/.test(token);
    }

    isVariable(token) {
        return /^[a-zA-Z]+$/.test(token) && !this.isFunction(token);
    }

    isNumeric(str) {
        if (typeof str !== "string") return false;
        return !isNaN(str) && !isNaN(parseFloat(str));
    }

    isFunction(token) {
        return this.builtins.has(token) || this.userspace.has(token);
    }
}
