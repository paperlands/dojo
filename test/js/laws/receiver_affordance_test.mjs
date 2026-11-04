// One authored recipe drives two supplied 3-joint assemblies; one venture is withdrawn
// while the other keeps working. Same runtime, no new syntax or flags.
// (id:laws-free-relations-f4-actor, id:being-facets-p4-sequence, id:laws-recipe-composition)
//
// Run: node --test test/js/laws/receiver_affordance_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from './harness.mjs'
import { frameWorldTransform, lawWorld } from '../../../assets/js/turtling/scheduler.js'
import { lawViolation } from '../../../assets/js/turtling/laws/verdict.js'
import { heldFrame } from '../../../assets/js/turtling/laws/constraints.js'
import { SE3, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const SRC = `def march a b c stride turn pause do
  as a do
    loop 3 do
      jmp stride
      rt turn
      wait pause
    end
  end
end
let A0
jmp 5
let A1
jmp 5
let A2
let distance(A0,A1)=5
let distance(A1,A2)=5
jmp 30
let B0
jmp 5
let B1
jmp 5
let B2
let distance(B0,B1)=5
let distance(B1,B2)=5
wait 1
let first = march A0 A1 A2 2 -20 1
let second = march B0 B1 B2 3 10 1
`

const q = (frame) => {
    const r = frameWorldTransform(frame).rotation
    return [r.w, r.x, r.y, r.z]
}
const at = (frame) => frameWorldTransform(frame).position
const r6 = (v) => v.map((n) => +n.toFixed(6))
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const close = (a, b, tol = 1e-6) => Math.hypot(...a.map((v, i) => v - b[i])) <= tol
const gate = (scheduler) => lawViolation(scheduler.laws.active(), new Map(), scheduler.registry, lawWorld)
const addresses = (scheduler) => scheduler.laws.active().map((law) => law.address).sort()

function until(ctx, predicate, { maxTicks = 400 } = {}) {
    for (let i = 0; i < maxTicks; i++) {
        ctx.scheduler._now = (ctx.scheduler._now ?? 0) + 1000
        ctx.scheduler.tick(ctx.scheduler._now)
        ctx.scheduler.readouts?.drain?.()
        if (predicate(ctx)) return true
    }
    return predicate(ctx)
}

function seat(opts = {}) {
    const seen = []
    const responder = []
    const scheduler = buildWorld({
        ...opts,
        validate: (v) => {
            seen.push({ command: v.request?.command ?? null, writer: v.writer,
                entries: v.entries.map((e) => e.frame.name) })
            return true
        },
        admit: opts.admit ? (request) => { responder.push(request.command); return opts.admit(request) } : undefined,
    })
    const host = scheduler.hotSwapChild('host', fork('host', SRC))
    return { scheduler, host, seen, responder }
}
const moved = (ctx, name, from) => dist(at(ctx.host.children.get(name)), from) > 1e-6
const ALL = ['A0', 'A1', 'A2', 'B0', 'B1', 'B2']

test('two assemblies share one recipe; withdrawing one leaves the other working', () => {
    const ctx = seat()
    const { scheduler, host } = ctx
    assert.equal(until(ctx, (c) => ALL.every((n) => c.host.children.get(n))), true,
        'both assemblies were born')

    // Both receivers move on their first joint step, while both loops still have work.
    assert.equal(until(ctx, (c) =>
        moved(c, 'A0', [0, 0, 0]) && moved(c, 'B0', [40, 0, 0]) &&
        c.scheduler.installationsOf(c.host.children.get('first'))[0]?.frame.done === false &&
        c.scheduler.installationsOf(c.host.children.get('second'))[0]?.frame.done === false), true)
    const first = host.children.get('first'), second = host.children.get('second')
    const original = Object.fromEntries(ALL.map((n) => [n, host.children.get(n)]))
    const [firstRec] = scheduler.installationsOf(first)
    const [secondRec] = scheduler.installationsOf(second)
    assert.ok(firstRec?.frame.done === false && secondRec?.frame.done === false, 'both continuations are live')
    const frozenA = Object.fromEntries(['A0', 'A1', 'A2'].map((n) => [n, [...at(host.children.get(n))]]))
    const frozenAQ = Object.fromEntries(['A0', 'A1', 'A2'].map((n) => [n, q(host.children.get(n))]))
    const frozenRev = scheduler.motionRevision
    const frozenLaws = addresses(scheduler)
    const bBefore = [...at(host.children.get('B0'))]
    assert.ok(moved(ctx, 'A0', [0, 0, 0]) && moved(ctx, 'B0', [40, 0, 0]), 'real joint motion before withdrawal')

    assert.equal(scheduler.retireInstallation(first, firstRec.site), true)
    assert.equal(until(ctx, (c) => secondRec.frame.done === true), true, 'the live assembly finished its own work')
    assert.equal(scheduler.installationsOf(first).length, 0)

    // The retired assembly is frozen in place, its participants and laws intact.
    for (const n of ['A0', 'A1', 'A2']) {
        assert.deepEqual(r6(at(host.children.get(n))), r6(frozenA[n]), `${n} frozen`)
    }
    assert.deepEqual(r6(q(host.children.get('A0'))), r6(frozenAQ.A0), 'retired writer heading frozen')
    assert.deepEqual(addresses(scheduler), frozenLaws, 'the SAME active laws survive withdrawal')
    for (const n of ALL) {
        assert.equal(host.children.get(n), original[n], `${n} is the ORIGINAL child object`)
        assert.equal(scheduler.registry.get(original[n].id), original[n], `${n} is the ORIGINAL registry object`)
    }

    // The live assembly moved further and still honours every original law and heading.
    assert.ok(dist(at(host.children.get('B0')), bBefore) > 1e-6, 'B kept working after A was withdrawn')
    assert.ok(scheduler.motionRevision > frozenRev, 'the live assembly advanced the revision')
    assert.equal(gate(scheduler).status, 'valid')
    for (const [a, b] of [['A0', 'A1'], ['A1', 'A2'], ['B0', 'B1'], ['B1', 'B2']])
        assert.ok(Math.abs(dist(at(host.children.get(a)), at(host.children.get(b))) - 5) < 1e-6, `${a}-${b} holds`)
    const turnB = SE3.rotateLocal(SE3.identity(), AXIS_Z, -3 * 10)
    assert.ok(close(q(host.children.get('B0')), [turnB.rotation.w, turnB.rotation.x, turnB.rotation.y, turnB.rotation.z]),
        'the writer heading is the authored 3 x turn')
    for (const n of ['A1', 'A2', 'B1', 'B2']) assert.deepEqual(r6(q(host.children.get(n))), [1, 0, 0, 0],
        `${n} keeps its accepted heading`)
    assert.equal(heldFrame(host.children.get('A0')), false)
    assert.equal(heldFrame(host.children.get('B0')), false)
    assert.deepEqual(scheduler.errors, [])
})

test('an installed host producer keeps precedence over the default follower', () => {
    const ctx = seat({ admit: (request) => ({ accepted: true, transform: request.requested }) })
    const { scheduler, host } = ctx
    assert.equal(until(ctx, (c) => c.host.children.get('first') && c.host.children.get('second') &&
        c.scheduler.installationsOf(c.host.children.get('first'))[0]?.frame.done === true &&
        c.scheduler.installationsOf(c.host.children.get('second'))[0]?.frame.done === true), true,
        'both finite ventures ran to completion')
    const jmps = ctx.seen.filter((v) => v.command === 'jmp' && v.writer?.installation === true)
    assert.equal(jmps.length, 6, 'three jmp requests per venture, each seen by the host')
    assert.ok(ctx.responder.includes('jmp'), 'the installed responder answered')
    assert.ok(jmps.every((v) => v.entries.length === 1), 'the default follower never expanded any candidate')
    assert.deepEqual(r6(at(host.children.get('A0'))), [0, 0, 0], 'A0 never translated')
    assert.deepEqual(r6(at(host.children.get('B0'))), [40, 0, 0], 'B0 never translated')
    assert.deepEqual(scheduler.errors, [])
})
