// The conic orbit family: one authored cone cut by one authored plane.
// Pitch is the cutting geometry; the conic is the exact locus, never a motor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, worldOf } from './harness.mjs'
import { pointStateOf } from '../../../assets/js/turtling/laws/point_state.js'
import { conicSource } from './conic_source.mjs'
import { readFileSync } from 'node:fs'

const RUNG = readFileSync(new URL('../../../scripts/play/rungs/conic-orbit.txt', import.meta.url), 'utf8')
const pass = ({ requested }) => ({ accepted: true, transform: requested })

function run(source) {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', source))
    drive(scheduler, { maxTicks: 30 })
    const P = [...scheduler.registry.values()].find((frame) => frame.name === 'P')
    return { scheduler, host, P, state: P ? pointStateOf(P, scheduler) : null }
}

test('the actual conic rung resolves to an ellipse cut', () => {
    const { scheduler, P, state } = run(RUNG)
    assert.deepEqual(scheduler.errors, [])
    assert.ok(P)
    assert.equal(state.status, 'accepted')
    assert.equal(state.locus.kind, 'conic')
    assert.equal(state.locus.shape, 'ellipse')
    assert.equal(state.dof, 1)
    assert.ok(state.at.every(Number.isFinite))
})

test('pitch selects the conic family: hyperbola -> parabola -> ellipse -> circle', () => {
    const families = [[0, 'conic', 'hyperbola'], [30, 'conic', 'parabola'],
        [60, 'conic', 'ellipse'], [90, 'circle', null]]
    for (const [pitch, kind, shape] of families) {
        const { scheduler, state } = run(conicSource({ pitch }))
        assert.deepEqual(scheduler.errors, [], `pitch ${pitch}`)
        assert.equal(state.locus.kind, kind, `pitch ${pitch} kind`)
        if (shape) assert.equal(state.locus.shape, shape, `pitch ${pitch} shape`)
        assert.equal(state.dof, 1, `pitch ${pitch} dof`)
        assert.equal(state.status, 'accepted')
    }
})

test('the cone laws remain active beside the cut; the point is on the exact locus', () => {
    const { scheduler, host, P, state } = run(conicSource({ pitch: 60 }))
    const features = scheduler.laws.active().map((law) => law.feature).sort()
    assert.deepEqual(features, ['coordinate', 'tilt'])
    assert.ok(Math.abs(state.at[2] - 1) < 1e-9, 'the cutting plane z=1 holds')
    assert.ok([...scheduler.registry.values()].some((frame) => frame.name === 'P'))
    assert.equal(worldOf(P).length, 3)
})

test('a different cutting height moves the section without changing its family', () => {
    const a = run(conicSource({ pitch: 60, cut: 1 }))
    const b = run(conicSource({ pitch: 60, cut: 2 }))
    assert.equal(a.state.locus.kind, 'conic')
    assert.equal(b.state.locus.kind, 'conic')
    assert.equal(a.state.locus.shape, b.state.locus.shape)
    assert.notDeepEqual(a.state.locus.origin, b.state.locus.origin)
})
