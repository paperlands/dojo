export class Parser {
    // take it to the shuntingyard
    constructor() {
        this.precedence = {
            '+': 1, '-': 1,
            '*': 2, '/': 2,
            '^': 3
        };
    }

    run(expression) {
        const tokens = this.tokenise(expression);
        const output = [];
        const operators = [];

        for (const token of tokens) {
            if (this.isOperand(token)) {
                output.push(new ASTNode('operand', token));
            } else if (token in this.precedence) {
                while (operators.length > 0 &&
                       this.precedence[operators[operators.length - 1]] >= this.precedence[token]) {
                    this.createOperatorNode(operators, output);
                }
                operators.push(token);
            } else if (token === '[') {
                operators.push(token);
            } else if (token === ']') {
                while (operators.length > 0 && operators[operators.length - 1] !== '[') {
                    this.createOperatorNode(operators, output);
                }
                operators.pop(); // Remove '('
            }
        }

        while (operators.length > 0) {
            this.createOperatorNode(operators, output);
        }

        return output[0]; // The root of the AST
    }

    tokenise(expression) {
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

    createOperatorNode(operators, output) {
        const operator = operators.pop();
        const right = output.pop();
        const left = output.pop();
        output.push(new ASTNode('operator', operator, [left, right]));
    }
}
