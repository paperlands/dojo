import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { at, buildWorld, drive, fork, worldOf } from './harness.mjs'
import { SE3, AXIS_X } from '../../../assets/js/turtling/se3.js'
import { Versor } from '../../../assets/js/turtling/mafs/versors.js'
import { pointStateOf } from '../../../assets/js/turtling/laws/point_state.js'
import { marksOf } from '../../../assets/js/turtling/laws/constraints.js'
import { boundParticipants, boundReferences } from '../../../assets/js/turtling/laws/authored.js'
import { collectErrors, parseProgram, printAST } from '../../../assets/js/turtling/parse.js'

const rung = (name) => readFileSync(new URL(`../../../scripts/play/rungs/${name}.plang`, import.meta.url), 'utf8')
const sliders = rung('sliding-ellipse')
const string = rung('string-ellipse')
const length = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]))
const near = (actual, want, tolerance = 1e-7) => assert.ok(Math.abs(actual - want) <= tolerance, `${actual} ≠ ${want}`)

function play(source, origin) {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', source, origin))
    drive(scheduler)
    const point = (name) => host.children.get(name)
    const where = (name) => worldOf(point(name))
    const drag = (name, wish) => {
        const result = scheduler.requestMotion(point(name), wish, scheduler.motionRevision, 'world')
        scheduler.tick(40000) // let the slider's dependent pen catch up
        return result
    }
    return { scheduler, host, point, where, drag }
}

for (const [source, axes] of [[sliders, [60, 100]], [sliders.replace('3/8', '1/2'), [80, 80]]]) {
    test(`the rail sliders produce semiaxes ${axes.join(' and ')} without a curve primitive`, () => {
        const { scheduler, host, where, drag } = play(source)
        assert.equal(host.unresolved, null)
        assert.deepEqual(scheduler.errors, [])
        for (const [handle, x, y] of [['A', 0, 160], ['B', -160, 0], ['A', 0, -160], ['B', 160, 0]]) {
            assert.equal(drag(handle, at(x, y)).kind, 'accept')
            const a = where('A'), b = where('B'), p = where('P')
            near(length(a, b), 160)
            near(a[0], 0); near(b[1], 0); near(p[2], 0)
            near((p[0] / axes[0]) ** 2 + (p[1] / axes[1]) ** 2, 1)
            if (handle === 'A') near(p[1], Math.sign(y) * axes[1], 0.01)
            else near(p[0], Math.sign(x) * axes[0], 0.01)
        }
    })
}

test('dragging the pen around the string ellipse keeps both pins and the whole loop', () => {
    const { scheduler, point, where, drag } = play(printAST(parseProgram(string)))
    assert.deepEqual(scheduler.errors, [])
    const f = where('F'), g = where('G')
    const law = scheduler.laws.active().find((law) => law.feature === 'length')
    assert.deepEqual(boundParticipants(law), ['F', 'P', 'G'].map((n) => point(n).id))
    const reads = boundReferences(law).filter((r) => r.aspect === 'position').map((r) => r.id)
    assert.deepEqual(reads, ['F', 'P', 'P', 'G', 'G', 'F'].map((n) => point(n).id))
    for (let i = 0; i < 16; i++) {
        const phase = i * Math.PI / 8
        const wish = at(60 * Math.cos(phase), 100 * Math.sin(phase))
        assert.equal(drag('P', wish).kind, 'accept')
        const p = where('P')
        near(length(p, wish.position), 0, 1e-3)
        near(length(f, p) + length(p, g) + length(g, f), 360)
        assert.deepEqual(where('F'), f)
        assert.deepEqual(where('G'), g)
    }
    const { locus, dof, interaction } = pointStateOf(point('P'), scheduler)
    assert.equal(dof, 1)
    assert.equal(interaction.offered, true)
    assert.equal(locus.shape, 'ellipse')
    near(locus.axes[0], 100)
    near(locus.axes[1], 60)
    const { traces, spokes } = marksOf(locus, { at: where('P') })
    assert.equal(spokes.length, 2)
    near(length(traces[0][0], traces[0].at(-1)), 0)
    assert.ok(traces[0].every((p) => Math.abs(length(f, p) + length(p, g) + length(g, f) - 360) < 1e-7))
    scheduler.laws.retractIdentity(point('F').id)
    assert.equal(scheduler.laws.active().some((law) => law.feature === 'length'), false)
})

test('reversing a route revises its length; a separate plane supplies the cut', () => {
    const pose = { position: [7, 8, 9], rotation: Versor.fromAxisAngle(AXIS_X, 35) }
    const pin = (y) => '(' + SE3.apply(pose, [0, y, 0]).join(', ') + ')'
    const source = string.replace('(0, -80)', pin(-80)).replace('(0, 80)', pin(80)).replace('P.z = 0', 'P.z = 9')
    const { scheduler, where, drag } = play(source + '\nlet length(F, G, P, F) = 370', pose)
    assert.deepEqual(scheduler.errors, [])
    const installed = scheduler.laws.active().filter((law) => law.feature === 'length')
    assert.deepEqual(installed.map((law) => law.predicate), [370])
    const wish = { ...at(0), position: SE3.apply(pose, [60, 10, 20]) }
    assert.equal(drag('P', wish).kind, 'accept')
    const p = where('P'), f = where('F'), g = where('G')
    near(p[2], 9)
    near(length(f, p) + length(p, g) + length(g, f), 370)
})

test('omitting the paper frees one degree; leaving the route open omits its closing span', () => {
    const open = string.replace('let P.z = 0', '').replace('length(F, P, G, F) = 360', 'length(F, P, G) = 200')
    const { scheduler, point, where, drag } = play(open)
    const { locus, dof } = pointStateOf(point('P'), scheduler)
    assert.equal(locus.kind, 'ellipsoid')
    assert.equal(dof, 2)
    assert.equal(drag('P', { ...at(0), position: [0, 0, 70] }).kind, 'accept')
    const p = where('P')
    near(p[2], 60, 1e-4)
    near(length(where('F'), p) + length(p, where('G')), 200)
})

test('a separate paper law can be added after the length; a satisfied route moves nothing', () => {
    const { scheduler, point } = play(string.replace('let P.z = 0\n', '') + '\nlet P.z = 0')
    assert.deepEqual(scheduler.errors, [])
    assert.equal(pointStateOf(point('P'), scheduler).locus?.shape, 'ellipse')
    const source = 'let A\nlet length(A, (0,0)) = 0'
    const satisfied = play(source)
    assert.deepEqual(satisfied.scheduler.errors, [])
    assert.equal(satisfied.scheduler.laws.active()[0]?.feature, 'length')
    assert.deepEqual(satisfied.where('A'), [0, 0, 0])
})
test('an unsupported route is not installed and does not pin another point', () => {
    for (const [source, expected, z = 0] of [
        [string.replace('let P.z = 0', 'let P.z = 5'), /no supported placement/, 5],
        [string.replace('let F = (0, -80)', 'let F'), /one adjustable point/],
    ]) {
        const { scheduler, host, where } = play(source)
        assert.match(host.unresolved?.reason ?? '', expected)
        assert.deepEqual(where('P'), [0, 0, z])
        assert.equal(scheduler.laws.active().some((law) => law.feature === 'length'), false)
    }
    assert.notEqual(collectErrors(parseProgram('let length(P) = 9')).length, 0)
})
