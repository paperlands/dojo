// Declared-behaviour revision — independent boundary witnesses (creator-authorized).
//
// The invariant these assert is: an OBSOLETE own step must never be committed by the run
// it was computed under. `tick` may lawfully service a replacement and then let the NEW run
// step, so end-state pose alone cannot decide it — we read the accepted-commit sequence and
// its run identity.
//
// Ownership: 1209b3a1's independent witness set. No production/spec file is touched.
//
// Invariants: I1 ownership-scoped live observation; I2 immutable capture with `rx:`-governed
// freshness; I3 requested-vs-attached authority before an obsolete own step (incl. ancestors);
// I4 owner-resolved seats; I5 ungated ordinary execution; I7 refine-on-dirty.
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
    const g = n => host.children.get(n)
    const pos = f => f ? frameWorldTransform(f).position.map(n => +n.toFixed(3)) : null
    const hand = (frame, xyz) => s.requestMotion(frame, { rotation: frame.transform.deref().rotation, position: xyz }, s.motionRevision, 'world')
    return { s, host, g, pos, hand, tick, drain, warm, builds: () => s.readouts.stats().builds }
}
const builds = c => c.builds()
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Watch the accepted-commit sequence with the owner's run identity at each commit.
function watch(c, ownerName, watchName) {
    const seq = []
    c.s.onAcceptedChange(() => seq.push({ run: c.g(ownerName).runIncarnation, pos: c.pos(c.g(watchName)) }))
    return seq
}

// After the anchor commit, no later commit may carry the anchor's run with a different pose:
// that would be the obsolete own step of the run about to be replaced.
function assertNoOldRunMove(seq, anchorRun, anchorPos) {
    let seen = false
    for (const e of seq) {
        if (!seen) { if (e.run === anchorRun && eq(e.pos, anchorPos)) seen = true; continue }
        assert.ok(e.run !== anchorRun || eq(e.pos, anchorPos),
            `obsolete own step committed by run ${anchorRun}: ${JSON.stringify(e)}`)
    }
    assert.ok(seen, 'the hand/reference commit was not observed')
}

// --- scenes --------------------------------------------------------------------
const EXACT = `let fox
let rabbit
def hunt prey predator do
  as prey do
    loop 720 do
      fw 5
      rt 1
      wait 1/5
    end
  end
  as predator do
    loop 720 do
      faceto prey
      fw 3
      wait 1/5
    end
  end
end
let hunting = hunt rabbit fox`
const REVERSED = `let fox
let rabbit
def hunt prey predator do
  as predator do
    loop 720 do
      faceto prey
      fw 3
      wait 1/5
    end
  end
  as prey do
    loop 720 do
      fw 5
      rt 1
      wait 1/5
    end
  end
end
let hunting = hunt rabbit fox`
const READ_BEFORE_SEAT = `let target
def behave t do
  let v = t.x
  as t do
    loop 4 do
      fw v
      wait 1
    end
  end
end
let w = behave target`
const W1 = `let target
def behave t do
  let v = t.x + 3
  as t do
    loop 100000 do
      fw v
      wait 1
    end
  end
end
let w = behave target`
const W0 = `let target
def behave t do
  as t do
    loop 100000 do
      fw 0
      wait 1
    end
  end
end
let w = behave target`
const W3 = `let target
def behave t do
  let base = t.x
  as t do
    loop 100000 do
      fw (base - t.x)
      wait 1
    end
  end
end
let w = behave target`
const QUANT = `let X
let target
def walk distance target do
  as target do
    loop 100000 do
      fw distance
      wait 1
    end
  end
end
let w = walk (round(X.x, 10) + 2) target`
const SCALAR = `let X
let target
def walk distance target do
  as target do
    loop 100000 do
      fw distance
      wait 1
    end
  end
end
let w = walk (X.x + 3) target`
const UNNAMED = `let target
def walk t do
  as t do
    loop 100000 do
      fw 3
      wait 1
    end
  end
end
walk target`
const NESTB = `let A
let B
def behave outer inner do
  as outer do
    fw 1
    as inner do
      fw 1
    end
    wait 1
  end
end
let hunting = behave A B`
const PQ = `let A
let B
def walker x do
  as x do
    loop 100000 do
      fw 1
      wait 1
    end
  end
end
let p = walker A
let q = walker B`
const FENCE = `let X
let target
def walker t do
  as t do
    loop 100000 do
      fw 1
      wait 1
    end
  end
end
def outer distance target do
  let inner = walker target
  wait 100
end
let w = outer (X.x + 3) target`

// --- I1: ownership-scoped live observation -------------------------------------
test('I1 the exact two-installation hunt runs once: sibling receivers are live, not definition inputs', () => {
    const c = world(EXACT, 16.6667)
    c.warm(120)
    assert.equal(c.g('hunting').runIncarnation, 1, 'expected one run')
    assert.equal(builds(c), 0, 'no rebuilds')
    assert.equal(c.s.errors.length, 0)
})

test('I1 reversed sibling order behaves identically (falsifies live-only runaway)', () => {
    const c = world(REVERSED, 16.6667)
    c.warm(120)
    assert.equal(c.g('hunting').runIncarnation, 1)
    assert.equal(builds(c), 0)
    assert.equal(c.s.errors.length, 0)
})

// --- I2: immutable capture with expected-receiver freshness --------------------
test('I2 a read taken before the seat gets freshness from the rx entry, not raw pose (no runaway)', () => {
    const c = world(READ_BEFORE_SEAT, 100)
    c.warm(8)
    const before = c.g('w').runIncarnation
    c.hand(c.g('target'), [77, 0, 0])
    c.warm(32)
    assert.ok(c.g('w').runIncarnation <= before + 1, `expected at most one revision, got ${c.g('w').runIncarnation - before}`)
    assert.ok(Math.abs(c.pos(c.g('target'))[0]) < 1e6, `target ran away: ${c.pos(c.g('target'))}`)
    assert.equal(c.s.errors.length, 0)
})

// --- I3/I4: the obsolete own step must not be committed by the run it grew from -
for (const [name, src, handName] of [
    ['W1 receiver hand77 then own +3', W1, 'target'],
    ['W0 receiver hand77 then own no-op', W0, 'target'],
    ['W3 receiver hand77 then own return', W3, 'target'],
    ['QUANT cross-bucket input hand14', QUANT, 'X'],
    ['SCALAR constructor-arg input hand77', SCALAR, 'X'],
    ['FENCE ancestor input handX77', FENCE, 'X'],
]) {
    test(`I3 ${name}: the obsolete own step is never committed by the old run`, () => {
        const c = world(src, 1000)
        c.warm(3)
        const owner = c.g('w')
        const seq = watch(c, 'w', 'target')
        c.hand(c.g(handName), handName === 'X' ? [77, 0, 0] : [77, 0, 0])
        const anchorRun = owner.runIncarnation
        const anchorPos = c.pos(c.g('target'))
        c.tick()
        c.drain()
        c.tick(); c.drain()
        assertNoOldRunMove(seq, anchorRun, anchorPos)
        assert.equal(c.s.errors.length, 0, 'rejection travels the stale cut: no wound')
    })
}

// --- I7: refine-on-dirty (guard; must stay green) -------------------------------
test('I7 same-bucket quantization keeps the attached run and allows the own step', () => {
    const c = world(QUANT, 1000)
    c.warm(3)
    c.hand(c.g('X'), [3, 0, 0])
    c.tick()
    assert.deepEqual(c.pos(c.g('target')), [8, 0, 0])
    c.drain()
    assert.equal(c.g('w').runIncarnation, 1, 'identical question keeps the run')
    c.tick(); c.drain()
    assert.deepEqual(c.pos(c.g('target')), [10, 0, 0])
})

// --- I3 nested receiver fence: the contested commit must carry a NEW inner incarnation,
//     not the old inner writer. (An outer-run blanket misfires here: the outer question is
//     unchanged and legitimately keeps its run.) ---------------------------------------
test('I3 a hand on the nested receiver is never moved by the OLD inner run', () => {
    const c = world(FENCE, 1000)
    c.warm(3)
    const w = c.g('w')
    const innerOf = () => w.children.get('inner')?.runIncarnation
    const seq = []
    c.s.onAcceptedChange(() => seq.push({ innerRun: innerOf(), pos: c.pos(c.g('target')) }))
    c.hand(c.g('target'), [77, 0, 0])
    const anchor = { innerRun: innerOf(), pos: c.pos(c.g('target')) }
    c.tick(); c.drain()
    let seen = false
    for (const e of seq) {
        if (!seen) { if (e.innerRun === anchor.innerRun && eq(e.pos, anchor.pos)) seen = true; continue }
        assert.ok(e.innerRun !== anchor.innerRun || eq(e.pos, anchor.pos),
            `old inner run ${anchor.innerRun} moved the receiver: ${JSON.stringify(e)}`)
    }
    assert.ok(seen, 'the hand commit was not observed')
    assert.ok(innerOf() > anchor.innerRun, 'the nested realization revises on its receiver change')
    assert.equal(c.s.errors.length, 0)
})

// --- I3 ancestor fence, timing-independent: the nested own step must not commit
//     under the old inner run when the outer question changed ---------------------
test('I3 ancestor input change fences the nested own step under the old run', () => {
    const c = world(FENCE, 1000)
    c.warm(3)
    const w = c.g('w')
    const seq = []
    c.s.onAcceptedChange(() => seq.push({ wRun: w.runIncarnation, innerRun: w.children.get('inner')?.runIncarnation, pos: c.pos(c.g('target')) }))
    c.hand(c.g('X'), [77, 0, 0])
    const anchor = { wRun: w.runIncarnation, innerRun: w.children.get('inner')?.runIncarnation, pos: c.pos(c.g('target')) }
    c.tick(); c.drain()
    let seen = false
    for (const e of seq) {
        if (!seen) { if (e.wRun === anchor.wRun && e.innerRun === anchor.innerRun && eq(e.pos, anchor.pos)) seen = true; continue }
        assert.ok(!(e.wRun === anchor.wRun && e.innerRun === anchor.innerRun && !eq(e.pos, anchor.pos)),
            `nested own step committed under the old inner run: ${JSON.stringify(e)}`)
    }
    assert.equal(c.s.errors.length, 0)
})

// --- I4: owner-resolved seats (guard) ------------------------------------------
test('I4 a hand on a nested seat receiver revises the declaration', () => {
    const c = world(NESTB, 100)
    c.warm(4)
    c.hand(c.g('B'), [77, 0, 0])
    c.warm(3)
    assert.equal(c.g('hunting').runIncarnation, 2)
    assert.deepEqual(c.pos(c.g('B')), [78, 0, 0])
    assert.equal(c.s.errors.length, 0)
})

test('I4 a hand on one question receiver revises only that question', () => {
    const c = world(PQ, 1000)
    c.warm(3)
    c.hand(c.g('A'), [77, 0, 0])
    c.warm(5)
    assert.equal(c.g('p').runIncarnation, 2, 'P revises on its receiver change')
    assert.deepEqual(c.pos(c.g('B')), [8, 0, 0], 'Q continues undisturbed')
    assert.equal(c.s.errors.length, 0)
})

// --- I5: ordinary execution is ungated (guard) ---------------------------------
test('I5 a seat with no governing question is never fenced', () => {
    const c = world(UNNAMED, 1000)
    c.warm(3)
    const t = c.g('target')
    c.hand(t, [77, 0, 0])
    c.warm(5)
    assert.deepEqual(c.pos(t), [86, 0, 0], 'the unnamed call advanced past the hand pose')
    assert.equal(c.s.errors.length, 0)
})

// --- I1/I3 sibling hand under the exact hunt: old run must not move the receiver
for (const handName of ['fox', 'rabbit']) {
    test(`I3 hand on ${handName} is not moved by the old run before replacement`, () => {
        const c = world(EXACT, 16.6667)
        c.warm(11)
        const seq = watch(c, 'hunting', handName)
        c.hand(c.g(handName), [77, 0, 0])
        const anchorRun = c.g('hunting').runIncarnation
        const anchorPos = c.pos(c.g(handName))
        c.tick(); c.drain()
        assertNoOldRunMove(seq, anchorRun, anchorPos)
        assert.ok(c.g('hunting').runIncarnation >= anchorRun + 1, 'external receiver change revises')
        assert.equal(c.s.errors.length, 0)
    })
}
