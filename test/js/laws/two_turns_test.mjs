import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildWorld, drive, fork, at, worldOf } from './harness.mjs'
import { collectErrors } from '../../../assets/js/turtling/parse.js'
import { worldTransform } from '../../../assets/js/turtling/scheduler.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'

const rung = readFileSync(new URL('../../../scripts/play/rungs/two-turns.plang', import.meta.url), 'utf8')
const near = (actual, expected) => assert.ok(Math.hypot(...actual.map((x, i) => x - expected[i])) < 1e-6,
    `${actual} ≠ ${expected}`)
const delta = (to, from) => to.map((x, i) => x - from[i])

function play(source) {
    const scheduler = buildWorld()
    const spec = fork('host', source)
    assert.deepEqual(collectErrors(spec.code.ast), [])
    const host = scheduler.hotSwapChild('host', spec)
    drive(scheduler, { maxTicks: 120 })
    assert.deepEqual(scheduler.errors, [])
    return {
        scheduler, host,
        point: (name) => worldOf(host.children.get(name)),
        drag(name, x, y) {
            const frame = host.children.get(name)
            const target = SE3.unapply(worldTransform(frame), [x, y, 0])
            const release = scheduler.defer(frame)
            try { return scheduler.requestMotion(frame, { ...at(x, y), position: target }, scheduler.motionRevision) }
            finally { release() }
        },
    }
}

test('a half-turn nests into a step, and a step into a trail that works backwards', () => {
    const { scheduler, host, point, drag } = play(rung)
    const owners = scheduler.laws.active().filter(l => l.feature === 'affine').map(l => scheduler.registry.get(l.scope))
    assert.equal(new Set(owners).size, 4)
    assert.ok(owners.every(owner => owner.parent.parent === host.children.get('trail')))
    const check = () => {
        for (const [p, peg, q] of [['P', 'A', 'Q'], ['Q', 'B', 'R'], ['R', 'A', 'S'], ['S', 'B', 'T']]) {
            near(delta(point(peg), point(p)), delta(point(q), point(peg)))
        }
        const step = delta(point('B'), point('A')).map(x => 2 * x)
        near(delta(point('R'), point('P')), step)
        near(delta(point('T'), point('R')), step)
    }
    check()
    assert.equal(drag('T', 65, -25).kind, 'accept')
    near(point('T'), [65, -25, 0]); near(point('P'), [-95, -25, 0]); check()
    assert.equal(drag('Q', -50, 15).kind, 'accept')
    near(point('Q'), [-50, 15, 0]); check()
})

test('reverse the second pair of pegs and the trail returns to its first point', () => {
    const { point, drag } = play(rung.replace('step r a s b t', 'step r b s a t'))
    near(point('T'), point('P'))
    assert.equal(drag('T', 30, 22).kind, 'accept')
    near(point('T'), [30, 22, 0]); near(point('P'), point('T'))
    near(delta(point('R'), point('P')), [80, 0, 0])
})

test('erasing an intermediate handle preserves the endpoint law but changes the gesture', () => {
    const scene = `let A = (0,0)
goto 20 0
let B
goto 5 10
let P
goto -5 -10
let Q
goto 45 10
let R`
    const expanded = play(`${scene}
let A.position - P.position = Q.position - A.position
let B.position - Q.position = R.position - B.position`)
    const reduced = play(`${scene}
let R.position - P.position = (B.position - A.position) + (B.position - A.position)`)
    for (const p of [expanded, reduced]) {
        near(p.point('R'), [45, 10, 0])
        assert.equal(p.drag('R', 45, 30).kind, 'accept')
        near(p.point('R'), [45, 30, 0])
        near(delta(p.point('R'), p.point('P')), delta(p.point('B'), p.point('A')).map(x => 2 * x))
    }
    near(expanded.point('P'), [5, 110 / 9, 0]); near(expanded.point('B'), [20, 80 / 9, 0])
    near(reduced.point('P'), [5, 14, 0]); near(reduced.point('B'), [20, 8, 0])
    near(expanded.point('Q'), [-5, -110 / 9, 0]); near(reduced.point('Q'), [-5, -10, 0])
})
