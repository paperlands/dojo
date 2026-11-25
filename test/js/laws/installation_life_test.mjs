// Lifecycle fences for installation ownership — a PRODUCTION contract, not an opt-in. An
// installation is addressed by its DECLARING source and statement site (never the receiver's
// spelling), owns its continuation and run, and the receiver keeps its own identity and
// constitution. (id:being-facets-p4-sequence)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, nz, at } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { isBeing } from '../../../assets/js/turtling/frame.js'

const position = (frame) => nz(frameWorldTransform(frame).position)
const installationsOf = (scheduler, frame) => scheduler.installationsOf?.(frame) ?? []

const attach = (wait, ack) => `def attach receiver do
  as receiver do
    wait ${wait}
    shout "ack" ${ack}
  end
end
attach A`

test("source withdrawal revokes the installation's future acknowledgment", () => {
    const shouts = []
    const scheduler = buildWorld({ onShout: (_f, _n, payload) => shouts.push(payload) })
    const host = scheduler.hotSwapChild('host', fork('host', `let A
let A.z = 0`))
    const src = scheduler.hotSwapChild('src', fork('src', attach(5, 1)))
    for (let i = 0; i < 3; i++) scheduler.tick(i * 1000)

    // Admission is the PREMISE and it is the INSTALLATION's state: a blanket refusal
    // cannot make the falsifier vacuous. (id:being-facets-p4-sequence)
    const [install] = installationsOf(scheduler, src)
    assert.ok(install, 'the installation is seated in its declaring slot')
    assert.ok(install.frame.runIncarnation >= 1, 'the installation was admitted')
    assert.ok(install.frame.done === false && install.frame.resumeAt > 2000, 'it reached its wait')
    assert.deepEqual(shouts, [], 'no acknowledgment before the wait resumes')

    scheduler.removeChild('src')
    for (let i = 3; i < 40; i++) scheduler.tick(i * 1000)
    const A = host.children.get('A')
    assert.deepEqual(shouts, [], 'the withdrawn installation produces no acknowledgment')
    assert.equal(scheduler.registry.get(A.id), A, 'the receiver survives its installer')
    assert.ok(scheduler.laws.active().some((law) => law.endpoints.includes(A.id)),
        'the receiver keeps its independent law')
})

// SUCCESSFUL ADMISSION under installation ownership, preserving a SOURCED receiver: its run,
// run episode, subtree and own-scope laws survive. A running receiver is refused at the
// PUBLICATION GATE, not by a blanket source-ownership refusal. (id:being-facets-p4-sequence)
test('a foreign installation is admitted while preserving a sourced receiver', () => {
    const scheduler = buildWorld({ admit })
    const A = scheduler.hotSwapChild('A', fork('A', `let C
let C.x = 1
wait 10`))
    for (let i = 0; i < 4; i++) scheduler.tick(i * 1000)
    assert.ok(A && !A.done, 'the receiver is sourced and running')
    const before = {
        run: A.run,
        incarnation: A.runIncarnation,
        children: [...A.children.keys()],
        laws: scheduler.laws.active().filter((law) => law.scope === A.id).length,
        pose: position(A),
    }
    const src = scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    goto 5 0
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.tick(1000)
    assert.equal(installationsOf(scheduler, src).length, 1, 'the installation is ADMITTED')
    assert.equal(A.run, before.run, 'the receiver keeps its run')
    assert.equal(A.runIncarnation, before.incarnation, 'the receiver keeps its own run episode')
    assert.deepEqual([...A.children.keys()], before.children, 'the receiver keeps its subtree')
    assert.equal(scheduler.laws.active().filter((law) => law.scope === A.id).length, before.laws,
        'the receiver keeps its own-scope law')
    assert.deepEqual(position(A), before.pose, 'a RUNNING receiver is refused at the publication gate')
})

test('two installations on one receiver own independent continuations', () => {
    const shouts = []
    const scheduler = buildWorld({ onShout: (_f, _n, payload) => shouts.push(payload) })
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    const src1 = scheduler.hotSwapChild('src1', fork('src1', attach(2, 1)))
    const src2 = scheduler.hotSwapChild('src2', fork('src2', attach(4, 2)))
    scheduler.tick(0)
    scheduler.tick(1000)

    const [h1] = installationsOf(scheduler, src1)
    const [h2] = installationsOf(scheduler, src2)
    assert.ok(h1 && h2, 'each declaring source seats its installation')
    assert.notEqual(h1.frame.id, h2.frame.id, 'the handles are distinct')
    assert.ok(!h1.frame.done && h1.frame.resumeAt > 1000, 'the first reached its wait')
    assert.ok(!h2.frame.done && h2.frame.resumeAt > 1000, 'the second reached its wait')
    assert.deepEqual(shouts, [], 'no acknowledgment before either wait resumes')

    // Selective retirement of ONE installation; the other's lifetime is untouched.
    assert.equal(scheduler.retireInstallation(src1, h1.site), true, 'the current occupant is retired')
    for (let i = 2; i < 12; i++) scheduler.tick(i * 1000)
    // Cancellation vs completion: the witness is the acknowledgment, not `done`.
    assert.deepEqual(shouts, [2], "only the survivor's acknowledgment arrives")
    const A = host.children.get('A')
    assert.equal(scheduler.registry.get(A.id), A, 'the receiver survives both')
    assert.equal(scheduler.errors.length, 0)
})

test('an installation cannot become a geometric participant by name', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    const src = scheduler.hotSwapChild('src', fork('src', attach(5, 1)))
    scheduler.tick(0)
    const [install] = installationsOf(scheduler, src)
    assert.ok(install, 'the installation exists')
    // The seat is not a child, so findFrame, tree traversal and subtree cleanup cannot
    // reach it: name lookup, facets and law/receiver selection have no path to it.
    assert.equal(src.children.size, 0, 'the seat is not a discoverable child')
    assert.equal(install.frame.installation, true, 'the seat declares itself an installation')
    assert.equal(install.frame.parent, src, 'it keeps the declaring source as its environment')
    assert.equal(host.children.has('receiver'), false, 'the receiver gains no child')
})
// Revisiting ONE site replaces its occupant (the recipe's `as` line is the same site for
// both calls in the declaring frame). Fresh record identity, not frame identity, is what
// the seat holds. (id:being-facets-p4-sequence)
test('revisiting one statement site replaces its occupant, not the receiver', () => {
    const shouts = []
    const scheduler = buildWorld({ onShout: (_f, _n, payload) => shouts.push(payload) })
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    const src = scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    wait 2
    shout "ack" 1
  end
end
attach A
attach A`))
    for (let i = 0; i < 8; i++) scheduler.tick(i * 1000)
    assert.equal(installationsOf(scheduler, src).length, 1, 'one site holds one current occupant')
    assert.deepEqual(shouts, [1], 'only the current occupant acknowledges')
    const A = host.children.get('A')
    assert.equal(scheduler.registry.get(A.id), A, 'the receiver is untouched by the replacement')
})

// ── Carrier obligations, repaired ─────────────────────────────────────────────

// A source EDIT is a source withdrawal: hotSwapChild must retire the installations the
// replaced source seated, not only removeChild. (id:being-facets-p4-sequence)
test('editing a source retires the installations it seated', () => {
    const scheduler = buildWorld()
    scheduler.hotSwapChild('host', fork('host', `let A`))
    const spec = () => fork('src', attach(5, 1))
    const src = scheduler.hotSwapChild('src', spec())
    scheduler.tick(0)
    const [install] = installationsOf(scheduler, src)
    assert.ok(install, 'the installation is seated')
    scheduler.hotSwapChild('src', spec())
    scheduler.tick(1000)
    assert.equal(scheduler.registry.get(install.frame.id), undefined, 'the old installation is retired')
})

// Absence from children earns name invisibility, NOT nonparticipation. The execution owner
// is refused at every admission door: being-shape, receiver selection and facets.
// (id:being-facets-p4-sequence)
test('a carried installation handle is refused at the admission doors', () => {
    const scheduler = buildWorld()
    scheduler.hotSwapChild('host', fork('host', `let A
let B`))
    const src = scheduler.hotSwapChild('src', fork('src', attach(5, 1)))
    scheduler.tick(0)
    const [install] = installationsOf(scheduler, src)
    assert.ok(install, 'the installation is seated')
    assert.equal(isBeing(install.frame), false, 'the execution owner is not a geometric being')

    const carried = (name, body) => {
        const spec = fork(name, body)
        spec.env.scope.subject = install.frame
        scheduler.hotSwapChild(name, spec)
        scheduler.tick(1000)
    }
    // Receiver door: passing the handle as a bound argument never attaches to it.
    carried('recv', `def attach receiver do
  as receiver do
    goto 5 0
  end
end
attach subject`)
    assert.equal(scheduler.laws.active().some((law) => law.endpoints.includes(install.frame.id)), false,
        'the carried handle is never admitted as a receiver')

    // Facet door: a dotted read of the handle has no answer.
    const before = scheduler.errors.length
    carried('facet', `def read subject do
  let out
  let out.position = (subject.x, 0, 0)
end
read subject`)
    assert.ok(scheduler.errors.length > before, 'a facet read of the handle is refused')
})

// Owner command vs handle command: an OLD handle must not retire its replacement.
// (id:being-facets-p4-sequence)
test('a stale installation handle cannot retire its replacement', () => {
    const scheduler = buildWorld()
    scheduler.hotSwapChild('host', fork('host', `let A`))
    const src = scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    wait 10
    shout "ack" 1
  end
end
attach A
wait 1
attach A`))
    scheduler.tick(0)
    const [h1] = installationsOf(scheduler, src)
    assert.ok(h1, 'the first occupant is seated')
    scheduler.tick(1000)                       // src resumes; the second attach replaces h1
    const [h2] = installationsOf(scheduler, src)
    assert.notEqual(h2, h1, 'the site now holds a fresh occupant')
    assert.equal(scheduler.retireOccupant(h1), false, 'the stale handle is refused')
    assert.equal(scheduler.registry.get(h2.frame.id), h2.frame, 'the replacement survives')
    assert.equal(scheduler.retireOccupant(h2), true, 'the current handle is retired')
})

// A closed declaring region is preserved, never silently opened. (id:being-facets-p4-sequence)
test('a closed declaring region refuses an outside installation', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A
def shape do
  as A do
    wait 1
  end
end
def use A do
  let fig = shape
end
use A`))
    scheduler.tick(0)
    const fig = host.children.get('fig')
    assert.ok(fig?.closed, 'the declaring figure is closed')
    // Restriction preserved, never silently opened: the outside receiver is refused
    // BEFORE a seat exists. (id:being-facets-p4-sequence)
    assert.equal(installationsOf(scheduler, fig).length, 0, 'no installation is admitted')
    assert.ok(scheduler.errors.some((e) => /closed region/.test(e.message)),
        'the closure boundary is preserved')
})

// Mixed ownership nesting: an installation owns an ordinary ambient child, and THAT child
// owns a nested installation. Teardown must follow both ownership edges recursively or the
// nested continuation is stranded. (id:being-facets-p4-sequence)
test('withdrawal retires installations nested under an owned ambient', () => {
    const scheduler = buildWorld()
    scheduler.hotSwapChild('host', fork('host', `let A`))
    const src = scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    as inner do
      as receiver do
        wait 10
      end
    end
  end
end
attach A`))
    scheduler.tick(0)
    const [outer] = installationsOf(scheduler, src)
    assert.ok(outer, 'the outer installation is seated')
    const ordinary = outer.frame.children.get('inner')
    assert.ok(ordinary, 'the outer installation owns an ordinary ambient child')
    const [inner] = installationsOf(scheduler, ordinary)
    assert.ok(inner, 'a nested installation is seated under that ordinary child')

    scheduler.removeChild('src')
    scheduler.tick(1000)
    assert.equal(scheduler.registry.get(outer.frame.id), undefined, 'the outer continuation is retired')
    assert.equal(scheduler.registry.get(inner.frame.id), undefined, 'the nested continuation is retired')
})

// ── Bounded receiver-motion route. The installation stays the writer/continuation; the
// retained receiver is the geometric destination; A's ORIGINAL laws judge; publication
// rechecks occupant and source life. (id:being-facets-p4-sequence)

const admit = ({ requested }) => ({ accepted: true, transform: requested })

test('authored movement reaches the retained receiver with both constitutions intact', () => {
    const scheduler = buildWorld({ admit })
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    const src = scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    goto 5 0
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = host.children.get('A')
    assert.deepEqual(position(A), [5, 0, 0], 'the authored movement reached the original receiver')
    assert.equal(scheduler.registry.get(A.id), A, 'the receiver keeps its identity')
    assert.equal(A.children.size, 0, 'the receiver gains no installation child')
    const [install] = installationsOf(scheduler, src)
    assert.ok(install, 'the installation owns the continuation')
    assert.equal(scheduler.errors.length, 0)
})

test("a prohibited movement is refused by the receiver's original law", () => {
    const scheduler = buildWorld({ admit })
    const host = scheduler.hotSwapChild('host', fork('host', `let A
let A.x = 2`))
    scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    goto 9 0
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = host.children.get('A')
    assert.deepEqual(position(A), [2, 0, 0], "A's original x law holds the receiver")
    assert.ok(scheduler.laws.active().some((law) => law.endpoints.includes(A.id)),
        "the judge is A's own law, not an installation-local substitute")
})

test('withdrawal between preparation and delayed acceptance prevents stale publication', async () => {
    let settle = null
    const admitAsync = () => new Promise((resolve) => { settle = resolve })
    const scheduler = buildWorld({ admitAsync })
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    const src = scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    goto 5 0
  end
end
attach A`))
    scheduler.tick(0)
    const [install] = installationsOf(scheduler, src)
    assert.ok(install, 'the installation is prepared')

    scheduler.removeChild('src')          // withdrawal before the delayed reply
    await Promise.resolve()
    settle?.({ accepted: true, transform: at(5) })
    await Promise.resolve()
    await Promise.resolve()
    scheduler.tick(1000)
    assert.deepEqual(position(host.children.get('A')), [0, 0, 0],
        'a withdrawn installation cannot publish its stale motion')
})

test("a second venture starts from the receiver's accepted pose", () => {
    const scheduler = buildWorld({ admit })
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    scheduler.hotSwapChild('src1', fork('src1', `def attach receiver do
  as receiver do
    wait 2
    fw 1
  end
end
attach A`))
    for (let i = 0; i < 4; i++) scheduler.tick(i * 1000)
    assert.deepEqual(position(host.children.get('A')), [1, 0, 0], 'the first venture completes')

    // Admitted only AFTER the first completes, from A's accepted pose: no simultaneous
    // cursors, no rebasing/occupancy rule. (id:being-facets-p4-sequence)
    scheduler.hotSwapChild('src2', fork('src2', `def attach receiver do
  as receiver do
    fw 1
  end
end
attach A`))
    for (let i = 4; i < 8; i++) scheduler.tick(i * 1000)
    assert.deepEqual(position(host.children.get('A')), [2, 0, 0],
        "the second venture continues from the receiver's accepted pose")
    assert.equal(scheduler.errors.length, 0)
})

// ── Publication-boundary counterexamples. A projection must not bypass or outlive the
// writer's publication authority. (id:being-facets-p4-sequence)

test('a single-destination motion respects the receiver settledness gate', () => {
    const scheduler = buildWorld({ admit })
    const host = scheduler.hotSwapChild('host', fork('host', `def shape do
  wait 10
end
let A = shape`))
    const A = host.children.get('A')
    assert.ok(A && !A.done, 'the receiver is an unfinished program')

    scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    goto 5 0
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.tick(1000)
    assert.deepEqual(position(A), [0, 0, 0], 'a running receiver is not moved by a foreign installation')
    assert.equal(scheduler.root._motionRevision ?? 0, 0, 'no publication lands on a running member')
})

test('a retired installation cannot publish a component proposal', () => {
    let scheduler
    let B
    const admitMid = ({ requested }) => {
        scheduler.removeChild('src')            // retire the writer inside admission
        return { accepted: true, transform: requested, component: [{ frame: B, transform: at(7) }] }
    }
    scheduler = buildWorld({ admit: admitMid })
    const host = scheduler.hotSwapChild('host', fork('host', `let A
let B`))
    B = host.children.get('B')
    scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    goto 5 0
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.tick(1000)
    assert.deepEqual(position(host.children.get('A')), [0, 0, 0], 'a retired writer cannot move the receiver')
    assert.deepEqual(position(B), [0, 0, 0], 'a retired writer cannot move a component')
})

test('a lost receiver ends the venture instead of becoming self-motion', () => {
    const scheduler = buildWorld({ admit })
    scheduler.hotSwapChild('host', fork('host', ``))
    const A = scheduler.hotSwapChild('A', fork('A', ``))
    const src = scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    wait 2
    goto 5 0
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.removeChild('A')                  // the retained receiver leaves the world
    for (let i = 1; i < 8; i++) scheduler.tick(i * 1000)
    const [install] = installationsOf(scheduler, src)
    const moved = install ? position(install.frame) : [0, 0, 0]
    assert.deepEqual(moved, [0, 0, 0], 'the venture ends; it does not silently self-move')
})

// ── Carrier completeness: every producer must cross the attempt, and no projection may
// create a second proposal. (id:being-facets-p4-sequence)

test('installation motion enters the attempt without a laboratory responder', () => {
    const scheduler = buildWorld()   // no responder, no laws
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    goto 5 0
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = host.children.get('A')
    assert.deepEqual(position(A), [5, 0, 0], 'the receiver position is published, not merely displayed')
    assert.equal(scheduler.errors.length, 0)
})

test("an installation's wait does not republish its cursor over the receiver", async () => {
    // DELAYED admission forces the accepted-but-not-resumed interval: the retained verdict
    // is established, a new law intervenes, and only THEN does the continuation resume into
    // the wait. A synchronous fence could already be waiting and miss the bug. (id:...)
    let settle = null
    const admitAsync = () => new Promise((resolve) => { settle = resolve })
    const scheduler = buildWorld({ admitAsync })
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    goto 5 0
    wait 2
  end
end
attach A`))
    const A = host.children.get('A')

    // 1. pending admission: nothing applied yet
    scheduler.tick(0)
    assert.deepEqual(position(A), [0, 0, 0], 'the motion is pending, not applied')

    // 2. resolve acceptance and establish the retained admission verdict
    settle?.({ accepted: true, transform: at(5) })
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(position(A), [5, 0, 0], 'the accepted motion is published')

    // 3. install the new law BEFORE ticking again
    scheduler.hotSwapChild('law', fork('law', `let A.x = 9`))
    assert.deepEqual(position(A), [9, 0, 0], 'the new law owns the receiver')

    // 4. resume; the wait must leave the accepted configuration untouched
    for (let i = 1; i < 10; i++) scheduler.tick(i * 1000)
    assert.deepEqual(position(A), [9, 0, 0], 'the wait does not republish the stale cursor')
    assert.equal(scheduler.errors.length, 0)
})

test('a lost receiver does not crash non-motion output delivery', () => {
    const scheduler = buildWorld({ admit })
    scheduler.hotSwapChild('host', fork('host', ``))
    scheduler.hotSwapChild('A', fork('A', ``))
    scheduler.hotSwapChild('src', fork('src', `def attach receiver do
  as receiver do
    wait 2
    shout "ack" 1
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.removeChild('A')
    for (let i = 1; i < 8; i++) scheduler.tick(i * 1000)
    assert.equal(scheduler.errors.length, 0, 'receiver loss ends the venture instead of crashing delivery')
})

// --- Wait-joint cursor contract: the continuation REFRESHES from the receiver on resumption.
// A wait retains the continuation and held cursor; on resumption it copies the receiver's
// accepted local pose (position AND orientation) before its next command — a copy, not a
// publication. Shared participation: one geometric reality. Future movement still crosses the
// original-law and current-rights gates. (id:being-facets-p4-sequence)

const motionSrc = (body) => `def attach receiver do
  as receiver do
    ${body}
  end
end
attach A`

test('a wait joint refreshes the cursor from an externally moved receiver', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    drive(scheduler, { maxTicks: 10 })
    scheduler.hotSwapChild('src', fork('src', motionSrc('goto 20 0\n    wait 4\n    fw 5')))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = host.children.get('A')
    assert.deepEqual(position(A), [20, 0, 0], 'the accepted motion lands before the wait')
    scheduler.hotSwapChild('mover', fork('mover', motionSrc('goto 100 0')))
    scheduler.tick(2000)
    assert.deepEqual(position(A), [100, 0, 0], 'the external venture moves the receiver')
    for (let i = 3; i < 12; i++) scheduler.tick(i * 1000)
    assert.deepEqual(position(A), [105, 0, 0], 'fw follows the REFRESHED cursor, not the held one')
    assert.equal(scheduler.errors.length, 0)
})

test('a wait joint refreshes the cursor orientation', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    drive(scheduler, { maxTicks: 10 })
    scheduler.hotSwapChild('src', fork('src', motionSrc('goto 20 0\n    wait 4\n    fw 5')))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = host.children.get('A')
    scheduler.hotSwapChild('mover', fork('mover', motionSrc('yaw 90')))
    scheduler.tick(2000)
    for (let i = 3; i < 12; i++) scheduler.tick(i * 1000)
    const rounded = position(A).map((n) => Math.round(n))
    assert.deepEqual(rounded, [20, 5, 0], 'the relative step follows the refreshed orientation')
    assert.equal(scheduler.errors.length, 0)
})

test('the refreshed cursor stays receiver-LOCAL under a translated parent', () => {
    const scheduler = buildWorld()
    const parent = scheduler.hotSwapChild('P', fork('P', `goto 10 0
let A`))
    drive(scheduler, { maxTicks: 10 })
    scheduler.hotSwapChild('src', fork('src', motionSrc('goto 20 0\n    wait 4\n    fw 5')))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = parent.children.get('A')
    for (let i = 2; i < 12; i++) scheduler.tick(i * 1000)
    assert.deepEqual(position(A), [25, 0, 0], 'goto 20 is world-valued; the relative step advances five')
    assert.deepEqual(A.transform.deref().position, [15, 0, 0], 'the refreshed private cursor remains receiver-local')
    assert.equal(scheduler.errors.length, 0)
})

test('the refresh copies pose without importing receiver bindings', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    drive(scheduler, { maxTicks: 10 })
    const src = scheduler.hotSwapChild('src', fork('src', `let n = 3
def attach receiver do
  as receiver do
    goto 20 0
    wait 4
    fw n
  end
end
attach A`))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = host.children.get('A')
    const [install] = installationsOf(scheduler, src)
    assert.ok(install, 'the installation is seated')
    assert.deepEqual(install.frame.batch.transform.position, [20, 0, 0],
        'the held cursor stays at 20 while waiting')
    scheduler.hotSwapChild('mover', fork('mover', motionSrc('goto 100 0')))
    scheduler.tick(2000)
    assert.deepEqual(position(A), [100, 0, 0], 'the external venture moves the receiver')
    for (let i = 3; i < 12; i++) scheduler.tick(i * 1000)
    assert.deepEqual(position(A), [103, 0, 0], 'the captured binding survives the refresh: fw n == fw 3')
})

test('withdrawal at the wait joint prevents further effects', () => {
    const scheduler = buildWorld()
    const A = scheduler.hotSwapChild('A', fork('A', `let C`))
    drive(scheduler, { maxTicks: 10 })
    scheduler.hotSwapChild('src', fork('src', motionSrc('goto 20 0\n    wait 4\n    fw 5')))
    scheduler.tick(0)
    scheduler.tick(1000)
    assert.deepEqual(position(A), [20, 0, 0], 'the accepted motion lands before the wait')
    scheduler.removeChild('A')
    for (let i = 2; i < 12; i++) scheduler.tick(i * 1000)
    assert.equal(scheduler.registry.get(A.id), undefined, 'the receiver is withdrawn')
    assert.equal(scheduler.errors.length, 0, 'no further effect and no crash at the joint')
})

// The accepted verdict is handed to the continuation, not shared with it. Publishing stored
// the pose in the receiver's atom; adopting that same object would alias the continuation to
// the world. Identity separation AND mutation isolation. (id:being-facets-p4-sequence)
test('the accepted verdict is an independently owned cursor value', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    drive(scheduler, { maxTicks: 10 })
    const src = scheduler.hotSwapChild('src', fork('src', motionSrc('goto 20 0\n    wait 4\n    fw 5')))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = host.children.get('A')
    const [install] = installationsOf(scheduler, src)
    const cursor = install.frame.batch.transform
    const receiver = A.transform.deref()
    assert.deepEqual(position(A), [20, 0, 0])
    assert.notEqual(cursor, receiver, 'the continuation cursor is not the receiver pose object')
    assert.notEqual(cursor.position, receiver.position, 'the position array is not shared')
    assert.notEqual(cursor.rotation, receiver.rotation, 'the rotation is not shared')
    const revision = scheduler.motionRevision
    cursor.position[0] = 77
    assert.deepEqual(position(A), [20, 0, 0], 'mutating the parked cursor does not move the receiver')
    assert.equal(scheduler.motionRevision, revision, 'the mutation does not increment the publication revision')
})

// An external STATEMENT on the receiver itself — the real placement door. A translation of
// birth placement plus receiver-local motion compose exactly ONCE. (id:being-facets-p4-sequence)
test('an external statement composes once with receiver-local motion', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let A`))
    drive(scheduler, { maxTicks: 10 })
    scheduler.hotSwapChild('src', fork('src', motionSrc('goto 20 0\n    wait 4\n    fw 5')))
    scheduler.tick(0)
    scheduler.tick(1000)
    const A = host.children.get('A')
    assert.deepEqual(position(A), [20, 0, 0], 'local 20, world 20 before the statement')
    scheduler.requestMotion(A, at(100), scheduler.motionRevision, 'world')
    assert.equal(A.origin.position[0], 80, 'the statement translates the BIRTH placement to 80')
    assert.deepEqual(position(A), [100, 0, 0], 'world = birth 80 + local 20')
    for (let i = 2; i < 12; i++) scheduler.tick(i * 1000)
    assert.deepEqual(position(A), [105, 0, 0], 'fw composes ONCE: birth 80 + local 25')
})
