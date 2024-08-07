export class Evaluator {
    run(ast, context) {
        if (ast.type === 'operand') {
            if (/^\d+\.?\d*$/.test(ast.value)) {
                return parseFloat(ast.value);
            } else {
                return this.resolveContext(ast.value, context);
            }
        } else if (ast.type === 'operator') {
            const left = this.run(ast.left, context);
            const right = this.run(ast.right, context);
            return this.applyOperator(ast.value, left, right);
        }
    }

    resolveContext(variable, context) {
        if (variable in context) {
            return context[variable];
        }
        throw new Error(`Undefined variable: ${variable}`);
    }

    applyOperator(operator, left, right) {
        switch (operator) {
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': return left / right;
            case '^': return Math.pow(left, right);
            default: throw new Error(`Unknown operator: ${operator}`);
        }
    }
}
