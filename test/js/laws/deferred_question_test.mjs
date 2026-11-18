// A deferred question answers from the interpretation captured at its boundary, not from
// whatever the world holds when a later read first happens. Serving and equality are
// separate: the question retains an eager view for serving and compares only the meanings
// it has consumed. (id:being-facets-root-repair)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from './harness.mjs'

// Rabbit starts at 5, moves to 10 at t=2000, then waits out the run. The answer reads only
// after the move, so the first read is the discriminating observation.
const RABBIT = `as rabbit do
  fw 5
  wait 2
  fw 5
  wait 2
end`

const READ_LATE = `def read subject do
  wait 3
  label subject.position
end
let answer = read rabbit`

// Tick the world, draining each frame's channel with the run incarnation it was produced
// under. A derived figure's incarnation advances when its question is superseded.
function run(source, { ticks = 12 } = {}) {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', source))
    const labels = []
    for (let i = 0; i < ticks && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) {
            for (const e of frame.channel.drain()) {
                if (e.type === 'label') labels.push({ name: frame.name, run: frame.runIncarnation, tick: i, text: e.text })
            }
        }
    }
    return { scheduler, host, labels, answer: host.children.get('answer') }
}

const answerLabels = (labels) => labels.filter((l) => l.name === 'answer')
const errors = (scheduler) => scheduler.errors.map((e) => e.message)

test('a late first read answers from the question boundary, not live state', () => {
    const { scheduler, labels } = run(`${RABBIT}\n${READ_LATE}`)
    const seen = answerLabels(labels)
    assert.deepEqual(errors(scheduler), [])
    // Rabbit is already at [10,0,0] when this read first happens; the question was asked
    // about [5,0,0]. The read must answer the boundary interpretation.
    assert.equal(seen[0]?.text, '[5, 0, 0]', `labels: ${JSON.stringify(seen)}`)
    assert.equal(seen[0]?.run, 1)
})

test('a changed consumed meaning supersedes into a fresh run', () => {
    const { scheduler, labels } = run(`${RABBIT}\n${READ_LATE}`)
    const seen = answerLabels(labels)
    // Run 1 answers the boundary value; a later run must answer the moved world. The tick
    // is not asserted: restarting the recipe restarts its authored wait.
    assert.equal(seen[0]?.text, '[5, 0, 0]', `labels: ${JSON.stringify(seen)}`)
    assert.ok(seen.some((l) => l.run > 1 && l.text === '[10, 0, 0]'), `labels: ${JSON.stringify(seen)}`)
    assert.deepEqual(errors(scheduler), [])
})

test('an unconsumed facet changing does not supersede the question', () => {
    // rabbit moves in x; the answer consumes only y, so its question has not changed.
    const { scheduler, answer } = run(`as rabbit do
  fw 5
  wait 2
  fw 5
  wait 2
end
def read subject do
  wait 1
  label subject.y
  wait 1
  label subject.y
end
let answer = read rabbit`)
    assert.deepEqual(errors(scheduler), [])
    assert.equal(answer?.runIncarnation, 1)
})

// --- Phase 2 regressions: missing-contract fences, expected red until the guard lands. ---

// A stable published position, for the branch-switch revision.
const accept = ({ requested }) => ({ accepted: true, transform: requested })

test('a same-binding re-declaration preserves the run and its retained capture', () => {
    const { scheduler, labels } = run(`as rabbit do
  fw 5
  wait 2
  fw 5
  wait 6
end
def read subject do
  wait 3
  label subject.position
end
let answer = read rabbit
wait 2
let answer = read rabbit`)
    const seen = answerLabels(labels)
    assert.deepEqual(errors(scheduler), [])
    // The same binding is the same question: its first read answers the boundary capture
    // (rabbit at 5), not the live 10 at re-declaration. A later legitimate supersession is
    // not prohibited.
    assert.equal(seen[0]?.run, 1, JSON.stringify(seen))
    assert.equal(seen[0]?.text, '[5, 0, 0]', JSON.stringify(seen))
})

test('a final first consumption still refreshes with no later world instant', () => {
    const { scheduler, labels } = run(`as rabbit do
  fw 5
  wait 2
  fw 5
end
def read subject do
  wait 3
  label subject.position
end
let answer = read rabbit`, { ticks: 16 })
    const seen = answerLabels(labels)
    // rabbit commits 10 before this first read; the read answers the boundary 5. With no
    // later instant, the changed meaning must still be discovered and refreshed.
    assert.equal(seen[0]?.text, '[5, 0, 0]', JSON.stringify(seen))
    assert.ok(seen.some((l) => l.run > 1 && l.text === '[10, 0, 0]'), JSON.stringify(seen))
    assert.deepEqual(errors(scheduler), [])
})

test('a branch switch retires the obsolete consumed facet', () => {
    const scheduler = buildWorld({ breathEvery: 0, admit: accept })
    const host = scheduler.hotSwapChild('host', fork('host', `let rabbit
let rabbit.y = 0
let control
def pick subject mode do
  when mode < 1 do
    label subject.x
  end
  when mode > 0 do
    label subject.y
  end
  wait 6
end
let answer = pick rabbit control.x`))
    const labels = []
    const tick = (t) => {
        scheduler.tick(t)
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) {
            for (const e of frame.channel.drain()) {
                if (e.type === 'label') labels.push({ name: frame.name, run: frame.runIncarnation, text: e.text })
            }
        }
    }
    tick(0)
    const control = host.children.get('control'), rabbit = host.children.get('rabbit')
    const answer = () => host.children.get('answer')
    // mode flips: the y-branch run replaces the x-branch run.
    const v1 = scheduler.requestMotion(control, { rotation: control.transform.deref().rotation, position: [1, 0, 0] }, scheduler.motionRevision)
    assert.equal(v1.kind, 'accept')
    assert.equal(control.transform.deref().position[0], 1)
    scheduler.readouts.recompute(); scheduler.readouts.drain()
    tick(1000)
    assert.equal(answer()?.runIncarnation, 2, JSON.stringify(labels))
    // rabbit's x is no longer consumed; moving it must not restart the y-only answer.
    const v2 = scheduler.requestMotion(rabbit, { rotation: rabbit.transform.deref().rotation, position: [5, 0, 0] }, scheduler.motionRevision)
    assert.equal(v2.kind, 'accept')
    assert.equal(rabbit.transform.deref().position[0], 5)
    scheduler.readouts.recompute(); scheduler.readouts.drain()
    tick(2000)
    assert.equal(answer()?.runIncarnation, 2, JSON.stringify(labels))
    assert.deepEqual(errors(scheduler), [])
})

test('a nested question inherits the enclosing capture instead of resampling', () => {
    const { scheduler, labels } = run(`as rabbit do
  fw 5
  wait 2
  fw 5
  wait 6
end
def inner subject do
  label subject.position
end
def outer subject do
  wait 3
  let b = inner subject
end
let a = outer rabbit`)
    const inner = labels.filter((l) => l.name === 'b')
    assert.deepEqual(errors(scheduler), [])
    // outer captured rabbit at 5; the nested inner must read that interpretation, not the
    // live 10 it happens to find when it is declared at t=3000.
    assert.equal(inner[0]?.text, '[5, 0, 0]', JSON.stringify(labels))
})

test('a consumed participant change supersedes an effect-owning parent from accepted reality', () => {
    const { scheduler, host } = run(`as rabbit do
  fw 5
  wait 2
  fw 5
  wait 2
end
let fox
def step predator do
  as predator do
    fw 2
  end
end
def build prey predator do
  label prey.position
  let action = step predator
  wait 4
end
let answer = build rabbit fox`, { ticks: 6 })
    assert.deepEqual(errors(scheduler), [])
    // Rabbit moved and `label prey.position` consumed it, so the declared behaviour is
    // revised: the fresh run re-executes from fox's accepted present. Accepted history is
    // never rolled back, and superseded pending work cannot publish.
    // (id:declared-behaviour-revision-contract)
    const x = host.children.get('fox').transform.deref().position[0]
    assert.equal(host.children.get('answer').runIncarnation, 2, 'a changed consumed meaning supersedes')
    assert.equal(x, 4, `fox x=${x}`)
})

test('an equal-valued re-declaration rebinds the subscription, preserving the run', () => {
    const scheduler = buildWorld({ breathEvery: 0, admit: accept })
    const host = scheduler.hotSwapChild('host', fork('host', `def draw n do
  label n
  wait 6
end
let control
let other
let answer = draw control.x
wait 1
let answer = draw other.x
wait 6`))
    const labels = []
    const tick = (t) => {
        scheduler.tick(t)
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) {
            for (const e of frame.channel.drain()) {
                if (e.type === 'label') labels.push({ run: frame.runIncarnation, text: e.text })
            }
        }
    }
    tick(0); tick(1000)
    const answer = () => host.children.get('answer')
    const control = host.children.get('control'), other = host.children.get('other')
    // control.x and other.x are both 0: the value is equal and the run is kept, but the
    // binding must follow the NEW declaration. control no longer defines demand; other
    // does. Preserve-current-behaviour guard for the lifetime repair.
    assert.equal(answer()?.runIncarnation, 1, JSON.stringify(labels))
    const c = scheduler.requestMotion(control, { rotation: control.transform.deref().rotation, position: [1, 0, 0] }, scheduler.motionRevision)
    assert.equal(c.kind, 'accept')
    scheduler.readouts.recompute(); scheduler.readouts.drain(); tick(2000)
    assert.equal(answer()?.runIncarnation, 1, JSON.stringify(labels))
    const o = scheduler.requestMotion(other, { rotation: other.transform.deref().rotation, position: [2, 0, 0] }, scheduler.motionRevision)
    assert.equal(o.kind, 'accept')
    scheduler.readouts.recompute(); scheduler.readouts.drain(); tick(3000)
    assert.equal(answer()?.runIncarnation, 2, JSON.stringify(labels))
    assert.deepEqual(errors(scheduler), [])
})

// --- Forwarding depth, withdrawal, and debt cleanup. ---

test('a repeated participant role does not defeat equal-reuse transfer', () => {
    const { scheduler, labels } = run(`as rabbit do
  fw 5
  wait 2
  fw 5
  wait 6
end
def read a b do
  wait 3
  label a.position
  label b.position
end
let answer = read rabbit rabbit
wait 2
let answer = read rabbit rabbit`)
    const seen = answerLabels(labels)
    assert.deepEqual(errors(scheduler), [])
    // One being in two roles is one identity: the boundary reading transfers, so run 1
    // answers 5 twice instead of resampling the live 10.
    assert.deepEqual(seen.filter((l) => l.run === 1).map((l) => l.text), ['[5, 0, 0]', '[5, 0, 0]'], JSON.stringify(seen))
})

test('a three-level forward records on the authoritative question, not each borrower', () => {
    const { scheduler, labels } = run(`as rabbit do
  fw 5
  wait 2
  fw 5
  wait 6
end
def inner s do
  label s.position
end
def middle s do
  let c = inner s
end
def outer s do
  wait 3
  let b = middle s
end
let a = outer rabbit`, { ticks: 16 })
    const seen = labels.filter((l) => l.name === 'c')
    assert.deepEqual(errors(scheduler), [])
    // outer owns the retained meaning; the deep read answers its boundary 5 first, and when
    // rabbit moves outer (not middle) supersedes, so the fresh chain answers 10.
    assert.equal(seen[0]?.text, '[5, 0, 0]', JSON.stringify(labels))
    assert.equal(seen[1]?.text, '[10, 0, 0]', JSON.stringify(labels))
})

test('a revoked private reader cannot amend the replacement footprint', () => {
    // Ordinary private child (not an installation), so it genuinely owns question rights
    // before withdrawal. (id:being-facets-root-repair)
    const scheduler = buildWorld({ breathEvery: 0, admit: accept })
    const host = scheduler.hotSwapChild('host', fork('host', `let rabbit
let rabbit.y = 0
let control
def read s n do
  as cursor do
    label s.position
    wait 6
  end
  wait 6
end
let answer = read rabbit control.x`))
    const tick = (t) => {
        scheduler.tick(t)
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) frame.channel.drain()
    }
    tick(0)
    const answer = host.children.get('answer')
    const rabbit = host.children.get('rabbit'), control = host.children.get('control')
    const cursor = answer.children.get('cursor')
    const facet = cursor.deps.mathEvaluator.resolveSubjectFacet
    // While live, the private reader records a fresh facet on its authoritative question.
    facet(rabbit, 'y')
    assert.ok([...answer.consumed.keys()].some((k) => k === `${rabbit.id}|y`), 'the live reader records')
    // The root binding (n = control.x) supersedes the question, revoking this reader.
    scheduler.requestMotion(control, { rotation: control.transform.deref().rotation, position: [1, 0, 0] }, scheduler.motionRevision)
    scheduler.readouts.recompute(); scheduler.readouts.drain(); tick(1000)
    assert.equal(scheduler.registry.has(cursor.id), false, 'the superseded reader is revoked')
    assert.notEqual(answer.children.get('cursor'), cursor)
    const before = [...answer.consumed.keys()]
    facet(rabbit, 'z')
    const after = [...answer.consumed.keys()]
    assert.deepEqual(after, before, 'a revoked reader must not amend the replacement')
    assert.ok(!after.some((k) => k === `${rabbit.id}|z`))
    assert.deepEqual(errors(scheduler), [])
})

test('a discovered meaning equal to the live world lets the world idle', () => {
    const { scheduler, labels } = run(`as rabbit do
  fw 5
  wait 6
end
def read subject do
  wait 3
  label subject.position
end
let answer = read rabbit`, { ticks: 8 })
    const seen = answerLabels(labels)
    assert.deepEqual(errors(scheduler), [])
    // One label, still run 1: the equal discovery must not restart.
    assert.equal(seen.length, 1, JSON.stringify(seen))
    assert.equal(seen[0]?.run, 1)
    assert.equal(seen[0]?.text, '[5, 0, 0]')
    assert.equal(scheduler.done, true)
})

test('withdrawing the owning source revokes its question and its debt', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', `as rabbit do
  fw 5
  wait 6
end
def read subject do
  wait 3
  label subject.position
end
let answer = read rabbit`))
    const tick = (t) => {
        scheduler.tick(t)
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) frame.channel.drain()
    }
    tick(0); tick(1000); tick(2000); tick(3000)   // the late read leaves a comparison debt
    const answer = host.children.get('answer')
    assert.equal(answer.compareOwed, true, 'the late read leaves an outstanding comparison debt')
    scheduler.removeChild('host')
    assert.equal(host.parent.children.has('host'), false, 'the owning source is withdrawn')
    assert.equal(scheduler.registry.has(host.id), false)
    assert.equal(scheduler.registry.has(answer.id), false)
    assert.equal(scheduler.readouts.list().some((n) => n.keyed), false, 'the owned readout is revoked')
    tick(4000); tick(5000); tick(6000)
    assert.deepEqual(errors(scheduler), [])
    assert.equal(scheduler.done, true)
})

test('grounded heading invalidation is independent of observer consumption order', () => {
    const source = (innerFirst) => `as rabbit do
  wait 2
  pitch 30
  wait 6
end
def inner s do
  label s.heading
end
def outer s do
${innerFirst ? '  roll 90\n  let c = inner s\n  label s.heading' : '  label s.heading\n  roll 90\n  let c = inner s'}
  wait 6
end
let a = outer rabbit`
    for (const innerFirst of [false, true]) {
        const { scheduler, labels } = run(source(innerFirst), { ticks: 8 })
        const outer = labels.filter((l) => l.name === 'a')
        // Both grounded observers are distinct interpretation contexts, so the nested
        // observer's changed heading supersedes whichever observer consumed it first.
        assert.deepEqual(errors(scheduler), [], `innerFirst=${innerFirst}`)
        assert.ok(outer.some((l) => l.run > 1), `innerFirst=${innerFirst}: ${JSON.stringify(labels)}`)
    }
})

// --- Attached vs requested question. ---

test('a same-binding re-declaration after a pending recapture still refreshes the attached run', () => {
    const { scheduler, labels } = run(`as rabbit do
  fw 5
  wait 2
  fw 5
  wait 6
end
def read subject do
  label subject.position
  wait 6
end
let answer = read rabbit
wait 2
let answer = read rabbit`, { ticks: 14 })
    const seen = answerLabels(labels)
    assert.deepEqual(errors(scheduler), [])
    // The re-declaration must seed with the ACTUALLY ATTACHED question (rabbit at 5), not the
    // pending requested one (10). Otherwise the new subscription falsely acknowledges an
    // unbuilt answer and the run never refreshes.
    assert.equal(seen[0]?.text, '[5, 0, 0]', JSON.stringify(seen))
    assert.ok(seen.some((l) => l.run > 1 && l.text === '[10, 0, 0]'), JSON.stringify(seen))
})

// --- Demand returning to the attached question, and observer-independent readings. ---

test('a demand that returns to the attached question preserves the run', () => {
    const scheduler = buildWorld({ breathEvery: 0, admit: accept })
    const host = scheduler.hotSwapChild('host', fork('host', `let rabbit
let rabbit.y = 0
wait 1
def read subject do
  label subject.position
  wait 6
end
let answer = read rabbit`))
    const tick = (t) => {
        scheduler.tick(t)
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) frame.channel.drain()
    }
    tick(0)
    const rabbit = host.children.get('rabbit')
    // Attach the reading at 5 before the answer is declared.
    scheduler.requestMotion(rabbit, { rotation: rabbit.transform.deref().rotation, position: [5, 0, 0] }, scheduler.motionRevision)
    scheduler.readouts.recompute()
    tick(1000)
    const answer = host.children.get('answer')
    // Requested 10 with no drain, then requested back to the attached 5 before the build.
    scheduler.requestMotion(rabbit, { rotation: rabbit.transform.deref().rotation, position: [10, 0, 0] }, scheduler.motionRevision)
    scheduler.readouts.recompute()
    scheduler.requestMotion(rabbit, { rotation: rabbit.transform.deref().rotation, position: [5, 0, 0] }, scheduler.motionRevision)
    scheduler.readouts.recompute()
    scheduler.readouts.drain()
    tick(2000); tick(3000)
    assert.deepEqual(errors(scheduler), [])
    // The demand returned to the still-attached question: run and continuation are kept.
    assert.equal(answer.runIncarnation, 1)
})

test('borrowed position reads share one observer-independent footprint entry', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', `as rabbit do
  wait 2
  fw 5
  wait 6
end
def inner s do
  label s.position
end
def outer s do
  label s.position
  let c = inner s
  wait 6
end
let a = outer rabbit`))
    scheduler.tick(0)
    scheduler.readouts.drain()
    for (const frame of scheduler.registry.values()) frame.channel.drain()
    const a = host.children.get('a')
    assert.deepEqual(errors(scheduler), [])
    // Position does not depend on the reader frame, so the two observers share one entry
    // rather than duplicating the same upstream dependency.
    assert.equal(a.consumed.size, 1, JSON.stringify([...a.consumed.keys()]))
})

const GROUNDED_PROGRESS = `def inner s do
  label s.heading
  wait 4
  label s.heading
end
def outer s do
  let b = inner s
  wait 2
  roll 90
  let b = inner s
  wait 4
end
let a = outer rabbit`

test('owned drawing progress cannot recursively redefine the upstream question', () => {
    const { scheduler, host, labels } = run(`as rabbit do
  pitch 30
  wait 12
end
${GROUNDED_PROGRESS}`, { ticks: 20 })
    assert.deepEqual(errors(scheduler), [])
    assert.equal(host.children.get('a').runIncarnation, 1, JSON.stringify(labels))
    assert.equal(scheduler.done, true)
    // The input is fixed; the owned reader's chart may progress without making a new demand.
    assert.deepEqual(labels.filter((l) => l.name === 'b').map((l) => l.text), ['90', '120'])
})

test('a reused observer retains distinct consumed interpretations for later upstream changes', () => {
    const { scheduler, host, labels } = run(`as rabbit do
  pitch 30
  wait 6
  pitch 30
  wait 8
end
${GROUNDED_PROGRESS}`, { ticks: 24 })
    assert.deepEqual(errors(scheduler), [])
    assert.equal(host.children.get('a').runIncarnation, 2, JSON.stringify(labels))
    assert.ok(labels.some((l) => l.name === 'b' && l.text === '150'), JSON.stringify(labels))
    assert.equal(scheduler.done, true)
})
