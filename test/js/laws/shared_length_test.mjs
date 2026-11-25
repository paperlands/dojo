import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { at, buildWorld, drive, fork, worldOf } from './harness.mjs'
import { collectErrors, parseProgram, printAST } from '../../../assets/js/turtling/parse.js'
import { pointStateOf } from '../../../assets/js/turtling/laws/point_state.js'

const rung = readFileSync(new URL('../../../scripts/play/rungs/shared-length.plang', import.meta.url), 'utf8')
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]))
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`)

function play(source = rung) {
    const ast = parseProgram(source)
    assert.deepEqual(collectErrors(ast), [])
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', printAST(ast)))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    return { scheduler, host, point: name => host.children.get(name), at: name => worldOf(host.children.get(name)) }
}

test('two bars share the budget, not a connector, and publish each exchange together', () => {
    const p = play()
    const { scheduler } = p
    const radii = () => [distance(p.at('A'), p.at('B')), distance(p.at('C'), p.at('D'))]
    assert.deepEqual(radii(), [120, 120]) // born at 130 each, so each gives up 10
    const b = pointStateOf(p.point('B'), scheduler)
    assert.equal(b.locus, null, 'a coupled budget does not lock the grab to the old radius')
    assert.deepEqual(b.truth.lengthSpans, [[p.at('A'), p.at('B')]])
    const published = []
    const stop = scheduler.onAcceptedChange(() => published.push(radii()))
    for (const [name, x, y, left, right] of [['B', -85, 85, 160, 80], ['D', 85, 75, 90, 150]]) {
        const result = scheduler.requestMotion(p.point(name), at(x, y), scheduler.motionRevision, 'world')
        assert.equal(result.kind, 'accept')
        assert.deepEqual(radii(), [left, right])
    }
    assert.equal(scheduler.requestMotion(p.point('D'), at(85, 235), scheduler.motionRevision, 'world').kind, 'accept')
    assert.ok(radii()[0] < 0.01 && radii()[1] > 239.99, 'overreach spends the available budget, never a negative length')
    assert.deepEqual(p.at('A'), [-85, -75, 0])
    assert.deepEqual(p.at('C'), [85, -75, 0])
    assert.ok(published.length >= 2)
    for (const [left, right] of published) near(left + right, 240)
    stop()
})

test('sum and route are the same law; direction and addend order do not matter, multiplicity does', () => {
    const p = play(`let F = (-60, 0)
let G = (60, 0)
jmp 80
let P
let P.z = 0
let length(F, P, G) = 160
let (distance(G, P) + distance(P, F)) = 200`)
    const laws = p.scheduler.laws.active().filter(law => law.feature === 'length')
    assert.deepEqual(laws.map(law => law.predicate), [200])
    near(distance(p.at('F'), p.at('P')) + distance(p.at('P'), p.at('G')), 200)
    assert.equal(pointStateOf(p.point('P'), p.scheduler).locus.shape, 'ellipse')
    const twice = play('let A = (0, 0)\njmp 70\nlet B\nlet distance(A, B) + distance(B, A) = 100')
    near(distance(twice.at('A'), twice.at('B')), 50)
    assert.notEqual(laws[0].address, twice.scheduler.laws.active().find(law => law.feature === 'length').address)
    assert.notEqual(collectErrors(parseProgram('let distance(A,B) + 12 = 30')).length, 0)
})

const twoFoci = (budget, extra = '') => `let F = (-60, 0)
let G = (60, 0)
let P
${extra}
let distance(F, P) + distance(P, G) = ${budget}`

test('exactly the pin separation is a closed segment, not an infinite line or a locked midpoint', () => {
    for (const paper of ['', 'let P.z = 0']) {
        const p = play(twoFoci(120, paper))
        assert.deepEqual(p.at('P'), [0, 0, 0])
        const { scheduler } = p
        const state = pointStateOf(p.point('P'), scheduler)
        assert.deepEqual(state.locus, { kind: 'segment', from: [-60, 0, 0], to: [60, 0, 0] })
        assert.equal(state.dof, 1)
        for (const [x, expected] of [[100, 60], [-100, -60], [25, 25]]) {
            const offer = scheduler.requestMotion(p.point('P'), at(x, 25), scheduler.motionRevision, 'world')
            assert.equal(offer.kind, 'accept')
            assert.deepEqual(p.at('P'), [expected, 0, 0])
        }
        assert.deepEqual(scheduler.contradictionGuides, [])
    }
})

test('a proven shortfall marks the refused spans, and repairing it clears the marks', () => {
    const s = buildWorld()
    const before = s.hotSwapChild('host', fork('host', twoFoci(119)))
    drive(s)
    assert.equal(s.errors[0]?.kind, 'contradiction')
    assert.match(s.errors[0].message, /need at least 120/)
    assert.deepEqual(worldOf(before.children.get('P')), [0, 0, 0])
    assert.equal(s.laws.active().some((law) => law.feature === 'length'), false)
    assert.deepEqual(s.contradictionGuides, [[[-60, 0, 0], [0, 0, 0]], [[0, 0, 0], [60, 0, 0]]])
    s.hotSwapChild('host', fork('host', twoFoci(120)))
    drive(s)
    assert.deepEqual(s.contradictionGuides, [])
    assert.deepEqual(s.errors, [])
})

test('near-degenerate lengths are not marked red without a proof', () => {
    const p = play(twoFoci(119.999999999, 'jmp 20\nlt 90\n jmp 10'))
    assert.deepEqual(p.scheduler.contradictionGuides, [])
})

test('a fixed span spends the budget without pulling on the free bar, and retires with its pin', () => {
    const p = play(`let A = (0, 0)
let C = (0, 200)
let D = (0, 210)
jmp 20
let B
let distance(C, D) + distance(A, B) = 50`)
    near(distance(p.at('A'), p.at('B')), 40)
    near(distance(p.at('C'), p.at('D')), 10)
    const state = pointStateOf(p.point('B'), p.scheduler)
    assert.equal(state.locus.kind, 'sphere')
    assert.equal(state.locus.radius, 40)
    p.scheduler.laws.retractIdentity(p.point('D').id)
    assert.ok(!p.scheduler.laws.active().some(law => law.feature === 'length'))
})
