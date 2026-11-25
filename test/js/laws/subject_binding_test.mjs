// P2 seam: a binding retains the being; an explicit spelling is a deliberate lookup.
// A quoted subject is re-resolved by name; a bare one carries identity.
// Probe: probe/bound-behaviour/subjects.mjs. (id:being-facets-p2-seam)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive, nz } from './harness.mjs'
import { collectErrors, parseProgram } from '../../../assets/js/turtling/parse.js'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

function run(source, opts = {}) {
    assert.deepEqual(collectErrors(parseProgram(source)), [], 'healthy construction parses')
    const scheduler = buildWorld(opts)
    const host = scheduler.hotSwapChild('host', fork('host', source))
    drive(scheduler, { maxTicks: 60 })
    return { scheduler, host }
}
const position = (frame) => nz(frameWorldTransform(frame).position)

const REACH = `def reach subject d do
 let subject.distance = d
end`

test('a forwarded subject is a spelling: a nearer namesake receives the law', () => {
    const result = run(`let A
${REACH}
def viaHolder subject d do
 as holder do
  let A
  let subject.distance = d
 end
end
viaHolder "A" 5`)
    const outer = result.host.children.get('A')
    const inner = result.host.children.get('holder').children.get('A')
    assert.notEqual(inner.id, outer.id)
    assert.deepEqual(position(outer), [0, 0, 0], 'the bound being is untouched')
    assert.deepEqual(position(inner), [5, 0, 0], 'the receiving scope chose the namesake')
    const active = result.scheduler.laws.active()
    assert.deepEqual(active.map((law) => law.endpoints.includes(inner.id)), [true])
    assert.equal(active.some((law) => law.endpoints.includes(outer.id)), false)
})

test('a bare subject argument binds the being, so a namesake cannot redirect it', () => {
    const result = run(`let A
${REACH}
def viaHolder subject d do
 as holder do
  let A
  let subject.distance = d
 end
end
viaHolder A 5`)
    const outer = result.host.children.get('A')
    const inner = result.host.children.get('holder').children.get('A')
    assert.notEqual(inner.id, outer.id)
    assert.deepEqual(position(outer), [5, 0, 0], 'the bound being received the law')
    assert.deepEqual(position(inner), [0, 0, 0], 'the nearer namesake did not')
    const active = result.scheduler.laws.active()
    assert.deepEqual(active.map((law) => law.endpoints.includes(outer.id)), [true])
    assert.equal(active.some((law) => law.endpoints.includes(inner.id)), false)
})

test('a law endpoint keeps the resolved being id across a same-name replacement', () => {
    const result = run(`let A
${REACH}
reach "A" 5`)
    const old = result.host.children.get('A')
    assert.ok(result.scheduler.laws.active()[0].endpoints.includes(old.id))
    result.scheduler.removeChild('host')
    assert.equal(result.scheduler.laws.count(), 0)
    assert.equal(result.scheduler.registry.has(old.id), false)
    const host = result.scheduler.hotSwapChild('host', fork('host', `let A
${REACH}
reach "A" 7`))
    drive(result.scheduler, { maxTicks: 20 })
    const fresh = host.children.get('A')
    assert.notEqual(fresh.id, old.id, 'a namesake re-created is a new being')
    assert.equal(result.scheduler.registry.has(old.id), false, 'the old identity never revives')
    assert.deepEqual(position(fresh), [7, 0, 0])
    assert.ok(result.scheduler.laws.active().every((law) => law.endpoints.includes(fresh.id)))
})

test("a bound being's facet is read through the identity, not a nearer namesake", () => {
    const result = run(`let A
let A.position = (7,0,0)
def use subject do
 as inner do
  let A
  let A.position = (99,0,0)
  let R
  let R.distance = subject.x
 end
end
as probe do
 use A
end`)
    const inner = result.host.children.get('probe').children.get('inner')
    assert.deepEqual(position(inner.children.get('R')), [7, 0, 0], 'the bound being answered')
    assert.deepEqual(position(result.host.children.get('A')), [7, 0, 0])
    assert.deepEqual(position(inner.children.get('A')), [99, 0, 0])
})

test('a quoted subject still deliberately looks up the nearer namesake', () => {
    const result = run(`let A
let A.position = (7,0,0)
def use subject do
 as inner do
  let A
  let A.position = (99,0,0)
  let R
  let R.distance = subject.x
 end
end
as probe do
 use "A"
end`)
    const inner = result.host.children.get('probe').children.get('inner')
    assert.deepEqual(position(inner.children.get('R')), [99, 0, 0], 'the spelling chose the namesake')
})

test('a nearer scalar owns the name; a bare subject does not bypass it', () => {
    const result = run(`let A
def emit n do
 let result = n + 1
end
as holder do
 let A = 7
 emit A
end`)
    const holder = result.host.children.get('holder')
    assert.equal(result.scheduler.readouts.value(holder.scalars.get('result')), 8)
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [])
})

test('a bound facet read records its observed input, so a driven law follows it', () => {
    const result = run(`let A
let out
def track subject do
 let out.x = subject.x + 1
end
track A`, { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const A = result.host.children.get('A'), out = result.host.children.get('out')
    assert.deepEqual(position(out), [1, 0, 0])
    const verdict = result.scheduler.requestMotion(A, { ...A.transform.deref(), position: [10, 0, 0] }, result.scheduler.motionRevision)
    assert.equal(verdict.kind, 'accept')
    for (let i = 0; i < 12; i++) {
        result.scheduler.readouts.recompute()
        result.scheduler.tick(100000 + i * 1000)
        for (const frame of result.scheduler.registry.values()) frame.channel.drain()
    }
    assert.deepEqual(position(A), [10, 0, 0])
    assert.deepEqual(position(out), [11, 0, 0], 'the changed facet changed the question')
})

// Binding a being or deliberately looking up its name preserves its position meaning.
// (id:world-coordinate-phase-2-reads)
test('bound and quoted root-datum reads converge on world coordinates', () => {
    const bound = run(`jmp 100
def read subject do
 let result = subject.x
end
as holder do
 read origin
end`)
    const holder = bound.host.children.get('holder')
    assert.deepEqual(position(holder), [100, 0, 0])
    assert.equal(bound.scheduler.readouts.value(holder.scalars.get('result')), 0)

    const quoted = run(`jmp 100
def read subject do
 let result = subject.x
end
as holder do
 read "origin"
end`)
    const quotedHolder = quoted.host.children.get('holder')
    assert.deepEqual(position(quotedHolder), [100, 0, 0])
    assert.equal(quoted.scheduler.readouts.value(quotedHolder.scalars.get('result')), 0)
})

test('a callable facet resolves on the bound being, not a caller namesake', () => {
    const result = run(`let A
let out
as A do
 fn bias(x) (x+1)
end
fn bias(x) (x+100)
def use subject do
 let out.x = subject.bias[2]
end
use A`)
    assert.deepEqual(position(result.host.children.get('out')), [3, 0, 0])
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [])
})

test('a failed bound callable refuses instead of using ambient spelling', () => {
    const result = run(`let A
let out
fn bias(x) (x+100)
def use subject do
 let out.x = subject.bias[2]
end
use A`)
    assert.deepEqual(position(result.host.children.get('out')), [0, 0, 0], 'the ambient namesake never ran')
    assert.ok(result.scheduler.errors.some((e) => /Undefined property: bias on assistant A/.test(e.message)))
})

test('a callable facet records its arguments, so a changed argument drives the answer', () => {
    const result = run(`let A
let out
as A do
 fn bias(x) (x+1)
end
def use subject do
 let out.x = subject.bias[A.x]
end
use A`, { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const A = result.host.children.get('A'), out = result.host.children.get('out')
    assert.deepEqual(position(out), [1, 0, 0])
    const verdict = result.scheduler.requestMotion(A, { ...A.transform.deref(), position: [10, 0, 0] }, result.scheduler.motionRevision)
    assert.equal(verdict.kind, 'accept')
    for (let i = 0; i < 12; i++) {
        result.scheduler.readouts.recompute()
        result.scheduler.tick(100000 + i * 1000)
        for (const frame of result.scheduler.registry.values()) frame.channel.drain()
    }
    assert.deepEqual(position(out), [11, 0, 0], 'the changed argument changed the question')
})

test('a string-bound subject still looks up its callable deliberately', () => {
    const result = run(`let A
let out
as A do
 fn bias(x) (x+1)
end
def use subject do
 let out.x = subject.bias[2]
end
use "A"`)
    assert.deepEqual(position(result.host.children.get('out')), [3, 0, 0])
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [])
})

// Rung 1: `as b` is a receiver door, not a selector spelling. A bound being must cross
// by identity before any word coercion, so the body heads the ORIGINAL being. The
// coalesced name and the nearer-namesake lookup are p2 open. (id:being-facets-p2-seam)
test('as b heads the bound receiver, not a coerced name', () => {
    const result = run(`let A
def attach receiver do
 as receiver do
  goto 5 0
 end
end
attach A`)
    const A = result.host.children.get('A')
    assert.deepEqual(position(A), [5, 0, 0], 'the original A walks under its own head')
    assert.equal(result.host.children.has('[object Object]'), false, 'no coerced-name frame was seated')
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [])
})

test('as "A" still deliberately looks the name up', () => {
    const result = run(`let A
as "A" do
  goto 5 0
end`)
    assert.deepEqual(position(result.host.children.get('A')), [5, 0, 0])
})

test('as a fresh name still creates a new ambient', () => {
    const result = run(`as bunny do
  goto 5 0
end`)
    assert.deepEqual(position(result.host.children.get('bunny')), [5, 0, 0])
})

test('as b is not redirected by a nearer namesake', () => {
    const result = run(`let A
def attach subject do
 as holder do
  let A
  as subject do
   goto 7 0
  end
 end
end
attach A`)
    assert.deepEqual(position(result.host.children.get('A')), [7, 0, 0], 'the bound being walked')
    const holder = result.host.children.get('holder')
    assert.deepEqual(position(holder.children.get('A')), [0, 0, 0], 'the nearer namesake stayed put')
})

test('as b survives nested parameter forwarding', () => {
    const result = run(`let A
def mid subject do
 as subject do
  goto 3 0
 end
end
def outer subject do
 mid subject
end
outer A`)
    assert.deepEqual(position(result.host.children.get('A')), [3, 0, 0])
    assert.equal(result.host.children.has('[object Object]'), false)
})

// CUTOVER: the bound receiver is ADMITTED as an independently owned installation and
// DRIVEN through the retained route — never rewired. (id:being-facets-p4-sequence)
test('as b drives the original receiver through an owned installation', () => {
    const result = run(`let A
as A do
  let C
  let C.x = 1
end
def attach receiver do
  as receiver do
    goto 5 1
  end
end
attach A`)
    const A = result.host.children.get('A')
    assert.deepEqual(position(A), [5, 1, 0], 'the original receiver is driven by the installation')
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [])
})

// A nearer lexical binding owns the name. The receiver door must resolve through the
// frame's own chain, so a nearer scalar shadows a captured outer name and the outer being
// is never reached. (id:being-facets-centers-review)
test('as b is not redirected by a nearer scalar', () => {
    const result = run(`let A
def attach subject do
  as holder do
    let subject = 7
    as subject do
      goto 5 0
    end
  end
end
attach A`)
    assert.deepEqual(position(result.host.children.get('A')), [0, 0, 0], 'the outer being was not reached')
    const holder = result.host.children.get('holder')
    const coerced = holder.children.get('7')
    assert.ok(coerced, 'the nearer scalar value named the ambient')
    assert.deepEqual(position(coerced), [5, 0, 0])
})

// A private derived figure already owns its source; the receiver boundary refuses the
// foreign attachment rather than replacing it. (id:being-facets-p4-rungs)
test('as b drives a private derived figure without replacing it', () => {
    const result = run(`def shape do
  goto 3 0
end
let fig = shape
def attach receiver do
  as receiver do
    goto 9 0
  end
end
attach fig`)
    const fig = result.host.children.get('fig')
    assert.deepEqual(position(fig), [9, 0, 0], 'the original figure is driven')
    assert.equal(result.scheduler.errors.length, 0)
})

// The other direction from the nearer-inner-scalar fence: a callee's formal scope is
// innermost, so a caller's own scalar must not redirect a passed participant.
// (id:being-facets-p2-seam)
test('as b keeps the formal binding ahead of a caller scalar', () => {
    const result = run(`let A
let subject = 7
def attach subject do
  as subject do
    goto 5 0
  end
end
attach A`)
    assert.deepEqual(position(result.host.children.get('A')), [5, 0, 0], 'the formal participant received the body')
    assert.equal(result.host.children.has('7'), false, 'the caller scalar did not name the ambient')
})

// And it survives a spawned frame: an ancestor's scalar must not override the formal the
// child captured. (id:being-facets-p2-seam)
test('as b keeps a captured formal ahead of an ancestor scalar', () => {
    const result = run(`let A
let subject = 7
def attach subject do
  as holder do
    as subject do
      goto 5 0
    end
  end
end
attach A`)
    assert.deepEqual(position(result.host.children.get('A')), [5, 0, 0])
    assert.equal(result.host.children.get('holder').children.has('7'), false)
})

// Rung 1 consistency: a spawned frame's own reached declaration owns the name. A
// captured formal is OUTER to the frame that declared it; `fw`, `.x` and `as` must
// not disagree about which binding wins. (id:being-facets-centers-review)
test('a spawned frame reads its own declaration, not the captured formal', () => {
    const result = run(`let len = 3
def launch len do
  as holder do
    let len = 7
    fw len
  end
end
launch len`)
    assert.deepEqual(position(result.host.children.get('holder')), [7, 0, 0],
        "the spawned frame's own declaration owns the name")
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [])
})

// The same nearer binding must win for an ordinary dotted read as for a selector:
// `subject.x` may not fall through to the captured being while `as subject` chooses
// the scalar. Present-but-unavailable is a refusal, never an outer namesake.
// (id:being-facets-centers-review)
test('a nearer scalar owns the name for a dotted read, as it does for a selector', () => {
    // The same nearer-scalar structure as 'as b is not redirected by a nearer scalar':
    // there the selector binds "7". A dotted read must agree — it may not fall through
    // to the captured being. Present-but-unavailable is a refusal, not an outer namesake.
    // (id:being-facets-centers-review)
    const result = run(`let A
let A.position = (5,0,0)
def use subject do
  as holder do
    let subject = 7
    let seen.position = (subject.x, 0, 0)
  end
end
use A`)
    assert.deepEqual(position(result.host.children.get('A')), [5, 0, 0],
        'the captured being was not read through the shadowed name')
    assert.equal(result.host.children.get('holder').children.has('seen'), false,
        'the facet read had no answer and withdrew its seat')
    assert.ok(result.scheduler.errors.length > 0, 'the refusal is reported')
})

// The law-selector branch resolves through the same interpretation: a law target
// naming a nearer local declaration must not reach the captured formal it shadows.
// (id:being-facets-centers-review)
test('a law target honors a nearer declaration before a captured formal', () => {
    const reached = run(`let A
def use subject do
  let subject.position = (9,0,0)
end
use A`)
    assert.deepEqual(position(reached.host.children.get('A')), [9, 0, 0],
        'the formal being is a lawful target when nothing shadows it')

    const shadowed = run(`let A
def use subject do
  let subject = 7
  let subject.position = (9,0,0)
end
use A`)
    assert.deepEqual(position(shadowed.host.children.get('A')), [0, 0, 0],
        'the nearer declaration owns the name; the captured A is not the target')
    assert.ok(shadowed.scheduler.errors.length > 0, 'the refusal is reported')
})

// The same branch builds a law's participants: a shadowed name must not smuggle the
// captured being in as an endpoint. (id:being-facets-centers-review)
test('a law participant honors a nearer declaration before a captured formal', () => {
    const shadowed = run(`let A
let B
let B.position = (4,0,0)
def use subject do
  let subject = 7
  let distance(subject, B) = 9
end
use A`)
    assert.deepEqual(shadowed.scheduler.laws.active().filter((l) => l.feature === 'distance'), [],
        'the captured A is not a participant')
    assert.deepEqual(position(shadowed.host.children.get('A')), [0, 0, 0])
    assert.ok(shadowed.scheduler.errors.length > 0, 'the refusal is reported')
})

// EXTENSION preserves inherited provenance: a nearer declaration keeps its meaning inside
// a function body, and a formal parameter genuinely shadows the inherited name.
// (id:being-facets-centers-review)
test('function extension keeps a nearer declaration and lets a parameter shadow it', () => {
    const kept = run(`let len = 3
def use len do
  as holder do
    let len = 7
    fn plus(x) (x+len)
    fw plus[0]
  end
end
use 3`)
    assert.deepEqual(position(kept.host.children.get('holder')), [7, 0, 0],
        'the inherited nearer declaration is not replaced by the captured value')

    const shadowed = run(`let len = 3
def use len do
  as holder do
    let len = 7
    fn plus(len) (len)
    fw plus[1]
  end
end
use 3`)
    assert.deepEqual(position(shadowed.host.children.get('holder')), [1, 0, 0],
        'the formal parameter shadows the inherited declaration')
})

// CAPTURE must not resurrect a shadowed binding: the child resolves the effective
// declaration through the frame chain. (id:being-facets-centers-review)
test('spawn capture does not resurrect a shadowed binding', () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', `let len = 3
def use len do
  as holder do
    let len = 7
    as inner do
      fw len
    end
  end
end
use 3`))
    drive(scheduler, { maxTicks: 80 })
    const holder = host.children.get('holder')
    assert.deepEqual(position(holder.children.get('inner')), [7, 0, 0],
        'the child reads the nearer declaration, not the captured 3')
    assert.deepEqual(scheduler.errors.map((e) => e.message), [])
})

// An UNAVAILABLE nearer declaration is still claimed: omission must not fall back to the
// outer namesake. (id:being-facets-centers-review)
test('an unavailable nearer declaration is not replaced by an outer namesake', () => {
    const result = run(`let len = 3
def use len do
  as holder do
    let len = 1/0
    as inner do
      fw len
    end
  end
end
use 3`)
    const inner = result.host.children.get('holder').children.get('inner')
    assert.deepEqual(position(inner), [0, 0, 0], 'the outer 3 was not resurrected')
    assert.ok(result.scheduler.errors.length > 0, 'the unavailability is reported')
})

// The fnScope projection must not let the evaluator-constants loop claim an omitted
// shadowed name: a locally declared `x` is claimed, not free for the cursor constant.
// (id:being-facets-centers-review)
test('a captured function does not replace a local x with the cursor constant', () => {
    const result = run(`let x = 3
def use x do
  as holder do
    let x = 9
    fn grab() (x)
    fw grab
  end
end
use 3`)
    assert.deepEqual(position(result.host.children.get('holder')), [9, 0, 0],
        'the locally declared x owns its name inside the captured function')
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [])
})


// ── ONE acquisition: the surface does not change finding ─────────────────────────
// The CALL path holds Argument nodes and the DECLARATION path holds raw strings. One
// acquire serves both, so the same spelling finds the same being either way.
// (id:being-facets-p2-seam, id:being-facets-centers-review)

function runTrace(source, ticks = 40) {
    assert.deepEqual(collectErrors(parseProgram(source)), [], 'healthy construction parses')
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild('host', fork('host', source))
    const trace = drive(scheduler, { maxTicks: ticks })
    const labels = [...trace.values()].flat().filter((e) => e.type === 'label').map((e) => e.text)
    return { scheduler, host, labels, messages: scheduler.errors.map((e) => e.message ?? String(e)) }
}

test('a declaration argument binds the being, exactly as an ordinary call does', () => {
    const result = run(`def choose a do
  fw 1
end
let rabbit
let flake = choose rabbit`)
    assert.ok(result.host.children.get('flake'), 'the private answer exists')
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [],
        'a declaration path finds the being: no Undefined variable: rabbit')
    assert.deepEqual(position(result.host.children.get('rabbit')), [0, 0, 0], 'the participant is untouched')
})

test('a body finds its own name, so a recipe can forward self', () => {
    const result = run(`def face subject do
  faceto subject
end
as rabbit do
  loop 2 do
    fw 5
    face rabbit
    wait 1/24
  end
end`)
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [],
        'self is a binding, not an undefined name')
    assert.ok(result.host.children.get('rabbit'), 'the self-referencing being still runs')
})

test('a display word resolves a being before the literal fallback', () => {
    const result = runTrace(`as rabbit do
  loop 2 do
    fw 5
    label rabbit 0.1
    wait 1/24
  end
end`)
    assert.ok(result.labels.length > 0, 'the label drew')
    assert.ok(result.labels.every((text) => /^[-0-9.,[\] ]+$/.test(text)),
        'a found being reaches the display adaptation, not its spelling')
    assert.equal(result.labels.includes('rabbit'), false, 'the literal never masks the found being')
})

test('an unresolved word hole keeps its spelling — white is still a colour', () => {
    const result = runTrace(`as rabbit do
  beColour white
  label snow
  fw 1
end`)
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [], 'no wound for a genuine word')
    assert.deepEqual(result.labels, ['snow'], 'a genuinely unresolved word is permitted')
})

// Passing explicit participants permits scoped requests, not access to an unrelated being.
// An outside receiver omitted from the input question remains a containment refusal.
// (id:being-facets-participant-membrane)
test('a private declaration cannot reach an unpassed outside receiver', () => {
    const result = runTrace(`def move target do
  as target do
    fw 2
  end
end
def hunt prey do
  let nested = move fox
end
as rabbit do
  loop 3 do
    fw 5
    rt 1
    wait 1/24
  end
end
let fox
let hunting = hunt rabbit`)
    assert.ok(result.messages.some((m) => /closed region has no outside receiver/.test(m)),
        'containment is what the boundary knows')
    assert.equal(result.messages.some((m) => /Undefined variable/.test(m)), false,
        'never an undefined-name error')
    assert.ok(result.host.children.get('rabbit'), 'the observed participant survives')
    assert.ok(result.host.children.get('fox'), 'the receiver survives')
})


// ── The same binding at acquisition and at reconstruction ────────────────────────
// A being bound at first sight keeps its identity when the question is re-read; only
// the expression argument is re-read, because a live name is a port. The unused
// participant deliberately isolates binding from containment.
// (id:being-facets-p2-seam)

test('a rebuilt question retains a bound being and re-reads a live expression', () => {
    const result = run(`let rabbit
let driver
def choose participant len do
  fw len
end
let flake = choose rabbit driver.x`, { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const driver = result.host.children.get('driver'), flake = result.host.children.get('flake')
    assert.deepEqual(flake.transform.deref().position, [0, 0, 0])
    const outcome = result.scheduler.requestMotion(driver,
        { rotation: driver.transform.deref().rotation, position: [12, 0, 0] }, result.scheduler.motionRevision)
    assert.equal(outcome.kind, 'accept')
    result.scheduler.readouts.recompute()
    result.scheduler.readouts.drain()
    drive(result.scheduler, { maxTicks: 120 })
    assert.deepEqual(flake.transform.deref().position, [12, 0, 0], 'the live expression reached the rebuild')
    assert.equal(result.scheduler.errors.some((e) => /Undefined variable: rabbit/.test(e.message)), false,
        'the bound being was not re-found by spelling')
})

test('a bound being is retained even when a same-name spelling would fail', () => {
    const result = run(`let rabbit
let driver
def choose participant len do
  fw len
end
let flake = choose rabbit driver.x`, { admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    result.scheduler.readouts.recompute()
    result.scheduler.readouts.drain()
    drive(result.scheduler, { maxTicks: 60 })
    assert.equal(result.scheduler.errors.some((e) => /Undefined variable/.test(e.message)), false,
        'the identity, not the spelling, is what the rebuild holds')
})

// ── Presence, never truthiness: only omission takes the default ───────────────────

test('a supplied empty string keeps its meaning and reaches the consumer', () => {
    const result = runTrace(`def emit t do
  label t
end
emit ""`)
    assert.deepEqual(result.labels, [''], 'the supplied empty text was not replaced by 0')
})

test('an omitted argument alone takes the recipe default', () => {
    const result = runTrace(`def emit t do
  label t
end
emit`)
    assert.deepEqual(result.labels, ['0'], 'omission receives the default')
    assert.deepEqual(result.scheduler.errors.map((e) => e.message), [])
})
