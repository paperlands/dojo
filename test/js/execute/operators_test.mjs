import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { OPERATOR_ROWS, OPERATOR_LEXEMES, getOperator } from '../../../assets/js/turtling/mafs/operators.js'
import { Lexer, OPERATORS } from '../../../assets/js/turtling/mafs/lexer.js'
import { Parser } from '../../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'
import { parseProgram } from '../../../assets/js/turtling/parse.js'

const parser = new Parser()
const evaluator = new Evaluator()
const ev = (source, context = {}) => evaluator.run(parser.parse(source), context)
const shape = (ast) => ast.children.length
    ? [ast.value, ...ast.children.map(shape)] : ast.value

// Expectations live outside the registry: projecting rows cannot prove their meaning.
const examples = [
    ['||', '0 || 3', 3], ['&&', '2 && 3', 3],
    ['|', '2 | 3', 3], ['&', '2 & 3', 2],
    ['===', '2 === 3', 0], ['!==', '2 !== 3', 1],
    ['==', '2 == 2', 1], ['!=', '2 != 3', 1],
    ['>=', '2 >= 3', 0], ['>', '3 > 2', 1],
    ['<=', '2 <= 2', 1], ['<', '2 < 3', 1],
    ['+', '2 + 3', 5], ['-', '2 - 3', -1],
    ['*', '2 * 3', 6], ['/', '3 / 2', 1.5],
    ['//', '7 // 3', 2], ['mod', '7 mod 3', 1], ['^', '2 ^ 3', 8],
]

describe('one fixed operator surface', () => {
    test('rows are immutable, unique by fixity, and indexed without copying', () => {
        assert.ok(Object.isFrozen(OPERATOR_ROWS))
        assert.ok(Object.isFrozen(OPERATOR_LEXEMES))
        const keys = OPERATOR_ROWS.map((r) => `${r.fixity}:${r.lexeme}`)
        assert.equal(new Set(keys).size, keys.length)
        for (const row of OPERATOR_ROWS) {
            assert.ok(Object.isFrozen(row))
            assert.equal(getOperator(row.lexeme, row.fixity), row)
            assert.equal(row.word, /^[a-zA-Z]+$/.test(row.lexeme))
        }
        assert.equal(OPERATORS, OPERATOR_LEXEMES) // compatibility export, not another list
        assert.equal(new Set(OPERATORS).size, OPERATORS.length)
        for (let i = 1; i < OPERATORS.length; i++) {
            assert.ok(OPERATORS[i - 1].length >= OPERATORS[i].length)
        }
        assert.equal(getOperator('--', 'infix'), undefined)
        assert.equal(getOperator('+-', 'infix'), undefined)
        assert.equal(getOperator('!', 'infix'), undefined)
    })

    test('every infix row lexes, parses and evaluates', () => {
        const rows = OPERATOR_ROWS.filter((r) => r.fixity === 'infix')
        assert.deepEqual(rows.map((r) => r.lexeme).sort(), examples.map(([op]) => op).sort())
        const lexer = new Lexer()
        for (const [op, source, expected] of examples) {
            assert.equal(lexer.tokenize(source)[1].type, 'OPERATOR', source)
            const ast = parser.parse(source)
            assert.equal(ast.type, 'operator', source)
            assert.equal(ast.value, op, source)
            assert.equal(evaluator.run(ast, {}), expected, source)
        }
    })

    test('every prefix row has its own meaning', () => {
        assert.deepEqual(OPERATOR_ROWS.filter((r) => r.fixity === 'prefix')
            .map((r) => r.lexeme).sort(), ['!', '+', '-'])
        assert.equal(ev('+3'), 3)
        assert.equal(ev('-3'), -3)
        assert.equal(ev('!3'), false)
        assert.equal(ev('!0'), true)
        assert.equal(ev('!!3'), true)
    })

    test('fixity and precedence preserve existing binding trees', () => {
        const trees = [
            ['1 || 2 && 3', ['||', 1, ['&&', 2, 3]]],
            ['1 && 2 | 3', ['&&', 1, ['|', 2, 3]]],
            ['1 | 2 & 3', ['|', 1, ['&', 2, 3]]],
            ['1 & 2 == 3', ['&', 1, ['==', 2, 3]]],
            ['1 == 2 < 3', ['==', 1, ['<', 2, 3]]],
            ['1 < 2 + 3', ['<', 1, ['+', 2, 3]]],
            ['1 + 2 * 3', ['+', 1, ['*', 2, 3]]],
            ['1 * 2 ^ 3', ['*', 1, ['^', 2, 3]]],
            ['2 ^ 3 ^ 2', ['^', 2, ['^', 3, 2]]],
            ['8 / 4 / 2', ['/', ['/', 8, 4], 2]],
            ['1 < 2 < 3', ['<', ['<', 1, 2], 3]],
            ['-2 ^ 2', ['^', ['-', 2], 2]],
            ['2 ^ -3', ['^', 2, ['-', 3]]],
            ['2 * 7 mod 3', ['mod', ['*', 2, 7], 3]],
        ]
        for (const [source, expected] of trees) {
            assert.deepEqual(shape(parser.parse(source)), expected, source)
        }
        assert.equal(ev('2 ^ 3 ^ 2'), 512)
        assert.equal(ev('-2 ^ 2'), 4)
    })

    test('adjacent signs compose; they are not special operator spellings', () => {
        for (const [source, expected] of [
            ['5--2', 7], ['5+-2', 3], ['5-+2', 3], ['5++2', 7],
            ['0.1--0.2', 0.3], ['0.3+-0.2', 0.1], ['---2', -2],
        ]) assert.equal(ev(source), expected, source)
        assert.deepEqual(shape(parser.parse('5--2')), ['-', 5, ['-', 2]])
        assert.deepEqual(new Lexer().tokenize('5--2').map((t) => t.value), ['5', '-', '-', '2'])
    })

    test('a word row never bites a longer name or a dotted path', () => {
        const lexer = new Lexer()
        for (const word of ['model', 'mode', 'mod_x', 'mod.x', 'mod3.x', 'world.mod']) {
            const tokens = lexer.tokenize(word)
            assert.equal(tokens.length, 1, word)
            assert.equal(tokens[0].type, 'IDENTIFIER', word)
            assert.equal(tokens[0].value, word)
        }
        assert.equal(ev('mod.x + mod3.x', { 'mod.x': 2, 'mod3.x': 3 }), 5)
        assert.equal(ev('7mod3'), 1)
        assert.equal(ev('7mod(3)'), 1)
        assert.equal(ev('(7)mod3'), 1)
        assert.equal(ev('7mod3.5'), 0)
        assert.deepEqual(lexer.tokenize('1e-3mod2').map((t) => t.value), ['1e-3', 'mod', '2'])
    })

    test('cached lexer pattern resets for successive expressions', () => {
        const lexer = new Lexer()
        const pattern = lexer.pattern
        for (const source of ['2^3', '7mod3', '', 'model', '1e-3+2', '7mod3']) {
            assert.deepEqual(lexer.tokenize(source), new Lexer().tokenize(source))
            assert.equal(lexer.pattern, pattern)
        }
        assert.equal(ev('0.1 + 0.2'), 0.3)
        assert.equal(ev('0.3 - 0.2'), 0.1)
        assert.equal(ev('2(3 + 4)'), 14)
    })

    test('PaperLang joins a word operator into one argument', () => {
        const ast = parseProgram('fw 7 mod 3\nrt 90')
        assert.equal(ast.length, 2)
        assert.equal(ast[0].children.length, 1)
        assert.equal(ast[0].children[0].value, '7 mod 3')
    })

    test('nothing propagates and evaluation refuses undeclared spellings', () => {
        for (const [op] of examples) {
            assert.equal(evaluator.applyOperator(op, null, 1), null, op)
            assert.equal(evaluator.applyOperator(op, 1, undefined), null, op)
        }
        for (const op of ['+', '-', '!']) {
            assert.equal(evaluator.applyUnaryOperator(op, null), null, op)
        }
        for (const op of ['wrap', '*-', '--', '+-', '!']) {
            assert.throws(() => evaluator.applyOperator(op, 2, 3), /Unknown operator/, op)
        }
        assert.throws(() => evaluator.applyUnaryOperator('*', 2), /Unsupported operator/)
    })
})
