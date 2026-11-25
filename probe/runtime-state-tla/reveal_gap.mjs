// probe-status: concluded
// Inject re-entry specifically between wall measurement and allowance spend.
// This is not evidence that an ordinary browser callback reaches that seam.
import assert from 'node:assert/strict'
import { createCompositor } from '../../assets/js/turtling/compositor.js'
import { createFocus } from '../../assets/js/turtling/focus.js'
import { createMaterialCache } from '../../assets/js/turtling/render/line/material-cache.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { Group, Vector3 } from '../../assets/js/utils/three-entry.js'
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

function run(interleave) {
    const scheduler = buildWorld({ clock: () => 0 })
    const seat = source => scheduler.hotSwapChild('host', fork('host', source), { fresh: true })
    const compositor = createCompositor(scheduler, {
        scene: new Group(), camera: { position: new Vector3(0, 0, 1000) },
        materials: createMaterialCache(), requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText() { throw Error('fixture only draws lines') } })
    try {
        seat('fw 1\nwait 1\nfw 1')
        compositor.advance(0)
        compositor.advance(40)
        assert.equal(scheduler.lastTickTime, 40)
        const drain = scheduler.readouts.drain
        scheduler.readouts.drain = (...args) => {
            scheduler.readouts.drain = drain
            if (interleave === 'hold-bounce') {
                assert.ok(compositor.setHeld(true))
                assert.ok(compositor.setHeld(false))
            } else if (interleave === 'fresh-play') {
                compositor.beginPlay()
                seat('wait 1\nfw 3')
                compositor.flush()
                assert.equal(scheduler.lastTickTime, 0)
            }
            return drain(...args)
        }
        compositor.advance(60)
        return scheduler.lastTickTime
    } finally { compositor.dispose() }
}

for (const [caseName, expected] of [['ordinary', 60], ['hold-bounce', 40], ['fresh-play', 0]]) {
    const observed = run(caseName)
    const staleSpend = observed !== expected
    console.log(caseName, { expected, observed, staleSpend })
    // The reset edges must revoke the sample measured before them.
    assert.equal(observed, expected, `${caseName}: the in-flight sample lost its authority`)
}
