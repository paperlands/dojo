// probe-status: active
// See FRESH-REENTRY.org.
import assert from 'node:assert/strict'
import { Group, Vector3 } from '../../assets/js/utils/three-entry.js'
import { createCompositor } from '../../assets/js/turtling/compositor.js'
import { createFocus } from '../../assets/js/turtling/focus.js'
import { createMaterialCache } from '../../assets/js/turtling/render/line/material-cache.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

const replacement = 'wait 0.05\nlet arrived = 1\nwait 0.1'
function build(reenter, singleTick = false) {
  const scheduler = buildWorld({ capacity: 512, clock: () => 0,
    admit: ({ requested }) => ({ accepted: true, transform: requested }) })
  scheduler.hotSwapChild('host', fork('host', 'let B\nlet A = (B.x, 0)\nwait 1\nfw 1'), { fresh: true, deferStart: true })
  const c = createCompositor(scheduler, {
    scene: new Group(), camera: { position: new Vector3(0, 0, 1000) },
    materials: createMaterialCache(), requestRender() {}, viewOffset: () => SE3.identity(),
  }, { focus: createFocus(scheduler), createText() { throw Error('fixture has no labels') } })
  c.advance(0)
  c.advance(80)
  const B = scheduler.root.children.get('host').children.get('B')
  assert.equal(scheduler.requestMotion(B, { ...SE3.identity(), position: [7, 0, 0] }, scheduler.motionRevision).kind, 'accept')
  let didReplace = false
  const actions = []
  function replace() {
    didReplace = true
    actions.push(['old-at-replace', scheduler.lastTickTime])
    c.beginPlay()
    scheduler.hotSwapChild('host', fork('host', replacement), { fresh: true })
    c.flush()
    actions.push(['after-fresh', scheduler.lastTickTime, scheduler.readScalar('arrived')])
  }
  const off = scheduler.onAcceptedChange(() => { if (reenter && !didReplace) replace() })
  if (singleTick) scheduler.tick(80)
  else c.advance(96)
  off()
  if (!reenter) replace()
  assert.equal(didReplace, true)
  actions.push(['after-outer', scheduler.lastTickTime, scheduler.readScalar('arrived')])
  c.advance(112)
  actions.push(['after-next-frame', scheduler.lastTickTime, scheduler.readScalar('arrived')])
  c.dispose()
  return actions
}
const result = { sequential: build(false), reentrant: build(true), singleTick: build(true, true) }
console.log(JSON.stringify(result, null, 2))
const after = mode => result[mode].find(([step]) => step === 'after-outer')
assert.deepEqual(after('sequential').slice(1), [0, { kind: 'missing' }])
assert.equal(after('reentrant')[2].kind, 'value')
assert.deepEqual(after('singleTick').slice(1), [0, { kind: 'value', value: 1 }])