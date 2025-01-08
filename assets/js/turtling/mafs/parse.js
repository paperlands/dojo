import { ASTNode } from "../ast.js"

export class Parser {
    // take it to the shuntingyard
    constructor() {
        this.precedence = {
            '+': 1, '-': 1,
            '*': 2, '/': 2,
            '^': 3,
            '>': 4, '=': 4, '<': 4,
            '|': 5,
            '&': 6
        };

        // Add built-in functions
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

            if (this.isFunction(token)) {
                operators.push(token);
                expectFunction = true;
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
            } else if (token === ']') {
                while (operators.length > 0 && operators[operators.length - 1] !== '[') {
                    this.createOperatorNode(operators, output);
                }
                if (operators.length > 0) {
                    operators.pop(); // Remove '['
                    if (operators.length > 0 && this.isFunction(operators[operators.length - 1])) {
                        // Create function node
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
        // Enhanced tokenizer to handle function names
        return expression.match(/\d+\.?\d*|[a-zA-Z]+|\S/g) || [];
    }

    isOperand(token) {
        return /^\d+\.?\d*$/.test(token) || /^[a-zA-Z]+$/.test(token);
    }

    isNumeric(str) {
        if (typeof str != "string") return false // we only process strings!
        return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
            !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
    }

    isFunction(token) {
        return this.functions.has(token);
    }

    createOperatorNode(operators, output) {
        const operator = operators.pop();
        if (this.isFunction(operator)) {
            const arg = output.pop();
            output.push(new ASTNode('function', operator, [arg]));
        } else {
            const right = output.pop();
            const left = output.pop();
            output.push(new ASTNode('operator', operator, [left, right]));
        }
    }
}
