import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { at, buildWorld, drive, fork, worldOf } from './harness.mjs'
import { worldTransform } from '../../../assets/js/turtling/scheduler.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'
import { pointStateOf, preparePointRead } from '../../../assets/js/turtling/laws/point_state.js'

const quarter = readFileSync(new URL('../../../scripts/play/rungs/quarter-mark.plang', import.meta.url), 'utf8')
const defs = `def halfturn p peg q do
  let peg.position - p.position = q.position - peg.position
end
def step p a b r do
  let q
  halfturn p a q
  halfturn q b r
end
def trail p a b t do
  let r
  let once = step p a b r
  let again = step r a b t
end`
const near = (a, b) => assert.ok(Math.hypot(...a.map((x, i) => x - b[i])) < 1e-8, `${a} ≠ ${b}`)

function play(source, options) {
    const s = buildWorld(options)
    const host = s.hotSwapChild('host', fork('host', source))
    drive(s, { maxTicks: 120 })
    assert.deepEqual(s.errors, [])
    const frame = name => host.children.get(name)
    const drag = (f, x, y) => {
        const position = SE3.unapply(worldTransform(f), [x, y, 0])
        const release = s.defer(f)
        try { return s.requestMotion(f, { ...at(), position }, s.motionRevision) }
        finally { release() }
    }
    return { s, frame, drag, p: name => worldOf(frame(name)) }
}

test('the quarter-mark is reversible; every published hand cut includes its private halfway point', () => {
    const { s, frame, drag, p } = play(quarter)
    const h = frame('gauge').children.get('h')
    const check = () => {
        const a = p('A'), b = p('B'), x = p('X')
        near(worldOf(h), a.map((v, i) => (v + b[i]) / 2))
        near(x, a.map((v, i) => (3 * v + b[i]) / 4))
    }
    check()
    assert.equal(preparePointRead(s)(h).interaction.offered, false)
    assert.equal(pointStateOf(frame('X'), s).interaction.offered, true)
    assert.equal(drag(h, 50, 5).kind, 'unresolved')
    const cuts = []
    s.onAcceptedChange(() => cuts.push([p('A'), p('X'), p('B'), worldOf(h)]))
    assert.equal(drag(frame('X'), -30, 5).kind, 'accept'); near(p('B'), [90, 20, 0]); check()
    assert.equal(drag(frame('B'), 90, -12).kind, 'accept'); near(p('X'), [-30, -3, 0]); check()
    assert.equal(cuts.length, 2)
    for (const [a, x, b, half] of cuts) {
        near(half, a.map((v, i) => (v + b[i]) / 2)); near(x, a.map((v, i) => (3 * v + b[i]) / 4))
    }
})

test('nested named calls own different local q points; neither changes the public stay cost', () => {
    const { s, frame, drag, p } = play(`${defs}
let A=(0,0)
goto 20 0
let B
goto 5 10
let P
goto 85 10
let T
let tool = trail P A B T`)
    const tool = frame('tool'), r = tool.children.get('r')
    const q1 = tool.children.get('once').children.get('q'), q2 = tool.children.get('again').children.get('q')
    assert.notEqual(q1.id, q2.id)
    assert.equal(s.laws.active().filter(l => l.feature === 'affine').length, 4)
    assert.equal(drag(frame('T'), 85, 27).kind, 'accept')
    near(p('P'), [5, 11, 0]); near(p('B'), [20, 4, 0]); near(worldOf(r), [45, 19, 0])
    near(worldOf(q1), [-5, -11, 0]); near(worldOf(q2), [-45, -19, 0])
    assert.equal(drag(frame('P'), 5, -6).kind, 'accept')
    near(p('T'), [85, 26, 0]); near(worldOf(r), [45, 10, 0])
    assert.equal(s.laws.active().filter(l => l.sourceIds.includes(q1.id)).length, 2)
    s.removeChild('host')
    assert.equal(s.registry.has(q1.id), false)
    assert.equal(s.laws.active().length, 0)
})

test('an underdetermined private pair does not install even if its initial pose satisfies the law', () => {
    const { s, frame } = play(`def ambiguous a do
  let h
  let k
  let a.position - h.position = k.position - a.position
end
let A
let trial = ambiguous A`)
    assert.equal(s.laws.active().length, 0)
    assert.match(frame('trial').unresolved.reason, /affine/)
    assert.deepEqual(s.contradictionGuides, [])
})

test('a distance on the span still vetoes an affine response that would break it', () => {
    const { s, frame, drag, p } = play(quarter + '\nlet distance(A, B) = 160')
    const h = frame('gauge').children.get('h')
    drag(frame('X'), -30, 20)
    assert.ok(Math.abs(p('X')[1]) < 0.04, 'the original distance must veto the requested displacement')
    assert.ok(Math.abs(Math.hypot(p('B')[0] - p('A')[0], p('B')[1] - p('A')[1]) - 160) < 2e-6)
    near(worldOf(h), p('A').map((v, i) => (v + p('B')[i]) / 2))
    assert.deepEqual(s.contradictionGuides, [])
})
