import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildWorld, drive, fork, at, worldOf } from './harness.mjs'
import { collectErrors, parseProgram, printAST } from '../../../assets/js/turtling/parse.js'
import { pointStateOf } from '../../../assets/js/turtling/laws/point_state.js'

const midpoint = `def midpoint a m b do
  let m.position - a.position = b.position - m.position
end`
const rung = readFileSync(new URL('../../../scripts/play/rungs/reversible-midpoint.plang', import.meta.url), 'utf8')
const near = (a, b) => assert.ok(Math.hypot(...a.map((x, i) => x - b[i])) < 1e-6, `${a} ≠ ${b}`)

function play(source, origin) {
    const ast = parseProgram(source)
    assert.deepEqual(collectErrors(ast), [])
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', printAST(ast), origin))
    drive(scheduler, { maxTicks: 80 })
    assert.deepEqual(scheduler.errors, [])
    const frame = (name) => host.children.get(name)
    const point = (name) => worldOf(frame(name))
    const drag = (name, x, y) => scheduler.requestMotion(frame(name), at(x, y), scheduler.motionRevision, 'world')
    return { scheduler, host, frame, point, drag }
}

test('a named recipe binds actuals; pinned ends place M with no output role on the law', () => {
    const p = play(`${midpoint}
let A = (-60, 0)
let B = (60, 0)
jmp 20
let M
let rule = midpoint A M B`)
    near(p.point('M'), [0, 0, 0])
    const [law] = p.scheduler.laws.active().filter(l => l.feature === 'affine')
    assert.equal(law.scope, p.frame('rule').id)
    assert.deepEqual(law.expression.references, ['M', 'A', 'B', 'M'].map(n => p.frame(n).id))
    p.drag('M', 20, 15)
    near(p.point('M'), [0, 0, 0])
})

test('the same recipe keeps the grabbed point; all responding points publish together', () => {
    const p = play(rung)
    const held = pointStateOf(p.frame('M'), p.scheduler)
    assert.equal(held.interaction.offered, true)
    const check = () => near(p.point('A').map((x, i) => (x + p.point('B')[i]) / 2), p.point('M'))
    // The headless hand and the browser pointer share this admission path.
    const observed = []
    p.scheduler.onAcceptedChange(() => observed.push(['A', 'M', 'B'].map(p.point)))
    assert.equal(p.drag('M', 10, 20).kind, 'accept')
    near(p.point('A'), [-90, 20, 0]); near(p.point('M'), [10, 20, 0]); near(p.point('B'), [110, 20, 0])
    assert.equal(p.drag('A', -75, -10).kind, 'accept')
    near(p.point('A'), [-75, -10, 0]); check()
    assert.ok(observed.length >= 2)
    for (const [a, m, b] of observed) near(m, a.map((x, i) => (x + b[i]) / 2))
})

test('redundant recipes keep their owners without doubling motion; a cancelled read still retires the law', () => {
    const p = play(`${midpoint}
jmp -60
let A
jmp 120
let B
jmp -60
let M
let X
let first = midpoint A M B
let second = midpoint B M A
let M.position + (X.position - X.position) - A.position = B.position - M.position`)
    const count = () => p.scheduler.laws.active().filter(l => l.feature === 'affine').length
    assert.equal(count(), 3)
    assert.equal(p.drag('M', 30, 10).kind, 'accept')
    near(p.point('A'), [-30, 10, 0]); near(p.point('B'), [90, 10, 0]); near(p.point('X'), [0, 0, 0])
    p.scheduler.laws.retractIdentity(p.frame('X').id)
    assert.equal(count(), 2)
    p.scheduler.laws.retractScope(p.frame('first').id)
    assert.equal(count(), 1)
})

test('a cancelled affine row neither takes over a distance drag nor loses its source identity', () => {
    const p = play(`let A
jmp 20
let B
let distance(A, B) = 20
let A.position - A.position = A.position - A.position`)
    const affine = p.scheduler.laws.active().find(law => law.feature === 'affine')
    assert.deepEqual(affine.endpoints, [])
    assert.deepEqual(affine.sourceIds, [p.frame('A').id])
    assert.equal(p.drag('A', 5, 5).kind, 'accept')
    near(p.point('A'), [5, 5, 0])
    const b = p.point('B')
    assert.ok(Math.abs(Math.hypot(b[0] - 5, b[1] - 5) - 20) < 1e-6)
})

test('a mixed component can accept the same affine offer when the original distance holds', () => {
    const p = play(`${midpoint}
jmp -60
let A
jmp 120
let B
jmp -60
let M
let distance(A, B) = 120
let rule = midpoint A M B`)
    assert.equal(p.drag('M', 0, 40).kind, 'accept')
    near(p.point('A'), [-60, 40, 0]); near(p.point('B'), [60, 40, 0]); near(p.point('M'), [0, 40, 0])
})
test('a mixed distance law vetoes the least-change affine offer', () => {
    const p = play(`${midpoint}
let A = (0, 0)
jmp 60
let M
jmp 60
let B
let distance(B, A) = 120
let rule = midpoint A M B`)
    const before = ['A', 'M', 'B'].map(p.point)
    const answer = p.drag('M', 60, 40)
    assert.notEqual(answer.kind, 'fault')
    // A clamp can make small progress within tolerance; it must not accept the wish.
    assert.ok(Math.abs(p.point('M')[1]) < 0.02)
    near(p.point('A'), before[0])
    near(p.point('M'), p.point('B').map(x => x / 2))
    assert.ok(Math.abs(Math.hypot(...p.point('B')) - 120) < 2e-6)
    assert.deepEqual(p.scheduler.contradictionGuides, [])
})

test('four calls compose a quadrilateral whose opposite midpoint sides stay equal', () => {
    const p = play(`${midpoint}
let A
jmp 100
let B
lt 90
jmp 70
let C
lt 90
jmp 100
let D
let M
let N
let O
let Q
let ab = midpoint A M B
let bc = midpoint B N C
let cd = midpoint C O D
let da = midpoint D Q A`)
    const v = (a, b) => p.point(b).map((x, i) => x - p.point(a)[i])
    const check = () => {
        for (const [a, m, b] of [['A', 'M', 'B'], ['B', 'N', 'C'], ['C', 'O', 'D'], ['D', 'Q', 'A']]) {
            near(v(a, m), v(m, b))
        }
        near(v('M', 'N'), v('Q', 'O')); near(v('M', 'Q'), v('N', 'O'))
    }
    check()
    assert.equal(p.drag('B', 0, 80).kind, 'accept')
    check()
    assert.equal(p.drag('M', 7, -20).kind, 'accept')
    check()
})

test('an author can close a four-point displacement without defining a midpoint', () => {
    const p = play(`let A = (0, 0)
let B = (40, 0)
let C = (0, 20)
let D
let [0,0,0] = (B.position - A.position) - (D.position - C.position)`)
    near(p.point('D'), [40, 20, 0])
})

test('a point is not a displacement; point literals are not silently placed in a chart', () => {
    for (const source of [
        'let A.position+B.position = C.position',
        'let A.position-B.position = C.position',
        'let A.position-B.position = (0,0,0)',
        'let A.position-B.position = distance(A,B)',
    ]) assert.ok(collectErrors(parseProgram(source)).length, source)
})
