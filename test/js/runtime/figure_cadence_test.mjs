// Logical waits reveal drawing; CPU preemption must not replace an accepted picture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Vector3 } from '../../../assets/js/utils/three-entry.js'
import { LineMaterial } from '../../../assets/js/utils/three-addons/lines/LineMaterial.js'
import { createCompositor } from '../../../assets/js/turtling/compositor.js'
import { createFocus } from '../../../assets/js/turtling/focus.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'
import { createPacer } from '../../../assets/js/turtling/pacer.js'
import { buildWorld, fork } from '../laws/harness.mjs'

// A deterministic work clock: cadence is asserted logically, not decided by wall time.
// Wall-time performance belongs in the probes. (id:render-construction-cadence)
function display(source, { scheduler = buildWorld({ capacity: 512, clock: () => 0 }), pacer } = {}) {
    const host = scheduler.hotSwapChild('host', fork('host', source))
    const scene = new Group(), ink = new LineMaterial({ vertexColors: true })
    ink._cached = true
    const compositor = createCompositor(scheduler, {
        scene, camera: { position: new Vector3(0, 0, 1000) },
        materials: { getInk: () => ink }, requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), pacer, createText: () => { throw Error('fixture has no labels') } })
    const segments = () => {
        let n = 0
        scene.traverse(obj => { n += obj.geometry?.instanceCount || 0 })
        return n
    }
    return { scheduler, host, compositor, segments }
}

const waited = 'draw r n do\n fw n\n wait 0.1\n fw n\nend\nlet F = r 2'

test('a waited figure displays its first step while sleeping, then its second step when due', () => {
    const r = display(waited), F = r.host.children.get('F')
    r.compositor.advance(0)
    assert.equal(F.done, false)
    assert.equal(F.resumeAt, 100)
    assert.equal(r.segments(), 1, 'first ink must not wait for the entire recipe to finish')
    r.compositor.advance(32)
    assert.equal(r.segments(), 1, 'a display pump must not fast-forward a logical wait')
    r.compositor.advance(64)
    assert.equal(r.segments(), 1)
    r.compositor.advance(100)
    assert.equal(F.done, true)
    assert.equal(r.segments(), 2)
})

test('an ordinary process still draws incrementally and sleeps on the same clock', () => {
    const r = display('fw 2\nwait 0.1\nfw 2')
    r.compositor.advance(0)
    assert.equal(r.segments(), 1)
    r.compositor.advance(32)
    r.compositor.advance(64)
    assert.equal(r.segments(), 1)
    r.compositor.advance(100)
    assert.equal(r.segments(), 2)
})

test('a recursive animation reveals each waited step without needing done', () => {
    const r = display('draw r n do\n fw n\n wait 0.01\n r n\nend\nlet F = r 1')
    r.compositor.advance(0)
    assert.equal(r.segments(), 1)
    r.compositor.advance(10)
    assert.equal(r.segments(), 2)
    r.compositor.advance(20)
    assert.equal(r.segments(), 3)
    assert.equal(r.host.children.get('F').done, false)
})

test('a waited child reveals ink even when its enclosing figure has ended its own body', () => {
    const r = display('draw r n do\n as kid do\n  fw n\n  wait 0.1\n  fw n\n end\nend\nlet F = r 2')
    r.compositor.advance(0)
    assert.equal(r.host.children.get('F').done, true)
    assert.equal(r.host.children.get('F').children.get('kid').done, false)
    assert.equal(r.segments(), 1)
    r.compositor.advance(32)
    r.compositor.advance(64)
    r.compositor.advance(100)
    assert.equal(r.segments(), 2)
})

test('the unit-circle recipe reveals one triangle per authored second', () => {
    const r = display(`draw tri theta hyp inc do
 when inc>0 do
  beColour darkorange
  fw cos[theta]*hyp
  lt 90
  beColour red
  fw sin[theta]*hyp
  lt 90+theta
  beColour blue
  fw hyp
  lt 180-theta
  wait 1
  tri theta+10 hyp inc-10
 end
end
let X
let X.distance=5
let X.z=0
let circle=tri 10 5 350-X.bearing`)
    r.compositor.advance(0)
    assert.equal(r.segments(), 3)
    for (let t = 16; t < 1000; t += 16) r.compositor.advance(t)
    assert.equal(r.segments(), 3, 'wait 1 must preserve the first triangle for a second')
    r.compositor.advance(1000)
    assert.equal(r.segments(), 6)
    assert.equal(r.host.children.get('circle').done, false)
})

test('a restarted figure exposes its incremental new ink', () => {
    // F draws `size` paths, then waits; size reads the moving point X. Moving X
    // changes F's captured question, so the same slot begins a NEW run. The first
    // frame of that run must already show its own ink: a restart starts a new
    // drawing, it does not hold the previous picture. (id:render-construction-cadence)
    const r = display(`draw r n do
 loop n do
  fw 1
 end
 wait n
 fw n
end
let X
let size=X.x+1
let F=r size`)
    const F = r.host.children.get('F'), X = r.host.children.get('X')
    r.compositor.advance(0)
    assert.equal(r.segments(), 1)
    r.compositor.advance(1000)
    assert.equal(F.done, true)
    assert.equal(r.segments(), 2)
    const run = F.runIncarnation
    assert.equal(r.scheduler.requestMotion(X,
        { rotation: SE3.identity().rotation, position: [4, 0, 0] }, r.scheduler.motionRevision, 'world').kind, 'accept')
    r.compositor.advance(1001)
    assert.ok(F.runIncarnation > run, 'the new question starts a fresh run')
    assert.equal(F.done, false, 'the restarted run is still drawing')
    assert.equal(r.segments(), 5, 'the restarted drawing is visible before it finishes')
})

test('a spent slice is crossed to the display cut: an instant lands whole, never a prefix', () => {
    // A zero-millisecond quantum is spent before the first tick, and breathEvery 4
    // parks the walk mid-instant. The display must still show the whole authored
    // instant, never a prefix: a prefix of a value is a broken figure, not a slow one.
    // (id:render-construction-cadence-wait-regression)
    const scheduler = buildWorld({ capacity: 512, breathEvery: 4, clock: () => 0 })
    const r = display(`draw r n do
 loop n do
  fw 4
 end
 wait 1
 r n
end
let F = r 40`, { scheduler, pacer: createPacer({ startMs: -1, minMs: -1, maxMs: -1 }) })
    r.compositor.advance(0)
    const F = r.host.children.get('F')
    assert.equal(r.segments(), 40, 'the first instant is whole')
    for (let t = 16; t <= 1008; t += 16) r.compositor.advance(t)
    assert.equal(r.segments(), 80, 'the second instant lands whole across a spent slice')
    assert.equal(F.done, false, 'and the figure is still drawing')
})
