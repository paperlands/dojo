// Retention / phase-close boundaries — independent witnesses (1209b3a1).
//
// These are NOT part of the I1-I7 centre; they witness two separately-amended boundaries
// that now hold under the Wave2 amendments (consumed footprint stores no observer reference;
// a defer-close subscribes/cancels without rewiring inside the publication fan).
//
// No production/spec file is touched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScheduler, metaRoot, frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { parseProgram } from '../../../assets/js/turtling/parse.js'
import { Parser } from '../../../assets/js/turtling/mafs/parse.js'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'

function world(src, tickMs = 1000) {
    const s = createScheduler(metaRoot(), {
        createDeps: () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() }),
        execOpts: { color: '#e77808' },
        onShout: () => {},
    })
    s.hotSwapChild('buf', { name: 'main', code: { ast: parseProgram(src), functions: null }, style: { color: '#e77808' }, env: null })
    const host = s.root.children.get('buf')
    let now = 0
    const drain = () => { s.readouts.drain(); for (const f of s.registry.values()) f.channel.drain(); s.readouts.drain() }
    const tick = () => { now += tickMs; s.tick(now) }
    const warm = n => { for (let i = 0; i < n; i++) { tick(); drain() } }
    return { s, host, drain, tick, warm, g: n => host.children.get(n) }
}

// A grounded orientation read on an external headed being pins its observer in the
// question owner's `consumed`. The desired contract: retired observers are not retained
// without bound (registry stays flat either way).
const GROUNDED = `as prey do
  loop 100 do
    fw 1
    wait 1
  end
end
let fox
def act prey target do
  loop 200 do
    as target do
      label prey.heading
      fw 1
      wait 1
    end
  end
end
let job = act prey fox`

test('grounded-orientation consumed footprint stays bounded across same-site replacements',
    () => {
        const c = world(GROUNDED, 1000)
        c.warm(3)
        for (let i = 0; i < 300 && !c.s.done; i++) c.warm(1)
        const consumed = c.g('job')?.consumed
        const size = consumed?.size ?? 0
        assert.ok(size <= 8, `consumed grew to ${size}; retired observers are pinned unboundedly`)
        assert.equal(c.s.registry.size < 20, true, 'registry stays flat')
    })

// `scheduler.defer(input)`'s disposer runs `onRelease` (readout recompute + drain)
// unconditionally. The seam wants builds outside publication, so a disposer invoked from
// an accepted-change listener must not rewire inside the notification fan.
const HUNT = `def hunt prey predator do
  as predator do
    loop 3 do
      faceto prey
      fw 3
      wait 1/24
    end
  end
end
let fox
let rabbit
let hunting = hunt rabbit fox`

test('a defer-close invoked inside the accepted-change fan does not rewire inside publication',
    () => {
        const c = world(HUNT, 41.6667)
        c.warm(2)
        const close = c.s.defer(c.g('fox'))
        const runs = []
        c.s.onAcceptedChange(() => {
            const before = c.g('hunting').runIncarnation
            const notifying = c.s.root.notifyingCommit === true
            if (close()) runs.push({ notifying, before, after: c.g('hunting').runIncarnation })
        })
        c.s.requestMotion(c.g('fox'), { ...frameWorldTransform(c.g('fox')), position: [10, 0, 0] }, c.s.motionRevision, 'world')
        assert.ok(runs.length === 1, 'listener ran inside the fan')
        assert.equal(runs[0].notifying, true, 'precondition: the listener is inside publication')
        assert.equal(runs[0].after, runs[0].before, 'close rewired the writer inside the publication fan')
        assert.equal(c.s.errors.length, 0)
    })
