// One rule, two rows: a lawful SOURCE is a placement for a singleton mover, never an
// absence of edits the gate must then refuse. An empty answer leaves the point off the law,
// the gate refuses what the row never read, and the law vanishes.
// (id:laws-hand-action-state, D058)
// Run: node --test test/js/laws/source_placement_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, worldOf } from './harness.mjs'
import { pointStateOf } from '../../../assets/js/turtling/laws/point_state.js'

const span = (L) => `let P = (-50, 0)\nlet Q = (50, 0)\nlet M\nlet length(P, M, Q) = ${L}`
const pinned = `let A = (-60, 0)\nlet B = (60, 0)\nlet M`
const midpoint = `def midpoint a m b do\n  let m.position - a.position = b.position - m.position\nend`
const midpointLaw = `${midpoint}\n${pinned}\nlet rule = midpoint A M B`
// The recorded construction input, exactly as the shell hands it back on a source edit.
const choice = (name, by) => ({ v: 1, inputs: [{ route: { root: 'document', names: [name] }, action: { kind: 'translation', by } }] })
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const near = (a, b, why) => assert.ok(Math.hypot(...a.map((x, i) => x - b[i])) <= 1e-6,
    `${why}: ${a.map((n) => +n.toFixed(6))} ≠ ${b.map((n) => +n.toFixed(6))}`)

const seat = (scheduler, source, options = {}) => {
    const host = scheduler.hotSwapChild('host', fork('host', source), options)
    drive(scheduler, { maxTicks: 40 })
    return host
}
const drag = (scheduler, frame, to) =>
    scheduler.requestMotion(frame, { ...frame.transform.deref(), position: to }, scheduler.motionRevision, 'world')

test('a lawful source after a retained replay installs the length law on the segment', () => {
    const scheduler = buildWorld({})
    let host = seat(scheduler, span(150))
    assert.equal(drag(scheduler, host.children.get('M'), [18, -9, 0]).kind, 'accept')
    drive(scheduler, { maxTicks: 30 })
    const accepted = worldOf(host.children.get('M'))

    // The source edit 150 → 100 (the pin separation), replaying the retained input.
    host = seat(scheduler, span(100), { fresh: true, choices: choice('M', accepted) })
    const laws = scheduler.laws.active().filter((l) => l.feature === 'length')
    assert.equal(laws.length, 1, 'the 100 law installs instead of vanishing')
    assert.equal(laws[0].predicate, 100, 'the installed payload is the edited one')
    assert.deepEqual(scheduler.errors, [], 'no contradiction is claimed')

    const p = host.children.get('M')
    const state = pointStateOf(p, scheduler)
    assert.equal(state.locus.kind, 'segment', 'the degenerate budget names the segment')
    assert.equal(state.dof, 1, 'one degree of freedom: along the segment')
    assert.equal(state.status, 'accepted', 'the place is answered, not held as previous')
    // The replayed intent on the segment: its x clamped to the foci, y and z on the segment.
    const seen = worldOf(p)
    near(seen, [clamp(accepted[0], -50, 50), 0, 0], 'the intended accepted point after replay')
})

test('the same rule carries the affine row: a singleton mover is placed at its source', () => {
    const scheduler = buildWorld({})
    let host = seat(scheduler, pinned)                 // free: the drag is admitted
    assert.equal(drag(scheduler, host.children.get('M'), [20, 15, 0]).kind, 'accept')
    drive(scheduler, { maxTicks: 30 })
    const accepted = worldOf(host.children.get('M'))

    host = seat(scheduler, midpointLaw, { fresh: true, choices: choice('M', accepted) })
    const laws = scheduler.laws.active().filter((l) => l.feature === 'affine')
    assert.equal(laws.length, 1, 'the affine law installs instead of vanishing')
    assert.deepEqual(scheduler.errors, [], 'no contradiction is claimed')

    const p = host.children.get('M')
    const state = pointStateOf(p, scheduler)
    assert.equal(state.locus.kind, 'point', 'a singleton affine law names the midpoint')
    assert.equal(state.dof, 0, 'no freedom off the point')
    assert.equal(state.status, 'accepted', 'the place is answered')
    // The midpoint of the pinned ends — the source the reach names.
    near(worldOf(p), [((-60) + 60) / 2, 0, 0], 'placed at the source, not left at the replay')
})
