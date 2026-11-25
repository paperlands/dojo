// A relational payload is a reading, not a constant: a live RHS makes the law a driver,
// so a knob that moves the budget moves the figure. A literal RHS costs no driver at all.
// (id:laws-dependency-driven-place)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { at, buildWorld, drive, fork, worldOf } from './harness.mjs'
import { collectErrors, parseProgram, printAST } from '../../../assets/js/turtling/parse.js'
import { pointStateOf } from '../../../assets/js/turtling/laws/point_state.js'

const program = (budget) => `let F = (-60, 0)
let G = (60, 0)
let K
jmp 40
lt 90
jmp 50
let P
let n = K.x + ${budget}
let distance(F, P)+distance(P, G) = n`

function play(source) {
    const ast = parseProgram(source)
    assert.deepEqual(collectErrors(ast), [])
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', printAST(ast)))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    return { scheduler, host }
}

const lengthLaw = (scheduler) => scheduler.laws.active().find((law) => law.feature === 'length') ?? null
const locusOf = (p, scheduler) => pointStateOf(p.scheduler.root.children.get('host').children.get(p.name), p.scheduler).locus

test('a moved knob re-reads the budget and the figure follows it onto the segment', () => {
    const p = play(program(150))
    const { scheduler } = p
    const host = () => scheduler.root.children.get('host')
    const P = () => host().children.get('P')
    const K = () => host().children.get('K')

    assert.equal(lengthLaw(scheduler).predicate, 150)
    assert.equal(pointStateOf(P(), scheduler).locus.kind, 'ellipsoid')

    // K.x moves 0 → −30, so the reading 150 + K.x becomes exactly the pin separation.
    assert.equal(scheduler.requestMotion(K(), at(-30, 0), scheduler.motionRevision, 'world').kind, 'accept')
    drive(scheduler)

    assert.equal(lengthLaw(scheduler).predicate, 120, 'the driven payload is refreshed')
    const state = pointStateOf(P(), scheduler)
    assert.deepEqual(state.locus, { kind: 'segment', from: [-60, 0, 0], to: [60, 0, 0] })
    assert.equal(state.dof, 1)
    // The move keeps the nearest point on the new locus, so P lands on the segment itself.
    const [px, py] = worldOf(P())
    assert.equal(py, 0, 'P is on the line through the pins')
    assert.ok(px >= -60 && px <= 60, 'P is between the pins')
    const F = worldOf(host().children.get('F')), G = worldOf(host().children.get('G'))
    const span = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    assert.ok(Math.abs(span(F, worldOf(P())) + span(worldOf(P()), G) - 120) < 1e-6, 'the budget holds')
})

test('the same law drives through a bare name and through its own expression', () => {
    for (const reading of ['n', 'K.x + 150']) {
        const p = play(`let F = (-60, 0)
let G = (60, 0)
let K
jmp 40
lt 90
jmp 50
let P
let n = K.x + 150
let distance(F, P)+distance(P, G) = ${reading}`)
        const { scheduler } = p
        const host = () => scheduler.root.children.get('host')
        scheduler.requestMotion(host().children.get('K'), at(-30, 0), scheduler.motionRevision, 'world')
        drive(scheduler)
        assert.equal(lengthLaw(scheduler).predicate, 120, `reading ${reading}`)
        assert.equal(pointStateOf(host().children.get('P'), scheduler).locus.kind, 'segment', `reading ${reading}`)
    }
})

test('a literal payload registers no driver: the capability costs nothing until it is read', () => {
    const silent = play(`let F = (-60, 0)
let G = (60, 0)
let P
let distance(F, P)+distance(P, G) = 150`)
    assert.equal(silent.scheduler.readouts.stats().size, 0)

    const driven = play(program(150))
    const size = driven.scheduler.readouts.stats().size
    assert.ok(size >= 2, `a derived reading and a driven law are nodes (got ${size})`)
})

test('the knob is a dependency of the law: retiring it retracts what stood on it', () => {
    const p = play(program(150))
    const { scheduler } = p
    const K = scheduler.root.children.get('host').children.get('K')
    assert.ok(lengthLaw(scheduler).sourceIds.includes(K.id), 'the reading is a source of the law')
    assert.equal(scheduler.laws.retractIdentity(K.id), 'retracted')
    assert.equal(lengthLaw(scheduler), null)
})
