// probe-status: concluded
// probe-witness: test/js/notation/ (falsifiers graduated per BASELINE.md)
// Headless falsifier battery, not a claim about children's lived experience.
// Run: node probe/notation-inquiry/probe.mjs
import { Lexer } from '../../assets/js/turtling/mafs/lexer.js'
import { Parser } from '../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../assets/js/turtling/mafs/evaluate.js'
import { parseProgram } from '../../assets/js/turtling/parse.js'
import { drainEvents } from '../../assets/js/turtling/executor.js'
import { Versor } from '../../assets/js/turtling/mafs/versors.js'

const lexer = new Lexer()
const parser = new Parser()
const evaluator = new Evaluator()
const context = { u: 2, v: 3, x: 4, y: 5, model: 7, 'u.x': 9, mod3: 8 }
const shape = (ast) => ast.children.length
    ? [ast.type, ast.value, ...ast.children.map(shape)] : ast.value
const value = (v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v
const cases = [
    ['2+3', 'ordinary arithmetic remains usable'],
    ['2$+3', 'unsupported glyph should be refused, not dropped'],
    ['.5+1', 'a decimal without a leading zero must not become five'],
    ['u.v', 'a glued path is one name'],
    ['u . v', 'a spaced dot must not silently become multiplication'],
    ['(u+v).x', 'selection should remain meaningful on an expression'],
    ['u.x', 'a dotted name must remain whole'],
    ['(2]', 'different delimiter kinds should not match'],
    ['[2)', 'different delimiter kinds should not match'],
    ['[1]', 'singleton bracket exposes grouping/vector ambiguity'],
    ['[1,2]', 'vector doorway is currently unavailable'],
    ['sin[30]', 'square brackets should not accidentally call sine'],
    ['sin(30]', 'an ill-closed function call should be refused'],
    ['x[1]', 'indexing must not report an unrelated function error'],
    ['2x', 'juxtaposition genuinely helps arithmetic'],
    ['x(y+1)', 'named call versus mathematical juxtaposition is ambiguous'],
    ['(x)(y+1)', 'grouped juxtaposition can work where x(...) does not'],
    ['sin(30)(2)', 'application-after-call versus implicit multiplication'],
    ['7mod3', 'word operator may touch digits'],
    ['mod3', 'a name accepted by identifier shape may be stolen by word splitting'],
    ['mod(7,3)', 'word operator currently has no function-shaped doorway'],
    ['3<2<1', 'mathematical chained comparison should not produce true'],
    ['-2^2', 'compatibility is not proof of mathematical convention'],
    ['(-2)^2', 'parentheses must make the intended contrast visible'],
    ['0 && missing', 'a dead branch should not require an absent name'],
    ['1 || missing', 'a dead branch should not require an absent name'],
    ['sqrt(-1)', 'domain failure must not teach NaN as a quantity'],
    ['1/0', 'division domain needs an explicit demand/display policy'],
    ['sin(1e-15)', 'tiny nonzero signals should not disappear in arithmetic'],
]
for (const [source, prediction] of cases) {
    const result = { source, prediction, tokens: lexer.tokenize(source).map((t) => t.value) }
    try {
        const ast = parser.parse(source)
        result.ast = shape(ast)
        result.value = value(evaluator.run(ast, context))
    } catch (error) { result.error = error.message }
    console.log(JSON.stringify(result))
}
for (const source of ['fw 7 mod 3', 'fw x + 1 2', 'fw sin(30)', 'fw sin (30)', 'label "value [x]"', 'goto [1,2,3]']) {
    console.log(JSON.stringify({ program: source, ast: parseProgram(source).map(shape) }))
}
const external = new Evaluator()
const reads = []
external.resolveExternal = (name) => { reads.push(name); return 99 }
console.log(JSON.stringify({ source: 'u.v with local u and v plus external resolver',
    value: external.run(parser.parse('u.v'), context), externalReads: reads }))
for (const source of ['u+v', 'u*v']) {
    console.log(JSON.stringify({ source, supplied: 'arrays through context, not vector literals',
        value: value(evaluator.run(parser.parse(source), { u: [1,2], v: [3,4] })) }))
}

for (const source of ['fw 2$+3', 'fw .5+1', 'fw (2+3) * 2', 'fw 2 * (3+4)',
    'fw sin(30)', 'fw sin (30)', 'fw 3<2<1', 'fw sqrt(-1)', 'fw 1/0']) {
    const result = { walk: source, arguments: parseProgram(source).map(shape) }
    try {
        const deps = { mathParser: new Parser(), mathEvaluator: new Evaluator() }
        result.events = drainEvents(parseProgram(source), deps).map((event) => ({
            type: event.type,
            points: event.points?.map((point) => point.map(value)),
            position: event.position?.map(value)
        }))
    } catch (error) { result.error = error.message }
    console.log(JSON.stringify(result))
}

const divisor = Number.MAX_SAFE_INTEGER
const dividend = divisor - 1
console.log(JSON.stringify({ arithmetic: 'safe integer division identity', dividend, divisor,
    quotient: evaluator.applyOperator('//', dividend, divisor),
    remainder: evaluator.applyOperator('mod', dividend, divisor), expectedRemainder: dividend }))

for (const degrees of [30, 150]) {
    const radians = degrees * Math.PI / 180
    console.log(JSON.stringify({ geometry: "unit-vector wedge does not determine angle",
        degrees, wedgeXY: Math.sin(radians), dot: Math.cos(radians) }))
}
const direction = { x: 1, y: 0, z: 0 }
console.log(JSON.stringify({ geometry: "complex left multiplication is not rotor sandwich",
    imaginaryUnitAsRotor: new Versor(0, 0, 0, 1).rotate(direction),
    quarterTurn: Versor.fromAxisAngle({ x: 0, y: 0, z: 1 }, 90).rotate(direction) }))

for (const code of ['loop 36 do\nfw 1\nrt 10\nend', 'fn step[n] n+1\nfw step(2)', 'fn mod3 8\nfw mod3']) {
    const result = { walk: code }
    try {
        const events = drainEvents(parseProgram(code), { mathParser: new Parser(), mathEvaluator: new Evaluator() })
        result.heads = events.filter((e) => e.type === 'head').map((e) => e.position)
        result.pathLengths = events.filter((e) => e.type === 'path').map((e) => e.points.length)
    } catch (error) { result.error = error.message }
    console.log(JSON.stringify(result))
}
