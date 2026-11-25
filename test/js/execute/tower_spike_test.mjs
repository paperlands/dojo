import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
    createTower,
    installScalarFloor,
    TowerRefusal,
    DomainRefusal,
    KindAmbiguity,
    RegistrySealed,
    SCALAR_BUILTINS,
} from '../../../assets/js/turtling/mafs/tower.js'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'
import { Parser } from '../../../assets/js/turtling/mafs/parse.js'
import { drainEvents } from '../../../assets/js/turtling/executor.js'
import { parseProgram } from '../../../assets/js/turtling/parse.js'

// ── The alternate-coefficient witness ───────────────────────────────────────
// A test-only kind whose coefficients are held symbols, not numbers. It combines
// through its own meaning, never JavaScript coercion — so any handler that
// reaches for raw + / * is *caught*, not silently answered. It is a bypass
// detector, not symbolic algebra. It proves generic *routing* — that composition
// reaches the center — not that every coefficient algebra supports the same
// mathematical interpretation (a complex norm needs conjugation, not just a
// registered square root). (id:tower-center-witness)
class Coeff {
    constructor(expr) { this.expr = expr }
    [Symbol.toPrimitive]() {
        throw new Error(`raw JavaScript coercion of ${this.expr}`)
    }
}
const coeff = (name) => new Coeff(name)
const isCoeff = (value) => value instanceof Coeff

function withCoefficients() {
    const tower = installScalarFloor(createTower())
    tower.kind('coefficient', isCoeff)
    // The same meanings, for a kind that is not a number. These handlers *are*
    // the operation — nothing raw-JS hides behind them.
    tower.define('+', ['coefficient', 'coefficient'], (a, b) => new Coeff(`${a.expr} + ${b.expr}`))
    tower.define('*', ['coefficient', 'coefficient'], (a, b) => new Coeff(`${a.expr} · ${b.expr}`))
    tower.define('sqrt', ['coefficient'], (x) => new Coeff(`√(${x.expr})`))
    return tower
}

// ── One small algorithm, written once against the center ────────────────────
//     norm(d) = sqrt(d · d)
// It names no coefficient kind. Whether the components are numbers or held
// symbols, every combination passes through the same door. (id:tower-sota, L6)
function installDot(tower) {
    tower.define('dot', ['vector', 'vector'], (a, b) => {
        // dot's domain is stated here, so a bad shape is rejected *structurally*
        // rather than by failing to find arithmetic somewhere deeper. Rank-one,
        // nonempty, equal length — no general tensor system to say so.
        if (a.length === 0) throw new DomainRefusal('dot', 'a nonempty vector', 'an empty vector')
        if (a.length !== b.length) throw new DomainRefusal('dot', 'equal lengths', `${a.length} and ${b.length}`)
        if (a.some(Array.isArray) || b.some(Array.isArray)) {
            throw new DomainRefusal('dot', 'rank-one vectors', 'a vector element')
        }
        let acc = tower.apply('*', a[0], b[0])
        for (let i = 1; i < a.length; i++) {
            acc = tower.apply('+', acc, tower.apply('*', a[i], b[i]))
        }
        return acc
    })
    tower.define('norm', ['vector'], (d) => tower.apply('sqrt', tower.apply('dot', d, d)))
    return tower
}

describe('the semantic center — one door, composition as depth', () => {
    test('one algorithm, two coefficient kinds — genericity is real, not decoration', () => {
        const numbers = installDot(installScalarFloor(createTower()))
        const symbols = installDot(withCoefficients())
        const d = [coeff('x'), coeff('y')]

        assert.equal(numbers.apply('norm', [3, 4]), 5)   // sqrt(9 + 16)
        // Not a number and not a NaN — a held expression, because every step
        // reached the coefficient's own meanings instead of JavaScript's.
        assert.equal(symbols.apply('norm', d).expr, '√(x · x + y · y)')
    })

    test('every mathematical combination reaches dispatch, not merely the products', () => {
        const tower = installDot(installScalarFloor(createTower()))
        const seen = []
        const door = tower.apply
        tower.apply = (op, ...args) => {
            seen.push(`${op}:${args.map((arg) => tower.typeOf(arg)).join(':')}`)
            return door(op, ...args)
        }

        assert.equal(tower.apply('norm', [3, 4]), 5)
        assert.deepEqual(seen, [
            'norm:vector',
            'dot:vector:vector',
            '*:number:number',
            '*:number:number',
            '+:number:number',
            'sqrt:number',
        ])
    })

    test('one rank-1 dot is registered once, whatever the coefficient kind', () => {
        const tower = installDot(withCoefficients())
        const dotRows = tower.keys().filter((key) => key.startsWith('dot:'))
        assert.deepEqual(dotRows, ['dot:vector:vector'])
    })

    test('a raw-JavaScript handler is exposed, not silently answered', () => {
        const tower = installDot(withCoefficients())
        const d = [coeff('x'), coeff('y')]
        // The bypass under test: JavaScript's own * and +, no door.
        tower.define('rawDot', ['vector', 'vector'], (a, b) => a[0] * b[0] + a[1] * b[1])

        assert.throws(() => tower.apply('rawDot', d, d), /raw JavaScript coercion of x/)
        // The center-routed dot, on the same composure, answers.
        assert.equal(tower.apply('dot', d, d).expr, 'x · x + y · y')
    })

    test('a missing meaning refuses with the operand kinds named', () => {
        const tower = withCoefficients()
        assert.throws(
            () => tower.apply('+', coeff('x'), 1),
            (error) => error instanceof TowerRefusal
                && error.op === '+'
                && error.types.join(':') === 'coefficient:number'
                && /no meaning for \+ over coefficient and number/.test(error.message),
        )
    })

    test("dot's domain is rank-one, nonempty and equal-length", () => {
        const tower = installDot(installScalarFloor(createTower()))
        assert.throws(() => tower.apply('dot', [], []),
            (error) => error instanceof DomainRefusal && /nonempty/.test(error.message))
        assert.throws(() => tower.apply('dot', [1, 2], [1, 2, 3]),
            (error) => error instanceof DomainRefusal && /equal lengths/.test(error.message))
        assert.throws(() => tower.apply('dot', [[1], [2, 3]], [[1], [2, 3]]),
            (error) => error instanceof DomainRefusal && /rank-one/.test(error.message))
    })

    test('a structural rejection is not a missing multiplication', () => {
        const tower = installDot(createTower())
        tower.kind('coefficient', isCoeff)
        tower.define('*', ['coefficient', 'coefficient'], (a, b) => new Coeff(`${a.expr} · ${b.expr}`))
        const d = [coeff('x'), coeff('y')]

        // The shape is fine; this coefficient kind simply has no addition yet.
        assert.throws(() => tower.apply('dot', d, d),
            (error) => error instanceof TowerRefusal
                && !(error instanceof DomainRefusal)
                && error.types.join(':') === 'coefficient:coefficient')
        // The shape is wrong; that is dot's own domain, not arithmetic.
        assert.throws(() => tower.apply('dot', [], []),
            (error) => error instanceof DomainRefusal)
    })

    test('a registered kind may take over a plain value, deliberately', () => {
        const tower = createTower()
        tower.kind('coefficient', (value) => typeof value === 'number')
        assert.equal(tower.typeOf(3), 'coefficient')   // registered wins over the built-in
        assert.equal(tower.typeOf('a'), 'string')      // the built-in classifies the rest
    })

    test('overlapping recognizers refuse rather than resolve by order', () => {
        const tower = createTower()
        tower.kind('anyObject', (value) => typeof value === 'object' && value !== null)
        tower.kind('coefficient', isCoeff)
        assert.throws(() => tower.typeOf(coeff('x')),
            (error) => error instanceof KindAmbiguity && error.kinds.join(':') === 'anyObject:coefficient')
    })

    test('installation ends — a sealed registry refuses later definitions', () => {
        const tower = installScalarFloor(createTower())
        assert.equal(tower.sealed, false)
        tower.seal()
        assert.equal(tower.sealed, true)
        // A later define would reinterpret a computation already in flight.
        assert.throws(() => tower.define('*', ['number', 'number'], () => 0), RegistrySealed)
        assert.throws(() => tower.kind('late', () => true), RegistrySealed)
    })

    test('the evaluator computes through its sealed center', () => {
        const evaluator = new Evaluator()
        assert.equal(evaluator.tower.sealed, true)
        // The center's answer IS the substrate's: one door, no shortcut past it, and no
        // second approximation layered on top. (id:tower-center-approximation-ruling)
        assert.equal(evaluator.applyOperator('+', 0.1, 0.2), evaluator.tower.apply('+', 0.1, 0.2))
        assert.equal(evaluator.applyOperator('+', 0.1, 0.2), 0.1 + 0.2)
        assert.equal(evaluator.applyFunction('mod', [-7, 3]), 2)   // integer behaviour preserved
        assert.equal(evaluator.applyUnaryOperator('-', 5), -5)
        assert.equal(evaluator.applyFunction('sqrt', [4]), 2)
    })

    test('evaluators share a frozen arithmetic floor, not their changing names', () => {
        const a = new Evaluator(), b = new Evaluator()
        assert.strictEqual(a.tower, b.tower)
        assert.ok(Object.isFrozen(a.tower))
        assert.throws(() => { a.tower.apply = () => 0 }, TypeError)
        assert.throws(() => a.tower.define('+', ['number', 'number'], () => 0), RegistrySealed)
        a.constants.pi = () => 7
        a.shadowable.clear()
        a.userFunctions = new Map()
        assert.equal(b.constants.pi(), Math.PI)
        assert.ok(b.shadowable.has('mod'))
        assert.equal(b.userFunctions, null)
        assert.equal(b.applyOperator('+', 2, 3), 5)
    })

    test('the parser and the center share one builtin signature list', () => {
        const parser = new Parser()
        assert.equal(parser.builtins.size, SCALAR_BUILTINS.length)
        for (const { name, arity } of SCALAR_BUILTINS) {
            assert.deepEqual(parser.builtins.get(name), arity)
        }
    })

    test('the registry is private — no exposed path mutates it', () => {
        const tower = installScalarFloor(createTower())
        // The live map is not reachable; inspection only hands back copies.
        assert.equal(tower.table, undefined)
        const snapshot = tower.keys()
        snapshot.length = 0
        assert.ok(tower.keys().length > 0)   // the registry is unaffected
        assert.equal(typeof tower.get('+', ['number', 'number']), 'function')

        const evaluator = new Evaluator()
        assert.equal(evaluator.applyOperator('+', 2, 3), 5)
        assert.equal(evaluator.tower.table, undefined)
        assert.equal(evaluator.applyOperator('+', 2, 3), 5)   // still 5, not 999
    })

    test('a known builtin owns its name — unsupported operands refuse, never resolve', () => {
        const evaluator = new Evaluator()
        evaluator.resolveExternal = () => 123
        assert.throws(() => evaluator.applyFunction('sin', ['oops']),
            (error) => error instanceof TowerRefusal && error.op === 'sin')
        // A genuinely unknown name still resolves externally.
        assert.equal(evaluator.applyFunction('mystery', []), 123)
    })

    test('booleans compose through the language’s own logical operations', () => {
        const ev = (source) => new Evaluator().run(new Parser().parse(source), {})
        assert.equal(ev('(!0) && (!0)'), true)
        assert.equal(ev('(!0) == (!0)'), 1)
        assert.equal(ev('(!0) | 0'), 1)
        assert.equal(ev('(!0) + 1'), 2)
        // Identity still distinguishes a boolean from a number.
        assert.equal(ev('(!0) === (!0)'), 1)
        assert.equal(ev('(!0) === 1'), 0)
        assert.equal(ev('sqrt(!0)'), 1)      // a numerical builtin widens a boolean
    })

    test('the text boundary is published: equality, truth and order yes, arithmetic no', () => {
        const ev = (source) => new Evaluator().run(new Parser().parse(source), {})
        assert.equal(ev("'a' == 'a'"), 1)            // text equality is supported
        assert.equal(ev("!'x'"), false)              // truth assessment over text
        assert.equal(ev("'a' && 'b'"), 'b')          // selection returns the chosen operand
        assert.throws(() => ev("'a' + 'b'"), TowerRefusal)   // no accidental concatenation
        assert.equal(ev("'a' < 'b'"), 1)               // text orders lexicographically
        assert.equal(ev("'apple' < 'banana'"), 1)
        assert.throws(() => ev("'a' < 1"), TowerRefusal)      // mixed text/number has no order
    })

    test('the authoritative builtin descriptions are immutable', () => {
        assert.ok(Object.isFrozen(SCALAR_BUILTINS))
        for (const record of SCALAR_BUILTINS) {
            assert.ok(Object.isFrozen(record))
            if (Array.isArray(record.arity)) assert.ok(Object.isFrozen(record.arity))
        }
        assert.throws(() => { SCALAR_BUILTINS[0].name = 'nope' }, TypeError)
        const round = SCALAR_BUILTINS.find((builtin) => builtin.name === 'round')
        assert.throws(() => { round.arity.push(3) }, TypeError)
    })
})

// ── The scalar contract — ordered dispatch, domains and edges ───────────────
// Expectations are derived independently (plain JavaScript), with each law's
// valid operand domain stated, so the table cannot certify itself.
describe('the scalar contract', () => {
    const ev = (source) => new Evaluator().run(new Parser().parse(source), {})

    test('dispatch is ordered — A:B is never silently B:A', () => {
        const tower = installScalarFloor(createTower())
        assert.equal(tower.apply('-', 2, 5), -3)
        assert.equal(tower.apply('-', 5, 2), 3)
        assert.equal(tower.apply('/', 2, 5), 0.4)
        assert.equal(tower.apply('/', 5, 2), 2.5)
    })

    test('admitted kinds per family, and mixed pairs that refuse', () => {
        assert.equal(ev('2 + 3'), 5)              // number, number
        assert.equal(ev('(!0) + 1'), 2)           // boolean widens to 0/1
        assert.equal(ev("'a' && 'b'"), 'b')       // selection over text
        assert.equal(ev("'a' == 'a'"), 1)         // text equality
        assert.equal(ev("'a' < 'b'"), 1)          // text order
        assert.throws(() => ev("'a' + 1"), TowerRefusal)     // text does not add
        assert.throws(() => ev("'a' < 1"), TowerRefusal)     // mixed order has no meaning
        assert.throws(() => ev("'a' & 'b'"), TowerRefusal)   // bitwise is numeric
    })

    test('unary operations and both round arities', () => {
        assert.equal(ev('-5'), -5)
        assert.equal(ev('+5'), 5)
        assert.equal(ev('-(!0)'), -1)             // a boolean widened by a unary sign
        assert.equal(ev('!0'), true)
        assert.equal(ev('round(2.4)'), 2)
        assert.equal(ev('round(2.6)'), 3)
        assert.equal(ev('round(2.3, 0.5)'), 2.5)
        assert.equal(ev('round(7, 5)'), 5)
    })

    test('numerical edges are inherited outcomes, not new refusals', () => {
        assert.ok(Number.isNaN(ev('sqrt(-1)')))       // NaN flows through, not refused
        assert.equal(ev('1/0'), Infinity)
        assert.ok(Number.isNaN(ev('0/0')))
        assert.equal(ev('log(0)'), -Infinity)
        assert.ok(Object.is(ev('-0'), -0))            // negative zero survives
        assert.equal(ev('9007199254740991 + 0'), 9007199254740991)   // the safe-integer ceiling
    })

    test('laws hold on their stated domain — and are not claimed outside it', () => {
        const tower = installScalarFloor(createTower())
        // Commutativity of + and * — domain: numbers.
        for (const [a, b] of [[2, 3], [10, -4], [6, 0.5]]) {
            assert.equal(tower.apply('+', a, b), a + b)
            assert.equal(tower.apply('*', a, b), a * b)
            assert.equal(tower.apply('+', a, b), tower.apply('+', b, a))
        }
        // The mod reconstruct — domain: safe integers, nonzero divisor.
        for (const [a, b] of [[7, 3], [-7, 3], [7, -3]]) {
            const q = tower.apply('//', a, b)
            assert.equal(tower.apply('+', tower.apply('*', q, b), tower.apply('mod', a, b)), a)
        }
        // The additive identity holds on every representable value, and the tail double
        // precision can hold is KEPT — the incoherence the old gate made is gone:
        // `1e-15 * 1` survived while `1e-15 + 0` vanished, and `1 + 1e-15` lost its tail.
        assert.equal(tower.apply('+', 0, 1e-15), 1e-15)
        assert.equal(tower.apply('+', 1e-15, 0), 1e-15)
        assert.equal(tower.apply('*', 1000, 1e-15), 1e-12)
        assert.equal(tower.apply('+', 1, 1e-15), 1 + 1e-15)
    })

    test('a scalar meaning survives the command boundary', () => {
        const run = (source) => drainEvents(parseProgram(source),
            { mathParser: new Parser(), mathEvaluator: new Evaluator() })
        // sqrt(!0) = 1: a boolean widened, carried through the command, walks a step.
        assert.ok(run('fw sqrt(!0)').some((e) => e.type === 'path'))
        // An unsupported question refuses; the refusal survives the enclosing command.
        assert.throws(() => run("fw ('a' + 'b')"), /no meaning for \+ over string and string/)
        // A non-finite *value* is not a center refusal — the command's finite demand
        // is what drops it, where it is asked for: the step is not taken.
        assert.ok(!run('fw sqrt(-1)').some((e) => e.type === 'path'))
    })
})
