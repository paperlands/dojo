import { getOperator } from "./operators.js"
import { createTower, installScalarFloor, installVectorFloor, SHADOWABLE_BUILTINS, asKind } from "./tower.js"
import { Parser } from "./parse.js"
import { parseMemo } from "./parse_memo.js"

// Meanings are fixed; a learner's names change. Install this floor once,
// not on every figure rebuild. (id:tower-center-life)
const DEFAULT_TOWER = Object.freeze(installVectorFloor(installScalarFloor(createTower())).seal())

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

        this.tower = DEFAULT_TOWER

        // Deferred = stochastic/streaming primitives that must re-evaluate at
        // each use, never folded into an fn body at definition time. Foldable
        // literals (pi, e) and context snapshots (x,y,z,count,time) may fold eagerly.
        this.deferred = new Set(['random']);

        this.userFunctions = null;
        // Which builtin names a child fn may take over. (id:tower-center-shadowable)
        this.shadowable = new Set(SHADOWABLE_BUILTINS);

        // What a read RESOLVED to, not what its spelling looked like: the resolver
        // records every external read here, so a declaration can ask its real
        // dependencies instead of scanning the expression for a name.
        // (id:laws-dependency-driven-place)
        this.reads = null
    }

    // Start a fresh dependency record for one evaluation. The resolver fills it as it
    // reaches values; the caller reads `reads` after the evaluation succeeds.
    beginReads() {
        this.reads = { live: false, frames: new Set(), inputs: [], samples: [], locals: new Set() }
        return this.reads
    }

    namespace_check(val) {
        if (val in this.constants) return true
        // Dotted paths (ambient.property) resolve through evaluator chain
        if (typeof val === 'string' && val.includes('.') && this.resolveExternal) return true
        return false
    }

    // Every source string has the same interpolation; held literals never enter.
    // Interpolated names resolve as data, never as newly minted expression ink.
    interpolate(text, context) {
        let processed = text;
        let previous;
        do {
            previous = processed;
            processed = processed.replace(/\[([^[\]](?:[^[\]]|\[(?:\\.|[^[\]])*\])*)\]/g, (match, expr) => {
                if (expr.trim().match(/^`.*`$/)) return match;
                const parser = this.parser ?? (this.parser = new Parser());
                const value = this.run(parseMemo(parser, expr.trim()), context);
                return value !== undefined ? String(value) : match;
            });
        } while (processed !== previous);
        return processed;
    }

    run(ast, context) {
        if (!ast) return 0;

        // A literal is a value, never a name: it evaluates to itself, exactly as a
        // string literal does. Only an operand names something to resolve.
        // (id:tower-tension-repr)
        if (ast.type === 'literal') return ast.value;
        if (ast.type === 'string') return this.interpolate(ast.value, context);
        if (ast.type === 'access' || ast.type === 'access_call') {
            const name = this.run(ast.children[0], context) + '.' + ast.value;
            if (ast.type === 'access_call') {
                return this.applyFunction(name, ast.children.slice(1).map(child => this.run(child, context)), context);
            }
            // Rehearsal has no ambient tree; the live resolver owns missing reads.
            if (context && name in context) return this.readContext(name, context);
            if (!this.resolveExternal) return null;
            return this.resolveContext(name, context);
        }

        // A list literal evaluates its elements in order and TAGS the result with the
        // kind its delimiter names: `(…)` a point, `[…]` a vector. The kind then rides
        // the value through every operation, so a consumer reads what the value IS,
        // not how it was spelled. (id:notation-coordinate-vector)

        if (ast.type === 'vector' || ast.type === 'point') {
            return asKind(ast.children.map((element) => this.run(element, context)), ast.type)
        }

        if (ast.type === 'operand') {
            if (context && ast.value in context) {
                return this.readContext(ast.value, context);
            }
            else if (ast.value in this.constants) {
                return this.readConstant(ast.value);
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
        // The child's own word wins where the surface lets it be shadowed: a user fn
        // at this exact arity owns a shadowable builtin's name (round, mod).
        // Otherwise a scalar builtin is a center registration — the same door the
        // operators use — and the rest falls through to ambient resolution, which
        // stays outside the algebra. (id:tower-center-shadowable)
        if (this.userFunctions) {
            const key = `${func}:${args.length}`;
            const entry = this.userFunctions.get(key);
            if (entry && (this.shadowable.has(func) || !this.tower.known(func))) {
                const [body, params] = entry;
                const childContext = { ...context };
                params.forEach((p, i) => { childContext[p] = args[i]; });
                const reads = this.reads, locals = reads?.locals
                if (reads) {
                    reads.inputs?.push(['function', func, body, params])
                    reads.locals = new Set([...(locals ?? []), ...params])
                }
                try { return this.run(body, childContext) }
                finally { if (reads) reads.locals = locals }
            }
        }
        // Identify the callable before testing applicability: a known builtin
        // owns its name even when its operands are unsupported, so it refuses
        // through the center instead of leaking to another resolver.
        if (this.tower.known(func)) return this.tower.apply(func, ...args)
        if (this.resolveExternal) {
            const result = this.readExternal(func, args);
            if (result !== undefined) return result;
        }
        throw new Error(`Undefined function: ${func}`);
    }

    // Observe resolved values, not names guessed from syntax. (id:laws-dependency-driven-place)
    readExternal(name, args) {
        const value = this.resolveExternal(name, args)
        this.reads?.inputs?.push(['external', name, args ?? null, value])
        return value
    }

    readContext(name, context) {
        const local = this.reads?.locals?.has(name)
        const value = !local && this.reads?.bind
            ? this.reads.bind('scope', name, () => context[name]) : context[name]
        if (!this.reads?.locals?.has(name)) this.reads?.inputs?.push(['scope', name, value])
        return value
    }

    readConstant(name) {
        if (!this.reads) return this.constants[name]()
        const deferred = this.deferred.has(name)
        const provide = () => this.constants[name]()
        const value = deferred
            ? (this.reads?.sample ? this.reads.sample(name) : provide())
            : (this.reads?.bind ? this.reads.bind('constant', name, provide) : provide())
        if (deferred) this.reads?.samples?.push([name, value])
        else this.reads?.inputs?.push(['constant', name, value])
        return value
    }

    resolveContext(variable, context) {
        if (variable in context) {
            return this.readContext(variable, context);
        }
        if (this.resolveExternal) {
            const resolved = this.readExternal(variable);
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
