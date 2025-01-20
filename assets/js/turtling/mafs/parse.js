import { ASTNode } from "../ast.js"


export class Parser {
    constructor() {
        this.precedence = {
            '||': 1,  // Lowest precedence
            '&&': 2,
            '|': 3,
            '&': 4,
            '===': 5, '!==': 5, '==': 5, '!=': 5,  // Equality operators
            '>=': 6, '>': 6, '<=': 6, '<': 6,      // Comparison operators
            '+': 7, '-': 7,
            '*': 8, '/': 8,
            '*-': 9, '/-': 9,
            '!': 9,   // Unary not
            '^': 10,
            '^-': 10
        };

        this.functions = new Set([
            'sin', 'cos', 'tan',
            'asin', 'acos', 'atan',
            'sqrt', 'log', 'exp'
        ]);
    }

    run(expression) {
        const tokens = this.tokenise(expression);
        const output = [];
        const operators = [];
        let expectFunction = false;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            // Handle multi-character operators
            let multiCharOp = '';
            if (token + (tokens[i + 1] || '') + (tokens[i + 2] || '') in this.precedence) {
                multiCharOp = token + tokens[i + 1] + tokens[i + 2];
                i += 2;
            } else if (token + (tokens[i + 1] || '') in this.precedence) {
                multiCharOp = token + tokens[i + 1];
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
            } else if (this.isOperand(token)) {
                output.push(new ASTNode('operand', token));
            } else if (token in this.precedence) {
                // Handle unary operators
                if (token === '!' && (output.length === 0 || operators.length === 0)) {
                    operators.push(token);
                    continue;
                }

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
            } else if (token === ']') {
                while (operators.length > 0 && operators[operators.length - 1] !== '[') {
                    this.createOperatorNode(operators, output);
                }
                if (operators.length > 0) {
                    operators.pop(); // Remove '['
                    if (operators.length > 0 && this.isFunction(operators[operators.length - 1])) {
                        const func = operators.pop();
                        const arg = output.pop();
                        output.push(new ASTNode('function', func, [arg]));
                    }
                }
            }
        }

        while (operators.length > 0) {
            this.createOperatorNode(operators, output);
        }

        return output[0];
    }

    tokenise(expression) {
        // Enhanced tokenizer to handle multi-character operators and functions
        return expression.match(/===|!==|&&|\|\||>=|<=|==|!=|[a-zA-Z]+|\d+\.?\d*|\S/g) || [];
    }

    isOperand(token) {
        return /^\d+\.?\d*$/.test(token) || /^[a-zA-Z]+$/.test(token);
    }

    isNumeric(str) {
        if (typeof str != "string") return false;
        return !isNaN(str) && !isNaN(parseFloat(str));
    }

    isFunction(token) {
        return this.functions.has(token);
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
